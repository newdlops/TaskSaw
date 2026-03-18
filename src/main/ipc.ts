import { ipcMain, BrowserWindow } from "electron";
import { PtyManager } from "./pty-manager";
import { CreateSessionInput } from "./types";

export function registerIpc(mainWindow: BrowserWindow, ptyManager: PtyManager) {
  ipcMain.handle("session:create", (_event, input: CreateSessionInput) => {
    return ptyManager.createSession(input);
  });

  ipcMain.handle("session:list", () => {
    return ptyManager.listSessions();
  });

  ipcMain.on("terminal:write", (_event, payload: { sessionId: string; data: string }) => {
    ptyManager.write(payload.sessionId, payload.data);
  });

  ipcMain.on("terminal:resize", (_event, payload: { sessionId: string; cols: number; rows: number }) => {
    ptyManager.resize(payload.sessionId, payload.cols, payload.rows);
  });

  ipcMain.on("session:kill", (_event, payload: { sessionId: string }) => {
    ptyManager.kill(payload.sessionId);
  });
}
