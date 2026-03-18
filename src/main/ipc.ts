import fs from "node:fs";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { PtyManager } from "./pty-manager";
import { CreateSessionInput } from "./types";

type DirectoryDialogOptions = {
  defaultPath?: string;
  title?: string;
  buttonLabel?: string;
};

export function registerIpc(mainWindow: BrowserWindow, ptyManager: PtyManager) {
  ipcMain.handle("session:create", (_event, input: CreateSessionInput) => {
    return ptyManager.createSession(input);
  });

  ipcMain.handle("session:list", () => {
    return ptyManager.listSessions();
  });

  ipcMain.handle("dialog:select-directory", async (_event, payload: DirectoryDialogOptions = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: payload.defaultPath,
      title: payload.title,
      buttonLabel: payload.buttonLabel,
      properties: ["openDirectory"]
    });

    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:create-directory", async (_event, payload: DirectoryDialogOptions = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: payload.defaultPath,
      title: payload.title,
      buttonLabel: payload.buttonLabel,
      showsTagField: false
    });

    if (result.canceled || !result.filePath) return null;

    if (fs.existsSync(result.filePath) && !fs.statSync(result.filePath).isDirectory()) {
      throw new Error(`Path already exists and is not a directory: ${result.filePath}`);
    }

    fs.mkdirSync(result.filePath, { recursive: true });
    return fs.realpathSync(result.filePath);
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
