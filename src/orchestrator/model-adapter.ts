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

export type OrchestratorApprovalOption = {
  optionId: string;
  kind?: string;
  label?: string;
};

export type OrchestratorApprovalRequest = {
  requestId: string;
  runId: string;
  nodeId: string;
  capability: OrchestratorCapability;
  provider: string;
  model: string;
  title?: string;
  message: string;
  details?: string;
  kind?: string;
  locations?: string[];
  options: OrchestratorApprovalOption[];
  createdAt: string;
  abortSignal: AbortSignal;
};

export type OrchestratorApprovalDecision = {
  outcome: "selected" | "cancelled";
  optionId?: string;
};

export type OrchestratorApprovalRequestDraft = Omit<
  OrchestratorApprovalRequest,
  "requestId" | "runId" | "nodeId" | "capability" | "provider" | "model" | "createdAt"
>;

export type OrchestratorUserInputOption = {
  label: string;
  description?: string;
};

export type OrchestratorUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  options?: OrchestratorUserInputOption[];
  isOther?: boolean;
  isSecret?: boolean;
};

export type OrchestratorUserInputRequest = {
  requestId: string;
  runId: string;
  nodeId: string;
  capability: OrchestratorCapability;
  provider: string;
  model: string;
  title?: string;
  message: string;
  questions: OrchestratorUserInputQuestion[];
  createdAt: string;
  abortSignal: AbortSignal;
};

export type OrchestratorUserInputResponse = {
  outcome: "submitted" | "cancelled";
  answers?: Record<string, string[]>;
};

export type OrchestratorUserInputRequestDraft = Omit<
  OrchestratorUserInputRequest,
  "requestId" | "runId" | "nodeId" | "capability" | "provider" | "model" | "createdAt"
>;

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
  requestUserApproval?: (request: OrchestratorApprovalRequestDraft) => Promise<OrchestratorApprovalDecision>;
  requestUserInput?: (request: OrchestratorUserInputRequestDraft) => Promise<OrchestratorUserInputResponse>;
  reportExecutionStatus?: (state: string, message: string, details?: Record<string, unknown>) => void;
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
