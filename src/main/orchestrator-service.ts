import fs from "node:fs";
import path from "node:path";
import {
  CliModelAdapter,
  ConfidenceLevel,
  ContinuationSeed,
  EvidenceBundle,
  createCodexAppServerInvoker,
  createGeminiAcpInvoker,
  ModelAssignment,
  ModelAdapterRegistry,
  OrchestratorApprovalDecision,
  OrchestratorApprovalRequest,
  OrchestratorInteractiveSessionRequest,
  OrchestratorInteractiveSessionResponse,
  OrchestratorUserInputRequest,
  OrchestratorUserInputResponse,
  ModelRef,
  OrchestratorCapability,
  OrchestratorEvent,
  OrchestratorPersistence,
  OrchestratorRuntime,
  RunSnapshot,
  WorkingMemoryUnknown,
  WorkspaceContextCache
} from "../orchestrator";
import { ToolManager } from "./tool-manager";
import {
  ManagedToolId,
  OrchestratorContinuationMode,
  ManagedToolModelCatalog,
  OrchestratorMode,
  OrchestratorRunSummary,
  RunOrchestratorInput
} from "./types";

const ORCHESTRATOR_CAPABILITIES: OrchestratorCapability[] = [
  "abstractPlan",
  "gather",
  "concretePlan",
  "review",
  "execute",
  "verify"
];

const ORCHESTRATOR_MODE_CONFIG: Record<
  OrchestratorMode,
  {
    title: string;
    requiredTools: ManagedToolId[];
    acceptanceCriterionId: string;
    acceptanceCriterionDescription: string;
  }
> = {
  gemini_only: {
    title: "Gemini Orchestrator Run",
    requiredTools: ["gemini"],
    acceptanceCriterionId: "gemini-run-completed",
    acceptanceCriterionDescription: "The Gemini-only orchestration completes successfully"
  },
  gemini_3_only: {
    title: "Gemini 3 Orchestrator Run (Stable)",
    requiredTools: ["gemini"],
    acceptanceCriterionId: "gemini-3-run-completed",
    acceptanceCriterionDescription: "The Gemini 3-only orchestration completes successfully"
  },
  codex_only: {
    title: "Codex Orchestrator Run",
    requiredTools: ["codex"],
    acceptanceCriterionId: "codex-run-completed",
    acceptanceCriterionDescription: "The Codex-only orchestration completes successfully"
  },
  cross_review: {
    title: "Cross-Review Orchestrator Run",
    requiredTools: ["codex", "gemini"],
    acceptanceCriterionId: "cross-review-run-completed",
    acceptanceCriterionDescription: "The Gemini and Codex cross-review orchestration completes successfully"
  }
};

type ResolvedModeConfig = {
  title: string;
  assignedModels: ModelAssignment;
  toolModels: Partial<Record<ManagedToolId, ModelRef[]>>;
  acceptanceCriterionId: string;
  acceptanceCriterionDescription: string;
};

export class OrchestratorService {
  private readonly runsRootDirectory: string;
  private readonly persistence: OrchestratorPersistence;
  private readonly activeRuns = new Map<string, OrchestratorRuntime>();

  constructor(
    private readonly appRootPath: string,
    private readonly userDataDirectory: string,
    private readonly toolManager: ToolManager
  ) {
    this.runsRootDirectory = path.join(this.userDataDirectory, "orchestrator-runs");
    this.persistence = new OrchestratorPersistence(this.runsRootDirectory);
  }

  async runOrchestrator(
    input: RunOrchestratorInput,
    onEvent?: (event: OrchestratorEvent) => void,
    requestUserApproval?: (request: OrchestratorApprovalRequest) => Promise<OrchestratorApprovalDecision>,
    requestUserInput?: (request: OrchestratorUserInputRequest) => Promise<OrchestratorUserInputResponse>,
    requestInteractiveSession?: (
      request: OrchestratorInteractiveSessionRequest
    ) => Promise<OrchestratorInteractiveSessionResponse>
  ): Promise<RunSnapshot> {
    const workspacePath = input.workspacePath?.trim();
    if (!workspacePath) {
      throw new Error("A workspace path is required to run the orchestrator");
    }

    const requestedMaxDepth = this.normalizeRequestedMaxDepth(input.maxDepth);
    const modeConfig = await this.resolveModeConfig(input.mode, workspacePath);
    const continuationSnapshot = this.loadContinuationSnapshot(input.continueFromRunId);
    const continuationMode = this.normalizeContinuationMode(input.continuationMode);
    const explicitContinuation = this.buildContinuationSeed(continuationSnapshot, continuationMode);
    const cachedContinuation = this.shouldUseCachedContinuation(input, continuationSnapshot)
      ? this.persistence.loadWorkspaceSeed(workspacePath)
      : undefined;
    const continuation = this.resolveContinuationSeed(explicitContinuation, cachedContinuation);
    const goal = this.resolveRunGoal(input, continuationSnapshot);
    let activeRunId: string | null = null;
    const runtime = new OrchestratorRuntime(await this.createRegistry(workspacePath, modeConfig.toolModels, input.sandbox ?? true, input.cliTimeoutSeconds, input.useGeminiAcpMode, input.geminiRegion), {
      persistence: this.persistence,
      enableRootBootstrapSketch: true,
      requestUserApproval,
      requestUserInput,
      requestInteractiveSession,
      onEvent: (event) => {
        if (!activeRunId) {
          activeRunId = event.runId;
          this.activeRuns.set(activeRunId, runtime);
        }

        onEvent?.(event);
      }
    });

    try {
      const result = await runtime.executeScheduledRun({
        goal,
        workspacePath,
        language: input.language,
        title: modeConfig.title,
        objective: goal,
        config: requestedMaxDepth === undefined
          ? undefined
          : {
              maxDepth: requestedMaxDepth
            },
        reviewPolicy: "light",
        executionBudget: requestedMaxDepth === undefined
          ? undefined
          : {
              maxDepth: requestedMaxDepth
            },
        continuation,
        assignedModels: modeConfig.assignedModels,
        acceptanceCriteria: {
          items: [
            {
              id: modeConfig.acceptanceCriterionId,
              description: modeConfig.acceptanceCriterionDescription,
              required: true,
              status: "pending"
            }
          ]
        }
      });

      return this.injectHistoricalNodes(result.snapshot);
    } finally {
      if (activeRunId) {
        this.activeRuns.delete(activeRunId);
      }
    }
  }

  cancelRun(runId: string): boolean {
    const runtime = this.activeRuns.get(runId);
    if (!runtime) {
      return false;
    }

    runtime.cancel("Orchestrator run cancelled by user");
    return true;
  }
  listRuns(): OrchestratorRunSummary[] {
    if (!fs.existsSync(this.runsRootDirectory)) return [];

    const summaries: OrchestratorRunSummary[] = [];
    for (const entry of fs.readdirSync(this.runsRootDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      try {
        const snapshot = this.persistence.loadSnapshot(entry.name);
        summaries.push({
          id: snapshot.run.id,
          goal: snapshot.run.goal,
          status: snapshot.run.status,
          createdAt: snapshot.run.createdAt,
          updatedAt: snapshot.run.updatedAt,
          completedAt: snapshot.run.completedAt,
          finalSummary: snapshot.finalReport?.summary ?? null
        });
      } catch {
        // Ignore corrupt or partial run directories.
      }
    }

    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getRun(runId: string): RunSnapshot {
    const snapshot = this.persistence.loadSnapshot(runId);
    return this.injectHistoricalNodes(snapshot);
  }

  private injectHistoricalNodes(snapshot: RunSnapshot): RunSnapshot {
    const historicalNodes: import("../orchestrator").PlanNode[] = [];
    let currentParentId = snapshot.run.continuedFromRunId;
    const visited = new Set<string>();

    while (currentParentId && !visited.has(currentParentId)) {
      visited.add(currentParentId);
      try {
        const parentSnapshot = this.persistence.loadSnapshot(currentParentId);
        
        // Include all nodes from the parent to preserve the tree hierarchy.
        // Filtering only 'done' nodes causes children to become orphans if their parent wasn't finished.
        const parentNodes = parentSnapshot.nodes;
        
        // We prepend them because we traverse from newest-parent to oldest-parent
        historicalNodes.unshift(...parentNodes);
        
        currentParentId = parentSnapshot.run.continuedFromRunId;
      } catch {
        break;
      }
    }

    if (historicalNodes.length > 0) {
      return {
        ...snapshot,
        nodes: [...historicalNodes, ...snapshot.nodes]
      };
    }

    return snapshot;
  }

  resetAllRuns(workspacePaths: string[] = []) {
    this.persistence.clearWorkspaceCachesForSavedRuns();
    this.clearWorkspaceCaches(workspacePaths);
    fs.rmSync(this.runsRootDirectory, { recursive: true, force: true });
    fs.mkdirSync(this.runsRootDirectory, { recursive: true });
  }

  getRequiredTools(mode: OrchestratorMode): ManagedToolId[] {
    return [...ORCHESTRATOR_MODE_CONFIG[mode].requiredTools];
  }

  private normalizeRequestedMaxDepth(value: number | null | undefined): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }

    const normalized = Math.trunc(value);
    return Math.min(6, Math.max(1, normalized));
  }

  private loadContinuationSnapshot(runId: string | null | undefined): RunSnapshot | undefined {
    const trimmedRunId = runId?.trim();
    if (!trimmedRunId) {
      return undefined;
    }

    return this.persistence.loadSnapshot(trimmedRunId);
  }

  private normalizeContinuationMode(value: OrchestratorContinuationMode | null | undefined): OrchestratorContinuationMode {
    return value === "next_action" ? "next_action" : "resume";
  }

  private shouldUseCachedContinuation(
    input: RunOrchestratorInput,
    continuationSnapshot: RunSnapshot | undefined
  ): boolean {
    void continuationSnapshot;
    // Only use cached continuation (workspace seed) if the user requested to continue or retry a node.
    // Fresh runs (including 'Resume with same goal' which we implement as a fresh run with pre-filled goal) 
    // should NOT use old memory to ensure a truly fresh start.
    return Boolean(input.continueFromRunId || input.continuationMode);
  }

  private resolveRunGoal(input: RunOrchestratorInput, continuationSnapshot: RunSnapshot | undefined): string {
    const explicitGoal = input.goal.trim();
    if (explicitGoal.length > 0) {
      return explicitGoal;
    }

    if (input.continuationMode === "next_action" && continuationSnapshot) {
      const nextAction = this.getContinuationNextAction(continuationSnapshot, input.nextActionIndex);
      if (nextAction) {
        return nextAction.objective;
      }
    }

    return continuationSnapshot?.run.goal ?? explicitGoal;
  }

  private buildContinuationSeed(
    snapshot: RunSnapshot | undefined,
    continuationMode: OrchestratorContinuationMode
  ): ContinuationSeed | undefined {
    if (!snapshot) {
      return undefined;
    }

    if (continuationMode === "next_action") {
      return this.buildTrimmedContinuationSeed(snapshot);
    }

    return {
      sourceRunId: snapshot.run.id,
      evidenceBundles: snapshot.evidenceBundles,
      workingMemory: snapshot.workingMemory,
      projectStructure: snapshot.projectStructure
    };
  }

  private resolveContinuationSeed(
    explicitContinuation: ContinuationSeed | undefined,
    cachedContinuation: ContinuationSeed | undefined
  ): ContinuationSeed | undefined {
    const explicitWithClues = explicitContinuation && this.hasContinuationClues(explicitContinuation)
      ? explicitContinuation
      : undefined;
    const cachedWithClues = cachedContinuation && this.hasContinuationClues(cachedContinuation)
      ? cachedContinuation
      : undefined;

    if (explicitWithClues && cachedWithClues) {
      return this.mergeContinuationSeeds(explicitWithClues, cachedWithClues);
    }

    return explicitWithClues ?? cachedWithClues ?? explicitContinuation ?? cachedContinuation;
  }

  private mergeContinuationSeeds(
    primary: ContinuationSeed,
    supplemental: ContinuationSeed
  ): ContinuationSeed {
    return {
      sourceRunId: primary.sourceRunId,
      evidenceBundles: this.mergeEvidenceBundles(primary.evidenceBundles, supplemental.evidenceBundles),
      workingMemory: {
        ...primary.workingMemory,
        facts: this.mergePrimaryFirstEntries(
          primary.workingMemory.facts,
          supplemental.workingMemory.facts,
          (entry) => this.normalizeContinuationText(entry.statement),
          (preferred, secondary) => ({
            ...preferred,
            confidence: this.mergeConfidence(preferred.confidence, secondary.confidence),
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        openQuestions: this.mergePrimaryFirstEntries(
          primary.workingMemory.openQuestions,
          supplemental.workingMemory.openQuestions,
          (entry) => this.normalizeContinuationText(entry.question),
          (preferred, secondary) => ({
            ...preferred,
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        unknowns: this.mergePrimaryFirstEntries(
          primary.workingMemory.unknowns,
          supplemental.workingMemory.unknowns,
          (entry) => this.normalizeContinuationText(entry.description),
          (preferred, secondary) => ({
            ...preferred,
            impact: this.mergeImpact(preferred.impact, secondary.impact),
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        conflicts: this.mergePrimaryFirstEntries(
          primary.workingMemory.conflicts,
          supplemental.workingMemory.conflicts,
          (entry) => this.normalizeContinuationText(entry.summary),
          (preferred, secondary) => ({
            ...preferred,
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        decisions: this.mergePrimaryFirstEntries(
          primary.workingMemory.decisions,
          supplemental.workingMemory.decisions,
          (entry) => `${this.normalizeContinuationText(entry.summary)}::${this.normalizeContinuationText(entry.rationale)}`,
          (preferred, secondary) => ({
            ...preferred,
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        updatedAt: this.pickLaterTimestamp(primary.workingMemory.updatedAt, supplemental.workingMemory.updatedAt)
      },
      projectStructure: {
        ...primary.projectStructure,
        summary: primary.projectStructure.summary.trim().length > 0
          ? primary.projectStructure.summary
          : supplemental.projectStructure.summary,
        directories: this.mergePrimaryFirstEntries(
          primary.projectStructure.directories,
          supplemental.projectStructure.directories,
          (entry) => entry.path.trim(),
          (preferred, secondary) => ({
            ...preferred,
            summary: preferred.summary.trim().length > 0 ? preferred.summary : secondary.summary,
            confidence: this.mergeConfidence(preferred.confidence, secondary.confidence),
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        keyFiles: this.mergePrimaryFirstEntries(
          primary.projectStructure.keyFiles,
          supplemental.projectStructure.keyFiles,
          (entry) => entry.path.trim(),
          (preferred, secondary) => ({
            ...preferred,
            summary: preferred.summary.trim().length > 0 ? preferred.summary : secondary.summary,
            confidence: this.mergeConfidence(preferred.confidence, secondary.confidence),
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        entryPoints: this.mergePrimaryFirstEntries(
          primary.projectStructure.entryPoints,
          supplemental.projectStructure.entryPoints,
          (entry) => `${entry.path.trim()}::${entry.role.trim()}`,
          (preferred, secondary) => ({
            ...preferred,
            summary: preferred.summary.trim().length > 0 ? preferred.summary : secondary.summary,
            confidence: this.mergeConfidence(preferred.confidence, secondary.confidence),
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        modules: this.mergePrimaryFirstEntries(
          primary.projectStructure.modules,
          supplemental.projectStructure.modules,
          (entry) => entry.name.trim(),
          (preferred, secondary) => ({
            ...preferred,
            summary: preferred.summary.trim().length > 0 ? preferred.summary : secondary.summary,
            relatedPaths: this.mergeStringLists(preferred.relatedPaths, secondary.relatedPaths),
            confidence: this.mergeConfidence(preferred.confidence, secondary.confidence),
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        openQuestions: this.mergePrimaryFirstEntries(
          primary.projectStructure.openQuestions,
          supplemental.projectStructure.openQuestions,
          (entry) => this.normalizeContinuationText(entry.question),
          (preferred, secondary) => ({
            ...preferred,
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        contradictions: this.mergePrimaryFirstEntries(
          primary.projectStructure.contradictions,
          supplemental.projectStructure.contradictions,
          (entry) => this.normalizeContinuationText(entry.summary),
          (preferred, secondary) => ({
            ...preferred,
            referenceIds: this.mergeStringLists(preferred.referenceIds, secondary.referenceIds),
            relatedNodeIds: this.mergeStringLists(preferred.relatedNodeIds, secondary.relatedNodeIds),
            createdAt: this.pickEarlierTimestamp(preferred.createdAt, secondary.createdAt),
            updatedAt: this.pickLaterTimestamp(preferred.updatedAt, secondary.updatedAt)
          })
        ),
        updatedAt: this.pickLaterTimestamp(primary.projectStructure.updatedAt, supplemental.projectStructure.updatedAt)
      }
    };
  }

  private mergeEvidenceBundles(primary: EvidenceBundle[], supplemental: EvidenceBundle[]): EvidenceBundle[] {
    return this.mergePrimaryFirstEntries(
      primary,
      supplemental,
      (entry) => entry.id.trim() || this.normalizeContinuationText(entry.summary),
      (preferred) => preferred
    );
  }

  private mergePrimaryFirstEntries<T>(
    primary: T[],
    supplemental: T[],
    keyFor: (entry: T) => string,
    merge: (preferred: T, secondary: T) => T
  ): T[] {
    const merged = new Map<string, T>();

    for (const entry of primary) {
      const key = keyFor(entry).trim();
      if (!key) {
        continue;
      }
      merged.set(key, entry);
    }

    for (const entry of supplemental) {
      const key = keyFor(entry).trim();
      if (!key) {
        continue;
      }
      const existing = merged.get(key);
      merged.set(key, existing ? merge(existing, entry) : entry);
    }

    return [...merged.values()];
  }

  private mergeStringLists(primary: string[], supplemental: string[]): string[] {
    return [...new Set([...primary, ...supplemental].map((entry) => entry.trim()).filter(Boolean))];
  }

  private mergeConfidence(left: ConfidenceLevel, right: ConfidenceLevel): ConfidenceLevel {
    return this.confidenceRank(left) >= this.confidenceRank(right) ? left : right;
  }

  private mergeImpact(left: WorkingMemoryUnknown["impact"], right: WorkingMemoryUnknown["impact"]): WorkingMemoryUnknown["impact"] {
    const rank = { low: 1, medium: 2, high: 3 };
    return rank[left] >= rank[right] ? left : right;
  }

  private confidenceRank(value: string): number {
    if (value === "high") return 4;
    if (value === "mixed") return 3;
    if (value === "medium") return 2;
    if (value === "low") return 1;
    return 0;
  }

  private pickEarlierTimestamp(left: string, right: string): string {
    return Date.parse(left) <= Date.parse(right) ? left : right;
  }

  private pickLaterTimestamp(left: string, right: string): string {
    return Date.parse(left) >= Date.parse(right) ? left : right;
  }

  private hasContinuationClues(continuation: ContinuationSeed): boolean {
    return continuation.evidenceBundles.length > 0
      || continuation.workingMemory.facts.length > 0
      || continuation.workingMemory.openQuestions.length > 0
      || continuation.workingMemory.unknowns.length > 0
      || continuation.workingMemory.conflicts.length > 0
      || continuation.workingMemory.decisions.length > 0
      || continuation.projectStructure.summary.trim().length > 0
      || continuation.projectStructure.directories.length > 0
      || continuation.projectStructure.keyFiles.length > 0
      || continuation.projectStructure.entryPoints.length > 0
      || continuation.projectStructure.modules.length > 0;
  }

  private buildTrimmedContinuationSeed(snapshot: RunSnapshot): ContinuationSeed {
    const carryForward = snapshot.finalReport?.carryForward;
    if (!carryForward) {
      return {
        sourceRunId: snapshot.run.id,
        evidenceBundles: snapshot.evidenceBundles,
        workingMemory: snapshot.workingMemory,
        projectStructure: snapshot.projectStructure
      };
    }

    const factKeys = new Set(carryForward.facts.map((entry) => this.normalizeContinuationText(entry)).filter(Boolean));
    const questionKeys = new Set(carryForward.openQuestions.map((entry) => this.normalizeContinuationText(entry)).filter(Boolean));
    const pathKeys = new Set(carryForward.projectPaths.map((entry) => entry.trim()).filter(Boolean));
    const evidenceKeys = new Set(carryForward.evidenceSummaries.map((entry) => this.normalizeContinuationText(entry)).filter(Boolean));

    const evidenceBundles = snapshot.evidenceBundles.filter((bundle) => {
      const summaryKey = this.normalizeContinuationText(bundle.summary);
      if (evidenceKeys.has(summaryKey)) {
        return true;
      }

      return bundle.relevantTargets.some((target) => this.pathMatches(pathKeys, target.filePath))
        || bundle.facts.some((fact) => factKeys.has(this.normalizeContinuationText(fact.statement)))
        || bundle.unknowns.some((unknown) => questionKeys.has(this.normalizeContinuationText(unknown.question)));
    });

    const workingMemory = {
      ...snapshot.workingMemory,
      facts: snapshot.workingMemory.facts.filter((fact) =>
        factKeys.has(this.normalizeContinuationText(fact.statement))
        || this.referencesPath(pathKeys, fact.statement)
      ),
      openQuestions: snapshot.workingMemory.openQuestions.filter((question) =>
        questionKeys.has(this.normalizeContinuationText(question.question))
      ),
      unknowns: snapshot.workingMemory.unknowns.filter((unknown) =>
        questionKeys.has(this.normalizeContinuationText(unknown.description))
      ),
      conflicts: snapshot.workingMemory.conflicts.filter((conflict) =>
        this.referencesPath(pathKeys, conflict.summary)
        || questionKeys.has(this.normalizeContinuationText(conflict.summary))
      ),
      decisions: snapshot.workingMemory.decisions.filter((decision) =>
        this.referencesPath(pathKeys, decision.summary)
        || factKeys.has(this.normalizeContinuationText(decision.summary))
      )
    };

    const projectStructure = {
      ...snapshot.projectStructure,
      directories: snapshot.projectStructure.directories.filter((entry) => this.pathMatches(pathKeys, entry.path)),
      keyFiles: snapshot.projectStructure.keyFiles.filter((entry) => this.pathMatches(pathKeys, entry.path)),
      entryPoints: snapshot.projectStructure.entryPoints.filter((entry) => this.pathMatches(pathKeys, entry.path)),
      modules: snapshot.projectStructure.modules.filter((module) =>
        module.relatedPaths.some((relatedPath) => this.pathMatches(pathKeys, relatedPath))
      ),
      openQuestions: snapshot.projectStructure.openQuestions.filter((question) =>
        questionKeys.has(this.normalizeContinuationText(question.question))
      ),
      contradictions: snapshot.projectStructure.contradictions.filter((contradiction) =>
        questionKeys.has(this.normalizeContinuationText(contradiction.summary))
        || this.referencesPath(pathKeys, contradiction.summary)
      )
    };

    return {
      sourceRunId: snapshot.run.id,
      evidenceBundles: evidenceBundles.length > 0 ? evidenceBundles : snapshot.evidenceBundles,
      workingMemory,
      projectStructure
    };
  }

  private getContinuationNextAction(snapshot: RunSnapshot, nextActionIndex: number | null | undefined) {
    const nextActions = snapshot.finalReport?.nextActions ?? [];
    if (nextActions.length === 0) {
      return undefined;
    }

    if (typeof nextActionIndex !== "number" || !Number.isFinite(nextActionIndex)) {
      return nextActions[0];
    }

    return nextActions[Math.max(0, Math.min(nextActions.length - 1, Math.trunc(nextActionIndex)))];
  }

  private normalizeContinuationText(value: string): string {
    return value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[`"'’“”]/g, "")
      .replace(/[()[\]{}:;,.!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private pathMatches(pathKeys: Set<string>, candidate: string | undefined): boolean {
    if (!candidate) {
      return false;
    }

    for (const pathKey of pathKeys) {
      if (pathKey === candidate || candidate.includes(pathKey) || pathKey.includes(candidate)) {
        return true;
      }
    }

    return false;
  }

  private referencesPath(pathKeys: Set<string>, text: string): boolean {
    for (const pathKey of pathKeys) {
      if (text.includes(pathKey)) {
        return true;
      }
    }
    return false;
  }

  clearWorkspaceCaches(workspacePaths: string[]) {
    const seen = new Set<string>();
    for (const workspacePath of workspacePaths) {
      const normalizedPath = workspacePath.trim();
      const cachePath = path.join(workspacePath, ".tasksaw");
      if (!normalizedPath || seen.has(normalizedPath)) {
        continue;
      }

      seen.add(normalizedPath);
      try {
        new WorkspaceContextCache(normalizedPath).clear();
      } catch {
        // Ignore cache cleanup failures during reset.
      }
    }
  }

  private async resolveModeConfig(mode: OrchestratorMode, workspacePath: string): Promise<ResolvedModeConfig> {
    const baseConfig = ORCHESTRATOR_MODE_CONFIG[mode];
    await Promise.all(
      this.getRequiredTools(mode).map((toolId) => this.toolManager.prepareWorkspaceContext(toolId, workspacePath))
    );
    const discoveredCatalogs = await Promise.all(
      baseConfig.requiredTools.map((toolId) => this.toolManager.discoverModelCatalog(toolId, workspacePath))
    );
    const catalogsByTool = new Map(discoveredCatalogs.map((catalog) => [catalog.toolId, catalog] as const));

    const codexPlanningModel = catalogsByTool.has("codex")
      ? this.selectCodexPlanningModel(catalogsByTool.get("codex")!)
      : undefined;
    const codexWorkerModel = catalogsByTool.has("codex")
      ? this.selectCodexWorkerModel(catalogsByTool.get("codex")!, codexPlanningModel)
      : undefined;
    const geminiPlanningModel = catalogsByTool.has("gemini")
      ? this.selectGeminiPlanningModel(catalogsByTool.get("gemini")!)
      : undefined;
    const geminiWorkerModel = catalogsByTool.has("gemini")
      ? this.selectGeminiWorkerModel(catalogsByTool.get("gemini")!, geminiPlanningModel)
      : undefined;

    const gemini3PlanningModel = catalogsByTool.has("gemini")
      ? this.selectGemini3PlanningModel(catalogsByTool.get("gemini")!)
      : undefined;
    const gemini3WorkerModel = catalogsByTool.has("gemini")
      ? this.selectGemini3WorkerModel(catalogsByTool.get("gemini")!, gemini3PlanningModel!)
      : undefined;

    if (mode === "gemini_only" || mode === "gemini_3_only") {
      const activeGeminiPlanningModel = mode === "gemini_3_only" ? gemini3PlanningModel : geminiPlanningModel;
      const activeGeminiWorkerModel = mode === "gemini_3_only" ? gemini3WorkerModel : geminiWorkerModel;

      if (!activeGeminiPlanningModel) {
        throw new Error(`Gemini mode requires a discovered Gemini model for mode ${mode}`);
      }
      const workerModel = activeGeminiWorkerModel ?? activeGeminiPlanningModel;

      return {
        title: baseConfig.title,
        assignedModels: {
          abstractPlanner: activeGeminiPlanningModel,
          gatherer: workerModel,
          concretePlanner: activeGeminiPlanningModel,
          reviewer: workerModel,
          executor: workerModel,
          verifier: workerModel
        },
        toolModels: {
          gemini: this.uniqueModels([activeGeminiPlanningModel, workerModel])
        },
        acceptanceCriterionId: baseConfig.acceptanceCriterionId,
        acceptanceCriterionDescription: baseConfig.acceptanceCriterionDescription
      };
    }

    if (mode === "codex_only") {
      if (!codexPlanningModel) {
        throw new Error("Codex mode requires a discovered Codex model");
      }
      const workerModel = codexWorkerModel ?? codexPlanningModel;

      return {
        title: baseConfig.title,
        assignedModels: {
          abstractPlanner: codexPlanningModel,
          gatherer: workerModel,
          concretePlanner: codexPlanningModel,
          reviewer: workerModel,
          executor: workerModel,
          verifier: workerModel
        },
        toolModels: {
          codex: this.uniqueModels([codexPlanningModel, workerModel])
        },
        acceptanceCriterionId: baseConfig.acceptanceCriterionId,
        acceptanceCriterionDescription: baseConfig.acceptanceCriterionDescription
      };
    }

    if (!codexPlanningModel || !geminiPlanningModel) {
      throw new Error("Cross-review mode requires discovered Codex and Gemini models");
    }
    const geminiWorker = geminiWorkerModel ?? geminiPlanningModel;
    const codexWorker = codexWorkerModel ?? codexPlanningModel;

    return {
      title: baseConfig.title,
      assignedModels: {
        abstractPlanner: codexPlanningModel,
        gatherer: geminiWorker,
        concretePlanner: codexPlanningModel,
        reviewer: geminiWorker,
        executor: codexWorker,
        verifier: codexWorker
      },
      toolModels: {
        codex: this.uniqueModels([codexPlanningModel, codexWorker]),
        gemini: this.uniqueModels([geminiPlanningModel, geminiWorker])
      },
      acceptanceCriterionId: baseConfig.acceptanceCriterionId,
      acceptanceCriterionDescription: baseConfig.acceptanceCriterionDescription
    };
  }

  private selectCodexPlanningModel(catalog: ManagedToolModelCatalog): ModelRef {
    const selectedModel = this.findCatalogModel(catalog, catalog.recommendedPlannerModelId)
      ?? this.pickBestModel(catalog, (model) =>
        (model.hidden ? -1_000_000 : 0)
        + (this.scoreReasoningCapability(model) * 10)
        + (model.isDefault ? 1 : 0)
      );
    if (!selectedModel) {
      throw new Error("Codex CLI did not report any available models");
    }

    return this.toModelRef(catalog.provider, selectedModel, "upper", "planner");
  }

  private selectCodexWorkerModel(catalog: ManagedToolModelCatalog, planningModel: ModelRef | undefined): ModelRef | undefined {
    // Token efficiency strategy: strongly prefer mini family for worker models.
    // Mini models use significantly fewer tokens for execution and gather phases.
    const preferredMiniModel = this.pickBestCandidate(
      this.listSelectableModels(catalog).filter((model) => this.isCodexMiniFamilyModel(model.model)),
      (model) =>
        (model.hidden ? -1_000_000 : 0)
        + (model.isDefault ? 10_000 : 0)
        + (this.scoreLighterReasoningPreference(model) * 10)
    );

    // If a mini model exists, use it immediately — skip all other candidates.
    if (preferredMiniModel) {
      return this.toModelRef(catalog.provider, preferredMiniModel, "lower", "worker");
    }

    // No mini model available — fall back to recommended/current/any with forced low reasoning.
    const recommendedWorkerModel = this.findCatalogModel(catalog, catalog.recommendedWorkerModelId);
    const currentModel = this.findCatalogModel(catalog, catalog.currentModelId);
    const selectedModel = recommendedWorkerModel
      ?? currentModel
      ?? this.pickBestCandidate(this.listSelectableModels(catalog), (model) =>
        (model.hidden ? -1_000_000 : 0)
        + (model.isDefault ? 10_000 : 0)
        + (this.scoreLighterReasoningPreference(model) * 10)
      );

    if (!selectedModel) {
      return planningModel;
    }

    return this.toModelRef(catalog.provider, selectedModel, "lower", "worker");
  }

  private selectGeminiPlanningModel(catalog: ManagedToolModelCatalog): ModelRef {
    const selectedModel = this.findCatalogModel(catalog, catalog.recommendedPlannerModelId)
      ?? this.findCatalogModel(catalog, catalog.currentModelId)
      ?? this.pickBestCandidate(
        this.listSelectableModels(catalog).filter((model) => this.isConcreteGeminiModel(model.model)),
        (model) => (model.isDefault ? 1 : 0)
      )
      ?? this.pickBestModel(catalog, (model) => (model.isDefault ? 1 : 0));
    if (!selectedModel) {
      throw new Error("Gemini CLI did not report any available models");
    }

    return this.toModelRef(catalog.provider, selectedModel, "upper", "planner");
  }

  private selectGeminiWorkerModel(catalog: ManagedToolModelCatalog, planningModel: ModelRef | undefined): ModelRef | undefined {
    const selectedModel = this.findCatalogModel(catalog, catalog.recommendedWorkerModelId)
      ?? this.findCatalogModel(catalog, catalog.currentModelId)
      ?? this.pickBestCandidate(
        this.listSelectableModels(catalog).filter((model) => this.isConcreteGeminiModel(model.model)),
        (model) => (model.isDefault ? 1 : 0)
      );

    if (!selectedModel) {
      return planningModel;
    }

    return this.toModelRef(catalog.provider, selectedModel, "lower", "worker");
  }

  private selectGemini3PlanningModel(catalog: ManagedToolModelCatalog): ModelRef {
    // Try to find a stable (non-preview, non-exp) Gemini model from the catalog,
    // preferring Gemini 3+ if available, otherwise fall back to latest stable (2.5)
    const stableCandidates = this.listSelectableModels(catalog).filter((model) =>
      this.isStableGeminiModel(model.model)
    );

    const stableModel = this.pickBestCandidate(stableCandidates, (model) => {
      let score = model.isDefault ? 1 : 0;
      if (model.model.includes("pro")) score += 2;
      // Prefer higher versions
      if (model.model.startsWith("gemini-3")) score += 10;
      if (model.model.startsWith("gemini-2.5")) score += 5;
      return score;
    });

    if (stableModel) {
      return this.toModelRef(catalog.provider, stableModel, "upper", "planner");
    }

    // Hardcode fallback: gemini-2.5-pro (latest confirmed stable model)
    return {
      id: "gemini-2.5-pro",
      provider: catalog.provider,
      model: "gemini-2.5-pro",
      tier: "upper",
      reasoningEffort: "high"
    };
  }

  private selectGemini3WorkerModel(catalog: ManagedToolModelCatalog, planningModel: ModelRef): ModelRef {
    // Try to find a stable (non-preview, non-exp) Gemini model from the catalog
    const stableCandidates = this.listSelectableModels(catalog).filter((model) =>
      this.isStableGeminiModel(model.model)
    );

    const stableModel = this.pickBestCandidate(stableCandidates, (model) => {
      let score = model.isDefault ? 1 : 0;
      if (model.model.includes("flash")) score += 2;
      // Prefer higher versions
      if (model.model.startsWith("gemini-3")) score += 10;
      if (model.model.startsWith("gemini-2.5")) score += 5;
      return score;
    });

    if (stableModel) {
      return this.toModelRef(catalog.provider, stableModel, "lower", "worker");
    }

    // Hardcode fallback: gemini-2.5-flash (latest confirmed stable model)
    return {
      id: "gemini-2.5-flash",
      provider: catalog.provider,
      model: "gemini-2.5-flash",
      tier: "lower",
      reasoningEffort: "low"
    };
  }

  private isStableGeminiModel(model: string): boolean {
    return this.isConcreteGeminiModel(model) && !model.includes("preview") && !model.includes("exp");
  }

  private isConcreteGeminiModel(model: string): boolean {
    return model.startsWith("gemini-") && !model.startsWith("auto-") && !model.includes("customtools");
  }

  private isCodexMiniFamilyModel(model: string): boolean {
    return model.toLowerCase().includes("mini");
  }

  private normalizeReasoningEffort(value: string | null | undefined): ModelRef["reasoningEffort"] {
    if (value === "low" || value === "medium" || value === "high" || value === "xhigh") {
      return value;
    }

    return undefined;
  }

  private async createRegistry(
    workspacePath: string,
    toolModels: Partial<Record<ManagedToolId, ModelRef[]>>,
    sandbox: boolean,
    cliTimeoutSeconds?: number | null,
    useGeminiAcpMode?: boolean,
    geminiRegion?: string | null
  ): Promise<ModelAdapterRegistry> {
    const registry = new ModelAdapterRegistry();
    const cliRunnerPath = path.join(this.appRootPath, "dist", "main", "node-cli-runner.js");
    const codexModels = toolModels.codex ?? [];
    const geminiModels = toolModels.gemini ?? [];

    if (codexModels.length > 0) {
      await this.toolManager.prepareWorkspaceContext("codex", workspacePath);
      const codexCommand = await this.toolManager.resolveLaunchCommand("codex");
      const codexEntryPath = this.requireManagedEntryPath(codexCommand.args, "codex");
      const codexEnv = this.toolManager.buildManagedExecutionEnvironment("codex");
      const codexConfigArgs = this.toolManager.getCodexWorkspaceConfigArgs(workspacePath);

      for (const codexModel of this.uniqueModels(codexModels)) {
        registry.register(
          new CliModelAdapter({
            model: codexModel,
            flavor: "codex",
            executablePath: codexCommand.command,
            executableArgs: [cliRunnerPath, codexEntryPath, ...codexConfigArgs],
            cwd: workspacePath,
            env: {
              ...codexEnv,
              ...codexCommand.env
            },
            customInvoke: createCodexAppServerInvoker({
              executablePath: codexCommand.command,
              executableArgs: [cliRunnerPath, codexEntryPath, ...codexConfigArgs],
              cwd: workspacePath,
              env: {
                ...codexEnv,
                ...codexCommand.env
              },
              timeoutMs: typeof cliTimeoutSeconds === "number" && cliTimeoutSeconds > 0 ? Math.trunc(cliTimeoutSeconds) * 1000 : undefined
            }),
            supportedCapabilities: ORCHESTRATOR_CAPABILITIES
          })
        );
      }
    }

    if (geminiModels.length > 0) {
      await this.toolManager.prepareWorkspaceContext("gemini", workspacePath);
      const geminiCommand = await this.toolManager.resolveLaunchCommand("gemini");
      const geminiEnv = this.toolManager.buildManagedExecutionEnvironment("gemini", geminiRegion);
      const geminiAcpModulePath = this.toolManager.getGeminiAcpModulePath();
      const geminiFallbackModelIds = this.uniqueModels(geminiModels).map((model) => model.model);
      
      const hasFlash = geminiFallbackModelIds.some((id) => id.includes("flash"));
      if (hasFlash) {
        if (!geminiFallbackModelIds.includes("gemini-2.5-flash-lite")) {
          geminiFallbackModelIds.push("gemini-2.5-flash-lite");
        }
        if (!geminiFallbackModelIds.includes("gemini-2.5-flash")) {
          geminiFallbackModelIds.push("gemini-2.5-flash");
        }
        if (!geminiFallbackModelIds.includes("gemini-3-flash-preview")) {
          geminiFallbackModelIds.push("gemini-3-flash-preview");
        }
        if (!geminiFallbackModelIds.some((id) => id.includes("pro"))) {
          geminiFallbackModelIds.push("gemini-2.5-pro");
        }
      }

      const sharedGeminiInvoke = createGeminiAcpInvoker({
        executablePath: geminiCommand.command,
        executableArgs: [cliRunnerPath, ...geminiCommand.args],
        acpModulePath: geminiAcpModulePath,
        cwd: workspacePath,
        fallbackModelIds: geminiFallbackModelIds,
        sandbox,
        env: {
          ...geminiEnv,
          ...geminiCommand.env
        },
        temperature: 0,
        timeoutMs: typeof cliTimeoutSeconds === "number" && cliTimeoutSeconds > 0 ? Math.trunc(cliTimeoutSeconds) * 1000 : undefined
      });

      for (const geminiModel of this.uniqueModels(geminiModels)) {
        registry.register(
          new CliModelAdapter({
            model: geminiModel,
            flavor: "gemini",
            executablePath: geminiCommand.command,
            executableArgs: [cliRunnerPath, ...geminiCommand.args],
            cwd: workspacePath,
            env: {
              ...geminiEnv,
              ...geminiCommand.env
            },
            customInvoke: useGeminiAcpMode !== false ? sharedGeminiInvoke : undefined,
            supportedCapabilities: ORCHESTRATOR_CAPABILITIES
          })
        );
      }
    }

    return registry;
  }

  private pickBestModel(
    catalog: ManagedToolModelCatalog,
    score: (model: ManagedToolModelCatalog["models"][number]) => number
  ): ManagedToolModelCatalog["models"][number] | undefined {
    return this.pickBestCandidate(catalog.models, score);
  }

  private pickBestCandidate(
    models: ManagedToolModelCatalog["models"],
    score: (model: ManagedToolModelCatalog["models"][number]) => number
  ): ManagedToolModelCatalog["models"][number] | undefined {
    return [...models]
      .sort((left, right) => score(right) - score(left))
      .find((model) => !model.hidden)
      ?? [...models].sort((left, right) => score(right) - score(left))[0];
  }

  private listSelectableModels(catalog: ManagedToolModelCatalog): ManagedToolModelCatalog["models"] {
    const visibleModels = catalog.models.filter((model) => !model.hidden);
    return visibleModels.length > 0 ? visibleModels : [...catalog.models];
  }

  private scoreReasoningCapability(model: ManagedToolModelCatalog["models"][number]): number {
    if (model.supportedReasoningEfforts.includes("xhigh")) return 400;
    if (model.supportedReasoningEfforts.includes("high")) return 300;
    if (model.supportedReasoningEfforts.includes("medium")) return 200;
    if (model.supportedReasoningEfforts.includes("low")) return 100;

    const normalizedDefaultReasoning = this.normalizeReasoningEffort(model.defaultReasoningEffort);
    if (normalizedDefaultReasoning === "xhigh") return 350;
    if (normalizedDefaultReasoning === "high") return 250;
    if (normalizedDefaultReasoning === "medium") return 150;
    if (normalizedDefaultReasoning === "low") return 50;
    return 0;
  }

  private scoreLighterReasoningPreference(model: ManagedToolModelCatalog["models"][number]): number {
    if (model.supportedReasoningEfforts.includes("low")) return 400;
    if (model.supportedReasoningEfforts.includes("medium")) return 300;
    if (model.supportedReasoningEfforts.includes("high")) return 200;
    if (model.supportedReasoningEfforts.includes("xhigh")) return 100;

    const normalizedDefaultReasoning = this.normalizeReasoningEffort(model.defaultReasoningEffort);
    if (normalizedDefaultReasoning === "low") return 350;
    if (normalizedDefaultReasoning === "medium") return 250;
    if (normalizedDefaultReasoning === "high") return 150;
    if (normalizedDefaultReasoning === "xhigh") return 50;
    return 0;
  }

  private findCatalogModel(
    catalog: ManagedToolModelCatalog,
    requestedModelId: string | null | undefined
  ): ManagedToolModelCatalog["models"][number] | undefined {
    if (!requestedModelId) {
      return undefined;
    }

    const selectableModels = this.listSelectableModels(catalog);
    return selectableModels.find((model) => model.id === requestedModelId || model.model === requestedModelId)
      ?? catalog.models.find((model) => model.id === requestedModelId || model.model === requestedModelId);
  }

  private toModelRef(
    provider: string,
    selectedModel: ManagedToolModelCatalog["models"][number],
    tier: ModelRef["tier"],
    usage: "planner" | "worker"
  ): ModelRef {
    return {
      id: selectedModel.id,
      provider,
      model: selectedModel.model,
      tier,
      reasoningEffort: usage === "planner"
        ? this.selectPlannerReasoningEffort(selectedModel)
        : this.selectWorkerReasoningEffort(selectedModel)
    };
  }

  private selectPlannerReasoningEffort(
    model: ManagedToolModelCatalog["models"][number]
  ): ModelRef["reasoningEffort"] {
    if (model.supportedReasoningEfforts.includes("xhigh")) return "xhigh";
    if (model.supportedReasoningEfforts.includes("high")) return "high";
    return this.normalizeReasoningEffort(model.defaultReasoningEffort);
  }

  private selectWorkerReasoningEffort(
    model: ManagedToolModelCatalog["models"][number]
  ): ModelRef["reasoningEffort"] {
    if (model.supportedReasoningEfforts.includes("low")) return "low";
    if (model.supportedReasoningEfforts.includes("medium")) return "medium";

    const normalizedDefaultReasoning = this.normalizeReasoningEffort(model.defaultReasoningEffort);
    if (normalizedDefaultReasoning === "low" || normalizedDefaultReasoning === "medium") {
      return normalizedDefaultReasoning;
    }

    if (model.supportedReasoningEfforts.includes("high")) return "high";
    if (model.supportedReasoningEfforts.includes("xhigh")) return "high";
    return normalizedDefaultReasoning;
  }

  private uniqueModels(models: Array<ModelRef | undefined>): ModelRef[] {
    const seen = new Set<string>();
    const unique: ModelRef[] = [];

    for (const model of models) {
      if (!model || seen.has(model.id)) {
        continue;
      }

      seen.add(model.id);
      unique.push(model);
    }

    return unique;
  }

  private requireManagedEntryPath(args: string[], toolId: ManagedToolId): string {
    const entryPath = args[0];
    if (!entryPath) {
      throw new Error(`Managed ${toolId} launch command did not expose an entry path`);
    }

    return entryPath;
  }
}
