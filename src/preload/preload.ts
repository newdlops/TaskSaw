import { contextBridge, ipcRenderer } from "electron";
import type { OrchestratorEvent } from "../orchestrator";
import type {
  CreateSessionInput,
  DirectoryDialogOptions,
  OrchestratorRunResponse,
  ManagedToolStatus,
  OrchestratorRunDetail,
  OrchestratorRunSummary,
  RespondOrchestratorApprovalInput,
  RespondOrchestratorInteractiveSessionInput,
  RespondOrchestratorUserInputInput,
  RunOrchestratorInput,
  SessionInfo
} from "../main/types";

contextBridge.exposeInMainWorld("tasksaw", {
  createSession: (input: CreateSessionInput): Promise<SessionInfo | null> =>
      ipcRenderer.invoke("session:create", input),

  listSessions: (): Promise<SessionInfo[]> =>
      ipcRenderer.invoke("session:list"),

  updateManagedTools: (): Promise<ManagedToolStatus[]> =>
      ipcRenderer.invoke("tools:update"),

  getManagedToolStatuses: (): Promise<ManagedToolStatus[]> =>
      ipcRenderer.invoke("tools:get-statuses"),

  resetAppState: (): Promise<void> =>
      ipcRenderer.invoke("app:reset"),

  runOrchestrator: (input: RunOrchestratorInput): Promise<OrchestratorRunResponse | null> =>
      ipcRenderer.invoke("orchestrator:run", input),

  cancelOrchestratorRun: (runId: string): Promise<boolean> =>
      ipcRenderer.invoke("orchestrator:cancel", runId),

  respondOrchestratorApproval: (input: RespondOrchestratorApprovalInput): Promise<boolean> =>
      ipcRenderer.invoke("orchestrator:respond-approval", input),

  respondOrchestratorUserInput: (input: RespondOrchestratorUserInputInput): Promise<boolean> =>
      ipcRenderer.invoke("orchestrator:respond-user-input", input),

  respondOrchestratorInteractiveSession: (input: RespondOrchestratorInteractiveSessionInput): Promise<boolean> =>
      ipcRenderer.invoke("orchestrator:respond-interactive-session", input),

  listOrchestratorRuns: (): Promise<OrchestratorRunSummary[]> =>
      ipcRenderer.invoke("orchestrator:list"),

  getOrchestratorRun: (runId: string): Promise<OrchestratorRunDetail> =>
      ipcRenderer.invoke("orchestrator:get-run", runId),

  selectDirectory: (options?: DirectoryDialogOptions): Promise<string | null> =>
      ipcRenderer.invoke("dialog:select-directory", options),

  createDirectory: (options?: DirectoryDialogOptions): Promise<string | null> =>
      ipcRenderer.invoke("dialog:create-directory", options),

  writeTerminal: (sessionId: string, data: string) =>
      ipcRenderer.send("terminal:write", { sessionId, data }),

  resizeTerminal: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send("terminal:resize", { sessionId, cols, rows }),

  killSession: (sessionId: string) =>
      ipcRenderer.send("session:kill", { sessionId }),

  onTerminalData: (handler: (payload: { sessionId: string; data: string }) => void) => {
    ipcRenderer.on("terminal:data", (_event, payload) => handler(payload));
  },

  onTerminalExit: (
      handler: (payload: { sessionId: string; exitCode: number; signal: number }) => void
  ) => {
    ipcRenderer.on("terminal:exit", (_event, payload) => handler(payload));
  },

  onOrchestratorEvent: (handler: (payload: OrchestratorEvent) => void) => {
    ipcRenderer.on("orchestrator:event", (_event, payload) => handler(payload));
  }
});
