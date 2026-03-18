export type SessionKind = "shell" | "codex" | "gemini";

export type SessionInfo = {
  id: string;
  kind: SessionKind;
  title: string;
  cwd: string;
};

export type CreateSessionInput = {
  kind: SessionKind;
  cwd: string;
};
