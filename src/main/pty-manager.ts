import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { BrowserWindow } from "electron";
import { CreateSessionInput, SessionInfo, SessionKind } from "./types";

type SessionRecord = {
  info: SessionInfo;
  ptyProcess: pty.IPty;
};

type SessionPaths = {
  workspaceDirectory: string;
  sessionDirectory: string;
  homeDirectory: string;
  tempDirectory: string;
  sandboxProfilePath: string;
};

export class PtyManager {
  private sessions = new Map<string, SessionRecord>();

  constructor(
    private mainWindow: BrowserWindow,
    private userDataDirectory: string
  ) {}

  createSession(input: CreateSessionInput): SessionInfo {
    this.ensureNodePtySpawnHelperExecutable();

    const workspaceDirectory = this.resolveWorkspaceDirectory(input.cwd);
    const id = randomUUID();
    const sessionPaths = this.prepareSessionPaths(id, workspaceDirectory);

    const info: SessionInfo = {
      id,
      kind: input.kind,
      title: this.makeTitle(input.kind),
      cwd: workspaceDirectory
    };

    const sessionEnv = this.buildSessionEnv(sessionPaths);
    const { command, args } = this.resolveCommand(input.kind, sessionEnv, sessionPaths);

    let ptyProcess: pty.IPty;

    try {
      ptyProcess = pty.spawn(command, args, {
        name: "xterm-256color",
        cols: 120,
        rows: 32,
        cwd: workspaceDirectory,
        env: sessionEnv
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start ${input.kind} session with "${command}": ${message}`);
    }

    ptyProcess.onData((data) => {
      this.mainWindow.webContents.send("terminal:data", { sessionId: id, data });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id);
      this.mainWindow.webContents.send("terminal:exit", {
        sessionId: id,
        exitCode,
        signal
      });
    });

    this.sessions.set(id, { info, ptyProcess });
    return info;
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].map((session) => session.info);
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
    this.sessions.delete(sessionId);
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
    const homeDirectory = path.join(sessionDirectory, "home");
    const tempDirectory = path.join(sessionDirectory, "tmp");
    const sandboxProfilePath = path.join(sessionDirectory, "workspace.sb");

    fs.mkdirSync(sessionDirectory, { recursive: true });
    fs.mkdirSync(homeDirectory, { recursive: true });
    fs.mkdirSync(tempDirectory, { recursive: true });

    this.writeSandboxProfile({
      workspaceDirectory,
      sessionDirectory,
      homeDirectory,
      tempDirectory,
      sandboxProfilePath
    });

    return {
      workspaceDirectory,
      sessionDirectory,
      homeDirectory,
      tempDirectory,
      sandboxProfilePath
    };
  }

  private writeSandboxProfile(sessionPaths: SessionPaths) {
    const writableSubpaths = [
      sessionPaths.workspaceDirectory,
      sessionPaths.homeDirectory,
      sessionPaths.tempDirectory
    ]
      .map((subpath) => `(subpath "${this.escapeSandboxPath(subpath)}")`)
      .join(" ");

    const sandboxProfile = [
      "(version 1)",
      "(deny default)",
      '(import "system.sb")',
      "(allow file-read*)",
      "(allow process*)",
      "(allow network*)",
      `(allow file-write* ${writableSubpaths})`
    ].join("\n");

    fs.writeFileSync(sessionPaths.sandboxProfilePath, sandboxProfile);
  }

  private escapeSandboxPath(targetPath: string): string {
    return targetPath.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  }

  private makeTitle(kind: SessionKind): string {
    const count = [...this.sessions.values()].filter((session) => session.info.kind === kind).length + 1;
    return `${kind}-${count}`;
  }

  private resolveCommand(
    kind: SessionKind,
    env: Record<string, string>,
    sessionPaths: SessionPaths
  ): { command: string; args: string[] } {
    const shell = this.resolveShellCommand(env);
    const shellArgs = this.resolveShellArgs(kind);

    if (os.platform() !== "darwin") {
      return { command: shell, args: shellArgs };
    }

    const sandboxCommand = this.resolveExecutable("/usr/bin/sandbox-exec", env)
      ?? this.resolveExecutable("sandbox-exec", env);

    if (!sandboxCommand) {
      throw new Error("macOS workspace sandbox is unavailable on this system");
    }

    return {
      command: sandboxCommand,
      args: ["-f", sessionPaths.sandboxProfilePath, shell, ...shellArgs]
    };
  }

  private resolveShellArgs(kind: SessionKind): string[] {
    if (kind === "shell") {
      return ["-i"];
    }

    if (kind === "codex") {
      return ["-ic", "exec codex"];
    }

    return ["-ic", "exec gemini"];
  }

  private buildSessionEnv(sessionPaths: SessionPaths): Record<string, string> {
    const pathEntries = this.buildPathEntries();
    const pathValue = pathEntries.join(path.delimiter);
    const env: Record<string, string> = {
      COLORTERM: "truecolor",
      HOME: sessionPaths.homeDirectory,
      HISTFILE: path.join(sessionPaths.homeDirectory, ".tasksaw_history"),
      LANG: process.env.LANG ?? "en_US.UTF-8",
      LOGNAME: process.env.LOGNAME ?? process.env.USER ?? "tasksaw",
      PATH: pathValue,
      PWD: sessionPaths.workspaceDirectory,
      SHELL: this.resolveShellCommand({ PATH: pathValue }),
      TASKSAW_SANDBOX_MODE: "workspace-write",
      TASKSAW_SESSION_HOME: sessionPaths.homeDirectory,
      TASKSAW_WORKSPACE_ROOT: sessionPaths.workspaceDirectory,
      TERM: "xterm-256color",
      TMPDIR: sessionPaths.tempDirectory,
      USER: process.env.USER ?? "tasksaw"
    };

    if (process.env.LC_CTYPE) {
      env.LC_CTYPE = process.env.LC_CTYPE;
    }

    if (os.platform() !== "win32") {
      env.ZDOTDIR = sessionPaths.homeDirectory;
    }

    if (os.platform() === "win32") {
      env.USERPROFILE = sessionPaths.homeDirectory;
      env.TEMP = sessionPaths.tempDirectory;
      env.TMP = sessionPaths.tempDirectory;
    }

    return env;
  }

  private buildPathEntries(): string[] {
    const homeDirectory = os.homedir();
    const pathEntries = new Set<string>();
    const appendPath = (value?: string) => {
      if (!value) return;
      pathEntries.add(value);
    };

    appendPath(path.dirname(process.execPath));

    for (const entry of [
      path.join(homeDirectory, ".codex", "bin"),
      path.join(homeDirectory, ".local", "bin"),
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
}
