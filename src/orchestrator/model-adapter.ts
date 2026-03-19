import {
  EvidenceBundle,
  EvidenceBundleDraft,
  ExecutionBudget,
  ModelExecutionDebugInfo,
  ModelRef,
  OrchestratorChildTask,
  OrchestratorConfig,
  OrchestratorWorkflowStage,
  PlanNode,
  ProjectStructureReport,
  ProjectStructureSnapshot,
  ReviewPolicy,
  Run,
  WorkingMemorySnapshot
} from "./types";

export type OrchestratorCapability =
  | "abstractPlan"
  | "gather"
  | "concretePlan"
  | "review"
  | "execute"
  | "verify"
  | "rehydrate";

export type ModelInvocationContext = {
  run: Run;
  node: PlanNode;
  config: OrchestratorConfig;
  assignedModel: ModelRef;
  abortSignal: AbortSignal;
  workflowStage: OrchestratorWorkflowStage;
  reviewPolicy: ReviewPolicy;
  executionBudget: ExecutionBudget;
  workingMemory: WorkingMemorySnapshot;
  projectStructure: ProjectStructureSnapshot;
  evidenceBundles: EvidenceBundle[];
};

export type AbstractPlanResult = {
  summary: string;
  targetsToInspect: string[];
  evidenceRequirements: string[];
  debug?: ModelExecutionDebugInfo;
};

export type GatherResult = {
  summary: string;
  evidenceBundles: EvidenceBundleDraft[];
  projectStructure?: ProjectStructureReport;
  debug?: ModelExecutionDebugInfo;
};

export type ConcretePlanResult = {
  summary: string;
  childTasks: OrchestratorChildTask[];
  executionNotes: string[];
  needsProjectStructureInspection?: boolean;
  inspectionObjectives?: string[];
  projectStructureContradictions?: string[];
  debug?: ModelExecutionDebugInfo;
};

export type ReviewResult = {
  summary: string;
  approved: boolean;
  followUpQuestions: string[];
  debug?: ModelExecutionDebugInfo;
};

export type ExecuteResult = {
  summary: string;
  outputs: string[];
  debug?: ModelExecutionDebugInfo;
};

export type VerifyResult = {
  summary: string;
  passed: boolean;
  findings: string[];
  debug?: ModelExecutionDebugInfo;
};

export type RehydrateResult = {
  summary: string;
  evidenceBundles: EvidenceBundleDraft[];
  debug?: ModelExecutionDebugInfo;
};

export interface OrchestratorModelAdapter {
  readonly model: ModelRef;
  supports(capability: OrchestratorCapability): boolean;
  abstractPlan?(context: ModelInvocationContext): Promise<AbstractPlanResult>;
  gather?(context: ModelInvocationContext): Promise<GatherResult>;
  concretePlan?(context: ModelInvocationContext): Promise<ConcretePlanResult>;
  review?(context: ModelInvocationContext): Promise<ReviewResult>;
  execute?(context: ModelInvocationContext): Promise<ExecuteResult>;
  verify?(context: ModelInvocationContext): Promise<VerifyResult>;
  rehydrate?(context: ModelInvocationContext): Promise<RehydrateResult>;
}
