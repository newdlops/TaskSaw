import type { OutputLanguageCode, RunSnapshot, RunStatus } from "../orchestrator";

export type SessionKind = "shell" | "codex" | "gemini";
export type ManagedToolId = Extract<SessionKind, "codex" | "gemini">;
export type OrchestratorMode = "gemini_only" | "codex_only" | "cross_review";
export type OrchestratorContinuationMode = "resume" | "next_action";

export type DirectoryDialogOptions = {
  defaultPath?: string;
  title?: string;
  buttonLabel?: string;
  message?: string;
};

export type ManagedToolStatus = {
  id: ManagedToolId;
  displayName: string;
  installed: boolean;
  version: string | null;
};

export type ManagedToolModel = {
  id: string;
  model: string;
  displayName: string;
  description: string | null;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: string[];
};

export type ManagedToolModelCatalog = {
  toolId: ManagedToolId;
  provider: string;
  currentModelId: string | null;
  recommendedPlannerModelId?: string | null;
  recommendedWorkerModelId?: string | null;
  discoveredAt: string;
  models: ManagedToolModel[];
};

export type SessionInfo = {
  id: string;
  kind: SessionKind;
  title: string;
  cwd: string;
};

export type CreateSessionInput = {
  kind: SessionKind;
  cwd: string;
  workspaceAccessDialog?: DirectoryDialogOptions;
};

export type RunOrchestratorInput = {
  goal: string;
  mode: OrchestratorMode;
  language?: OutputLanguageCode;
  continuationMode?: OrchestratorContinuationMode | null;
  nextActionIndex?: number | null;
  maxDepth?: number | null;
  workspacePath?: string | null;
  continueFromRunId?: string | null;
  workspaceAccessDialog?: DirectoryDialogOptions;
};

export type OrchestratorRunSummary = {
  id: string;
  goal: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  finalSummary: string | null;
};

export type OrchestratorRunDetail = RunSnapshot;

export type RespondOrchestratorApprovalInput = {
  requestId: string;
  optionId?: string | null;
  approved: boolean;
};

export type RespondOrchestratorUserInputInput = {
  requestId: string;
  submitted: boolean;
  answers?: Record<string, string[]>;
};

export type OrchestratorRunResponse =
  | {
    status: "completed";
    detail: OrchestratorRunDetail;
  }
  | {
    status: "cancelled";
    detail: OrchestratorRunDetail;
  }
  | {
    status: "login_required";
    missingToolIds: ManagedToolId[];
    loginSessions: SessionInfo[];
  };
