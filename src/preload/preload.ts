import { contextBridge, ipcRenderer } from "electron";
import type { CreateSessionInput, SessionInfo } from "../main/types";

contextBridge.exposeInMainWorld("tasksaw", {
  createSession: (input: CreateSessionInput): Promise<SessionInfo> =>
      ipcRenderer.invoke("session:create", input),

  listSessions: (): Promise<SessionInfo[]> =>
      ipcRenderer.invoke("session:list"),

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
  }
});
