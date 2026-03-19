import { BrowserWindow, dialog, ipcMain } from "electron";
import { OrchestratorRunCancelledError, type OrchestratorEvent } from "../orchestrator";
import { OrchestratorService } from "./orchestrator-service";
import { PtyManager } from "./pty-manager";
import { CreateSessionInput, DirectoryDialogOptions, ManagedToolId, RunOrchestratorInput } from "./types";
import { ToolManager } from "./tool-manager";
import { WorkspaceAccessManager } from "./workspace-access";

export function registerIpc(
  mainWindow: BrowserWindow,
  ptyManager: PtyManager,
  workspaceAccessManager: WorkspaceAccessManager,
  toolManager: ToolManager,
  orchestratorService: OrchestratorService
) {
  const ensureLoginSession = async (toolId: ManagedToolId, workspacePath: string) => {
    const existingSession = ptyManager
      .listSessions()
      .find((session) => session.kind === toolId && session.cwd === workspacePath);
    if (existingSession) {
      return {
        session: existingSession,
        created: false
      };
    }

    try {
      const session = await ptyManager.createSession({
        kind: toolId,
        cwd: workspacePath
      });
      if (!session) {
        return null;
      }

      return {
        session,
        created: true
      };
    } catch (error) {
      console.error(`[TaskSaw] Failed to open ${toolId} login session:`, error);
      return null;
    }
  };

  const showManagedToolLoginRequiredDialog = async (
    workspacePath: string,
    toolIds: ManagedToolId[],
    openedSessionCount: number
  ) => {
    const toolNames = toolIds.map((toolId) => toolManager.getStatus(toolId).displayName);
    const title = toolNames.length === 1
      ? `${toolNames[0]} login required`
      : "Gemini/Codex login required";
    const message = toolNames.length === 1
      ? `${toolNames[0]} is not logged in.`
      : `${toolNames.join(" and ")} are not logged in.`;
    const detail = [
      openedSessionCount > 0
        ? "TaskSaw opened the matching terminal session. Complete login there, then retry the orchestrator."
        : "Open the matching tool session in TaskSaw, complete login, then retry the orchestrator.",
      `Workspace: ${workspacePath}`
    ].join("\n");

    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["OK"],
      defaultId: 0,
      title,
      message,
      detail
    });
  };

  const forwardOrchestratorEvent = (event: OrchestratorEvent) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("orchestrator:event", event);
  };

  ipcMain.handle("session:create", async (_event, input: CreateSessionInput) => {
    return ptyManager.createSession(input);
  });

  ipcMain.handle("session:list", () => {
    return ptyManager.listSessions();
  });

  ipcMain.handle("tools:update", async () => {
    return toolManager.updateAll();
  });

  ipcMain.handle("orchestrator:run", async (_event, input: RunOrchestratorInput) => {
    const requestedWorkspacePath = input.workspacePath?.trim();
    if (!requestedWorkspacePath) {
      throw new Error("A workspace path is required to run the orchestrator");
    }

    const authorizedWorkspacePath = await workspaceAccessManager.acquireWorkspace(
      requestedWorkspacePath,
      mainWindow,
      input.workspaceAccessDialog
    );
    if (!authorizedWorkspacePath) return null;

    try {
      const authStates = await Promise.all(
        orchestratorService
          .getRequiredTools(input.mode)
          .map((toolId) => toolManager.getAuthenticationStatus(toolId, authorizedWorkspacePath))
      );
      const missingToolIds = authStates
        .filter((state) => !state.authenticated)
        .map((state) => state.toolId);
      if (missingToolIds.length > 0) {
        const loginSessionResults = (
          await Promise.all(
            missingToolIds.map((toolId) => ensureLoginSession(toolId, authorizedWorkspacePath))
          )
        ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
        const loginSessions = loginSessionResults.map((entry) => entry.session);
        const openedSessionCount = loginSessionResults.filter((entry) => entry.created).length;

        await showManagedToolLoginRequiredDialog(authorizedWorkspacePath, missingToolIds, openedSessionCount);
        return {
          status: "login_required" as const,
          missingToolIds,
          loginSessions
        };
      }

      return {
        status: "completed" as const,
        detail: await orchestratorService.runOrchestrator({
          ...input,
          workspacePath: authorizedWorkspacePath
        }, forwardOrchestratorEvent)
      };
    } catch (error) {
      if (error instanceof OrchestratorRunCancelledError && error.snapshot) {
        return {
          status: "cancelled" as const,
          detail: error.snapshot
        };
      }

      throw error;
    } finally {
      workspaceAccessManager.releaseWorkspace(authorizedWorkspacePath);
    }
  });

  ipcMain.handle("orchestrator:cancel", async (_event, runId: string) => {
    return orchestratorService.cancelRun(runId);
  });

  ipcMain.handle("orchestrator:list", async () => {
    return orchestratorService.listRuns();
  });

  ipcMain.handle("orchestrator:get-run", async (_event, runId: string) => {
    return orchestratorService.getRun(runId);
  });

  ipcMain.handle("app:reset", async () => {
    ptyManager.resetAllSessions();
    orchestratorService.resetAllRuns();
    toolManager.resetPersistentState();
    workspaceAccessManager.resetAllAccess();
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
