import { BrowserWindow, dialog, ipcMain } from "electron";
import { PtyManager } from "./pty-manager";
import { CreateSessionInput, DirectoryDialogOptions } from "./types";
import { ToolManager } from "./tool-manager";
import { WorkspaceAccessManager } from "./workspace-access";

export function registerIpc(
  mainWindow: BrowserWindow,
  ptyManager: PtyManager,
  workspaceAccessManager: WorkspaceAccessManager,
  toolManager: ToolManager
) {
  ipcMain.handle("session:create", async (_event, input: CreateSessionInput) => {
    return ptyManager.createSession(input);
  });

  ipcMain.handle("session:list", () => {
    return ptyManager.listSessions();
  });

  ipcMain.handle("tools:update", async () => {
    return toolManager.updateAll();
  });

  ipcMain.handle("dialog:select-directory", async (_event, payload: DirectoryDialogOptions = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: payload.defaultPath,
      title: payload.title,
      buttonLabel: payload.buttonLabel,
      message: payload.message,
      properties: ["openDirectory"],
      securityScopedBookmarks: process.platform === "darwin"
    });

    if (result.canceled) return null;
    const selectedPath = result.filePaths[0];
    if (!selectedPath) return null;

    return workspaceAccessManager.registerSelectedDirectory(selectedPath, result.bookmarks?.[0]);
  });

  ipcMain.handle("dialog:create-directory", async (_event, payload: DirectoryDialogOptions = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: payload.defaultPath,
      title: payload.title,
      buttonLabel: payload.buttonLabel,
      message: payload.message,
      properties: ["openDirectory", "createDirectory"],
      securityScopedBookmarks: process.platform === "darwin"
    });

    if (result.canceled) return null;
    const selectedPath = result.filePaths[0];
    if (!selectedPath) return null;

    return workspaceAccessManager.registerSelectedDirectory(selectedPath, result.bookmarks?.[0]);
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
