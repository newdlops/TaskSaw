import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { BrowserWindow } from "electron";
import { CreateSessionInput, ManagedToolId, SessionInfo, SessionKind } from "./types";
import { ToolManager } from "./tool-manager";
import { WorkspaceAccessManager } from "./workspace-access";
import { BrowserBridge } from "./browser-bridge";

type SessionRecord = {
  info: SessionInfo;
  ptyProcess: pty.IPty;
  sessionDirectory: string;
  outputBuffer: string;
  ansiCarryover: string;
  rawOutputCarryover: string;
  pendingBrowserUrl: string | null;
  pendingBrowserOpenTimer: NodeJS.Timeout | null;
  recentlyHandledBrowserKeys: Map<string, number>;
};

type SessionPaths = {
  workspaceDirectory: string;
  sessionDirectory: string;
  homeDirectory: string;
  runtimeDirectory: string;
  zshDirectory: string;
  tmuxDirectory: string;
  tempDirectory: string;
  sandboxProfilePath: string;
};

export class PtyManager {
  private sessions = new Map<string, SessionRecord>();
  private lastUsageQueryTime = 0;

  constructor(
    private mainWindow: BrowserWindow,
    private userDataDirectory: string,
    private toolManager: ToolManager,
    private workspaceAccessManager: WorkspaceAccessManager,
    private browserBridge: BrowserBridge
  ) {
    this.cleanupStaleSessionDirectories();
  }

  async createSession(input: CreateSessionInput): Promise<SessionInfo | null> {
    this.ensureNodePtySpawnHelperExecutable();

    const authorizedWorkspacePath = await this.workspaceAccessManager.acquireWorkspace(
      input.cwd,
      this.mainWindow,
      input.workspaceAccessDialog
    );
    if (!authorizedWorkspacePath) return null;

    let sessionPaths: SessionPaths | null = null;

    try {
      const workspaceDirectory = this.resolveWorkspaceDirectory(authorizedWorkspacePath);
      const id = randomUUID();
      sessionPaths = this.prepareSessionPaths(id, workspaceDirectory);

      const info: SessionInfo = {
        id,
        kind: input.kind,
        title: input.title?.trim() || this.makeTitle(input.kind),
        cwd: workspaceDirectory,
        hidden: input.hidden === true
      };

      const sessionEnv = this.buildSessionEnv(sessionPaths);
      const { command, args, env: launchEnv } = await this.resolveCommand(input, sessionEnv, sessionPaths);
      const ptyProcess = pty.spawn(command, args, {
        name: "xterm-256color",
        cols: 120,
        rows: 32,
        cwd: workspaceDirectory,
        env: launchEnv
      });

      const record: SessionRecord = {
        info,
        ptyProcess,
        sessionDirectory: sessionPaths.sessionDirectory,
        outputBuffer: "",
        ansiCarryover: "",
        rawOutputCarryover: "",
        pendingBrowserUrl: null,
        pendingBrowserOpenTimer: null,
        recentlyHandledBrowserKeys: new Map<string, number>()
      };

      ptyProcess.onData((data) => {
        void this.handleSessionOutput(record, data);
        this.mainWindow.webContents.send("terminal:data", { sessionId: id, data });
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        this.releaseSession(id);
        this.mainWindow.webContents.send("terminal:exit", {
          sessionId: id,
          exitCode,
          signal
        });
      });

      this.sessions.set(id, {
        ...record
      });
      return info;
    } catch (error) {
      this.workspaceAccessManager.releaseWorkspace(authorizedWorkspacePath);
      if (sessionPaths) {
        this.removeSessionDirectory(sessionPaths.sessionDirectory);
      }

      if (error instanceof Error && error.message.startsWith(`Failed to start ${input.kind} session with "`)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start ${input.kind} session: ${message}`);
    }
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()]
      .map((session) => session.info)
      .filter((session) => session.hidden !== true);
  }

  write(sessionId: string, data: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.ptyProcess.write(data);
  }

  resize(sessionId: string, cols: number, rows: number) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.ptyProcess.resize(cols, rows);
  }

  kill(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.ptyProcess.kill();
  }

  async executeHiddenCommand(kind: ManagedToolId, commandText: string): Promise<string> {
    this.ensureNodePtySpawnHelperExecutable();

    const id = randomUUID();
    const workspaceDirectory = os.tmpdir(); // Use tmp for short-lived commands
    const sessionPaths = this.prepareSessionPaths(id, workspaceDirectory);

    try {
      const sessionEnv = this.buildSessionEnv(sessionPaths);
      const { command, args, env: launchEnv } = await this.resolveManagedToolCommand(kind, sessionEnv, sessionPaths);
      
      const ptyProcess = pty.spawn(command, args, {
        name: "xterm-256color",
        cols: 120,
        rows: 32,
        cwd: workspaceDirectory,
        env: launchEnv
      });

      return await new Promise((resolve) => {
        let output = "";
        const timeout = setTimeout(() => {
          ptyProcess.kill();
          resolve(output);
        }, 10_000);

        let commandSent = false;

        ptyProcess.onData((data) => {
          output += data;
          
          // Wait for a prompt-like output before sending the command, or just send it after a short delay
          if (!commandSent && (data.includes("tasksaw") || data.includes("%") || data.includes(">"))) {
            commandSent = true;
            ptyProcess.write(`${commandText}\r`);
          }

          // If we see something that looks like the end of the command output (e.g., the prompt returns)
          // and we have captured some actual output from the command
          if (commandSent && output.split("\r\n").length > 3 && (data.includes("tasksaw") || data.includes("%") || data.includes(">"))) {
            clearTimeout(timeout);
            ptyProcess.kill();
            resolve(output);
          }
        });

        ptyProcess.onExit(() => {
          clearTimeout(timeout);
          resolve(output);
        });
      });
    } finally {
      this.removeSessionDirectory(sessionPaths.sessionDirectory);
    }
  }

  resetAllSessions() {
    const sessionIds = [...this.sessions.keys()];

    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (!session) continue;

      try {
        session.ptyProcess.kill();
      } catch {
        // Ignore already-exited PTY processes during reset.
      }

      this.releaseSession(sessionId);
    }

    this.cleanupStaleSessionDirectories();
  }

  requestGeminiUsageUpdateFromActiveSession() {
    const now = Date.now();
    // Throttle checks to once every 60 seconds
    if (now - this.lastUsageQueryTime < 60_000) return;

    for (const session of this.sessions.values()) {
      if (session.info.kind === "gemini" && !session.info.hidden) {
        this.lastUsageQueryTime = now;
        session.ptyProcess.write("/stats session\n");
        break;
      }
    }
  }

  private releaseSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.pendingBrowserOpenTimer) {
      clearTimeout(session.pendingBrowserOpenTimer);
      session.pendingBrowserOpenTimer = null;
    }

    this.sessions.delete(sessionId);
    this.workspaceAccessManager.releaseWorkspace(session.info.cwd);
    this.removeSessionDirectory(session.sessionDirectory);
  }

  private resolveWorkspaceDirectory(cwd: string): string {
    const resolvedDirectory = path.resolve(cwd);

    if (!fs.existsSync(resolvedDirectory)) {
      throw new Error(`Workspace directory does not exist: ${resolvedDirectory}`);
    }

    const workspaceDirectory = fs.realpathSync(resolvedDirectory);
    if (!fs.statSync(workspaceDirectory).isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${workspaceDirectory}`);
    }

    return workspaceDirectory;
  }

  private prepareSessionPaths(sessionId: string, workspaceDirectory: string): SessionPaths {
    const sessionDirectory = path.join(this.userDataDirectory, "sandbox-sessions", sessionId);
    const homeDirectory = this.toolManager.getHomeDirectory();
    const runtimeDirectory = this.toolManager.getRuntimeDirectory();
    const zshDirectory = path.join(runtimeDirectory, "zsh");
    const tmuxDirectory = path.join(runtimeDirectory, "tmux");
    const tempDirectory = path.join(sessionDirectory, "tmp");
    const sandboxProfilePath = path.join(sessionDirectory, "workspace.sb");

    fs.mkdirSync(sessionDirectory, { recursive: true });
    fs.mkdirSync(homeDirectory, { recursive: true });
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    fs.mkdirSync(zshDirectory, { recursive: true });
    fs.mkdirSync(tmuxDirectory, { recursive: true });
    fs.mkdirSync(path.join(runtimeDirectory, "xdg-cache"), { recursive: true });
    fs.mkdirSync(path.join(runtimeDirectory, "xdg-config"), { recursive: true });
    fs.mkdirSync(path.join(runtimeDirectory, "xdg-state"), { recursive: true });
    fs.mkdirSync(tempDirectory, { recursive: true });
    this.ensureRuntimeShellFiles(zshDirectory);

    this.writeSandboxProfile({
      workspaceDirectory,
      sessionDirectory,
      homeDirectory,
      runtimeDirectory,
      zshDirectory,
      tmuxDirectory,
      tempDirectory,
      sandboxProfilePath
    });

    return {
      workspaceDirectory,
      sessionDirectory,
      homeDirectory,
      runtimeDirectory,
      zshDirectory,
      tmuxDirectory,
      tempDirectory,
      sandboxProfilePath
    };
  }

  private writeSandboxProfile(sessionPaths: SessionPaths) {
    const writableSubpaths = [
      sessionPaths.workspaceDirectory,
      sessionPaths.homeDirectory,
      sessionPaths.runtimeDirectory,
      sessionPaths.tmuxDirectory,
      sessionPaths.tempDirectory
    ];

    const sandboxProfile = [
      "(version 1)",
      "(deny default)",
      '(import "system.sb")',
      "(allow file-read*)",
      "(allow file-read-metadata)",
      '(allow file-ioctl (regex #"^/dev/tty.*"))',
      "(allow process*)",
      "(allow signal (target self))",
      '(allow mach-lookup (global-name "com.apple.SecurityServer"))',
      '(allow mach-lookup (global-name "com.apple.securityd.xpc"))',
      '(allow mach-lookup (global-name "com.apple.SystemConfiguration.PPPController"))',
      '(allow mach-lookup (global-name "com.apple.SystemConfiguration.SCNetworkReachability"))',
      '(allow mach-lookup (global-name "com.apple.cfnetwork.cfnetworkagent"))',
      '(allow mach-lookup (global-name "com.apple.dnssd.service"))',
      '(allow mach-lookup (global-name "com.apple.nehelper"))',
      '(allow mach-lookup (global-name "com.apple.nesessionmanager"))',
      '(allow mach-lookup (global-name "com.apple.networkd"))',
      '(allow mach-lookup (global-name "com.apple.networkscored"))',
      '(allow mach-lookup (global-name "com.apple.sysmond"))',
      '(allow mach-lookup (global-name "com.apple.symptomsd"))',
      '(allow mach-lookup (global-name "com.apple.SystemConfiguration.configd"))',
      '(allow mach-lookup (global-name "com.apple.usymptomsd"))',
      '(allow network-outbound (control-name "com.apple.netsrc"))',
      '(allow network-outbound (control-name "com.apple.network.statistics"))',
      "(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)) (socket-domain AF_ROUTE))",
      "(allow sysctl-read)",
      '(allow user-preference-read (preference-domain "com.apple.CFNetwork" "com.apple.SystemConfiguration"))',
      "(allow network*)",
      `(allow file-write* ${writableSubpaths
        .map((subpath) => `(subpath "${this.escapeSandboxPath(subpath)}")`)
        .join(" ")})`
    ].join("\n");

    fs.writeFileSync(sessionPaths.sandboxProfilePath, sandboxProfile);
  }

  private ensureRuntimeShellFiles(zshDirectory: string) {
    const zshEnvPath = path.join(zshDirectory, ".zshenv");
    const zshRcPath = path.join(zshDirectory, ".zshrc");

    const zshEnvContent = [
      "# Generated by TaskSaw.",
      "export ZDOTDIR=${ZDOTDIR:-$HOME}",
      ""
    ].join("\n");

    const zshRcContent = [
      "# Generated by TaskSaw.",
      "PROMPT='%F{39}tasksaw%f %1~ %# '",
      ""
    ].join("\n");

    fs.writeFileSync(zshEnvPath, zshEnvContent);
    fs.writeFileSync(zshRcPath, zshRcContent);
  }

  private cleanupStaleSessionDirectories() {
    const sessionRootDirectory = path.join(this.userDataDirectory, "sandbox-sessions");
    if (!fs.existsSync(sessionRootDirectory)) return;

    for (const entry of fs.readdirSync(sessionRootDirectory)) {
      this.removeSessionDirectory(path.join(sessionRootDirectory, entry));
    }
  }

  private removeSessionDirectory(sessionDirectory: string) {
    fs.rmSync(sessionDirectory, { recursive: true, force: true });
  }

  private escapeSandboxPath(targetPath: string): string {
    return targetPath.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  }

  private makeTitle(kind: SessionKind): string {
    const count = [...this.sessions.values()].filter((session) => session.info.kind === kind).length + 1;
    return `${kind}-${count}`;
  }

  private resolveCommand(
    input: CreateSessionInput,
    env: Record<string, string>,
    sessionPaths: SessionPaths
  ): Promise<{ command: string; args: string[]; env: Record<string, string> }> | { command: string; args: string[]; env: Record<string, string> } {
    const commandText = input.commandText?.trim();
    if (commandText) {
      return this.resolveCustomShellCommand(commandText, env, sessionPaths);
    }

    const kind = input.kind;
    if (kind === "codex" || kind === "gemini") {
      return this.resolveManagedToolCommand(kind, env, sessionPaths);
    }

    const shell = this.resolveShellCommand(env);
    const shellArgs = this.resolveShellArgs(shell);

    if (os.platform() !== "darwin") {
      return { command: shell, args: shellArgs, env };
    }

    const sandboxCommand = this.resolveExecutable("/usr/bin/sandbox-exec", env)
      ?? this.resolveExecutable("sandbox-exec", env);

    if (!sandboxCommand) {
      throw new Error("macOS workspace sandbox is unavailable on this system");
    }

    return {
      command: sandboxCommand,
      args: ["-f", sessionPaths.sandboxProfilePath, shell, ...shellArgs],
      env
    };
  }

  private resolveCustomShellCommand(
    commandText: string,
    env: Record<string, string>,
    sessionPaths: SessionPaths
  ): { command: string; args: string[]; env: Record<string, string> } {
    const shell = this.resolveShellCommand(env);
    const shellArgs = ["-lc", commandText];

    if (os.platform() !== "darwin") {
      return {
        command: shell,
        args: shellArgs,
        env
      };
    }

    const sandboxCommand = this.resolveExecutable("/usr/bin/sandbox-exec", env)
      ?? this.resolveExecutable("sandbox-exec", env);

    if (!sandboxCommand) {
      throw new Error("macOS workspace sandbox is unavailable on this system");
    }

    return {
      command: sandboxCommand,
      args: ["-f", sessionPaths.sandboxProfilePath, shell, ...shellArgs],
      env
    };
  }

  private async resolveManagedToolCommand(
    kind: ManagedToolId,
    env: Record<string, string>,
    sessionPaths: SessionPaths
  ): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
    await this.toolManager.prepareWorkspaceContext(kind, sessionPaths.workspaceDirectory);
    const toolCommand = await this.toolManager.resolveLaunchCommand(kind);
    const toolArgs = kind === "codex"
      ? [...toolCommand.args, ...this.toolManager.getCodexWorkspaceConfigArgs(sessionPaths.workspaceDirectory)]
      : toolCommand.args;
    const launchEnv = {
      ...env,
      ...this.buildManagedToolEnv(kind),
      ...toolCommand.env
    };

    if (os.platform() !== "darwin") {
      return {
        command: toolCommand.command,
        args: toolArgs,
        env: launchEnv
      };
    }

    const sandboxCommand = this.resolveExecutable("/usr/bin/sandbox-exec", launchEnv)
      ?? this.resolveExecutable("sandbox-exec", launchEnv);

    if (!sandboxCommand) {
      throw new Error("macOS workspace sandbox is unavailable on this system");
    }

    return {
      command: sandboxCommand,
      args: ["-f", sessionPaths.sandboxProfilePath, toolCommand.command, ...toolArgs],
      env: launchEnv
    };
  }

  private buildManagedToolEnv(kind: ManagedToolId): Record<string, string> {
    const sharedEnv: Record<string, string> = {};

    if (this.browserBridge.isStarted()) {
      sharedEnv.BROWSER = path.join(this.toolManager.getBinDirectory(), "browser-open");
      sharedEnv.TASKSAW_BROWSER_BRIDGE_TOKEN = this.browserBridge.getToken();
      sharedEnv.TASKSAW_BROWSER_BRIDGE_URL = this.browserBridge.getEndpointUrl();
    }

    if (kind === "codex") {
      return {
        ...sharedEnv,
        ALL_PROXY: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NO_PROXY: "*",
        OTEL_SDK_DISABLED: "true"
      };
    }

    return {
      ...sharedEnv,
      GEMINI_FORCE_FILE_STORAGE: "true",
      GEMINI_TELEMETRY_ENABLED: "0",
      OTEL_SDK_DISABLED: "true"
    };
  }

  private async handleSessionOutput(session: SessionRecord, data: string) {
    const strippedChunk = this.stripAnsiChunk(`${session.ansiCarryover}${data}`);
    session.ansiCarryover = strippedChunk.remainder;
    if (strippedChunk.plainText) {
      session.outputBuffer = `${session.outputBuffer}${strippedChunk.plainText}`.slice(-32_000);
    }

    if (session.info.kind === "gemini") {
      this.detectGeminiUsageFromOutput(session);
    }

    if (session.info.kind !== "codex") return;

    const rawWindow = `${session.rawOutputCarryover}${data}`;
    const rawAuthUrls = this.extractCodexAuthUrlsFromRaw(rawWindow);
    session.rawOutputCarryover = rawWindow.slice(-8_192);

    const plainAuthUrls = this.extractCodexAuthUrlsFromPlainText(session.outputBuffer);
    const latestAuthUrl = [...rawAuthUrls, ...plainAuthUrls].at(-1);
    if (!latestAuthUrl) return;

    session.pendingBrowserUrl = latestAuthUrl;
    if (session.pendingBrowserOpenTimer) {
      clearTimeout(session.pendingBrowserOpenTimer);
    }

    session.pendingBrowserOpenTimer = setTimeout(() => {
      void this.openPendingCodexAuthUrl(session);
    }, 400);
  }

  private async openPendingCodexAuthUrl(session: SessionRecord) {
    session.pendingBrowserOpenTimer = null;

    const authUrl = session.pendingBrowserUrl;
    session.pendingBrowserUrl = null;
    if (!authUrl) return;

    if (this.shouldSuppressSessionBrowserOpen(session, authUrl)) {
      console.log("[TaskSaw] Suppressed duplicate Codex auth browser open:", authUrl);
      return;
    }

    try {
      const opened = await this.browserBridge.openExternal(authUrl);
      console.log(
        `[TaskSaw] ${opened ? "Opened" : "Suppressed"} Codex auth URL via browser bridge:`,
        authUrl
      );
    } catch (error) {
      console.error("[TaskSaw] Failed to open Codex auth URL via browser bridge:", authUrl, error);
      // Codex also prints the URL in the terminal, so ignore open failures here.
    }
  }

  private extractCodexAuthUrlsFromRaw(rawOutput: string): string[] {
    const matches = new Set<string>();
    const osc8LinkPattern = new RegExp(String.raw`\u001B\]8;;([^\u0007\u001B]+)(?:\u0007|\u001B\\)`, "g");

    for (const match of rawOutput.matchAll(osc8LinkPattern)) {
      const normalizedUrl = this.normalizeCodexAuthUrl(match[1]);
      if (normalizedUrl) {
        matches.add(normalizedUrl);
      }
    }

    return [...matches];
  }

  private extractCodexAuthUrlsFromPlainText(output: string): string[] {
    const matches = new Set<string>();
    const urlPattern = /https?:\/\/[^\s<>"'`]+/gi;

    for (const match of output.matchAll(urlPattern)) {
      const rawUrl = this.trimUrlPunctuation(match[0]);
      const normalizedUrl = this.normalizeCodexAuthUrl(rawUrl);
      if (!normalizedUrl) continue;

      const startIndex = match.index ?? 0;
      const context = output.slice(
        Math.max(0, startIndex - 240),
        Math.min(output.length, startIndex + rawUrl.length + 160)
      );

      if (!this.looksLikeCodexAuthPrompt(context)) {
        continue;
      }

      matches.add(normalizedUrl);
    }

    return [...matches];
  }

  private normalizeCodexAuthUrl(rawUrl: string): string | null {
    let targetUrl: URL;

    try {
      targetUrl = new URL(rawUrl);
    } catch {
      return null;
    }

    if (targetUrl.hostname.toLowerCase() !== "auth.openai.com") {
      return null;
    }

    if (targetUrl.pathname !== "/oauth/authorize") {
      return null;
    }

    if (rawUrl.includes("\u0007") || rawUrl.includes("\u001B") || /%07|%1B/i.test(targetUrl.toString())) {
      return null;
    }

    const requiredParams = [
      "response_type",
      "client_id",
      "redirect_uri",
      "scope",
      "code_challenge",
      "code_challenge_method",
      "state"
    ];

    const paramCounts = new Map<string, number>();
    for (const [key] of targetUrl.searchParams) {
      paramCounts.set(key, (paramCounts.get(key) ?? 0) + 1);
    }

    if ([...paramCounts.values()].some((count) => count > 1)) {
      return null;
    }

    if (targetUrl.searchParams.get("response_type") !== "code") {
      return null;
    }

    for (const key of requiredParams) {
      if (!targetUrl.searchParams.get(key)) {
        return null;
      }
    }

    const redirectUrl = targetUrl.searchParams.get("redirect_uri");
    if (!redirectUrl?.startsWith("http://localhost:") && !redirectUrl?.startsWith("http://127.0.0.1:")) {
      return null;
    }

    return targetUrl.toString();
  }

  private looksLikeCodexAuthPrompt(context: string): boolean {
    const normalizedContext = context.toLowerCase();

    if (/(if your browser did not open|navigate to this url to authenticate|failed to open browser for|follow instructions in your browser|open this url in your browser)/.test(normalizedContext)) {
      return true;
    }

    return /(oauth|auth|login|authorize|consent|deviceauth)/.test(normalizedContext);
  }

  private shouldSuppressSessionBrowserOpen(session: SessionRecord, rawUrl: string): boolean {
    let targetUrl: URL;
    try {
      targetUrl = new URL(rawUrl);
    } catch {
      return true;
    }

    const dedupeKey = targetUrl.toString();
    const now = Date.now();

    for (const [key, handledAt] of session.recentlyHandledBrowserKeys) {
      if (now - handledAt > 15_000) {
        session.recentlyHandledBrowserKeys.delete(key);
      }
    }

    const previousHandledAt = session.recentlyHandledBrowserKeys.get(dedupeKey);
    if (previousHandledAt && now - previousHandledAt < 15_000) {
      return true;
    }

    session.recentlyHandledBrowserKeys.set(dedupeKey, now);
    return false;
  }

  private trimUrlPunctuation(rawUrl: string): string {
    return rawUrl.replace(/[),.;:!?]+$/g, "");
  }

  private stripAnsiChunk(value: string): { plainText: string; remainder: string } {
    let result = "";

    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (character !== "\u001B") {
        result += character;
        continue;
      }

      const nextCharacter = value[index + 1];
      if (!nextCharacter) {
        return {
          plainText: result,
          remainder: value.slice(index)
        };
      }

      if (nextCharacter === "[") {
        index += 2;
        while (index < value.length && !/[@-~]/.test(value[index])) {
          index += 1;
        }

        if (index >= value.length) {
          return {
            plainText: result,
            remainder: value.slice(index - 2)
          };
        }
        continue;
      }

      if (nextCharacter === "]") {
        index += 2;
        let foundTerminator = false;

        while (index < value.length) {
          if (value[index] === "\u0007") {
            foundTerminator = true;
            break;
          }
          if (value[index] === "\u001B" && value[index + 1] === "\\") {
            index += 1;
            foundTerminator = true;
            break;
          }
          index += 1;
        }

        if (!foundTerminator) {
          return {
            plainText: result,
            remainder: value.slice(index - 2)
          };
        }
        continue;
      }

      index += 1;
    }

    return {
      plainText: result,
      remainder: ""
    };
  }

  private stripAnsi(value: string): string {
    let result = "";

    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (character !== "\u001B") {
        result += character;
        continue;
      }

      const nextCharacter = value[index + 1];
      if (nextCharacter === "[") {
        index += 2;
        while (index < value.length && !/[@-~]/.test(value[index])) {
          index += 1;
        }
        continue;
      }

      if (nextCharacter === "]") {
        index += 2;
        while (index < value.length) {
          if (value[index] === "\u0007") break;
          if (value[index] === "\u001B" && value[index + 1] === "\\") {
            index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }
    }

    return result;
  }

  private resolveShellArgs(shell: string): string[] {
    const isSandboxedZsh = os.platform() === "darwin" && path.basename(shell) === "zsh";
    const baseArgs = isSandboxedZsh ? ["-o", "no_monitor"] : [];
    return [...baseArgs, "-i"];
  }

  private buildSessionEnv(sessionPaths: SessionPaths): Record<string, string> {
    const pathEntries = this.buildPathEntries();
    const pathValue = pathEntries.join(path.delimiter);
    const env: Record<string, string> = {
      COLORTERM: "truecolor",
      HOME: sessionPaths.homeDirectory,
      HISTFILE: path.join(sessionPaths.zshDirectory, ".tasksaw_history"),
      LANG: process.env.LANG ?? "en_US.UTF-8",
      LOGNAME: process.env.LOGNAME ?? process.env.USER ?? "tasksaw",
      PATH: pathValue,
      PWD: sessionPaths.workspaceDirectory,
      SHELL: this.resolveShellCommand({ PATH: pathValue }),
      TASKSAW_SANDBOX_MODE: "workspace-write",
      TASKSAW_SESSION_HOME: sessionPaths.runtimeDirectory,
      TASKSAW_WORKSPACE_ROOT: sessionPaths.workspaceDirectory,
      TERM: "xterm-256color",
      TMUX_TMPDIR: sessionPaths.tmuxDirectory,
      TMPDIR: sessionPaths.tempDirectory,
      USER: process.env.USER ?? "tasksaw"
    };

    if (process.env.LC_CTYPE) {
      env.LC_CTYPE = process.env.LC_CTYPE;
    }

    if (os.platform() !== "win32") {
      env.XDG_CACHE_HOME = path.join(sessionPaths.runtimeDirectory, "xdg-cache");
      env.XDG_CONFIG_HOME = path.join(sessionPaths.runtimeDirectory, "xdg-config");
      env.XDG_STATE_HOME = path.join(sessionPaths.runtimeDirectory, "xdg-state");
      env.ZDOTDIR = sessionPaths.zshDirectory;
    }

    if (os.platform() === "win32") {
      env.USERPROFILE = sessionPaths.homeDirectory;
      env.TEMP = sessionPaths.tempDirectory;
      env.TMP = sessionPaths.tempDirectory;
    }

    return env;
  }

  private buildPathEntries(): string[] {
    const pathEntries = new Set<string>();
    const appendPath = (value?: string) => {
      if (!value) return;
      pathEntries.add(value);
    };

    appendPath(path.dirname(process.execPath));
    appendPath(this.toolManager.getBinDirectory());

    for (const entry of [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin"
    ]) {
      appendPath(entry);
    }

    return [...pathEntries];
  }

  private resolveShellCommand(env: Record<string, string>): string {
    const shellCandidates = os.platform() === "win32"
      ? [env.SHELL, "powershell.exe"]
      : [env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh", "zsh", "bash", "sh"];

    for (const candidate of shellCandidates) {
      if (!candidate) continue;
      const executablePath = this.resolveExecutable(candidate, env);
      if (executablePath) return executablePath;
    }

    throw new Error("No usable shell executable was found for PTY sessions");
  }

  private resolveExecutable(command: string, env: Record<string, string>): string | null {
    if (path.isAbsolute(command)) {
      return fs.existsSync(command) ? command : null;
    }

    const pathEntries = env.PATH?.split(path.delimiter).filter(Boolean) ?? [];

    for (const pathEntry of pathEntries) {
      const candidate = path.join(pathEntry, command);
      if (fs.existsSync(candidate)) return candidate;
    }

    return null;
  }

  private ensureNodePtySpawnHelperExecutable() {
    if (os.platform() === "win32") return;

    const nodePtyPackagePath = require.resolve("node-pty/package.json");
    const nodePtyDirectory = path.dirname(nodePtyPackagePath);
    const helperCandidates = [
      path.join(nodePtyDirectory, "build", "Release", "spawn-helper"),
      path.join(nodePtyDirectory, "build", "Debug", "spawn-helper"),
      path.join(nodePtyDirectory, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper")
    ];

    for (const helperPath of helperCandidates) {
      if (!fs.existsSync(helperPath)) continue;

      const helperStats = fs.statSync(helperPath);
      if ((helperStats.mode & 0o111) === 0o111) return;

      fs.chmodSync(helperPath, helperStats.mode | 0o111);
      return;
    }
  }


  private detectGeminiUsageFromOutput(session: SessionRecord) {
    const text = session.outputBuffer.toLowerCase();
    const lastWindow = text.slice(-2000); // Look at the last 2KB for efficiency

    // Detect JSON in output (sometimes -o json is used)
    const jsonMatch = lastWindow.match(/\{[\s\S]*"limit_per_day"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const limit = parsed.limit_per_day;
        const used = parsed.used_in_session || parsed.used_quota || 0;
        if (typeof limit === "number" && typeof used === "number" && limit > 0) {
          this.toolManager.updateObservedGeminiUsage(((limit - used) / limit) * 100, null);
          return;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
    
    // Detect quota exhausted
    if (lastWindow.includes("exhausted your capacity") || lastWindow.includes("quota will reset after") || lastWindow.includes("quota_exhausted")) {
      const resetMatch = lastWindow.match(/quota will reset after ([^\s.]+)/);
      const statusMessage = resetMatch ? `Quota exhausted (resets after ${resetMatch[1]})` : "Quota exhausted";
      this.toolManager.updateObservedGeminiUsage(null, statusMessage);
      return;
    }

    // Detect numeric patterns like 10/100 or 90% remaining
    const remainingMatch = lastWindow.match(/(\d+)%\s*remaining/);
    if (remainingMatch?.[1]) {
      this.toolManager.updateObservedGeminiUsage(parseInt(remainingMatch[1], 10), null);
      return;
    }

    // Match patterns like "usage: 10/100" or "requests: 10 / 100"
    const quotaMatch = lastWindow.match(/(?:usage|requests):\s*(\d+)\s*\/\s*(\d+)/);
    if (quotaMatch?.[1] && quotaMatch?.[2]) {
      const used = parseInt(quotaMatch[1], 10);
      const total = parseInt(quotaMatch[2], 10);
      if (total > 0) {
        this.toolManager.updateObservedGeminiUsage(((total - used) / total) * 100, null);
        return;
      }
    }

    // Match patterns like "10 / 100 requests used (10%)"
    const usedPercentMatch = lastWindow.match(/(\d+)\s*\/\s*(\d+)\s*(?:requests|tokens)\s*used\s*\((\d+)%\)/);
    if (usedPercentMatch?.[3]) {
      this.toolManager.updateObservedGeminiUsage(100 - parseInt(usedPercentMatch[3], 10), null);
      return;
    }
  }
}
