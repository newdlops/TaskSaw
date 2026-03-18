import { Terminal } from "@xterm/xterm";

type SessionKind = "shell" | "codex" | "gemini";

type SessionInfo = {
  id: string;
  kind: SessionKind;
  title: string;
};

declare global {
  interface Window {
    tasksaw: {
      createSession(input: { kind: SessionKind; cwd?: string }): Promise<SessionInfo>;
      listSessions(): Promise<SessionInfo[]>;
      writeTerminal(sessionId: string, data: string): void;
      resizeTerminal(sessionId: string, cols: number, rows: number): void;
      killSession(sessionId: string): void;
      onTerminalData(handler: (payload: { sessionId: string; data: string }) => void): void;
      onTerminalExit(
          handler: (payload: { sessionId: string; exitCode: number; signal: number }) => void
      ): void;
    };
  }
}

const sessionListEl = document.getElementById("session-list") as HTMLUListElement;
const terminalRoot = document.getElementById("terminal-root") as HTMLDivElement;
const logbar = document.getElementById("logbar") as HTMLDivElement;

const terminals = new Map<string, Terminal>();
const terminalContainers = new Map<string, HTMLDivElement>();
let activeSessionId: string | null = null;
const sessions: SessionInfo[] = [];

function log(message: string) {
  logbar.textContent = message;
}

function setActiveSession(sessionId: string) {
  activeSessionId = sessionId;

  for (const [id, el] of terminalContainers.entries()) {
    el.style.display = id === sessionId ? "block" : "none";
  }

  for (const li of sessionListEl.querySelectorAll("li")) {
    li.classList.toggle("active", li.getAttribute("data-id") === sessionId);
  }

  const term = terminals.get(sessionId);
  if (term) {
    fitSession(sessionId, term);
    term.focus();
  }
}

function fitSession(sessionId: string, term: Terminal) {
  const cols = Math.max(40, Math.floor(window.innerWidth / 9));
  const rows = Math.max(10, Math.floor((window.innerHeight - 120) / 18));
  term.resize(cols, rows);
  window.tasksaw.resizeTerminal(sessionId, cols, rows);
}

function renderSessionList() {
  sessionListEl.innerHTML = "";

  for (const session of sessions) {
    const li = document.createElement("li");
    li.textContent = session.title;
    li.setAttribute("data-id", session.id);
    if (session.id === activeSessionId) li.classList.add("active");
    li.onclick = () => setActiveSession(session.id);
    sessionListEl.appendChild(li);
  }
}

function mountTerminal(session: SessionInfo) {
  const container = document.createElement("div");
  container.className = "terminal-pane";
  container.style.display = "none";
  terminalRoot.appendChild(container);

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14
  });

  term.open(container);
  term.onData((data) => {
    window.tasksaw.writeTerminal(session.id, data);
  });

  terminals.set(session.id, term);
  terminalContainers.set(session.id, container);

  fitSession(session.id, term);
}

async function createSession(kind: SessionKind) {
  const session = await window.tasksaw.createSession({ kind });
  sessions.push(session);
  renderSessionList();
  mountTerminal(session);
  setActiveSession(session.id);
  log(`created: ${session.title}`);
}

window.tasksaw.onTerminalData(({ sessionId, data }) => {
  const term = terminals.get(sessionId);
  if (term) term.write(data);
});

window.tasksaw.onTerminalExit(({ sessionId, exitCode, signal }) => {
  log(`session exited: ${sessionId} (code=${exitCode}, signal=${signal})`);
});

document.getElementById("new-shell")!.addEventListener("click", () => createSession("shell"));
document.getElementById("new-codex")!.addEventListener("click", () => createSession("codex"));
document.getElementById("new-gemini")!.addEventListener("click", () => createSession("gemini"));

window.addEventListener("resize", () => {
  if (!activeSessionId) return;
  const term = terminals.get(activeSessionId);
  if (!term) return;
  fitSession(activeSessionId, term);
});
