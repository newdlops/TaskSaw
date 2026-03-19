import type { RunSnapshot, RunStatus } from "../orchestrator";

export type SessionKind = "shell" | "codex" | "gemini";
export type ManagedToolId = Extract<SessionKind, "codex" | "gemini">;
export type OrchestratorMode = "gemini_only" | "codex_only" | "cross_review";

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
