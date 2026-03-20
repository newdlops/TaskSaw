import { randomUUID } from "node:crypto";
import {
  AcceptanceCriteria,
  AcceptanceCriterionStatus,
  CreateChildNodeInput,
  CreateRunInput,
  ExecutionBudget,
  NodePhase,
  OrchestratorConfig,
  OrchestratorEvent,
  PlanNode,
  Run
} from "./types";

export const DEFAULT_EXECUTION_BUDGET: ExecutionBudget = {
  maxDepth: 2,
  evidenceBudget: 12,
  rereadBudget: 4,
  upperModelCallBudget: 6,
  reviewBudget: 2
};

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxDepth: 2,
  reviewPolicy: "light",
  plannerBias: "balanced",
  carefulnessMode: "balanced",
  defaultBudget: DEFAULT_EXECUTION_BUDGET
};

export const NODE_PHASE_TRANSITIONS: Record<NodePhase, readonly NodePhase[]> = {
  init: ["abstract_plan", "gather", "evidence_consolidation", "concrete_plan", "review", "execute", "verify", "done", "escalated"],
  abstract_plan: ["gather", "concrete_plan", "done", "replan", "escalated"],
  gather: ["evidence_consolidation", "done", "replan", "escalated"],
  evidence_consolidation: ["gather", "concrete_plan", "done", "replan", "escalated"],
  concrete_plan: ["review", "execute", "done", "replan", "escalated"],
  review: ["execute", "done", "replan", "escalated"],
  execute: ["verify", "done", "replan", "escalated"],
  verify: ["done", "replan", "escalated"],
  done: [],
  replan: ["abstract_plan", "gather", "concrete_plan", "escalated"],
  escalated: []
};

const DEFAULT_ACCEPTANCE_CRITERIA: AcceptanceCriteria = {
  items: []
};

export class InvalidNodePhaseTransitionError extends Error {
  constructor(nodeId: string, currentPhase: NodePhase, targetPhase: NodePhase) {
    super(`Invalid phase transition for node ${nodeId}: ${currentPhase} -> ${targetPhase}`);
    this.name = "InvalidNodePhaseTransitionError";
  }
}

export type OrchestratorEventListener = (event: OrchestratorEvent) => void;

export class OrchestratorEngine {
  private readonly runs = new Map<string, Run>();
  private readonly nodes = new Map<string, PlanNode>();
  private readonly events: OrchestratorEvent[] = [];
  private readonly listeners = new Set<OrchestratorEventListener>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  createRun(input: CreateRunInput): { run: Run; rootNode: PlanNode } {
    const timestamp = this.now();
    const runId = randomUUID();
    const rootNodeId = randomUUID();
    const config = this.resolveConfig(input.config);
    const executionBudget = this.resolveBudget(config.defaultBudget, input.executionBudget);
    const reviewPolicy = input.reviewPolicy ?? config.reviewPolicy;
    const acceptanceCriteria = this.cloneAcceptanceCriteria(input.acceptanceCriteria ?? DEFAULT_ACCEPTANCE_CRITERIA);

    const run: Run = {
      id: runId,
      goal: input.goal,
      workspacePath: input.workspacePath?.trim() || null,
      language: input.language ?? "ko",
      status: "pending",
      rootNodeId,
      continuedFromRunId: input.continuation?.sourceRunId ?? null,
      config,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };

    const rootNode: PlanNode = {
      id: rootNodeId,
      runId,
      parentId: null,
      childIds: [],
      kind: input.kind ?? "planning",
      role: input.role ?? "task",
      stagePhase: input.stagePhase ?? null,
      title: input.title ?? "Root Task",
      objective: input.objective ?? input.goal,
      depth: 0,
      phase: "init",
      assignedModels: input.assignedModels ?? {},
      reviewPolicy,
      acceptanceCriteria,
      executionBudget,
      evidenceBundleIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };

    this.runs.set(runId, run);
    this.nodes.set(rootNodeId, rootNode);
    this.recordEvent(runId, null, "run_created", {
      goal: run.goal,
      rootNodeId,
      continuedFromRunId: run.continuedFromRunId
    });
    this.recordEvent(runId, rootNodeId, "node_created", {
      parentId: null,
      kind: rootNode.kind,
      role: rootNode.role,
      stagePhase: rootNode.stagePhase,
      phase: rootNode.phase,
      depth: rootNode.depth,
      title: rootNode.title,
      objective: rootNode.objective
    });

    return { run, rootNode };
  }

  createChildNode(parentNodeId: string, input: CreateChildNodeInput): { parentNode: PlanNode; childNode: PlanNode } {
    const parentNode = this.getRequiredNode(parentNodeId);
    const run = this.getRequiredRun(parentNode.runId);
    const timestamp = this.now();
    const childKind = input.kind ?? "planning";
    const childRole = input.role ?? "task";
    const childDepth = childRole === "stage"
      ? parentNode.depth
      : childKind === "execution"
        ? parentNode.depth
        : parentNode.depth + 1;

    if (childDepth > run.config.maxDepth) {
      throw new Error(`Child node depth ${childDepth} exceeds configured maxDepth ${run.config.maxDepth}`);
    }

    const childNode: PlanNode = {
      id: randomUUID(),
      runId: parentNode.runId,
      parentId: parentNodeId,
      childIds: [],
      kind: childKind,
      role: childRole,
      stagePhase: input.stagePhase ?? null,
      title: input.title,
      objective: input.objective,
      depth: childDepth,
      phase: "init",
      assignedModels: input.assignedModels ?? {},
      reviewPolicy: input.reviewPolicy ?? parentNode.reviewPolicy,
      acceptanceCriteria: this.cloneAcceptanceCriteria(input.acceptanceCriteria ?? DEFAULT_ACCEPTANCE_CRITERIA),
      executionBudget: this.resolveBudget(parentNode.executionBudget, input.executionBudget),
      evidenceBundleIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };

    const updatedParentNode: PlanNode = {
      ...parentNode,
      childIds: [...parentNode.childIds, childNode.id],
      updatedAt: timestamp
    };

    this.nodes.set(updatedParentNode.id, updatedParentNode);
    this.nodes.set(childNode.id, childNode);
    this.recordEvent(parentNode.runId, childNode.id, "node_created", {
      parentId: parentNodeId,
      kind: childNode.kind,
      role: childNode.role,
      stagePhase: childNode.stagePhase,
      phase: childNode.phase,
      depth: childNode.depth,
      title: childNode.title,
      objective: childNode.objective
    });

    return { parentNode: updatedParentNode, childNode };
  }

  transitionNode(nodeId: string, nextPhase: NodePhase): PlanNode {
    const node = this.getRequiredNode(nodeId);
    if (!this.canTransition(node.phase, nextPhase)) {
      throw new InvalidNodePhaseTransitionError(nodeId, node.phase, nextPhase);
    }

    const timestamp = this.now();
    const updatedNode: PlanNode = {
      ...node,
      phase: nextPhase,
      updatedAt: timestamp,
      completedAt: nextPhase === "done" ? timestamp : null
    };

    this.nodes.set(nodeId, updatedNode);
    this.updateRunForNodeTransition(updatedNode, timestamp);
    this.recordEvent(updatedNode.runId, updatedNode.id, "phase_transition", {
      from: node.phase,
      to: nextPhase
    });

    return updatedNode;
  }

  updateAcceptanceCriterion(
    nodeId: string,
    criterionId: string,
    status: AcceptanceCriterionStatus
  ): PlanNode {
    const node = this.getRequiredNode(nodeId);
    const timestamp = this.now();
    let found = false;

    const acceptanceCriteria = {
      items: node.acceptanceCriteria.items.map((criterion) => {
        if (criterion.id !== criterionId) return criterion;
        found = true;
        return {
          ...criterion,
          status
        };
      })
    };

    if (!found) {
      throw new Error(`Acceptance criterion ${criterionId} was not found on node ${nodeId}`);
    }

    const updatedNode: PlanNode = {
      ...node,
      acceptanceCriteria,
      updatedAt: timestamp
    };

    this.nodes.set(nodeId, updatedNode);
    this.recordEvent(updatedNode.runId, updatedNode.id, "acceptance_updated", {
      criterionId,
      status
    });

    return updatedNode;
  }

  attachEvidenceBundle(nodeId: string, bundleId: string): PlanNode {
    const node = this.getRequiredNode(nodeId);
    if (node.evidenceBundleIds.includes(bundleId)) return node;

    const timestamp = this.now();
    const updatedNode: PlanNode = {
      ...node,
      evidenceBundleIds: [...node.evidenceBundleIds, bundleId],
      updatedAt: timestamp
    };

    this.nodes.set(nodeId, updatedNode);
    this.recordEvent(updatedNode.runId, updatedNode.id, "evidence_attached", {
      bundleId
    });

    return updatedNode;
  }

  canTransition(currentPhase: NodePhase, nextPhase: NodePhase): boolean {
    return NODE_PHASE_TRANSITIONS[currentPhase].includes(nextPhase);
  }

  getAllowedTransitions(phase: NodePhase): readonly NodePhase[] {
    return NODE_PHASE_TRANSITIONS[phase];
  }

  getRun(runId: string): Run | undefined {
    return this.runs.get(runId);
  }

  getNode(nodeId: string): PlanNode | undefined {
    return this.nodes.get(nodeId);
  }

  listRunNodes(runId: string): PlanNode[] {
    return [...this.nodes.values()]
      .filter((node) => node.runId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listEvents(runId?: string): OrchestratorEvent[] {
    if (!runId) return [...this.events];
    return this.events.filter((event) => event.runId === runId);
  }

  subscribe(listener: OrchestratorEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  appendEvent(runId: string, nodeId: string | null, type: OrchestratorEvent["type"], payload: Record<string, unknown>) {
    this.recordEvent(runId, nodeId, type, payload);
  }

  pauseRun(runId: string, nodeId: string | null, reason: string): Run {
    const run = this.getRequiredRun(runId);
    const timestamp = this.now();
    const updatedRun: Run = {
      ...run,
      status: "paused",
      updatedAt: timestamp,
      completedAt: null
    };

    this.runs.set(runId, updatedRun);
    this.recordEvent(runId, nodeId, "run_paused", {
      reason
    });

    return updatedRun;
  }

  private resolveConfig(config: Partial<OrchestratorConfig> | undefined): OrchestratorConfig {
    const defaultBudget = this.resolveBudget(
      DEFAULT_ORCHESTRATOR_CONFIG.defaultBudget,
      config?.defaultBudget
    );

    return {
      maxDepth: config?.maxDepth ?? DEFAULT_ORCHESTRATOR_CONFIG.maxDepth,
      reviewPolicy: config?.reviewPolicy ?? DEFAULT_ORCHESTRATOR_CONFIG.reviewPolicy,
      plannerBias: config?.plannerBias ?? DEFAULT_ORCHESTRATOR_CONFIG.plannerBias,
      carefulnessMode: config?.carefulnessMode ?? DEFAULT_ORCHESTRATOR_CONFIG.carefulnessMode,
      defaultBudget
    };
  }

  private resolveBudget(baseBudget: ExecutionBudget, overrideBudget: Partial<ExecutionBudget> | undefined): ExecutionBudget {
    return {
      maxDepth: overrideBudget?.maxDepth ?? baseBudget.maxDepth,
      evidenceBudget: overrideBudget?.evidenceBudget ?? baseBudget.evidenceBudget,
      rereadBudget: overrideBudget?.rereadBudget ?? baseBudget.rereadBudget,
      upperModelCallBudget: overrideBudget?.upperModelCallBudget ?? baseBudget.upperModelCallBudget,
      reviewBudget: overrideBudget?.reviewBudget ?? baseBudget.reviewBudget
    };
  }

  private cloneAcceptanceCriteria(criteria: AcceptanceCriteria): AcceptanceCriteria {
    return {
      items: criteria.items.map((item) => ({ ...item }))
    };
  }

  private recordEvent(
    runId: string,
    nodeId: string | null,
    type: OrchestratorEvent["type"],
    payload: Record<string, unknown>
  ) {
    const event: OrchestratorEvent = {
      id: randomUUID(),
      runId,
      nodeId,
      type,
      createdAt: this.now(),
      payload
    };

    this.events.push(event);

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener failures so engine state transitions stay deterministic.
      }
    }
  }

  private updateRunForNodeTransition(node: PlanNode, timestamp: string) {
    const run = this.getRequiredRun(node.runId);
    let status = run.status;
    let completedAt = run.completedAt;

    if (node.phase === "done" && node.id === run.rootNodeId) {
      status = "done";
      completedAt = timestamp;
    } else if (node.phase === "escalated") {
      status = "escalated";
      completedAt = null;
    } else if (run.status === "pending") {
      status = "running";
      completedAt = null;
    }

    this.runs.set(run.id, {
      ...run,
      status,
      updatedAt: timestamp,
      completedAt
    });
  }

  private getRequiredRun(runId: string): Run {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} was not found`);
    return run;
  }

  private getRequiredNode(nodeId: string): PlanNode {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} was not found`);
    return node;
  }
}
