import { randomUUID } from "node:crypto";
import { OrchestratorEngine, OrchestratorEventListener } from "./engine";
import { EvidenceStore } from "./evidence-store";
import { findUnresolvedSuccessSignal } from "./execution-guardrails";
import {
  AbstractPlanResult,
  ConcretePlanResult,
  ExecuteResult,
  GatherResult,
  OrchestratorApprovalDecision,
  OrchestratorApprovalRequest,
  OrchestratorUserInputRequest,
  OrchestratorUserInputResponse,
  ModelInvocationContext,
  OrchestratorCapability,
  OrchestratorModelAdapter,
  ReviewResult,
  VerifyResult
} from "./model-adapter";
import { ModelAdapterRegistry } from "./adapter-registry";
import { OrchestratorPersistence } from "./persistence";
import { ProjectStructureMemoryStore } from "./project-structure-memory";
import { OrderedDfsScheduler } from "./scheduler";
import {
  ContinuationSeed,
  CreateRunInput,
  EvidenceBundle,
  EvidenceBundleDraft,
  ModelAssignment,
  ModelExecutionDebugInfo,
  ModelRef,
  NodePhase,
  OrchestratorFinalReport,
  OrchestratorWorkflowStage,
  PlanNode,
  ProjectStructureSnapshot,
  Run,
  RunSnapshot,
  WorkingMemorySnapshot
} from "./types";
import { WorkingMemoryStore } from "./working-memory";

type AssignedModelRole = keyof ModelAssignment;
const ALL_ASSIGNED_MODEL_ROLES: AssignedModelRole[] = [
  "abstractPlanner",
  "gatherer",
  "concretePlanner",
  "reviewer",
  "executor",
  "verifier"
];
const ASSIGNED_ROLE_CAPABILITY: Record<AssignedModelRole, OrchestratorCapability> = {
  abstractPlanner: "abstractPlan",
  gatherer: "gather",
  concretePlanner: "concretePlan",
  reviewer: "review",
  executor: "execute",
  verifier: "verify"
};

const PRECISE_DATA_REQUEST_PATTERN = /\b(?:exact|actual|accurate|precise|real)\b|정확|실제|정확한|정확하게|실시간/i;
const FALLBACK_EXECUTION_PATTERN = /\bn\/a\b|no data|data unavailable|placeholder|fallback|not tracked|not available|usage unavailable|quota unavailable|정보 없음|데이터 없음|추적 불가|지원하지 않|표시를 .* 변경/i;
const DATA_SOURCE_BLOCKER_PATTERN = /\b(?:quota|usage|remaining|stats model|retrieveuserquota|unsupported|unavailable|not expose|not exposed|missing data source|blocked by missing source)\b|지원하지 않|노출하지 않|불가|제약|데이터 소스/i;
const REPOSITORY_EVIDENCE_PATTERN = /\bsrc\/|tool-manager\.ts|renderer\/app\.ts|main\/types\.ts/i;
const EXTERNAL_SURFACE_EVIDENCE_PATTERN = /managed-tools|gemini-cli|\/stats model|retrieveuserquota|codeassist|\.gemini|auth login status/i;

type RootPhaseResults = {
  abstractPlan: AbstractPlanResult;
  gather: GatherResult;
  consolidatedEvidence: EvidenceBundle;
  concretePlan: ConcretePlanResult;
  review?: ReviewResult;
  execute?: ExecuteResult;
  verify?: VerifyResult;
};

type NodePhaseResults = Partial<RootPhaseResults>;

type NodeExecutionOutcome = {
  node: PlanNode;
  phaseResults: NodePhaseResults;
  outputs: string[];
  verifySummaries: string[];
  verificationPassed: boolean;
};

type ProjectStructureInspectionRequest = {
  objectives: string[];
  contradictions: string[];
};

export type HappyPathExecutionResult = {
  run: Run;
  rootNode: PlanNode;
  finalReport: OrchestratorFinalReport;
  snapshot: RunSnapshot;
  phaseResults: {
    abstractPlan: AbstractPlanResult;
    gather: GatherResult;
    consolidatedEvidence: EvidenceBundle;
    concretePlan: ConcretePlanResult;
    review?: ReviewResult;
    execute: ExecuteResult;
    verify: VerifyResult;
  };
};

export type ScheduledRunExecutionResult = {
  run: Run;
  rootNode: PlanNode;
  finalReport: OrchestratorFinalReport;
  snapshot: RunSnapshot;
  outputs: string[];
  verifySummaries: string[];
};

export type OrchestratorRuntimeOptions = {
  engine?: OrchestratorEngine;
  evidenceStore?: EvidenceStore;
  persistence?: OrchestratorPersistence;
  now?: () => string;
  onEvent?: OrchestratorEventListener;
  enableRootBootstrapSketch?: boolean;
  requestUserApproval?: (request: OrchestratorApprovalRequest) => Promise<OrchestratorApprovalDecision>;
  requestUserInput?: (request: OrchestratorUserInputRequest) => Promise<OrchestratorUserInputResponse>;
};

export class MissingModelAssignmentError extends Error {
  constructor(nodeId: string, role: AssignedModelRole) {
    super(`Node ${nodeId} is missing a model assignment for role ${role}`);
    this.name = "MissingModelAssignmentError";
  }
}

export class MissingChildTaskModelAssignmentError extends Error {
  constructor(nodeId: string, childTitle: string, role: AssignedModelRole) {
    super(`Planning node ${nodeId} routed child task "${childTitle}" without a model assignment for role ${role}`);
    this.name = "MissingChildTaskModelAssignmentError";
  }
}

export class VerificationFailedError extends Error {
  constructor(nodeId: string, summary: string) {
    super(`Verification failed for node ${nodeId}: ${summary}`);
    this.name = "VerificationFailedError";
  }
}

export class ExecutionNotCompletedError extends Error {
  constructor(nodeId: string, summary: string) {
    super(`Execution did not complete for node ${nodeId}: ${summary}`);
    this.name = "ExecutionNotCompletedError";
  }
}

export class OrchestratorRunCancelledError extends Error {
  constructor(
    message = "Orchestrator run cancelled",
    readonly runId?: string,
    readonly nodeId?: string,
    readonly snapshot?: RunSnapshot
  ) {
    super(message);
    this.name = "OrchestratorRunCancelledError";
  }
}

export class OrchestratorRuntime {
  private readonly engine: OrchestratorEngine;
  private readonly evidenceStore: EvidenceStore;
  private readonly persistence: OrchestratorPersistence | undefined;
  private readonly now: () => string;
  private readonly onEvent: OrchestratorEventListener | undefined;
  private readonly enableRootBootstrapSketch: boolean;
  private readonly requestUserApprovalHandler: ((request: OrchestratorApprovalRequest) => Promise<OrchestratorApprovalDecision>) | undefined;
  private readonly requestUserInputHandler: ((request: OrchestratorUserInputRequest) => Promise<OrchestratorUserInputResponse>) | undefined;
  private readonly scheduler = new OrderedDfsScheduler();
  private readonly workingMemoryByRun = new Map<string, WorkingMemoryStore>();
  private readonly projectStructureByRun = new Map<string, ProjectStructureMemoryStore>();
  private readonly projectStructureInspectionNodeIdsByRun = new Map<string, Set<string>>();
  private readonly projectStructureInspectionAttemptsByNode = new Map<string, number>();
  private readonly focusedGatherAttemptsByNode = new Map<string, number>();
  private readonly finalReports = new Map<string, OrchestratorFinalReport>();
  private readonly abortController = new AbortController();
  private cancellationReason: string | null = null;

  constructor(
    private readonly adapterRegistry: ModelAdapterRegistry,
    options: OrchestratorRuntimeOptions = {}
  ) {
    this.engine = options.engine ?? new OrchestratorEngine();
    this.evidenceStore = options.evidenceStore ?? new EvidenceStore();
    this.persistence = options.persistence;
    this.now = options.now ?? (() => new Date().toISOString());
    this.onEvent = options.onEvent;
    this.enableRootBootstrapSketch = options.enableRootBootstrapSketch ?? false;
    this.requestUserApprovalHandler = options.requestUserApproval;
    this.requestUserInputHandler = options.requestUserInput;
    this.engine.subscribe((event) => {
      if (this.workingMemoryByRun.has(event.runId)) {
        try {
          this.persistence?.saveSnapshot(this.getSnapshot(event.runId));
        } catch {
          // Ignore transient snapshot persistence failures during live updates.
        }
      }

      try {
        this.onEvent?.(event);
      } catch {
        // Ignore UI event sink failures so orchestration can continue.
      }
    });
  }

  async executeHappyPath(input: CreateRunInput): Promise<HappyPathExecutionResult> {
    const execution = await this.executeRunInternal(input, false);
    const { execute, verify } = execution.phaseResults;

    if (!execute || !verify) {
      throw new Error("Happy path execution did not produce leaf execute/verify results");
    }

    return {
      run: execution.snapshot.run,
      rootNode: execution.rootNode,
      finalReport: execution.finalReport,
      snapshot: execution.snapshot,
      phaseResults: {
        abstractPlan: execution.phaseResults.abstractPlan,
        gather: execution.phaseResults.gather,
        consolidatedEvidence: execution.phaseResults.consolidatedEvidence,
        concretePlan: execution.phaseResults.concretePlan,
        review: execution.phaseResults.review,
        execute,
        verify
      }
    };
  }

  async executeScheduledRun(input: CreateRunInput): Promise<ScheduledRunExecutionResult> {
    return this.executeRunInternal(input, true);
  }

  cancel(reason = "Orchestrator run cancelled by user") {
    if (this.abortController.signal.aborted) {
      return;
    }

    this.cancellationReason = reason;
    this.abortController.abort(new Error(reason));
  }

  getSnapshot(runId: string): RunSnapshot {
    const run = this.engine.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} was not found`);
    }

    const workingMemory = this.workingMemoryByRun.get(runId);
    if (!workingMemory) {
      throw new Error(`Working memory for run ${runId} was not found`);
    }

    const projectStructure = this.projectStructureByRun.get(runId);
    if (!projectStructure) {
      throw new Error(`Project structure memory for run ${runId} was not found`);
    }

    return {
      run,
      nodes: this.engine.listRunNodes(runId),
      evidenceBundles: this.evidenceStore.listRunBundles(runId),
      workingMemory: workingMemory.getSnapshot(),
      projectStructure: projectStructure.getSnapshot(),
      events: this.engine.listEvents(runId),
      finalReport: this.finalReports.get(runId)
    };
  }

  private async executeRunInternal(
    input: CreateRunInput,
    allowDecomposition: boolean
  ): Promise<ScheduledRunExecutionResult & { phaseResults: RootPhaseResults }> {
    const { run, rootNode } = this.engine.createRun(input);
    this.workingMemoryByRun.set(
      run.id,
      new WorkingMemoryStore(
        run.id,
        this.now,
        input.continuation
          ? this.rebaseWorkingMemorySnapshot(input.continuation.workingMemory, rootNode.id)
          : undefined
      )
    );
    this.projectStructureByRun.set(
      run.id,
      new ProjectStructureMemoryStore(
        run.id,
        this.now,
        input.continuation
          ? this.rebaseProjectStructureSnapshot(input.continuation.projectStructure, rootNode.id)
          : undefined
      )
    );
    this.projectStructureInspectionNodeIdsByRun.set(run.id, new Set());
    this.projectStructureInspectionAttemptsByNode.set(rootNode.id, 0);
    this.focusedGatherAttemptsByNode.set(rootNode.id, 0);
    const seededEvidenceCount = this.seedContinuationContext(rootNode, input.continuation);
    this.persistence?.saveSnapshot(this.getSnapshot(run.id));
    this.engine.appendEvent(run.id, rootNode.id, "scheduler_progress", {
      message: "Starting orchestrator run",
      allowDecomposition
    });
    if (input.continuation) {
      this.engine.appendEvent(run.id, rootNode.id, "scheduler_progress", {
        message: "Seeded run from previous snapshot",
        sourceRunId: input.continuation.sourceRunId,
        seededEvidenceCount,
        seededOpenQuestionCount: input.continuation.workingMemory.openQuestions.length,
        seededFactCount: input.continuation.workingMemory.facts.length,
        seededProjectStructureDirectoryCount: input.continuation.projectStructure.directories.length,
        seededProjectStructureKeyFileCount: input.continuation.projectStructure.keyFiles.length
      });
    }

    try {
      this.throwIfCancelled(run.id, rootNode.id);
      const rootExecution = await this.executeNode(rootNode.id, allowDecomposition);
      const rootPhaseResults = this.requireRootPhaseResults(rootExecution.phaseResults, rootNode.id);
      const finalReport = this.buildFinalReport(
        run.id,
        rootExecution.outputs,
        rootExecution.verifySummaries,
        rootPhaseResults.review
      );
      this.finalReports.set(run.id, finalReport);
      this.engine.appendEvent(run.id, rootExecution.node.id, "run_completed", {
        summary: finalReport.summary,
        outputs: finalReport.outcomes
      });

      const snapshot = this.getSnapshot(run.id);
      this.persistence?.saveSnapshot(snapshot);

      return {
        run: snapshot.run,
        rootNode: rootExecution.node,
        finalReport,
        snapshot,
        outputs: rootExecution.outputs,
        verifySummaries: rootExecution.verifySummaries,
        phaseResults: rootPhaseResults
      };
    } catch (error) {
      if (this.isCancellationError(error)) {
        const cancelled = this.toCancellationError(error, run.id, rootNode.id);
        this.engine.pauseRun(run.id, cancelled.nodeId ?? rootNode.id, cancelled.message);
        const snapshot = this.getSnapshot(run.id);
        this.persistence?.saveSnapshot(snapshot);
        throw new OrchestratorRunCancelledError(cancelled.message, run.id, cancelled.nodeId ?? rootNode.id, snapshot);
      }

      this.engine.appendEvent(run.id, null, "run_failed", {
        nodeId: rootNode.id,
        error: this.formatRuntimeError(error)
      });
      this.escalateRunIfPossible(rootNode.id);
      this.persistence?.saveSnapshot(this.getSnapshot(run.id));
      throw error;
    }
  }

  private async executeNode(nodeId: string, allowDecomposition: boolean): Promise<NodeExecutionOutcome> {
    const startingNode = this.engine.getNode(nodeId);
    if (!startingNode) {
      throw new Error(`Node ${nodeId} was not found`);
    }

    try {
      this.throwIfCancelled(startingNode.runId, nodeId);
      return await (startingNode.kind === "execution"
        ? this.executeExecutionNode(startingNode)
        : this.executePlanningNode(startingNode, allowDecomposition));
    } catch (error) {
      if (this.isCancellationError(error)) {
        throw this.toCancellationError(error, startingNode.runId, nodeId);
      }

      const failedNode = this.engine.getNode(nodeId);
      if (failedNode) {
        if (failedNode.kind === "execution") {
          this.recordExecutionStatus(failedNode, "failed", this.formatRuntimeError(error));
        }
        this.engine.appendEvent(failedNode.runId, failedNode.id, "node_failed", {
          phase: failedNode.phase,
          error: this.formatRuntimeError(error)
        });
      }
      this.escalateRunIfPossible(nodeId);
      throw error;
    }
  }

  private async executePlanningNode(startingNode: PlanNode, allowDecomposition: boolean): Promise<NodeExecutionOutcome> {
    const nodeId = startingNode.id;
    const isProjectStructureInspection = this.isProjectStructureInspectionNode(startingNode);
    let planningEvidence = this.getNodeEvidenceBundles(startingNode);

    if (!isProjectStructureInspection && this.shouldRunBootstrapSketch(startingNode, planningEvidence)) {
      this.engine.appendEvent(startingNode.runId, startingNode.id, "scheduler_progress", {
        message: "No prior clues found. Starting low-cost bootstrap sketch before root planning."
      });
      const bootstrapSketchStage = await this.executeStageCapability<GatherResult>(startingNode, {
        phase: "gather",
        title: "Bootstrap Sketch",
        objective: `Produce a rough, low-cost sketch of the repository before deeper planning for:\n${startingNode.objective}`,
        kind: "planning",
        role: "gatherer",
        capability: "gather",
        evidenceBundles: planningEvidence
      });
      const bootstrapSketch = bootstrapSketchStage.result;
      this.mergeProjectStructureReport(bootstrapSketchStage.stageNode, bootstrapSketch.projectStructure);
      const bootstrapBundles = bootstrapSketch.evidenceBundles.map((bundleDraft) =>
        this.materializeEvidenceBundle(bootstrapSketchStage.stageNode, bundleDraft)
      );

      for (const bundle of bootstrapBundles) {
        this.evidenceStore.upsertBundle(bundle);
        const storedBundle = this.evidenceStore.getBundle(bundle.id) ?? bundle;
        this.engine.attachEvidenceBundle(bootstrapSketchStage.stageNode.id, bundle.id);
        this.ingestEvidenceBundle(bootstrapSketchStage.stageNode.id, storedBundle);
      }

      planningEvidence = [...planningEvidence, ...bootstrapBundles];
    }

    let currentNode = this.engine.transitionNode(nodeId, "abstract_plan");
    const abstractPlanStage = await this.executeStageCapability<AbstractPlanResult>(currentNode, {
      phase: "abstract_plan",
      title: "Abstract Plan",
      objective: this.buildPlanningStageObjective(
        currentNode,
        "abstractPlan",
        `Define the search scope, evidence requirements, and inspection targets for:\n${currentNode.objective}`,
        planningEvidence
      ),
      kind: "planning",
      role: "abstractPlanner",
      capability: "abstractPlan",
      evidenceBundles: planningEvidence
    });
    let abstractPlan = abstractPlanStage.result;
    this.recordAbstractPlanning(abstractPlanStage.stageNode, abstractPlan);

    this.throwIfCancelled(currentNode.runId, currentNode.id);
    currentNode = this.engine.transitionNode(nodeId, "gather");
    const gatherStage = await this.executeStageCapability<GatherResult>(currentNode, {
      phase: "gather",
      title: "Gather",
      objective: this.buildPlanningStageObjective(
        currentNode,
        "gather",
        `Gather file, symbol, and evidence findings for:\n${currentNode.objective}`,
        planningEvidence,
        {
          targetsToInspect: abstractPlan.targetsToInspect,
          evidenceRequirements: abstractPlan.evidenceRequirements
        }
      ),
      kind: "planning",
      role: "gatherer",
      capability: "gather",
      evidenceBundles: planningEvidence
    });
    let gather = gatherStage.result;
    this.mergeProjectStructureReport(gatherStage.stageNode, gather.projectStructure);
    const gatheredBundles = gather.evidenceBundles.map((bundleDraft) =>
      this.materializeEvidenceBundle(gatherStage.stageNode, bundleDraft)
    );

    for (const bundle of gatheredBundles) {
      this.evidenceStore.upsertBundle(bundle);
      const storedBundle = this.evidenceStore.getBundle(bundle.id) ?? bundle;
      this.engine.attachEvidenceBundle(gatherStage.stageNode.id, bundle.id);
      this.ingestEvidenceBundle(gatherStage.stageNode.id, storedBundle);
    }

    this.throwIfCancelled(currentNode.runId, currentNode.id);
    currentNode = this.engine.transitionNode(nodeId, "evidence_consolidation");
    const bundleIdsForConsolidation = [
      ...planningEvidence.map((bundle) => bundle.id),
      ...gatheredBundles.map((bundle) => bundle.id)
    ];
    let consolidatedEvidence = this.evidenceStore.mergeBundles({
      runId: currentNode.runId,
      nodeId: currentNode.id,
      bundleIds: bundleIdsForConsolidation,
      summary: gather.summary
    });
    this.evidenceStore.upsertBundle(consolidatedEvidence);
    const consolidationStage = this.createCompletedStageNode(currentNode, {
      phase: "evidence_consolidation",
      title: "Evidence Consolidation",
      objective: `Consolidate the gathered evidence into a compact bundle for:\n${currentNode.objective}`,
      kind: "planning"
    });
    this.engine.attachEvidenceBundle(consolidationStage.id, consolidatedEvidence.id);

    this.throwIfCancelled(currentNode.runId, currentNode.id);
    currentNode = this.engine.transitionNode(nodeId, "concrete_plan");
    let concretePlanStage = await this.executeStageCapability<ConcretePlanResult>(currentNode, {
      phase: "concrete_plan",
      title: "Concrete Plan",
      objective: `Turn the gathered evidence into an execution plan for:\n${currentNode.objective}`,
      kind: "planning",
      role: "concretePlanner",
      capability: "concretePlan",
      evidenceBundles: [consolidatedEvidence]
    });
    let concretePlan = concretePlanStage.result;
    this.recordDecision(currentNode.runId, concretePlanStage.stageNode.id, "Concrete plan created", concretePlan.summary);
    if (!isProjectStructureInspection && currentNode.depth === 0) {
      const inspectedPlan = await this.resolveProjectStructureInspectionLoop(
        currentNode,
        consolidatedEvidence,
        concretePlan
      );
      currentNode = inspectedPlan.node;
      concretePlan = inspectedPlan.concretePlan;
    }

    if (!isProjectStructureInspection) {
      const guardedConcretePlan = this.requireExplicitEvidenceBeforeFallback(
        currentNode,
        consolidatedEvidence,
        concretePlan
      );
      if (guardedConcretePlan !== concretePlan) {
        concretePlan = guardedConcretePlan;
        this.recordDecision(
          currentNode.runId,
          concretePlanStage.stageNode.id,
          "Concrete plan refined for evidence gap",
          (concretePlan.additionalGatherObjectives ?? [concretePlan.summary]).join(" | ")
        );
      }
    }

    if (!isProjectStructureInspection) {
      const refinedPlan = await this.resolveFocusedGatherLoop({
        node: currentNode,
        planningEvidence,
        abstractPlan,
        gather,
        consolidatedEvidence,
        concretePlan
      });
      currentNode = refinedPlan.node;
      planningEvidence = refinedPlan.planningEvidence;
      abstractPlan = refinedPlan.abstractPlan;
      gather = refinedPlan.gather;
      consolidatedEvidence = refinedPlan.consolidatedEvidence;
      concretePlan = refinedPlan.concretePlan;
      concretePlanStage = refinedPlan.concretePlanStage;
    }

    const phaseResults: NodePhaseResults = {
      abstractPlan,
      gather,
      consolidatedEvidence,
      concretePlan
    };

    if (isProjectStructureInspection) {
      if (concretePlan.childTasks.length > 0) {
        this.engine.appendEvent(currentNode.runId, currentNode.id, "scheduler_progress", {
          message: "Ignoring inspection child tasks because inspection nodes only refresh project structure memory",
          proposedChildCount: concretePlan.childTasks.length
        });
      }

      this.resolveCoveredQuestions(currentNode, {
        abstractPlanSummary: abstractPlan.summary,
        gatherSummary: gather.summary,
        concretePlanSummary: concretePlan.summary,
        outputs: [],
        verifySummaries: [concretePlan.summary],
        evidenceBundles: [consolidatedEvidence]
      });
      this.markPendingAcceptanceCriteriaMet(currentNode.id);
      this.throwIfCancelled(currentNode.runId, currentNode.id);
      currentNode = this.engine.transitionNode(nodeId, "done");

      return {
        node: currentNode,
        phaseResults,
        outputs: [],
        verifySummaries: [concretePlan.summary],
        verificationPassed: true
      };
    }

    const canDecomposeFurther = this.canDecomposeFurther(currentNode);
    const shouldSkipTrivialDecomposition = allowDecomposition && this.shouldSkipDecompositionForShortTestGoal(currentNode);
    const needsMorePlanning = concretePlan.needsMorePlanning ?? concretePlan.childTasks.length > 0;
    if (allowDecomposition && concretePlan.childTasks.length > 0 && canDecomposeFurther && !shouldSkipTrivialDecomposition && needsMorePlanning) {
      const childTitles = concretePlan.childTasks.map((task) => task.title);
      this.engine.appendEvent(currentNode.runId, currentNode.id, "node_decomposed", {
        childCount: concretePlan.childTasks.length,
        childTitles
      });

      const outputs: string[] = [];
      const verifySummaries: string[] = [];

      const childOutcomes = await this.scheduler.executeChildrenInOrder(
        concretePlan.childTasks,
        async (childTask, index) => {
          this.throwIfCancelled(currentNode.runId, currentNode.id);
          const { childNode } = this.engine.createChildNode(currentNode.id, {
            title: childTask.title,
            objective: childTask.objective,
            kind: "planning",
            assignedModels: this.requirePlanningChildTaskAssignedModels(currentNode, childTask),
            reviewPolicy: childTask.reviewPolicy,
            acceptanceCriteria: childTask.acceptanceCriteria,
            executionBudget: childTask.executionBudget
          });

          this.engine.appendEvent(currentNode.runId, childNode.id, "scheduler_progress", {
            message: "Executing child subtree",
            parentNodeId: currentNode.id,
            childIndex: index,
            childCount: concretePlan.childTasks.length
          });

          return this.executeNode(childNode.id, allowDecomposition);
        }
      );

      for (const childOutcome of childOutcomes) {
        this.throwIfCancelled(currentNode.runId, currentNode.id);
        outputs.push(...childOutcome.outputs);
        verifySummaries.push(...childOutcome.verifySummaries);
        phaseResults.review ??= childOutcome.phaseResults.review;
        phaseResults.execute ??= childOutcome.phaseResults.execute;
        phaseResults.verify ??= childOutcome.phaseResults.verify;
      }

      this.resolveCoveredQuestions(currentNode, {
        abstractPlanSummary: abstractPlan.summary,
        gatherSummary: gather.summary,
        concretePlanSummary: concretePlan.summary,
        reviewSummary: phaseResults.review?.summary,
        executeSummary: phaseResults.execute?.summary,
        outputs,
        verifySummaries,
        evidenceBundles: [consolidatedEvidence]
      });
      this.markPendingAcceptanceCriteriaMet(currentNode.id);
      currentNode = this.engine.transitionNode(nodeId, "done");

      return {
        node: currentNode,
        phaseResults,
        outputs,
        verifySummaries,
        verificationPassed: childOutcomes.every((childOutcome) => childOutcome.verificationPassed)
      };
    }

    if (allowDecomposition && concretePlan.childTasks.length > 0 && !needsMorePlanning) {
      this.engine.appendEvent(currentNode.runId, currentNode.id, "scheduler_progress", {
        message: "Skipping decomposition because the current node already has enough execution detail",
        nodeDepth: currentNode.depth,
        proposedChildCount: concretePlan.childTasks.length
      });
    }

    if (allowDecomposition && concretePlan.childTasks.length > 0 && shouldSkipTrivialDecomposition) {
      this.engine.appendEvent(currentNode.runId, currentNode.id, "scheduler_progress", {
        message: "Skipping decomposition because the goal requested a short test tree",
        nodeDepth: currentNode.depth,
        proposedChildCount: concretePlan.childTasks.length
      });
    }

    if (allowDecomposition && concretePlan.childTasks.length > 0 && !canDecomposeFurther) {
      const maxDepth = this.getMaxDecompositionDepth(currentNode);
      this.engine.appendEvent(currentNode.runId, currentNode.id, "scheduler_progress", {
        message: "Skipping decomposition because max depth was reached",
        nodeDepth: currentNode.depth,
        maxDepth,
        proposedChildCount: concretePlan.childTasks.length
      });
    }

    const executionOutcome = await this.executeExecutionLeafForPlan(currentNode, consolidatedEvidence, concretePlan);
    phaseResults.review = executionOutcome.phaseResults.review;
    phaseResults.execute = executionOutcome.phaseResults.execute;
    phaseResults.verify = executionOutcome.phaseResults.verify;

    this.resolveCoveredQuestions(currentNode, {
      abstractPlanSummary: abstractPlan.summary,
      gatherSummary: gather.summary,
      concretePlanSummary: concretePlan.summary,
      reviewSummary: executionOutcome.phaseResults.review?.summary,
      executeSummary: executionOutcome.phaseResults.execute?.summary,
      outputs: executionOutcome.outputs,
      verifySummaries: executionOutcome.verifySummaries,
      evidenceBundles: [consolidatedEvidence]
    });
    if (executionOutcome.verificationPassed) {
      this.markPendingAcceptanceCriteriaMet(currentNode.id);
    }
    this.throwIfCancelled(currentNode.runId, currentNode.id);
    currentNode = this.engine.transitionNode(nodeId, "done");

    return {
      node: currentNode,
      phaseResults,
      outputs: executionOutcome.outputs,
      verifySummaries: executionOutcome.verifySummaries,
      verificationPassed: executionOutcome.verificationPassed
    };
  }

  private async executeExecutionNode(startingNode: PlanNode): Promise<NodeExecutionOutcome> {
    const nodeId = startingNode.id;
    const executionEvidence = this.getNodeEvidenceBundles(startingNode);
    let currentNode = startingNode;
    let review: ReviewResult | undefined;
    const phaseResults: NodePhaseResults = {};

    this.throwIfCancelled(currentNode.runId, currentNode.id);
    currentNode = this.engine.transitionNode(nodeId, "execute");
    this.recordExecutionStatus(currentNode, "running", "Executing routed model command");
    const executeStage = await this.executeStageCapability<ExecuteResult>(currentNode, {
      phase: "execute",
      title: "Execute",
      objective: `Execute the planned work for:\n${currentNode.objective}`,
      kind: "execution",
      role: "executor",
      capability: "execute",
      evidenceBundles: executionEvidence
    });
    const execute = executeStage.result;
    phaseResults.execute = execute;
    if (execute.completed === false) {
      const failureSummary = execute.blockedReason
        ? `${execute.summary} (${execute.blockedReason})`
        : execute.summary;
      this.recordDecision(currentNode.runId, executeStage.stageNode.id, "Execution blocked", failureSummary);
      this.recordExecutionStatus(currentNode, "failed", failureSummary);
      throw new ExecutionNotCompletedError(currentNode.id, failureSummary);
    }
    this.recordDecision(currentNode.runId, executeStage.stageNode.id, "Execution completed", execute.summary);
    this.recordExecutionStatus(currentNode, "executed", execute.summary);

    this.throwIfCancelled(currentNode.runId, currentNode.id);
    currentNode = this.engine.transitionNode(nodeId, "verify");
    this.recordExecutionStatus(currentNode, "verifying", "Verifying execution result");
    const verifyStage = await this.executeStageCapability<VerifyResult>(currentNode, {
      phase: "verify",
      title: "Verify",
      objective: `Verify the execution result for:\n${currentNode.objective}`,
      kind: "execution",
      role: "verifier",
      capability: "verify",
      evidenceBundles: executionEvidence
    });
    const verify = verifyStage.result;
    phaseResults.verify = verify;
    this.recordDecision(currentNode.runId, verifyStage.stageNode.id, "Verification completed", verify.summary);
    this.recordExecutionStatus(currentNode, verify.passed ? "completed" : "verification_failed", verify.summary);
    review = await this.runFinalExecutionReviewIfNeeded(currentNode, executionEvidence, execute, verify);
    if (review) {
      phaseResults.review = review;
    }
    let verificationPassed = verify.passed;
    let verificationSummary = verify.summary;
    const unresolvedSuccessSignal = verificationPassed
      ? findUnresolvedSuccessSignal([
          execute.summary,
          ...execute.outputs,
          verify.summary,
          ...verify.findings,
          review?.summary,
          ...(review?.followUpQuestions ?? []),
          ...((review?.nextActions ?? []).flatMap((nextAction) => [
            nextAction.title,
            nextAction.objective,
            nextAction.rationale
          ]))
        ])
      : null;
    if (unresolvedSuccessSignal) {
      verificationPassed = false;
      verificationSummary = `Verification reported success but the model output still includes an unresolved blocker signal (${unresolvedSuccessSignal}).`;
      this.recordDecision(
        currentNode.runId,
        verifyStage.stageNode.id,
        "Verification flagged unresolved blocker",
        verificationSummary
      );
      this.recordExecutionStatus(currentNode, "verification_failed", verificationSummary, {
        signal: unresolvedSuccessSignal
      });
    }

    this.resolveCoveredQuestions(currentNode, {
      reviewSummary: review?.summary,
      executeSummary: execute.summary,
      outputs: execute.outputs,
      verifySummaries: [verificationSummary, ...verify.findings],
      evidenceBundles: executionEvidence
    });

    if (!verificationPassed) {
      throw new VerificationFailedError(currentNode.id, verificationSummary);
    }

    this.markPendingAcceptanceCriteriaMet(currentNode.id);
    this.throwIfCancelled(currentNode.runId, currentNode.id);
    currentNode = this.engine.transitionNode(nodeId, "done");

    return {
      node: currentNode,
      phaseResults,
      outputs: execute.outputs.length > 0 ? execute.outputs : [execute.summary],
      verifySummaries: [verificationSummary],
      verificationPassed
    };
  }

  private async runFinalExecutionReviewIfNeeded(
    node: PlanNode,
    executionEvidence: EvidenceBundle[],
    execute: ExecuteResult,
    verify: VerifyResult
  ): Promise<ReviewResult | undefined> {
    if (!this.shouldRunReview(node)) {
      return undefined;
    }

    this.throwIfCancelled(node.runId, node.id);
    this.recordExecutionStatus(node, "reviewing", "Reviewing completed execution result");

    try {
      const reviewStage = await this.executeStageCapability<ReviewResult>(node, {
        phase: "review",
        title: "Review",
        objective: [
          `Review the completed execution result for:\n${node.objective}`,
          `Execution summary:\n${execute.summary}`,
          execute.outputs.length > 0
            ? `Execution outputs:\n${execute.outputs.join("\n")}`
            : null,
          `Verification summary:\n${verify.summary}`,
          verify.findings.length > 0
            ? `Verification findings:\n${verify.findings.join("\n")}`
            : null
        ].filter((section): section is string => Boolean(section)).join("\n\n"),
        kind: "execution",
        role: "reviewer",
        capability: "review",
        evidenceBundles: executionEvidence,
        escalateOnFailure: false
      });
      const review = reviewStage.result;
      this.recordDecision(node.runId, reviewStage.stageNode.id, "Review completed", review.summary);
      this.recordExecutionStatus(node, "review_completed", review.summary);
      return review;
    } catch (error) {
      if (this.isCancellationError(error)) {
        throw this.toCancellationError(error, node.runId, node.id);
      }

      const failureSummary = `Final review failed: ${this.formatRuntimeError(error)}`;
      this.recordDecision(node.runId, node.id, "Review failed", failureSummary);
      this.recordExecutionStatus(node, "review_failed", failureSummary);
      return undefined;
    }
  }

  private async executeExecutionLeafForPlan(
    planNode: PlanNode,
    consolidatedEvidence: EvidenceBundle,
    concretePlan: ConcretePlanResult
  ): Promise<NodeExecutionOutcome> {
    this.throwIfCancelled(planNode.runId, planNode.id);
    const { childNode } = this.engine.createChildNode(planNode.id, {
      title: `${planNode.title} / execution`,
      objective: this.buildExecutionObjective(planNode, concretePlan),
      kind: "execution",
      assignedModels: this.buildExecutionAssignedModels(planNode),
      reviewPolicy: planNode.reviewPolicy
    });
    this.engine.attachEvidenceBundle(childNode.id, consolidatedEvidence.id);
    this.engine.appendEvent(planNode.runId, childNode.id, "scheduler_progress", {
      message: "Executing dedicated execution node",
      parentNodeId: planNode.id
    });
    this.recordExecutionStatus(childNode, "queued", "Execution node created and waiting to start");

    return this.executeNode(childNode.id, false);
  }

  private buildExecutionObjective(node: PlanNode, concretePlan: ConcretePlanResult): string {
    const sections = [node.objective.trim()];

    if (concretePlan.summary.trim().length > 0) {
      sections.push(`Execution plan summary: ${concretePlan.summary.trim()}`);
    }

    if (concretePlan.childTasks.length > 0) {
      sections.push(
        `Planned execution steps:\n${concretePlan.childTasks.map((task) => `- ${task.title}: ${task.objective}`).join("\n")}`
      );
    }

    if (concretePlan.executionNotes.length > 0) {
      sections.push(`Execution notes:\n${concretePlan.executionNotes.map((note) => `- ${note}`).join("\n")}`);
    }

    return sections.filter((section) => section.length > 0).join("\n\n");
  }

  private buildExecutionAssignedModels(node: PlanNode): ModelAssignment {
    const executor = node.assignedModels.executor;
    if (!this.isValidModelRef(executor)) {
      throw new MissingModelAssignmentError(node.id, "executor");
    }

    const verifier = node.assignedModels.verifier;
    if (!this.isValidModelRef(verifier)) {
      throw new MissingModelAssignmentError(node.id, "verifier");
    }

    const assignment: ModelAssignment = {
      executor,
      verifier
    };

    if (node.reviewPolicy !== "none") {
      const reviewer = node.assignedModels.reviewer;
      if (!this.isValidModelRef(reviewer)) {
        throw new MissingModelAssignmentError(node.id, "reviewer");
      }
      assignment.reviewer = reviewer;
    }

    return assignment;
  }

  private requirePlanningChildTaskAssignedModels(
    parentNode: PlanNode,
    childTask: ConcretePlanResult["childTasks"][number]
  ): ModelAssignment {
    const assignedModels = childTask.assignedModels;
    const effectiveReviewPolicy = childTask.reviewPolicy ?? parentNode.reviewPolicy;
    const requiredRoles: AssignedModelRole[] = [
      "abstractPlanner",
      "gatherer",
      "concretePlanner",
      "executor",
      "verifier"
    ];

    if (effectiveReviewPolicy !== "none") {
      requiredRoles.push("reviewer");
    }

    const resolvedModels: ModelAssignment = {};
    const repairedRoles: AssignedModelRole[] = [];

    for (const role of ALL_ASSIGNED_MODEL_ROLES) {
      const explicitModel = assignedModels?.[role];
      if (this.isUsableModelForRole(explicitModel, role)) {
        resolvedModels[role] = explicitModel;
        continue;
      }

      const routedParentModel = parentNode.assignedModels[role];
      if (this.isUsableModelForRole(routedParentModel, role)) {
        resolvedModels[role] = routedParentModel;
        repairedRoles.push(role);
      }
    }

    for (const role of requiredRoles) {
      if (!this.isValidModelRef(resolvedModels[role])) {
        throw new MissingChildTaskModelAssignmentError(parentNode.id, childTask.title, role);
      }
    }

    if (repairedRoles.length > 0) {
      this.engine.appendEvent(parentNode.runId, parentNode.id, "scheduler_progress", {
        message: "Materialized missing child task routing from nodeModelRouting",
        childTitle: childTask.title,
        repairedRoles,
        importance: childTask.importance ?? "medium"
      });
    }

    return resolvedModels;
  }

  private isValidModelRef(value: ModelRef | undefined): value is ModelRef {
    return Boolean(
      value
      && typeof value.id === "string"
      && value.id.trim().length > 0
      && typeof value.provider === "string"
      && value.provider.trim().length > 0
      && typeof value.model === "string"
      && value.model.trim().length > 0
    );
  }

  private isUsableModelForRole(value: ModelRef | undefined, role: AssignedModelRole): value is ModelRef {
    if (!this.isValidModelRef(value)) {
      return false;
    }

    const adapter = this.adapterRegistry.get(value.id);
    return Boolean(adapter?.supports(ASSIGNED_ROLE_CAPABILITY[role]));
  }

  private requireRootPhaseResults(phaseResults: NodePhaseResults, nodeId: string): RootPhaseResults {
    if (!phaseResults.abstractPlan || !phaseResults.gather || !phaseResults.consolidatedEvidence || !phaseResults.concretePlan) {
      throw new Error(`Root planning node ${nodeId} did not produce the required planning phase results`);
    }

    return {
      abstractPlan: phaseResults.abstractPlan,
      gather: phaseResults.gather,
      consolidatedEvidence: phaseResults.consolidatedEvidence,
      concretePlan: phaseResults.concretePlan,
      review: phaseResults.review,
      execute: phaseResults.execute,
      verify: phaseResults.verify
    };
  }

  private shouldRunReview(node: PlanNode): boolean {
    return node.reviewPolicy !== "none" && Boolean(node.assignedModels.reviewer);
  }

  private createStageNode(
    parentNode: PlanNode,
    input: {
      phase: NodePhase;
      title: string;
      objective: string;
      kind: PlanNode["kind"];
      assignedModels?: ModelAssignment;
    }
  ): PlanNode {
    const { childNode } = this.engine.createChildNode(parentNode.id, {
      title: input.title,
      objective: input.objective,
      kind: input.kind,
      role: "stage",
      stagePhase: input.phase,
      assignedModels: input.assignedModels,
      reviewPolicy: "none"
    });

    this.engine.appendEvent(parentNode.runId, childNode.id, "scheduler_progress", {
      message: "Executing stage node",
      parentNodeId: parentNode.id,
      stagePhase: input.phase
    });

    return childNode;
  }

  private createCompletedStageNode(
    parentNode: PlanNode,
    input: {
      phase: NodePhase;
      title: string;
      objective: string;
      kind: PlanNode["kind"];
      assignedModels?: ModelAssignment;
    }
  ): PlanNode {
    const stageNode = this.createStageNode(parentNode, input);
    this.engine.transitionNode(stageNode.id, input.phase);
    return this.engine.transitionNode(stageNode.id, "done");
  }

  private shouldRunBootstrapSketch(node: PlanNode, seededEvidence: EvidenceBundle[]): boolean {
    if (!this.enableRootBootstrapSketch) {
      return false;
    }

    if (node.depth !== 0 || node.kind !== "planning") {
      return false;
    }

    if (!this.isUsableModelForRole(node.assignedModels.gatherer, "gatherer")) {
      return false;
    }

    if (seededEvidence.length > 0) {
      return false;
    }

    if (!this.isValidModelRef(node.assignedModels.gatherer)) {
      return false;
    }

    const workingMemory = this.getWorkingMemorySnapshot(node.runId);
    const projectStructure = this.getProjectStructureSnapshot(node.runId);

    return workingMemory.facts.length === 0
      && workingMemory.openQuestions.length === 0
      && workingMemory.unknowns.length === 0
      && workingMemory.conflicts.length === 0
      && workingMemory.decisions.length === 0
      && projectStructure.summary.trim().length === 0
      && projectStructure.directories.length === 0
      && projectStructure.keyFiles.length === 0
      && projectStructure.entryPoints.length === 0
      && projectStructure.modules.length === 0;
  }

  private buildStageAssignedModels(parentNode: PlanNode, roles: AssignedModelRole[]): ModelAssignment {
    const assignment: ModelAssignment = {};

    for (const role of roles) {
      const model = parentNode.assignedModels[role];
      if (!this.isValidModelRef(model)) {
        throw new MissingModelAssignmentError(parentNode.id, role);
      }

      assignment[role] = model;
    }

    return assignment;
  }

  private async executeStageCapability<TResult extends { debug?: ModelExecutionDebugInfo }>(
    parentNode: PlanNode,
    input: {
      phase: NodePhase;
      title: string;
      objective: string;
      kind: PlanNode["kind"];
      role: AssignedModelRole;
      capability: OrchestratorCapability;
      evidenceBundles: EvidenceBundle[];
      escalateOnFailure?: boolean;
    }
  ): Promise<{ stageNode: PlanNode; result: TResult }> {
    const stageNode = this.createStageNode(parentNode, {
      phase: input.phase,
      title: input.title,
      objective: input.objective,
      kind: input.kind,
      assignedModels: this.buildStageAssignedModels(parentNode, [input.role])
    });

    try {
      let activeStageNode = this.engine.transitionNode(stageNode.id, input.phase);
      const result = await this.invokeCapability<TResult>(
        activeStageNode,
        input.role,
        input.capability,
        input.evidenceBundles
      );
      this.throwIfCancelled(activeStageNode.runId, activeStageNode.id);
      activeStageNode = this.engine.transitionNode(stageNode.id, "done");

      return {
        stageNode: activeStageNode,
        result
      };
    } catch (error) {
      if (this.isCancellationError(error)) {
        throw this.toCancellationError(error, stageNode.runId, stageNode.id);
      }

      const failedStageNode = this.engine.getNode(stageNode.id);
      if (failedStageNode) {
        if (failedStageNode.kind === "execution") {
          this.recordExecutionStatus(failedStageNode, "failed", this.formatRuntimeError(error));
        }
        this.engine.appendEvent(failedStageNode.runId, failedStageNode.id, "node_failed", {
          phase: failedStageNode.phase,
          error: this.formatRuntimeError(error)
        });
      }
      if (input.escalateOnFailure !== false) {
        this.escalateRunIfPossible(stageNode.id);
      }
      throw error;
    }
  }

  private shouldSkipDecompositionForShortTestGoal(node: PlanNode): boolean {
    if (node.depth !== 0) {
      return false;
    }

    const run = this.engine.getRun(node.runId);
    if (!run) {
      throw new Error(`Run ${node.runId} was not found`);
    }

    const text = `${run.goal}\n${node.objective}`;
    const mentionsShortTree = /짧은\s*트리|short\s+tree|minimal\s+tree|small\s+tree/i.test(text);
    const mentionsTest = /테스트|test/i.test(text);
    const mentionsNoLongWork = /(긴\s*작업|장시간|long(?:-running)?\s+work|long\s+task)/i.test(text)
      && /(하지\s*말|금지|피하|do\s+not|don't|avoid)/i.test(text);

    return mentionsShortTree && (mentionsTest || mentionsNoLongWork);
  }

  private canDecomposeFurther(node: PlanNode): boolean {
    return node.depth < this.getMaxDecompositionDepth(node);
  }

  private getMaxDecompositionDepth(node: PlanNode): number {
    const run = this.engine.getRun(node.runId);
    if (!run) {
      throw new Error(`Run ${node.runId} was not found`);
    }

    return Math.min(run.config.maxDepth, node.executionBudget.maxDepth);
  }

  private async invokeCapability<TResult extends { debug?: ModelExecutionDebugInfo }>(
    node: PlanNode,
    role: AssignedModelRole,
    capability: OrchestratorCapability,
    evidenceBundles: EvidenceBundle[]
  ): Promise<TResult> {
    this.throwIfCancelled(node.runId, node.id);
    const assignedModel = node.assignedModels[role];
    if (!assignedModel) {
      throw new MissingModelAssignmentError(node.id, role);
    }

    const adapter = this.adapterRegistry.resolve(assignedModel, capability);
    const context = this.buildInvocationContext(node, assignedModel, capability, evidenceBundles);
    const invocation = this.getInvocation(adapter, capability);
    try {
      const result = await invocation(context) as TResult;
      this.throwIfCancelled(node.runId, node.id);
      this.recordModelInvocation(node, role, capability, assignedModel, result.debug, result);
      return result;
    } catch (error) {
      if (this.isCancellationError(error)) {
        throw this.toCancellationError(error, node.runId, node.id);
      }
      throw error;
    }
  }

  private getInvocation(
    adapter: OrchestratorModelAdapter,
    capability: OrchestratorCapability
  ): (context: ModelInvocationContext) => Promise<unknown> {
    const invocation = adapter[capability];
    if (!invocation) {
      throw new Error(`Adapter ${adapter.model.id} is missing the ${capability} implementation`);
    }

    return invocation.bind(adapter);
  }

  private rebaseWorkingMemorySnapshot(snapshot: WorkingMemorySnapshot, relatedNodeId: string): WorkingMemorySnapshot {
    return {
      ...snapshot,
      facts: snapshot.facts.map((fact) => ({
        ...fact,
        relatedNodeIds: [relatedNodeId]
      })),
      openQuestions: snapshot.openQuestions.map((question) => ({
        ...question,
        relatedNodeIds: [relatedNodeId]
      })),
      unknowns: snapshot.unknowns.map((unknown) => ({
        ...unknown,
        relatedNodeIds: [relatedNodeId]
      })),
      conflicts: snapshot.conflicts.map((conflict) => ({
        ...conflict,
        relatedNodeIds: [relatedNodeId]
      })),
      decisions: snapshot.decisions.map((decision) => ({
        ...decision,
        relatedNodeIds: [relatedNodeId]
      }))
    };
  }

  private rebaseProjectStructureSnapshot(
    snapshot: ProjectStructureSnapshot,
    relatedNodeId: string
  ): ProjectStructureSnapshot {
    return {
      ...snapshot,
      directories: snapshot.directories.map((entry) => ({
        ...entry,
        relatedNodeIds: [relatedNodeId]
      })),
      keyFiles: snapshot.keyFiles.map((entry) => ({
        ...entry,
        relatedNodeIds: [relatedNodeId]
      })),
      entryPoints: snapshot.entryPoints.map((entry) => ({
        ...entry,
        relatedNodeIds: [relatedNodeId]
      })),
      modules: snapshot.modules.map((entry) => ({
        ...entry,
        relatedNodeIds: [relatedNodeId]
      })),
      openQuestions: snapshot.openQuestions.map((question) => ({
        ...question,
        relatedNodeIds: [relatedNodeId]
      })),
      contradictions: snapshot.contradictions.map((contradiction) => ({
        ...contradiction,
        relatedNodeIds: [relatedNodeId]
      }))
    };
  }

  private getWorkflowStage(node: PlanNode, _capability: OrchestratorCapability): OrchestratorWorkflowStage {
    if (node.role === "stage" && node.title === "Bootstrap Sketch") {
      return "bootstrap_sketch";
    }

    if (this.isProjectStructureInspectionNode(node)) {
      return "project_structure_inspection";
    }

    return "task_orchestration";
  }

  private mergeProjectStructureReport(node: PlanNode, report: GatherResult["projectStructure"]) {
    if (!report) {
      return;
    }

    const projectStructure = this.requireProjectStructureMemory(node.runId);
    projectStructure.mergeReport(node.id, report);
    this.engine.appendEvent(node.runId, node.id, "scheduler_progress", {
      message: "Project structure memory updated",
      directoryCount: projectStructure.getSnapshot().directories.length,
      keyFileCount: projectStructure.getSnapshot().keyFiles.length,
      openQuestionCount: projectStructure.getSnapshot().openQuestions.filter((entry) => entry.status === "open").length,
      contradictionCount: projectStructure.getSnapshot().contradictions.filter((entry) => entry.status === "open").length
    });
  }

  private async resolveProjectStructureInspectionLoop(
    node: PlanNode,
    consolidatedEvidence: EvidenceBundle,
    initialPlan: ConcretePlanResult
  ): Promise<{ node: PlanNode; concretePlan: ConcretePlanResult }> {
    let currentNode = node;
    let concretePlan = initialPlan;

    while (concretePlan.needsProjectStructureInspection) {
      const attempt = (this.projectStructureInspectionAttemptsByNode.get(currentNode.id) ?? 0) + 1;
      if (attempt > currentNode.executionBudget.rereadBudget) {
        throw new Error(
          `Project structure inspection budget exhausted for node ${currentNode.id} after ${attempt - 1} attempts`
        );
      }
      this.projectStructureInspectionAttemptsByNode.set(currentNode.id, attempt);

      const request = this.createProjectStructureInspectionRequest(concretePlan);
      this.recordProjectStructureInspectionRequest(currentNode, request, attempt);
      const projectStructureFingerprintBeforeInspection = this.getProjectStructureInspectionFingerprint(currentNode.runId);

      currentNode = this.engine.transitionNode(currentNode.id, "replan");
      await this.executeProjectStructureInspectionNodes(currentNode, request, attempt);
      const projectStructureFingerprintAfterInspection = this.getProjectStructureInspectionFingerprint(currentNode.runId);
      currentNode = this.engine.transitionNode(currentNode.id, "concrete_plan");
      const concretePlanStage = await this.executeStageCapability<ConcretePlanResult>(currentNode, {
        phase: "concrete_plan",
        title: "Concrete Plan",
        objective: `Turn the refreshed structure evidence into an execution plan for:\n${currentNode.objective}`,
        kind: "planning",
        role: "concretePlanner",
        capability: "concretePlan",
        evidenceBundles: [consolidatedEvidence]
      });
      concretePlan = concretePlanStage.result;
      this.recordDecision(
        currentNode.runId,
        concretePlanStage.stageNode.id,
        "Concrete plan updated after project structure inspection",
        concretePlan.summary
      );

      if (
        concretePlan.needsProjectStructureInspection
        && projectStructureFingerprintBeforeInspection === projectStructureFingerprintAfterInspection
      ) {
        this.engine.appendEvent(currentNode.runId, currentNode.id, "scheduler_progress", {
          message: "Stopping repeated project structure inspection because the structure memory did not change",
          attempt,
          objectives: request.objectives
        });
        throw new Error(
          `Project structure inspection did not change the structure memory for node ${currentNode.id} on attempt ${attempt}`
        );
      }
    }

    return {
      node: currentNode,
      concretePlan
    };
  }

  private createProjectStructureInspectionRequest(plan: ConcretePlanResult): ProjectStructureInspectionRequest {
    const objectives = this.dedupeTextEntries(
      plan.inspectionObjectives?.length
        ? plan.inspectionObjectives
        : plan.projectStructureContradictions?.length
          ? plan.projectStructureContradictions
          : [plan.summary]
    );
    const contradictions = this.dedupeTextEntries(plan.projectStructureContradictions ?? objectives);

    return {
      objectives,
      contradictions
    };
  }

  private async resolveFocusedGatherLoop(input: {
    node: PlanNode;
    planningEvidence: EvidenceBundle[];
    abstractPlan: AbstractPlanResult;
    gather: GatherResult;
    consolidatedEvidence: EvidenceBundle;
    concretePlan: ConcretePlanResult;
  }): Promise<{
    node: PlanNode;
    planningEvidence: EvidenceBundle[];
    abstractPlan: AbstractPlanResult;
    gather: GatherResult;
    consolidatedEvidence: EvidenceBundle;
    concretePlan: ConcretePlanResult;
    concretePlanStage: { stageNode: PlanNode; result: ConcretePlanResult };
  }> {
    let currentNode = input.node;
    let planningEvidence = input.planningEvidence;
    let abstractPlan = input.abstractPlan;
    let gather = input.gather;
    let consolidatedEvidence = input.consolidatedEvidence;
    let concretePlan = input.concretePlan;
    let concretePlanStage: { stageNode: PlanNode; result: ConcretePlanResult } = {
      stageNode: currentNode,
      result: concretePlan
    };

    while (concretePlan.needsAdditionalGather) {
      const attempt = (this.focusedGatherAttemptsByNode.get(currentNode.id) ?? 0) + 1;
      if (attempt > currentNode.executionBudget.rereadBudget) {
        throw new Error(
          `Focused gather refinement budget exhausted for node ${currentNode.id} after ${attempt - 1} attempts`
        );
      }
      this.focusedGatherAttemptsByNode.set(currentNode.id, attempt);

      const focusedObjectives = this.dedupeTextEntries(
        concretePlan.additionalGatherObjectives?.length
          ? concretePlan.additionalGatherObjectives
          : [concretePlan.summary]
      );
      this.recordDecision(
        currentNode.runId,
        currentNode.id,
        "Focused gather refinement requested",
        focusedObjectives.join(" | ")
      );

      currentNode = this.engine.transitionNode(currentNode.id, "replan");
      const focusedReplanStage = await this.executeStageCapability<AbstractPlanResult>(currentNode, {
        phase: "abstract_plan",
        title: "Focused Replan",
        objective: this.buildPlanningStageObjective(
          currentNode,
          "abstractPlan",
          [
            `Narrow the next gather pass for:\n${currentNode.objective}`,
            focusedObjectives.length > 0
              ? `Focused refinement objectives:\n${focusedObjectives.map((objective, index) => `${index + 1}. ${objective}`).join("\n")}`
              : ""
          ].filter((value) => value.length > 0).join("\n\n"),
          [consolidatedEvidence]
        ),
        kind: "planning",
        role: "abstractPlanner",
        capability: "abstractPlan",
        evidenceBundles: [consolidatedEvidence]
      });
      abstractPlan = focusedReplanStage.result;
      this.recordAbstractPlanning(focusedReplanStage.stageNode, abstractPlan);

      this.throwIfCancelled(currentNode.runId, currentNode.id);
      currentNode = this.engine.transitionNode(currentNode.id, "gather");
      const focusedGatherStage = await this.executeStageCapability<GatherResult>(currentNode, {
        phase: "gather",
        title: "Focused Gather",
        objective: this.buildPlanningStageObjective(
          currentNode,
          "gather",
          `Gather only the targeted follow-up evidence for:\n${currentNode.objective}`,
          [consolidatedEvidence],
          {
            targetsToInspect: abstractPlan.targetsToInspect,
            evidenceRequirements: abstractPlan.evidenceRequirements,
            additionalObjectives: focusedObjectives
          }
        ),
        kind: "planning",
        role: "gatherer",
        capability: "gather",
        evidenceBundles: [consolidatedEvidence]
      });
      gather = focusedGatherStage.result;
      this.mergeProjectStructureReport(focusedGatherStage.stageNode, gather.projectStructure);
      const focusedBundles = gather.evidenceBundles.map((bundleDraft) =>
        this.materializeEvidenceBundle(focusedGatherStage.stageNode, bundleDraft)
      );

      for (const bundle of focusedBundles) {
        this.evidenceStore.upsertBundle(bundle);
        const storedBundle = this.evidenceStore.getBundle(bundle.id) ?? bundle;
        this.engine.attachEvidenceBundle(focusedGatherStage.stageNode.id, bundle.id);
        this.ingestEvidenceBundle(focusedGatherStage.stageNode.id, storedBundle);
      }

      planningEvidence = [...planningEvidence, ...focusedBundles];

      this.throwIfCancelled(currentNode.runId, currentNode.id);
      currentNode = this.engine.transitionNode(currentNode.id, "evidence_consolidation");
      consolidatedEvidence = this.evidenceStore.mergeBundles({
        runId: currentNode.runId,
        nodeId: currentNode.id,
        bundleIds: [consolidatedEvidence.id, ...focusedBundles.map((bundle) => bundle.id)],
        summary: gather.summary
      });
      this.evidenceStore.upsertBundle(consolidatedEvidence);
      const consolidationStage = this.createCompletedStageNode(currentNode, {
        phase: "evidence_consolidation",
        title: "Evidence Consolidation",
        objective: `Consolidate the focused evidence into a compact bundle for:\n${currentNode.objective}`,
        kind: "planning"
      });
      this.engine.attachEvidenceBundle(consolidationStage.id, consolidatedEvidence.id);

      this.throwIfCancelled(currentNode.runId, currentNode.id);
      currentNode = this.engine.transitionNode(currentNode.id, "concrete_plan");
      concretePlanStage = await this.executeStageCapability<ConcretePlanResult>(currentNode, {
        phase: "concrete_plan",
        title: "Concrete Plan",
        objective: `Turn the refined evidence into an execution plan for:\n${currentNode.objective}`,
        kind: "planning",
        role: "concretePlanner",
        capability: "concretePlan",
        evidenceBundles: [consolidatedEvidence]
      });
      concretePlan = concretePlanStage.result;
      this.recordDecision(
        currentNode.runId,
        concretePlanStage.stageNode.id,
        "Concrete plan updated after focused gather",
        concretePlan.summary
      );
    }

    return {
      node: currentNode,
      planningEvidence,
      abstractPlan,
      gather,
      consolidatedEvidence,
      concretePlan,
      concretePlanStage
    };
  }

  private recordProjectStructureInspectionRequest(
    node: PlanNode,
    request: ProjectStructureInspectionRequest,
    attempt: number
  ) {
    this.engine.appendEvent(node.runId, node.id, "scheduler_progress", {
      message: "Project structure inspection requested",
      attempt,
      objectives: request.objectives,
      contradictions: request.contradictions
    });
  }

  private async executeProjectStructureInspectionNodes(
    parentNode: PlanNode,
    request: ProjectStructureInspectionRequest,
    attempt: number
  ) {
    const inspectionSummaries: string[] = [];
    const inspectionObjectives = request.objectives.length > 0 ? request.objectives : [parentNode.objective];
    const inspectionObjective = inspectionObjectives.length === 1
      ? inspectionObjectives[0]!
      : inspectionObjectives.map((objective, index) => `${index + 1}. ${objective}`).join("\n");
    const { childNode } = this.engine.createChildNode(parentNode.id, {
      title: `${parentNode.title} / inspection-${attempt}`,
      objective: inspectionObjective,
      kind: "planning",
      assignedModels: this.buildInspectionAssignedModels(parentNode),
      reviewPolicy: "none",
      executionBudget: {
        maxDepth: parentNode.depth + 1
      }
    });
    this.registerProjectStructureInspectionNode(childNode.runId, childNode.id);
    this.engine.appendEvent(parentNode.runId, childNode.id, "scheduler_progress", {
      message: "Executing project structure inspection node",
      parentNodeId: parentNode.id,
      attempt,
      inspectionObjectiveCount: inspectionObjectives.length,
      inspectionObjectives
    });

    const outcome = await this.executeNode(childNode.id, false);
    const inspectionConcretePlan = outcome.phaseResults.concretePlan;
    if (!inspectionConcretePlan) {
      throw new Error(`Inspection node ${childNode.id} completed without a concrete plan summary`);
    }
    inspectionSummaries.push(inspectionConcretePlan.summary);

    const resolution = this.dedupeTextEntries(inspectionSummaries).join(" | ") || "Project structure inspection completed";
    const projectStructure = this.requireProjectStructureMemory(parentNode.runId);
    const snapshot = projectStructure.getSnapshot();
    const relatedNodeIds = new Set([
      ...this.collectNodeResolutionScope(parentNode),
      ...this.collectNodeSubtreeIds(childNode)
    ]);
    const parentOpenQuestions = snapshot.openQuestions
      .filter((question) => question.status === "open" && question.relatedNodeIds.some((nodeId) => relatedNodeIds.has(nodeId)))
      .map((question) => question.question);
    const parentContradictions = snapshot.contradictions
      .filter((contradiction) => contradiction.status === "open" && contradiction.relatedNodeIds.some((nodeId) => relatedNodeIds.has(nodeId)))
      .map((contradiction) => contradiction.summary);
    projectStructure.resolveQuestions(this.dedupeTextEntries([...request.objectives, ...parentOpenQuestions]), resolution);
    projectStructure.resolveContradictions(
      this.dedupeTextEntries([...request.contradictions, ...parentContradictions]),
      resolution
    );
    this.engine.appendEvent(parentNode.runId, parentNode.id, "scheduler_progress", {
      message: "Project structure inspection completed",
      attempt,
      resolution
    });
  }

  private buildInspectionAssignedModels(parentNode: PlanNode): ModelAssignment | undefined {
    const allAssignedModels = this.uniqueInspectionModels(Object.values(parentNode.assignedModels));
    if (allAssignedModels.length === 0) {
      return undefined;
    }

    const planningCandidates = this.uniqueInspectionModels([
      parentNode.assignedModels.abstractPlanner,
      parentNode.assignedModels.concretePlanner,
      parentNode.assignedModels.reviewer,
      parentNode.assignedModels.verifier,
      ...allAssignedModels
    ]);
    const workerCandidates = this.uniqueInspectionModels([
      parentNode.assignedModels.gatherer,
      parentNode.assignedModels.executor,
      ...allAssignedModels
    ]);

    const planningModel = [...planningCandidates]
      .sort((left, right) => this.scoreInspectionPlanningModel(right) - this.scoreInspectionPlanningModel(left))[0]
      ?? [...allAssignedModels]
        .sort((left, right) => this.scoreInspectionPlanningModel(right) - this.scoreInspectionPlanningModel(left))[0];
    const workerModel = [...workerCandidates]
      .sort((left, right) => this.scoreInspectionWorkerModel(right) - this.scoreInspectionWorkerModel(left))[0]
      ?? planningModel;

    return {
      abstractPlanner: planningModel,
      gatherer: workerModel,
      concretePlanner: planningModel,
      reviewer: planningModel,
      executor: workerModel,
      verifier: planningModel
    };
  }

  private uniqueInspectionModels(models: Array<ModelRef | undefined>): ModelRef[] {
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

  private scoreInspectionPlanningModel(model: ModelRef): number {
    const reasoningScore = model.reasoningEffort === "xhigh"
      ? 400
      : model.reasoningEffort === "high"
        ? 300
        : model.reasoningEffort === "medium"
          ? 200
          : model.reasoningEffort === "low"
            ? 100
            : 0;
    const tierScore = model.tier === "upper"
      ? 40
      : model.tier === "reviewer"
        ? 30
        : 10;
    const lightweightPenalty = /\bmini\b|\bnano\b|flash|lite/i.test(model.model) ? -50 : 0;
    return reasoningScore + tierScore + lightweightPenalty;
  }

  private scoreInspectionWorkerModel(model: ModelRef): number {
    const lightweightBonus = /\bmini\b|\bnano\b|flash|lite/i.test(model.model) ? 250 : 0;
    const tierBonus = model.tier === "lower"
      ? 150
      : model.tier === "reviewer"
        ? 50
        : 0;
    const reasoningBonus = model.reasoningEffort === "low"
      ? 160
      : model.reasoningEffort === "medium"
        ? 130
        : model.reasoningEffort === "high"
          ? 70
          : model.reasoningEffort === "xhigh"
            ? 20
            : 90;
    return lightweightBonus + tierBonus + reasoningBonus;
  }

  private seedContinuationContext(node: PlanNode, continuation: ContinuationSeed | undefined): number {
    if (!continuation) {
      return 0;
    }

    let seededEvidenceCount = 0;
    for (const bundle of continuation.evidenceBundles) {
      const seededBundle = this.cloneSeedEvidenceBundle(node, bundle);
      this.engine.attachEvidenceBundle(node.id, seededBundle.id);
      this.ingestEvidenceBundle(node.id, seededBundle);
      seededEvidenceCount += 1;
    }

    return seededEvidenceCount;
  }

  private cloneSeedEvidenceBundle(node: PlanNode, bundle: EvidenceBundle): EvidenceBundle {
    return this.evidenceStore.createBundle({
      runId: node.runId,
      nodeId: node.id,
      summary: bundle.summary,
      facts: bundle.facts.map((fact) => ({
        statement: fact.statement,
        confidence: fact.confidence,
        referenceIds: fact.referenceIds
      })),
      hypotheses: bundle.hypotheses.map((hypothesis) => ({
        statement: hypothesis.statement,
        confidence: hypothesis.confidence,
        referenceIds: hypothesis.referenceIds
      })),
      unknowns: bundle.unknowns.map((unknown) => ({
        question: unknown.question,
        impact: unknown.impact,
        referenceIds: unknown.referenceIds
      })),
      relevantTargets: bundle.relevantTargets,
      snippets: bundle.snippets.map((snippet) => ({
        kind: snippet.kind,
        content: snippet.content,
        location: snippet.location,
        referenceId: snippet.referenceId,
        rationale: snippet.rationale
      })),
      references: bundle.references.map((reference) => ({
        sourceType: reference.sourceType,
        location: reference.location,
        note: reference.note
      })),
      confidence: bundle.confidence
    });
  }

  private getNodeEvidenceBundles(node: PlanNode): EvidenceBundle[] {
    return node.evidenceBundleIds
      .map((bundleId) => this.evidenceStore.getBundle(bundleId))
      .filter((bundle): bundle is EvidenceBundle => Boolean(bundle));
  }

  private buildInvocationContext(
    node: PlanNode,
    assignedModel: ModelRef,
    capability: OrchestratorCapability,
    evidenceBundles: EvidenceBundle[]
  ): ModelInvocationContext {
    const run = this.engine.getRun(node.runId);
    if (!run) {
      throw new Error(`Run ${node.runId} was not found`);
    }

    return {
      run,
      node,
      config: run.config,
      assignedModel,
      outputLanguage: run.language ?? "ko",
      abortSignal: this.abortController.signal,
      workflowStage: this.getWorkflowStage(node, capability),
      reviewPolicy: node.reviewPolicy,
      executionBudget: node.executionBudget,
      workingMemory: node.role === "stage"
        ? this.rebaseWorkingMemorySnapshot(this.getWorkingMemorySnapshot(node.runId), node.id)
        : this.getWorkingMemorySnapshot(node.runId),
      projectStructure: node.role === "stage"
        ? this.rebaseProjectStructureSnapshot(this.getProjectStructureSnapshot(node.runId), node.id)
        : this.getProjectStructureSnapshot(node.runId),
      evidenceBundles,
      requestUserApproval: (request) => this.handleUserApprovalRequest(node, capability, assignedModel, request),
      requestUserInput: (request) => this.handleUserInputRequest(node, capability, assignedModel, request),
      reportProgress: (message, details) => {
        this.engine.appendEvent(node.runId, node.id, "scheduler_progress", {
          message,
          ...(details ?? {})
        });
      },
      reportExecutionStatus: (state, message, details) => this.recordExecutionStatus(node, state, message, details)
    };
  }

  private async handleUserApprovalRequest(
    node: PlanNode,
    capability: OrchestratorCapability,
    assignedModel: ModelRef,
    request: Omit<OrchestratorApprovalRequest, "requestId" | "runId" | "nodeId" | "capability" | "provider" | "model" | "createdAt">
  ): Promise<OrchestratorApprovalDecision> {
    const approvalRequest: OrchestratorApprovalRequest = {
      ...request,
      requestId: randomUUID(),
      runId: node.runId,
      nodeId: node.id,
      capability,
      provider: assignedModel.provider,
      model: assignedModel.model,
      createdAt: this.now()
    };
    const payloadOptions = approvalRequest.options.map((option) => ({
      optionId: option.optionId,
      kind: option.kind ?? null,
      label: option.label ?? this.describeApprovalOption(option)
    }));

    this.engine.appendEvent(node.runId, node.id, "approval_requested", {
      requestId: approvalRequest.requestId,
      capability,
      provider: assignedModel.provider,
      model: assignedModel.model,
      title: approvalRequest.title ?? null,
      message: approvalRequest.message,
      details: approvalRequest.details ?? null,
      kind: approvalRequest.kind ?? null,
      locations: approvalRequest.locations ?? [],
      options: payloadOptions
    });

    if (node.kind === "execution") {
      this.recordExecutionStatus(node, "awaiting_user_approval", approvalRequest.message);
    }

    let decision: OrchestratorApprovalDecision;
    if (this.requestUserApprovalHandler) {
      decision = await this.requestUserApprovalHandler(approvalRequest);
    } else {
      const allowOption = approvalRequest.options.find((option) => option.kind === "allow_once")
        ?? approvalRequest.options.find((option) => option.kind?.startsWith("allow"))
        ?? approvalRequest.options[0];
      decision = allowOption
        ? {
            outcome: "selected",
            optionId: allowOption.optionId
          }
        : {
            outcome: "cancelled"
          };
    }

    this.engine.appendEvent(node.runId, node.id, "approval_resolved", {
      requestId: approvalRequest.requestId,
      capability,
      provider: assignedModel.provider,
      model: assignedModel.model,
      approved: decision.outcome === "selected",
      optionId: decision.optionId ?? null
    });

    if (node.kind === "execution") {
      this.recordExecutionStatus(
        node,
        decision.outcome === "selected" ? "approval_granted" : "approval_denied",
        decision.outcome === "selected"
          ? `Approved ${this.describeApprovalOption(payloadOptions.find((option) => option.optionId === decision.optionId))}`
          : "User denied the requested action"
      );
    }

    return decision;
  }

  private async handleUserInputRequest(
    node: PlanNode,
    capability: OrchestratorCapability,
    assignedModel: ModelRef,
    request: Omit<OrchestratorUserInputRequest, "requestId" | "runId" | "nodeId" | "capability" | "provider" | "model" | "createdAt">
  ): Promise<OrchestratorUserInputResponse> {
    const inputRequest: OrchestratorUserInputRequest = {
      ...request,
      requestId: randomUUID(),
      runId: node.runId,
      nodeId: node.id,
      capability,
      provider: assignedModel.provider,
      model: assignedModel.model,
      createdAt: this.now()
    };

    this.engine.appendEvent(node.runId, node.id, "user_input_requested", {
      requestId: inputRequest.requestId,
      capability,
      provider: assignedModel.provider,
      model: assignedModel.model,
      title: inputRequest.title ?? null,
      message: inputRequest.message,
      questions: inputRequest.questions.map((question) => ({
        id: question.id,
        header: question.header,
        question: question.question,
        options: question.options ?? [],
        isOther: question.isOther ?? false,
        isSecret: question.isSecret ?? false
      }))
    });

    if (node.kind === "execution") {
      this.recordExecutionStatus(node, "awaiting_user_input", inputRequest.message);
    }

    let response: OrchestratorUserInputResponse;
    if (this.requestUserInputHandler) {
      response = await this.requestUserInputHandler(inputRequest);
    } else {
      response = {
        outcome: "cancelled"
      };
    }

    this.engine.appendEvent(node.runId, node.id, "user_input_resolved", {
      requestId: inputRequest.requestId,
      capability,
      provider: assignedModel.provider,
      model: assignedModel.model,
      submitted: response.outcome === "submitted",
      answers: response.answers ?? {}
    });

    if (node.kind === "execution") {
      this.recordExecutionStatus(
        node,
        response.outcome === "submitted" ? "user_input_submitted" : "user_input_cancelled",
        response.outcome === "submitted"
          ? "User input submitted"
          : "User input request was cancelled"
      );
    }

    return response;
  }

  private describeApprovalOption(
    option: { optionId: string; kind?: string | null; label?: string | null } | undefined
  ): string {
    if (option?.label && option.label.trim().length > 0) {
      return option.label.trim();
    }

    const kind = option?.kind?.trim() ?? "";
    if (kind === "allow_once") {
      return "allow once";
    }
    if (kind === "allow_for_session") {
      return "allow for session";
    }
    if (kind.startsWith("allow")) {
      return kind.replaceAll("_", " ");
    }

    return option?.optionId?.trim() || "selected option";
  }

  private recordExecutionStatus(
    node: PlanNode,
    state: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    this.engine.appendEvent(node.runId, node.id, "execution_status", {
      state,
      message,
      ...(details ?? {})
    });
  }

  private materializeEvidenceBundle(node: PlanNode, bundleDraft: EvidenceBundleDraft): EvidenceBundle {
    const timestamp = this.now();
    return {
      ...bundleDraft,
      runId: node.runId,
      nodeId: node.id,
      createdAt: bundleDraft.createdAt ?? timestamp,
      updatedAt: bundleDraft.updatedAt ?? timestamp
    } as EvidenceBundle;
  }

  private recordModelInvocation(
    node: PlanNode,
    role: AssignedModelRole,
    capability: OrchestratorCapability,
    assignedModel: ModelRef,
    debug: ModelExecutionDebugInfo | undefined,
    result: { debug?: ModelExecutionDebugInfo }
  ) {
    this.engine.appendEvent(node.runId, node.id, "model_invocation", {
      role,
      capability,
      modelId: assignedModel.id,
      provider: assignedModel.provider,
      model: assignedModel.model,
      command: debug?.command ?? [],
      prompt: debug?.prompt ?? null
    });

    this.engine.appendEvent(node.runId, node.id, "model_response", {
      role,
      capability,
      modelId: assignedModel.id,
      provider: assignedModel.provider,
      model: assignedModel.model,
      rawStdout: debug?.rawStdout ?? null,
      rawStderr: debug?.rawStderr ?? null,
      result: this.stripDebug(result)
    });
  }

  private stripDebug<TResult extends { debug?: ModelExecutionDebugInfo }>(result: TResult): Record<string, unknown> {
    const { debug: _debug, ...payload } = result as TResult & { debug?: ModelExecutionDebugInfo };
    return payload as Record<string, unknown>;
  }

  private recordAbstractPlanning(node: PlanNode, result: AbstractPlanResult) {
    this.recordDecision(node.runId, node.id, "Abstract plan created", result.summary);

    const workingMemory = this.requireWorkingMemory(node.runId);
    for (const requirement of result.evidenceRequirements) {
      workingMemory.recordQuestion({
        question: requirement,
        relatedNodeIds: [node.id]
      });
    }

    for (const target of result.targetsToInspect) {
      workingMemory.recordDecision({
        summary: "Inspection target identified",
        rationale: target,
        relatedNodeIds: [node.id]
      });
    }
  }

  private recordDecision(runId: string, nodeId: string, summary: string, rationale: string) {
    this.requireWorkingMemory(runId).recordDecision({
      summary,
      rationale,
      relatedNodeIds: [nodeId]
    });
  }

  private ingestEvidenceBundle(nodeId: string, bundle: EvidenceBundle) {
    const workingMemory = this.requireWorkingMemory(bundle.runId);

    for (const fact of bundle.facts) {
      if (typeof fact.statement !== "string" || fact.statement.trim().length === 0) {
        continue;
      }
      workingMemory.recordFact({
        statement: fact.statement,
        confidence: fact.confidence,
        referenceIds: fact.referenceIds,
        relatedNodeIds: [nodeId]
      });
    }

    for (const unknown of bundle.unknowns) {
      if (typeof unknown.question !== "string" || unknown.question.trim().length === 0) {
        continue;
      }
      workingMemory.recordUnknown({
        description: unknown.question,
        impact: unknown.impact,
        referenceIds: unknown.referenceIds,
        relatedNodeIds: [nodeId]
      });
    }
  }

  private resolveCoveredQuestions(
    node: PlanNode,
    input: {
      abstractPlanSummary?: string;
      gatherSummary?: string;
      concretePlanSummary?: string;
      reviewSummary?: string;
      executeSummary?: string;
      outputs: string[];
      verifySummaries: string[];
      evidenceBundles: EvidenceBundle[];
    }
  ) {
    const workingMemory = this.requireWorkingMemory(node.runId);
    const snapshot = workingMemory.getSnapshot();
    const candidateSources = this.collectResolutionSources(node, input);
    const relatedNodeIds = this.collectNodeResolutionScope(node);

    for (const question of snapshot.openQuestions) {
      if (question.status !== "open") continue;
      if (
        question.relatedNodeIds.length > 0
        && !question.relatedNodeIds.some((relatedNodeId) => relatedNodeIds.has(relatedNodeId))
      ) {
        continue;
      }

      const matchingSource = candidateSources.find((source) => this.questionIsCoveredBySource(question.question, source));
      if (!matchingSource) continue;

      workingMemory.resolveQuestion(question.id, `Confirmed by: ${truncateResolutionSource(matchingSource)}`);
    }
  }

  private collectNodeResolutionScope(node: PlanNode): Set<string> {
    const relatedNodeIds = new Set<string>([node.id]);

    for (const childNodeId of node.childIds) {
      const childNode = this.engine.getNode(childNodeId);
      if (!childNode || childNode.role !== "stage") {
        continue;
      }

      relatedNodeIds.add(childNode.id);
    }

    return relatedNodeIds;
  }

  private collectNodeSubtreeIds(node: PlanNode): Set<string> {
    const relatedNodeIds = new Set<string>();
    const stack = [node.id];

    while (stack.length > 0) {
      const currentNodeId = stack.pop();
      if (!currentNodeId || relatedNodeIds.has(currentNodeId)) {
        continue;
      }

      relatedNodeIds.add(currentNodeId);
      const currentNode = this.engine.getNode(currentNodeId);
      if (!currentNode) {
        continue;
      }

      for (const childNodeId of currentNode.childIds) {
        stack.push(childNodeId);
      }
    }

    return relatedNodeIds;
  }

  private markPendingAcceptanceCriteriaMet(nodeId: string) {
    const node = this.engine.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} was not found`);
    }

    for (const item of node.acceptanceCriteria.items) {
      if (item.status !== "pending") continue;
      this.engine.updateAcceptanceCriterion(nodeId, item.id, "met");
    }
  }

  private buildFinalReport(
    runId: string,
    outputs: string[],
    verifySummaries: string[],
    review?: ReviewResult
  ): OrchestratorFinalReport {
    const workingMemory = this.getWorkingMemorySnapshot(runId);
    const projectStructure = this.getProjectStructureSnapshot(runId);
    const unresolvedRisks = this.dedupeTextEntries([
      ...(review?.followUpQuestions ?? []),
      ...workingMemory.openQuestions.filter((question) => question.status === "open").map((question) => question.question),
      ...workingMemory.unknowns.filter((unknown) => unknown.status === "open").map((unknown) => unknown.description),
      ...workingMemory.conflicts.filter((conflict) => conflict.status === "open").map((conflict) => conflict.summary),
      ...projectStructure.openQuestions
        .filter((question) => question.status === "open")
        .map((question) => question.question),
      ...projectStructure.contradictions
        .filter((contradiction) => contradiction.status === "open")
        .map((contradiction) => contradiction.summary)
    ]);

    return {
      runId,
      summary: review?.summary ?? verifySummaries.at(-1) ?? "Run completed",
      outcomes: this.dedupeTextEntries(outputs),
      unresolvedRisks,
      nextActions: review?.nextActions ?? [],
      carryForward: review?.carryForward,
      createdAt: this.now()
    };
  }

  private isCancellationError(error: unknown): boolean {
    if (error instanceof OrchestratorRunCancelledError) {
      return true;
    }

    if (!this.abortController.signal.aborted) {
      return false;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    return error.name === "AbortError" || /aborted|cancelled/i.test(error.message);
  }

  private toCancellationError(error: unknown, runId: string, nodeId: string): OrchestratorRunCancelledError {
    if (error instanceof OrchestratorRunCancelledError) {
      return error;
    }

    const message = this.cancellationReason ?? (error instanceof Error ? error.message : "Orchestrator run cancelled");
    return new OrchestratorRunCancelledError(message, runId, nodeId);
  }

  private throwIfCancelled(runId: string, nodeId: string) {
    if (!this.abortController.signal.aborted) {
      return;
    }

    throw new OrchestratorRunCancelledError(
      this.cancellationReason ?? "Orchestrator run cancelled",
      runId,
      nodeId
    );
  }

  private getProjectStructureInspectionFingerprint(runId: string): string {
    const snapshot = this.getProjectStructureSnapshot(runId);
    return JSON.stringify({
      // Ignore prose-only summary churn. Repeat detection should key off
      // concrete structure facts and unresolved structure issues instead.
      directories: snapshot.directories
        .map((entry) => `${entry.path}:${entry.summary}:${entry.confidence}`)
        .sort(),
      keyFiles: snapshot.keyFiles
        .map((entry) => `${entry.path}:${entry.summary}:${entry.confidence}`)
        .sort(),
      entryPoints: snapshot.entryPoints
        .map((entry) => `${entry.path}:${entry.role}:${entry.summary}:${entry.confidence}`)
        .sort(),
      modules: snapshot.modules
        .map((entry) => `${entry.name}:${entry.summary}:${entry.relatedPaths.join("|")}:${entry.confidence}`)
        .sort(),
      openQuestions: snapshot.openQuestions
        .filter((entry) => entry.status === "open")
        .map((entry) => entry.question)
        .sort(),
      contradictions: snapshot.contradictions
        .filter((entry) => entry.status === "open")
        .map((entry) => entry.summary)
        .sort()
    });
  }

  private buildPlanningStageObjective(
    node: PlanNode,
    capability: "abstractPlan" | "gather",
    baseObjective: string,
    evidenceBundles: EvidenceBundle[],
    gatherContract?: {
      targetsToInspect?: string[];
      evidenceRequirements?: string[];
      additionalObjectives?: string[];
    }
  ): string {
    if (this.getWorkflowStage(node, capability) !== "task_orchestration") {
      return baseObjective;
    }

    const memoryCues = this.buildTaskOrchestrationMemoryCues(node.runId, evidenceBundles);
    const contractCues = capability === "gather"
      ? this.buildGatherContractCues(gatherContract)
      : [];
    if (memoryCues.length === 0 && contractCues.length === 0) {
      return baseObjective;
    }

    const sections = [baseObjective];
    if (memoryCues.length > 0) {
      sections.push(`Priority memory cues:\n${memoryCues.map((cue) => `- ${cue}`).join("\n")}`);
    }
    if (contractCues.length > 0) {
      sections.push(`Current gather contract:\n${contractCues.map((cue) => `- ${cue}`).join("\n")}`);
    }
    return sections.join("\n\n");
  }

  private requireExplicitEvidenceBeforeFallback(
    node: PlanNode,
    consolidatedEvidence: EvidenceBundle,
    concretePlan: ConcretePlanResult
  ): ConcretePlanResult {
    if (concretePlan.needsAdditionalGather) {
      return concretePlan;
    }

    if (!PRECISE_DATA_REQUEST_PATTERN.test(node.objective)) {
      return concretePlan;
    }

    const planText = [
      concretePlan.summary,
      ...concretePlan.executionNotes,
      ...concretePlan.childTasks.flatMap((task) => [task.title, task.objective])
    ]
      .filter((entry) => entry.length > 0)
      .join("\n");

    if (!FALLBACK_EXECUTION_PATTERN.test(planText)) {
      return concretePlan;
    }

    const evidenceText = [
      consolidatedEvidence.summary,
      ...consolidatedEvidence.facts.map((fact) => fact.statement),
      ...consolidatedEvidence.hypotheses.map((hypothesis) => hypothesis.statement),
      ...consolidatedEvidence.unknowns.map((unknown) => unknown.question),
      ...consolidatedEvidence.relevantTargets.flatMap((target) => [
        target.filePath ?? "",
        target.symbol ?? "",
        target.note ?? ""
      ]),
      ...consolidatedEvidence.references.flatMap((reference) => [
        reference.note ?? "",
        reference.location?.filePath ?? "",
        reference.location?.symbol ?? "",
        reference.location?.label ?? "",
        reference.location?.uri ?? ""
      ]),
      ...consolidatedEvidence.snippets.map((snippet) => snippet.content)
    ]
      .filter((entry) => entry.length > 0)
      .join("\n");

    const hasRepositoryEvidence = REPOSITORY_EVIDENCE_PATTERN.test(evidenceText);
    const hasExternalSurfaceEvidence = EXTERNAL_SURFACE_EVIDENCE_PATTERN.test(evidenceText)
      || consolidatedEvidence.references.some((reference) =>
        reference.sourceType === "terminal" || reference.sourceType === "search" || reference.sourceType === "web"
      )
      || consolidatedEvidence.snippets.some((snippet) =>
        snippet.kind === "terminal" || snippet.kind === "search_result"
      );
    const hasExplicitBlockerEvidence = DATA_SOURCE_BLOCKER_PATTERN.test(evidenceText);

    if (hasRepositoryEvidence && hasExternalSurfaceEvidence && hasExplicitBlockerEvidence) {
      return concretePlan;
    }

    return {
      ...concretePlan,
      needsAdditionalGather: true,
      additionalGatherObjectives: this.dedupeTextEntries([
        ...(concretePlan.additionalGatherObjectives ?? []),
        "Confirm the narrowest backend data source that could satisfy the requested exact data before switching to a fallback label.",
        "Collect one explicit piece of evidence about whether the relevant external Gemini surface exposes or blocks the requested usage or quota data.",
        "Return blocker evidence, not just a UI fallback recommendation."
      ]).slice(0, 3),
      executionNotes: this.dedupeTextEntries([
        ...concretePlan.executionNotes,
        "Execution is deferred until the missing or unsupported data source is established with explicit evidence."
      ])
    };
  }

  private buildGatherContractCues(input: {
    targetsToInspect?: string[];
    evidenceRequirements?: string[];
    additionalObjectives?: string[];
  } | undefined): string[] {
    if (!input) {
      return [];
    }

    const targets = this.dedupeTextEntries(input.targetsToInspect ?? []).slice(0, 3);
    const requirements = this.dedupeTextEntries(input.evidenceRequirements ?? []).slice(0, 3);
    const additionalObjectives = this.dedupeTextEntries(input.additionalObjectives ?? []).slice(0, 3);
    const cues: string[] = [];
    if (targets.length > 0) {
      cues.push(`Inspection targets from abstract plan: ${targets.join(" | ")}`);
    }
    if (requirements.length > 0) {
      cues.push(`Evidence requirements from abstract plan: ${requirements.join(" | ")}`);
    }
    if (additionalObjectives.length > 0) {
      cues.push(`Focused gather objectives from concrete plan: ${additionalObjectives.join(" | ")}`);
    }
    if (cues.length > 0) {
      cues.push("Do not widen beyond this contract unless each item has been exhausted and the returned evidence explains why widening was necessary.");
    }
    return cues;
  }

  private buildTaskOrchestrationMemoryCues(runId: string, evidenceBundles: EvidenceBundle[]): string[] {
    const workingMemory = this.getWorkingMemorySnapshot(runId);
    const projectStructure = this.getProjectStructureSnapshot(runId);
    const unresolvedQuestions = this.dedupeTextEntries([
      ...workingMemory.openQuestions
        .filter((entry) => entry.status === "open")
        .map((entry) => entry.question),
      ...workingMemory.unknowns
        .filter((entry) => entry.status === "open")
        .map((entry) => entry.description),
      ...workingMemory.conflicts
        .filter((entry) => entry.status === "open")
        .map((entry) => entry.summary),
      ...projectStructure.openQuestions
        .filter((entry) => entry.status === "open")
        .map((entry) => entry.question),
      ...projectStructure.contradictions
        .filter((entry) => entry.status === "open")
        .map((entry) => entry.summary)
    ]).slice(0, 3);
    const recentDecisions = this.dedupeTextEntries(
      workingMemory.decisions
        .slice(-3)
        .map((entry) => `${entry.summary}: ${entry.rationale}`)
    );
    const structureAnchors = this.dedupeTextEntries([
      ...projectStructure.entryPoints.map((entry) => entry.path),
      ...projectStructure.keyFiles.map((entry) => entry.path),
      ...projectStructure.modules.flatMap((entry) => entry.relatedPaths),
      ...projectStructure.directories.map((entry) => entry.path)
    ]).slice(0, 4);
    const evidenceAnchors = this.dedupeTextEntries(
      evidenceBundles.flatMap((bundle) => [
        bundle.summary,
        ...bundle.relevantTargets.map((target) => target.filePath ?? target.symbol ?? target.note ?? "")
      ])
    )
      .filter((entry) => entry.length > 0)
      .slice(0, 4);

    const cues: string[] = [];
    if (recentDecisions.length > 0) {
      cues.push(`Recent memory decisions: ${recentDecisions.join(" | ")}`);
    }
    if (unresolvedQuestions.length > 0) {
      cues.push(`Unresolved memory questions: ${unresolvedQuestions.join(" | ")}`);
    }
    if (structureAnchors.length > 0) {
      cues.push(`Known structure anchors: ${structureAnchors.join(" | ")}`);
    }
    if (evidenceAnchors.length > 0) {
      cues.push(`Existing evidence anchors: ${evidenceAnchors.join(" | ")}`);
    }

    return cues;
  }

  private getWorkingMemorySnapshot(runId: string): WorkingMemorySnapshot {
    return this.requireWorkingMemory(runId).getSnapshot();
  }

  private getProjectStructureSnapshot(runId: string): ProjectStructureSnapshot {
    return this.requireProjectStructureMemory(runId).getSnapshot();
  }

  private requireWorkingMemory(runId: string): WorkingMemoryStore {
    const workingMemory = this.workingMemoryByRun.get(runId);
    if (!workingMemory) {
      throw new Error(`Working memory for run ${runId} was not found`);
    }

    return workingMemory;
  }

  private requireProjectStructureMemory(runId: string): ProjectStructureMemoryStore {
    const projectStructure = this.projectStructureByRun.get(runId);
    if (!projectStructure) {
      throw new Error(`Project structure memory for run ${runId} was not found`);
    }

    return projectStructure;
  }

  private registerProjectStructureInspectionNode(runId: string, nodeId: string) {
    const inspectionNodeIds = this.projectStructureInspectionNodeIdsByRun.get(runId);
    if (!inspectionNodeIds) {
      throw new Error(`Project structure inspection registry for run ${runId} was not found`);
    }

    inspectionNodeIds.add(nodeId);
  }

  private isProjectStructureInspectionNode(node: PlanNode): boolean {
    let currentNode: PlanNode | undefined = node;

    while (currentNode) {
      if (this.projectStructureInspectionNodeIdsByRun.get(currentNode.runId)?.has(currentNode.id)) {
        return true;
      }

      currentNode = currentNode.parentId ? this.engine.getNode(currentNode.parentId) : undefined;
    }

    return false;
  }

  private escalateRunIfPossible(nodeId: string) {
    const node = this.engine.getNode(nodeId);
    if (!node) return;
    if (node.phase === "done" || node.phase === "escalated") return;
    if (!this.engine.canTransition(node.phase, "escalated")) return;
    this.engine.transitionNode(nodeId, "escalated");
  }

  private formatRuntimeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private dedupeTextEntries(values: string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];

    for (const value of values) {
      const trimmedValue = value.trim();
      if (trimmedValue.length === 0) continue;

      const key = trimmedValue
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[`"'’“”]/g, "")
        .replace(/[()[\]{}:;,.!?]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (key.length === 0 || seen.has(key)) continue;

      seen.add(key);
      deduped.push(trimmedValue);
    }

    return deduped;
  }

  private collectResolutionSources(
    node: PlanNode,
    input: {
      abstractPlanSummary?: string;
      gatherSummary?: string;
      concretePlanSummary?: string;
      reviewSummary?: string;
      executeSummary?: string;
      outputs: string[];
      verifySummaries: string[];
      evidenceBundles: EvidenceBundle[];
    }
  ): string[] {
    const run = this.engine.getRun(node.runId);
    if (!run) {
      throw new Error(`Run ${node.runId} was not found`);
    }

    const sources = [
      run.goal,
      node.objective,
      `executionBudget.maxDepth is ${node.executionBudget.maxDepth}`,
      `run.config.maxDepth is ${run.config.maxDepth}`,
      `maxDepth ${node.executionBudget.maxDepth}`,
      `최대 깊이 ${node.executionBudget.maxDepth}`,
      `최대 깊이 ${node.executionBudget.maxDepth}로 제한된 짧은 실행 계획`,
      `짧은 실행 계획은 최대 깊이 ${node.executionBudget.maxDepth}로 제한됨`,
      `acceptance criteria count ${node.acceptanceCriteria.items.length}`,
      `성공 기준은 ${node.acceptanceCriteria.items.length}건`,
      input.abstractPlanSummary,
      input.gatherSummary,
      input.concretePlanSummary,
      input.reviewSummary,
      input.executeSummary,
      ...input.outputs,
      ...input.verifySummaries,
      ...input.evidenceBundles.flatMap((bundle) => [
        bundle.summary,
        ...bundle.facts.map((fact) => fact.statement),
        ...bundle.unknowns.map((unknown) => unknown.question),
        ...bundle.relevantTargets.map((target) => `${target.filePath ?? ""} ${target.symbol ?? ""} ${target.note ?? ""}`),
        ...bundle.snippets.map((snippet) => snippet.content)
      ])
    ];

    return this.dedupeTextEntries(
      sources.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    );
  }

  private questionIsCoveredBySource(question: string, source: string): boolean {
    const normalizedQuestion = this.normalizeText(question);
    const normalizedSource = this.normalizeText(source);
    if (normalizedQuestion.length === 0 || normalizedSource.length === 0) {
      return false;
    }

    if (normalizedSource.includes(normalizedQuestion)) {
      return true;
    }

    const questionTokens = this.extractMeaningfulTokens(normalizedQuestion);
    const sourceTokens = new Set(this.extractMeaningfulTokens(normalizedSource));
    if (questionTokens.length === 0 || sourceTokens.size === 0) {
      return false;
    }

    const overlappingTokens = questionTokens.filter((token) => sourceTokens.has(token));
    if (overlappingTokens.length === 0) {
      return false;
    }

    const overlapRatio = overlappingTokens.length / questionTokens.length;
    return overlappingTokens.length >= 2 && overlapRatio >= 0.4;
  }

  private extractMeaningfulTokens(value: string): string[] {
    const stopwords = new Set([
      "a",
      "an",
      "and",
      "are",
      "be",
      "by",
      "confirm",
      "does",
      "explicitly",
      "for",
      "if",
      "in",
      "is",
      "it",
      "its",
      "of",
      "or",
      "remains",
      "satisfy",
      "that",
      "the",
      "their",
      "this",
      "to"
    ]);

    return value
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .filter((token) => !stopwords.has(token));
  }

  private normalizeText(value: string): string {
    return value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[`"'’“”]/g, "")
      .replace(/[()[\]{}:;,.!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

function truncateResolutionSource(value: string, maxLength = 180): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}
