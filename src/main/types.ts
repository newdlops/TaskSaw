export type SessionKind = "shell" | "codex" | "gemini";
export type ManagedToolId = Extract<SessionKind, "codex" | "gemini">;

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
