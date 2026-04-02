import {
  EvidenceBundle,
  EvidenceBundleDraft,
  ExecutionBudget,
  ModelExecutionDebugInfo,
  ModelRef,
  OrchestratorCarryForward,
  OrchestratorChildTask,
  OrchestratorConfig,
  OrchestratorNextAction,
  OrchestratorWorkflowStage,
  PlanNode,
  ProjectStructureReport,
  ProjectStructureSnapshot,
  ReviewPolicy,
  Run,
  WorkingMemorySnapshot
} from "./types";

export { OrchestratorWorkflowStage };

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
  disallowAutoApprove?: boolean;
};

export type OrchestratorApprovalDecision = {
  outcome: "selected" | "rejected" | "internally_cancelled";
  optionId?: string;
  reason?: string;
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

export type OrchestratorInteractiveSessionRequest = {
  requestId: string;
  runId: string;
  nodeId: string;
  capability: OrchestratorCapability;
  provider: string;
  model: string;
  title?: string;
  message: string;
  commandText: string;
  cwd: string;
  createdAt: string;
  abortSignal: AbortSignal;
};

export type OrchestratorInteractiveSessionResponse = {
  outcome: "completed" | "terminated" | "cancelled" | "failed";
  sessionId?: string | null;
  exitCode?: number | null;
  signal?: number | null;
  transcript?: string;
};

export type OrchestratorTerminalStream = "system" | "stdout" | "stderr" | "input";

export type OrchestratorTerminalEventDraft = {
  sessionId?: string;
  title?: string;
  stream?: OrchestratorTerminalStream;
  text: string;
};

export type OrchestratorUserInputRequestDraft = Omit<
  OrchestratorUserInputRequest,
  "requestId" | "runId" | "nodeId" | "capability" | "provider" | "model" | "createdAt"
>;

export type OrchestratorInteractiveSessionRequestDraft = Omit<
  OrchestratorInteractiveSessionRequest,
  "requestId" | "runId" | "nodeId" | "capability" | "provider" | "model" | "createdAt"
>;

export type ModelInvocationContext = {
  run: Run;
  node: PlanNode;
  config: OrchestratorConfig;
  role: string;
  assignedModel: ModelRef;
  outputLanguage: "en" | "ko";
  abortSignal: AbortSignal;
  workflowStage: OrchestratorWorkflowStage;
  reviewPolicy: ReviewPolicy;
  executionBudget: ExecutionBudget;
  workingMemory: WorkingMemorySnapshot;
  projectStructure: ProjectStructureSnapshot;
  evidenceBundles: EvidenceBundle[];
  terminalSessionId?: string;
  terminalSessionTitle?: string;
  requestUserApproval?: (request: OrchestratorApprovalRequestDraft) => Promise<OrchestratorApprovalDecision>;
  requestUserInput?: (request: OrchestratorUserInputRequestDraft) => Promise<OrchestratorUserInputResponse>;
  requestInteractiveSession?: (
    request: OrchestratorInteractiveSessionRequestDraft
  ) => Promise<OrchestratorInteractiveSessionResponse>;
  reportProgress?: (message: string, details?: Record<string, unknown>) => void;
  reportExecutionStatus?: (state: string, message: string, details?: Record<string, unknown>) => void;
  reportTerminalEvent?: (event: OrchestratorTerminalEventDraft) => void;
  reportModelInvocation?: (payload: {
    role: string;
    capability: OrchestratorCapability;
    modelId: string;
    provider: string;
    model: string;
    prompt: string;
  }) => void;
  sessionScopeHint?: ModelInvocationSessionScopeHint;
};

export type ModelInvocationSessionScopeHint = {
  ownerTaskId: string;
  ownerTaskTitle: string;
  ownerTaskObjective: string;
  ownerTaskLineage: string[];
};

export type StageObjectiveHints = Partial<Record<
  Exclude<OrchestratorCapability, "rehydrate">,
  string
>>;

export type AbstractPlanResult = {
  summary: string;
  targetsToInspect: string[];
  evidenceRequirements: string[];
  nextObjectives?: StageObjectiveHints;
  debug?: ModelExecutionDebugInfo;
};

export type GatherResult = {
  summary: string;
  evidenceBundles: EvidenceBundleDraft[];
  projectStructure?: ProjectStructureReport;
  nextObjectives?: StageObjectiveHints;
  debug?: ModelExecutionDebugInfo;
};

export type ConcretePlanResult = {
  summary: string;
  childTasks: OrchestratorChildTask[];
  executionNotes: string[];
  needsMorePlanning?: boolean;
  needsAdditionalGather?: boolean;
  additionalGatherObjectives?: string[];
  needsProjectStructureInspection?: boolean;
  inspectionObjectives?: string[];
  projectStructureContradictions?: string[];
  nextObjectives?: StageObjectiveHints;
  debug?: ModelExecutionDebugInfo;
};

export type ReviewResult = {
  summary: string;
  approved?: boolean;
  followUpQuestions: string[];
  nextActions: OrchestratorNextAction[];
  carryForward?: OrchestratorCarryForward;
  debug?: ModelExecutionDebugInfo;
};

export type ExecuteResult = {
  summary: string;
  outputs: string[];
  completed?: boolean;
  blockedReason?: string;
  nextObjectives?: StageObjectiveHints;
  debug?: ModelExecutionDebugInfo;
};

export type VerifyResult = {
  summary: string;
  passed: boolean;
  findings: string[];
  nextObjectives?: StageObjectiveHints;
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
