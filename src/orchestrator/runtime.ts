import { OrchestratorEngine, OrchestratorEventListener } from "./engine";
import { EvidenceStore } from "./evidence-store";
import {
  AbstractPlanResult,
  ConcretePlanResult,
  ExecuteResult,
  GatherResult,
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

type RootPhaseResults = {
  abstractPlan: AbstractPlanResult;
  gather: GatherResult;
  consolidatedEvidence: EvidenceBundle;
  concretePlan: ConcretePlanResult;
  review?: ReviewResult;
  execute?: ExecuteResult;
  verify?: VerifyResult;
};

type NodeExecutionOutcome = {
  node: PlanNode;
  phaseResults: RootPhaseResults;
  outputs: string[];
  verifySummaries: string[];
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
};

export class MissingModelAssignmentError extends Error {
  constructor(nodeId: string, role: AssignedModelRole) {
    super(`Node ${nodeId} is missing a model assignment for role ${role}`);
    this.name = "MissingModelAssignmentError";
  }
}

export class ReviewRejectedError extends Error {
  constructor(nodeId: string, summary: string) {
    super(`Review rejected node ${nodeId}: ${summary}`);
    this.name = "ReviewRejectedError";
  }
}

export class VerificationFailedError extends Error {
  constructor(nodeId: string, summary: string) {
    super(`Verification failed for node ${nodeId}: ${summary}`);
    this.name = "VerificationFailedError";
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
  private readonly scheduler = new OrderedDfsScheduler();
  private readonly workingMemoryByRun = new Map<string, WorkingMemoryStore>();
  private readonly projectStructureByRun = new Map<string, ProjectStructureMemoryStore>();
  private readonly projectStructureInspectionNodeIdsByRun = new Map<string, Set<string>>();
  private readonly projectStructureInspectionAttemptsByNode = new Map<string, number>();
  private readonly finalReports = new Map<string, OrchestratorFinalReport>();
  private readonly disabledModelIdsByRun = new Map<string, Set<string>>();
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
    this.disabledModelIdsByRun.set(run.id, new Set());
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
      const finalReport = this.buildFinalReport(run.id, rootExecution.outputs, rootExecution.verifySummaries);
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
        phaseResults: rootExecution.phaseResults
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
    } finally {
      this.disabledModelIdsByRun.delete(run.id);
    }
  }

  private async executeNode(nodeId: string, allowDecomposition: boolean): Promise<NodeExecutionOutcome> {
    const startingNode = this.engine.getNode(nodeId);
    if (!startingNode) {
      throw new Error(`Node ${nodeId} was not found`);
    }

    try {
      this.throwIfCancelled(startingNode.runId, nodeId);
      const isProjectStructureInspection = this.isProjectStructureInspectionNode(startingNode);
      const seededEvidence = this.getNodeEvidenceBundles(startingNode);
      let currentNode = this.engine.transitionNode(nodeId, "abstract_plan");
      const abstractPlan = await this.invokeCapability<AbstractPlanResult>(
        currentNode,
        "abstractPlanner",
        "abstractPlan",
        seededEvidence
      );
      this.recordAbstractPlanning(currentNode, abstractPlan);

      this.throwIfCancelled(currentNode.runId, currentNode.id);
      currentNode = this.engine.transitionNode(nodeId, "gather");
      const gather = await this.invokeCapability<GatherResult>(currentNode, "gatherer", "gather", seededEvidence);
      this.mergeProjectStructureReport(currentNode, gather.projectStructure);
      const gatheredBundles = gather.evidenceBundles.map((bundleDraft) =>
        this.materializeEvidenceBundle(currentNode, bundleDraft)
      );

      for (const bundle of gatheredBundles) {
        this.evidenceStore.upsertBundle(bundle);
        this.engine.attachEvidenceBundle(currentNode.id, bundle.id);
        this.ingestEvidenceBundle(currentNode.id, bundle);
      }

      this.throwIfCancelled(currentNode.runId, currentNode.id);
      currentNode = this.engine.transitionNode(nodeId, "evidence_consolidation");
      const bundleIdsForConsolidation = [
        ...seededEvidence.map((bundle) => bundle.id),
        ...gatheredBundles.map((bundle) => bundle.id)
      ];
      const consolidatedEvidence = this.evidenceStore.mergeBundles({
        runId: currentNode.runId,
        nodeId: currentNode.id,
        bundleIds: bundleIdsForConsolidation,
        summary: gather.summary
      });
      this.evidenceStore.upsertBundle(consolidatedEvidence);
      this.engine.attachEvidenceBundle(currentNode.id, consolidatedEvidence.id);

      this.throwIfCancelled(currentNode.runId, currentNode.id);
      currentNode = this.engine.transitionNode(nodeId, "concrete_plan");
      let concretePlan = await this.invokeCapability<ConcretePlanResult>(
        currentNode,
        "concretePlanner",
        "concretePlan",
        [consolidatedEvidence]
      );
      this.recordDecision(currentNode.runId, currentNode.id, "Concrete plan created", concretePlan.summary);
      if (!isProjectStructureInspection && currentNode.depth === 0) {
        const inspectedPlan = await this.resolveProjectStructureInspectionLoop(
          currentNode,
          consolidatedEvidence,
          concretePlan
        );
        currentNode = inspectedPlan.node;
        concretePlan = inspectedPlan.concretePlan;
      }

      const phaseResults: RootPhaseResults = {
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
          verifySummaries: [concretePlan.summary]
        };
      }

      const canDecomposeFurther = this.canDecomposeFurther(currentNode);
      const shouldSkipTrivialDecomposition = allowDecomposition && this.shouldSkipDecompositionForShortTestGoal(currentNode);
      if (allowDecomposition && concretePlan.childTasks.length > 0 && canDecomposeFurther && !shouldSkipTrivialDecomposition) {
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
              assignedModels: childTask.assignedModels,
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
        }

        this.resolveCoveredQuestions(currentNode, {
          abstractPlanSummary: abstractPlan.summary,
          gatherSummary: gather.summary,
          concretePlanSummary: concretePlan.summary,
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
          verifySummaries
        };
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

      let review: ReviewResult | undefined;
      if (this.shouldRunReview(currentNode)) {
        this.throwIfCancelled(currentNode.runId, currentNode.id);
        currentNode = this.engine.transitionNode(nodeId, "review");
        review = await this.invokeCapability<ReviewResult>(currentNode, "reviewer", "review", [consolidatedEvidence]);
        phaseResults.review = review;
        this.recordDecision(currentNode.runId, currentNode.id, "Review completed", review.summary);

        if (!review.approved) {
          throw new ReviewRejectedError(currentNode.id, review.summary);
        }
      }

      this.throwIfCancelled(currentNode.runId, currentNode.id);
      currentNode = this.engine.transitionNode(nodeId, "execute");
      const execute = await this.invokeCapability<ExecuteResult>(currentNode, "executor", "execute", [consolidatedEvidence]);
      phaseResults.execute = execute;
      this.recordDecision(currentNode.runId, currentNode.id, "Execution completed", execute.summary);

      this.throwIfCancelled(currentNode.runId, currentNode.id);
      currentNode = this.engine.transitionNode(nodeId, "verify");
      const verify = await this.invokeCapability<VerifyResult>(currentNode, "verifier", "verify", [consolidatedEvidence]);
      phaseResults.verify = verify;
      this.recordDecision(currentNode.runId, currentNode.id, "Verification completed", verify.summary);

      if (!verify.passed) {
        throw new VerificationFailedError(currentNode.id, verify.summary);
      }

      this.resolveCoveredQuestions(currentNode, {
        abstractPlanSummary: abstractPlan.summary,
        gatherSummary: gather.summary,
        concretePlanSummary: concretePlan.summary,
        reviewSummary: review?.summary,
        executeSummary: execute.summary,
        outputs: execute.outputs,
        verifySummaries: [verify.summary, ...verify.findings],
        evidenceBundles: [consolidatedEvidence]
      });
      this.markPendingAcceptanceCriteriaMet(currentNode.id);
      this.throwIfCancelled(currentNode.runId, currentNode.id);
      currentNode = this.engine.transitionNode(nodeId, "done");

      return {
        node: currentNode,
        phaseResults,
        outputs: execute.outputs.length > 0 ? execute.outputs : [execute.summary],
        verifySummaries: [verify.summary]
      };
    } catch (error) {
      if (this.isCancellationError(error)) {
        throw this.toCancellationError(error, startingNode.runId, nodeId);
      }

      const failedNode = this.engine.getNode(nodeId);
      if (failedNode) {
        this.engine.appendEvent(failedNode.runId, failedNode.id, "node_failed", {
          phase: failedNode.phase,
          error: this.formatRuntimeError(error)
        });
      }
      this.escalateRunIfPossible(nodeId);
      throw error;
    }
  }

  private shouldRunReview(node: PlanNode): boolean {
    return node.reviewPolicy !== "none" && Boolean(node.assignedModels.reviewer);
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

    const modelForInvocation = this.resolveModelForInvocation(node, capability, assignedModel);
    const adapter = this.adapterRegistry.resolve(modelForInvocation, capability);
    const context = this.buildInvocationContext(node, modelForInvocation, capability, evidenceBundles);
    const invocation = this.getInvocation(adapter, capability);
    try {
      const result = await invocation(context) as TResult;
      this.throwIfCancelled(node.runId, node.id);
      this.recordModelInvocation(node, role, capability, modelForInvocation, result.debug, result);
      return result;
    } catch (error) {
      if (this.isCancellationError(error)) {
        throw this.toCancellationError(error, node.runId, node.id);
      }

      if (modelForInvocation.id !== assignedModel.id) {
        throw error;
      }

      const fallbackModel = this.resolveFallbackModel(node, capability, assignedModel, error);
      if (!fallbackModel) {
        throw error;
      }

      this.disableModelForRun(node.runId, assignedModel.id);
      this.engine.appendEvent(node.runId, node.id, "scheduler_progress", {
        message: "Retrying capability with fallback model",
        capability,
        failedModelId: assignedModel.id,
        fallbackModelId: fallbackModel.id,
        error: this.formatRuntimeError(error)
      });

      const fallbackAdapter = this.adapterRegistry.resolve(fallbackModel, capability);
      const fallbackContext = this.buildInvocationContext(node, fallbackModel, capability, evidenceBundles);
      const fallbackInvocation = this.getInvocation(fallbackAdapter, capability);
      const fallbackResult = await fallbackInvocation(fallbackContext) as TResult;
      this.throwIfCancelled(node.runId, node.id);
      this.recordModelInvocation(node, role, capability, fallbackModel, fallbackResult.debug, fallbackResult);
      return fallbackResult;
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

  private getWorkflowStage(node: PlanNode, capability: OrchestratorCapability): OrchestratorWorkflowStage {
    if (this.isProjectStructureInspectionNode(node)) {
      return "project_structure_inspection";
    }

    if (node.depth === 0 && (capability === "abstractPlan" || capability === "gather")) {
      return "project_structure_discovery";
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
      concretePlan = await this.invokeCapability<ConcretePlanResult>(
        currentNode,
        "concretePlanner",
        "concretePlan",
        [consolidatedEvidence]
      );
      this.recordDecision(
        currentNode.runId,
        currentNode.id,
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

  private recordProjectStructureInspectionRequest(
    node: PlanNode,
    request: ProjectStructureInspectionRequest,
    attempt: number
  ) {
    const projectStructure = this.requireProjectStructureMemory(node.runId);
    projectStructure.recordInspectionObjectives(node.id, request.objectives);
    projectStructure.recordContradictions(node.id, request.contradictions);
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
    inspectionSummaries.push(outcome.phaseResults.concretePlan.summary);

    const resolution = this.dedupeTextEntries(inspectionSummaries).join(" | ") || "Project structure inspection completed";
    const projectStructure = this.requireProjectStructureMemory(parentNode.runId);
    const snapshot = projectStructure.getSnapshot();
    const parentOpenQuestions = snapshot.openQuestions
      .filter((question) => question.status === "open" && question.relatedNodeIds.includes(parentNode.id))
      .map((question) => question.question);
    const parentContradictions = snapshot.contradictions
      .filter((contradiction) => contradiction.status === "open" && contradiction.relatedNodeIds.includes(parentNode.id))
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
    const inspectionModel = Object.values(parentNode.assignedModels)
      .filter((model): model is ModelRef => Boolean(model))
      .sort((left, right) => this.scoreInspectionModel(right) - this.scoreInspectionModel(left))[0];

    if (!inspectionModel) {
      return undefined;
    }

    return {
      abstractPlanner: inspectionModel,
      gatherer: inspectionModel,
      concretePlanner: inspectionModel,
      reviewer: inspectionModel,
      executor: inspectionModel,
      verifier: inspectionModel
    };
  }

  private scoreInspectionModel(model: ModelRef): number {
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
    const miniPenalty = /\bmini\b|\bnano\b/i.test(model.model) ? -50 : 0;
    return reasoningScore + tierScore + miniPenalty;
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
      abortSignal: this.abortController.signal,
      workflowStage: this.getWorkflowStage(node, capability),
      reviewPolicy: node.reviewPolicy,
      executionBudget: node.executionBudget,
      workingMemory: this.getWorkingMemorySnapshot(node.runId),
      projectStructure: this.getProjectStructureSnapshot(node.runId),
      evidenceBundles
    };
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
      workingMemory.recordFact({
        statement: fact.statement,
        confidence: fact.confidence,
        referenceIds: fact.referenceIds,
        relatedNodeIds: [nodeId]
      });
    }

    for (const unknown of bundle.unknowns) {
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

    for (const question of snapshot.openQuestions) {
      if (question.status !== "open") continue;
      if (question.relatedNodeIds.length > 0 && !question.relatedNodeIds.includes(node.id)) continue;

      const matchingSource = candidateSources.find((source) => this.questionIsCoveredBySource(question.question, source));
      if (!matchingSource) continue;

      workingMemory.resolveQuestion(question.id, `Confirmed by: ${truncateResolutionSource(matchingSource)}`);
    }
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

  private buildFinalReport(runId: string, outputs: string[], verifySummaries: string[]): OrchestratorFinalReport {
    const workingMemory = this.getWorkingMemorySnapshot(runId);
    const projectStructure = this.getProjectStructureSnapshot(runId);
    const unresolvedRisks = this.dedupeTextEntries([
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
      summary: verifySummaries.at(-1) ?? "Run completed",
      outcomes: this.dedupeTextEntries(outputs),
      unresolvedRisks,
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
      summary: snapshot.summary,
      directories: snapshot.directories.map((entry) => `${entry.path}:${entry.summary}:${entry.confidence}`),
      keyFiles: snapshot.keyFiles.map((entry) => `${entry.path}:${entry.summary}:${entry.confidence}`),
      entryPoints: snapshot.entryPoints.map((entry) => `${entry.path}:${entry.role}:${entry.summary}:${entry.confidence}`),
      modules: snapshot.modules.map((entry) => `${entry.name}:${entry.summary}:${entry.relatedPaths.join("|")}:${entry.confidence}`)
    });
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
    return this.projectStructureInspectionNodeIdsByRun.get(node.runId)?.has(node.id) ?? false;
  }

  private escalateRunIfPossible(nodeId: string) {
    const node = this.engine.getNode(nodeId);
    if (!node) return;
    if (node.phase === "done" || node.phase === "escalated") return;
    if (!this.engine.canTransition(node.phase, "escalated")) return;
    this.engine.transitionNode(nodeId, "escalated");
  }

  private resolveFallbackModel(
    node: PlanNode,
    capability: OrchestratorCapability,
    assignedModel: ModelRef,
    error: unknown
  ): ModelRef | null {
    if (!this.shouldRetryManagedGeminiWithCodex(capability, assignedModel, error)) {
      return null;
    }

    return this.findFallbackModel(node, capability, assignedModel.id);
  }

  private resolveModelForInvocation(
    node: PlanNode,
    capability: OrchestratorCapability,
    assignedModel: ModelRef
  ): ModelRef {
    if (!this.isModelDisabledForRun(node.runId, assignedModel.id)) {
      return assignedModel;
    }

    const fallbackModel = this.findFallbackModel(node, capability, assignedModel.id);
    if (!fallbackModel) {
      return assignedModel;
    }

    this.engine.appendEvent(node.runId, node.id, "scheduler_progress", {
      message: "Using fallback model because the primary model was disabled earlier in the run",
      capability,
      disabledModelId: assignedModel.id,
      fallbackModelId: fallbackModel.id
    });

    return fallbackModel;
  }

  private findFallbackModel(
    node: PlanNode,
    capability: OrchestratorCapability,
    excludedModelId: string
  ): ModelRef | null {
    for (const candidate of [
      node.assignedModels.concretePlanner,
      node.assignedModels.abstractPlanner,
      node.assignedModels.reviewer,
      node.assignedModels.verifier
    ]) {
      if (!candidate || candidate.id === excludedModelId) continue;
      const adapter = this.adapterRegistry.get(candidate.id);
      if (!adapter?.supports(capability)) continue;
      return candidate;
    }

    return null;
  }

  private disableModelForRun(runId: string, modelId: string) {
    const disabledModelIds = this.disabledModelIdsByRun.get(runId);
    if (!disabledModelIds) return;
    disabledModelIds.add(modelId);
  }

  private isModelDisabledForRun(runId: string, modelId: string): boolean {
    return this.disabledModelIdsByRun.get(runId)?.has(modelId) ?? false;
  }

  private shouldRetryManagedGeminiWithCodex(
    _capability: OrchestratorCapability,
    assignedModel: ModelRef,
    error: unknown
  ): boolean {
    const provider = assignedModel.provider.trim().toLowerCase();
    const modelName = assignedModel.model.trim().toLowerCase();
    if (provider !== "google" && !modelName.includes("gemini")) {
      return false;
    }

    const message = this.formatRuntimeError(error);
    return message.includes("Failed to parse gemini output")
      || message.includes("Gemini CLI exited without writing any JSON to stdout");
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
