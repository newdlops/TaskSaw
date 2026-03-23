import path from "node:path";
import { app, BrowserWindow, nativeImage } from "electron";
import { registerIpc } from "./ipc";
import { OrchestratorService } from "./orchestrator-service";
import { PtyManager } from "./pty-manager";
import { ToolManager } from "./tool-manager";
import { WorkspaceAccessManager } from "./workspace-access";
import { BrowserBridge } from "./browser-bridge";

const APP_NAME = "TaskSaw";

let mainWindow: BrowserWindow | null = null;
let browserBridge: BrowserBridge | null = null;

app.setName(APP_NAME);
process.title = APP_NAME;

function loadAppIcon() {
  const iconPath = path.join(app.getAppPath(), "assets", "icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

async function createWindow() {
  const appIcon = loadAppIcon();

  if (process.platform === "darwin" && appIcon) {
    app.dock?.setIcon(appIcon);
  }

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion()
  });

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: APP_NAME,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 개발용: src의 html 직접 로드
  mainWindow.loadFile(path.join(app.getAppPath(), "src/renderer/index.html"));

  const toolManager = new ToolManager(app.getPath("userData"));
  const workspaceAccessManager = new WorkspaceAccessManager(app.getPath("userData"));
  const orchestratorService = new OrchestratorService(app.getAppPath(), app.getPath("userData"), toolManager);
  browserBridge = new BrowserBridge();
  await browserBridge.start().catch((error) => {
    console.error("Failed to start TaskSaw browser bridge:", error);
  });
  const ptyManager = new PtyManager(
    mainWindow,
    app.getPath("userData"),
    toolManager,
    workspaceAccessManager,
    browserBridge
  );
  toolManager.setPtyExecutor((kind, commandText) => ptyManager.executeHiddenCommand(kind, commandText));
  toolManager.setActiveSessionQueryTrigger(() => ptyManager.requestGeminiUsageUpdateFromActiveSession());
  registerIpc(mainWindow, ptyManager, workspaceAccessManager, toolManager, orchestratorService);
}

app.whenReady().then(createWindow);

app.on("before-quit", () => {
  void browserBridge?.stop();
});

app.on("window-all-closed", () => {
  app.quit();
});
