export const NODE_PHASES = [
  "init",
  "abstract_plan",
  "gather",
  "evidence_consolidation",
  "concrete_plan",
  "review",
  "execute",
  "verify",
  "done",
  "replan",
  "escalated"
] as const;

export type NodePhase = (typeof NODE_PHASES)[number];

export const NODE_KINDS = ["planning", "execution"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const RUN_STATUSES = ["pending", "running", "done", "failed", "paused", "escalated"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const REVIEW_POLICIES = ["none", "light", "risk_based", "mandatory"] as const;
export type ReviewPolicy = (typeof REVIEW_POLICIES)[number];

export const PLANNER_BIAS_OPTIONS = ["planner", "balanced", "executor"] as const;
export type PlannerBias = (typeof PLANNER_BIAS_OPTIONS)[number];

export const CAREFULNESS_MODES = ["fast", "balanced", "careful"] as const;
export type CarefulnessMode = (typeof CAREFULNESS_MODES)[number];

export const MODEL_TIERS = ["upper", "lower", "reviewer"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const CHILD_TASK_IMPORTANCE_LEVELS = ["critical", "high", "medium", "low"] as const;
export type ChildTaskImportance = (typeof CHILD_TASK_IMPORTANCE_LEVELS)[number];

export const ORCHESTRATOR_WORKFLOW_STAGES = [
  "project_structure_discovery",
  "project_structure_inspection",
  "task_orchestration"
] as const;
export type OrchestratorWorkflowStage = (typeof ORCHESTRATOR_WORKFLOW_STAGES)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high", "mixed"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const ACCEPTANCE_CRITERION_STATUSES = ["pending", "met", "failed"] as const;
export type AcceptanceCriterionStatus = (typeof ACCEPTANCE_CRITERION_STATUSES)[number];

export const WORKING_MEMORY_ENTRY_STATUSES = ["open", "resolved", "superseded"] as const;
export type WorkingMemoryEntryStatus = (typeof WORKING_MEMORY_ENTRY_STATUSES)[number];

export type ModelRef = {
  id: string;
  provider: string;
  model: string;
  tier: ModelTier;
  reasoningEffort?: ReasoningEffort;
};

export type ModelAssignment = {
  abstractPlanner?: ModelRef;
  gatherer?: ModelRef;
  concretePlanner?: ModelRef;
  reviewer?: ModelRef;
  executor?: ModelRef;
  verifier?: ModelRef;
};

export type OrchestratorChildTask = {
  title: string;
  objective: string;
  importance?: ChildTaskImportance;
  assignedModels?: ModelAssignment;
  reviewPolicy?: ReviewPolicy;
  acceptanceCriteria?: AcceptanceCriteria;
  executionBudget?: Partial<ExecutionBudget>;
};

export type ExecutionBudget = {
  maxDepth: number;
  evidenceBudget: number;
  rereadBudget: number;
  upperModelCallBudget: number;
  reviewBudget: number;
};

export type OrchestratorConfig = {
  maxDepth: number;
  reviewPolicy: ReviewPolicy;
  plannerBias: PlannerBias;
  carefulnessMode: CarefulnessMode;
  defaultBudget: ExecutionBudget;
};

export type AcceptanceCriterion = {
  id: string;
  description: string;
  required: boolean;
  status: AcceptanceCriterionStatus;
};

export type AcceptanceCriteria = {
  items: AcceptanceCriterion[];
};

export type EvidenceLocation = {
  filePath?: string;
  symbol?: string;
  line?: number;
  column?: number;
  uri?: string;
  label?: string;
};

export type EvidenceReference = {
  id: string;
  sourceType: "file" | "terminal" | "web" | "search" | "human" | "generated" | "other";
  location?: EvidenceLocation;
  note?: string;
};

export type EvidenceFact = {
  id: string;
  statement: string;
  confidence: ConfidenceLevel;
  referenceIds: string[];
};

export type EvidenceHypothesis = {
  id: string;
  statement: string;
  confidence: ConfidenceLevel;
  referenceIds: string[];
};

export type EvidenceUnknown = {
  id: string;
  question: string;
  impact: "low" | "medium" | "high";
  referenceIds: string[];
};

export type EvidenceTarget = {
  filePath?: string;
  symbol?: string;
  note?: string;
};

export type EvidenceSnippet = {
  id: string;
  kind: "code" | "text" | "terminal" | "search_result";
  content: string;
  location?: EvidenceLocation;
  referenceId?: string;
  rationale?: string;
};

export type EvidenceBundle = {
  id: string;
  runId: string;
  nodeId: string;
  summary: string;
  facts: EvidenceFact[];
  hypotheses: EvidenceHypothesis[];
  unknowns: EvidenceUnknown[];
  relevantTargets: EvidenceTarget[];
  snippets: EvidenceSnippet[];
  references: EvidenceReference[];
  confidence: ConfidenceLevel;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceBundleDraft = Omit<EvidenceBundle, "runId" | "nodeId" | "createdAt" | "updatedAt"> &
  Partial<Pick<EvidenceBundle, "runId" | "nodeId" | "createdAt" | "updatedAt">>;

export type WorkingMemoryFact = {
  id: string;
  statement: string;
  confidence: ConfidenceLevel;
  referenceIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkingMemoryQuestion = {
  id: string;
  question: string;
  status: WorkingMemoryEntryStatus;
  resolution?: string;
  referenceIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkingMemoryUnknown = {
  id: string;
  description: string;
  status: WorkingMemoryEntryStatus;
  impact: "low" | "medium" | "high";
  referenceIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkingMemoryConflict = {
  id: string;
  summary: string;
  status: WorkingMemoryEntryStatus;
  referenceIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkingMemoryDecision = {
  id: string;
  summary: string;
  rationale: string;
  referenceIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkingMemorySnapshot = {
  runId: string;
  facts: WorkingMemoryFact[];
  openQuestions: WorkingMemoryQuestion[];
  unknowns: WorkingMemoryUnknown[];
  conflicts: WorkingMemoryConflict[];
  decisions: WorkingMemoryDecision[];
  updatedAt: string;
};

export type ProjectStructurePathEntry = {
  id: string;
  path: string;
  summary: string;
  confidence: ConfidenceLevel;
  referenceIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectStructureEntryPoint = {
  id: string;
  path: string;
  role: string;
  summary: string;
  confidence: ConfidenceLevel;
  referenceIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectStructureModule = {
  id: string;
  name: string;
  summary: string;
  relatedPaths: string[];
  confidence: ConfidenceLevel;
  referenceIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectStructureQuestion = {
  id: string;
  question: string;
  status: WorkingMemoryEntryStatus;
  resolution?: string;
  referenceIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectStructureContradiction = {
  id: string;
  summary: string;
  status: WorkingMemoryEntryStatus;
  resolution?: string;
  referenceIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectStructureSnapshot = {
  runId: string;
  summary: string;
  directories: ProjectStructurePathEntry[];
  keyFiles: ProjectStructurePathEntry[];
  entryPoints: ProjectStructureEntryPoint[];
  modules: ProjectStructureModule[];
  openQuestions: ProjectStructureQuestion[];
  contradictions: ProjectStructureContradiction[];
  updatedAt: string;
};

export type ProjectStructurePathReport = {
  path: string;
  summary: string;
  confidence?: ConfidenceLevel;
  referenceIds?: string[];
};

export type ProjectStructureEntryPointReport = {
  path: string;
  role: string;
  summary: string;
  confidence?: ConfidenceLevel;
  referenceIds?: string[];
};

export type ProjectStructureModuleReport = {
  name: string;
  summary: string;
  relatedPaths?: string[];
  confidence?: ConfidenceLevel;
  referenceIds?: string[];
};

export type ProjectStructureReport = {
  summary: string;
  directories: ProjectStructurePathReport[];
  keyFiles: ProjectStructurePathReport[];
  entryPoints: ProjectStructureEntryPointReport[];
  modules: ProjectStructureModuleReport[];
  openQuestions: string[];
  contradictions: string[];
};

export type PlanNode = {
  id: string;
  runId: string;
  parentId: string | null;
  childIds: string[];
  kind: NodeKind;
  title: string;
  objective: string;
  depth: number;
  phase: NodePhase;
  assignedModels: ModelAssignment;
  reviewPolicy: ReviewPolicy;
  acceptanceCriteria: AcceptanceCriteria;
  executionBudget: ExecutionBudget;
  evidenceBundleIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type Run = {
  id: string;
  goal: string;
  status: RunStatus;
  rootNodeId: string;
  continuedFromRunId?: string | null;
  config: OrchestratorConfig;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ModelExecutionDebugInfo = {
  executable: string;
  command: string[];
  prompt: string;
  rawStdout: string;
  rawStderr: string;
};

export type OrchestratorEvent = {
  id: string;
  runId: string;
  nodeId: string | null;
  type:
    | "run_created"
    | "node_created"
    | "phase_transition"
    | "acceptance_updated"
    | "evidence_attached"
    | "node_decomposed"
    | "model_invocation"
    | "model_response"
    | "approval_requested"
    | "approval_resolved"
    | "user_input_requested"
    | "user_input_resolved"
    | "execution_status"
    | "scheduler_progress"
    | "node_failed"
    | "run_failed"
    | "run_paused"
    | "run_completed";
  createdAt: string;
  payload: Record<string, unknown>;
};

export type OrchestratorFinalReport = {
  runId: string;
  summary: string;
  outcomes: string[];
  unresolvedRisks: string[];
  createdAt: string;
};

export type RunSnapshot = {
  run: Run;
  nodes: PlanNode[];
  evidenceBundles: EvidenceBundle[];
  workingMemory: WorkingMemorySnapshot;
  projectStructure: ProjectStructureSnapshot;
  events: OrchestratorEvent[];
  finalReport?: OrchestratorFinalReport;
};

export type ContinuationSeed = {
  sourceRunId: string;
  evidenceBundles: EvidenceBundle[];
  workingMemory: WorkingMemorySnapshot;
  projectStructure: ProjectStructureSnapshot;
};

export type CreateRunInput = {
  goal: string;
  title?: string;
  objective?: string;
  kind?: NodeKind;
  config?: Partial<OrchestratorConfig>;
  assignedModels?: ModelAssignment;
  reviewPolicy?: ReviewPolicy;
  acceptanceCriteria?: AcceptanceCriteria;
  executionBudget?: Partial<ExecutionBudget>;
  continuation?: ContinuationSeed;
};

export type CreateChildNodeInput = {
  title: string;
  objective: string;
  kind?: NodeKind;
  assignedModels?: ModelAssignment;
  reviewPolicy?: ReviewPolicy;
  acceptanceCriteria?: AcceptanceCriteria;
  executionBudget?: Partial<ExecutionBudget>;
};
