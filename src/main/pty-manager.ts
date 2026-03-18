import os from "node:os";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { BrowserWindow } from "electron";
import { CreateSessionInput, SessionInfo, SessionKind } from "./types";

type SessionRecord = {
  info: SessionInfo;
  ptyProcess: pty.IPty;
};

export class PtyManager {
  private sessions = new Map<string, SessionRecord>();

  constructor(private mainWindow: BrowserWindow) {}

  createSession(input: CreateSessionInput): SessionInfo {
    const id = randomUUID();
    const info: SessionInfo = {
      id,
      kind: input.kind,
      title: this.makeTitle(input.kind)
    };

    const { command, args } = this.resolveCommand(input.kind);

    const ptyProcess = pty.spawn(command, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      cwd: input.cwd || process.cwd(),
      env: process.env as Record<string, string>
    });

    ptyProcess.onData((data) => {
      this.mainWindow.webContents.send("terminal:data", { sessionId: id, data });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
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
    return [...this.sessions.values()].map((s) => s.info);
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

  private makeTitle(kind: SessionKind): string {
    const count = [...this.sessions.values()].filter((s) => s.info.kind === kind).length + 1;
    return `${kind}-${count}`;
  }

  private resolveCommand(kind: SessionKind): { command: string; args: string[] } {
    const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "zsh");

    if (kind === "shell") {
      return { command: shell, args: [] };
    }

    if (kind === "codex") {
      return { command: shell, args: ["-lc", "codex"] };
    }

    return { command: shell, args: ["-lc", "gemini"] };
  }
}
