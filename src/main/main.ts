import path from "node:path";
import { app, BrowserWindow } from "electron";
import { PtyManager } from "./pty-manager";
import { registerIpc } from "./ipc";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  const ptyManager = new PtyManager(mainWindow);
  registerIpc(mainWindow, ptyManager);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
