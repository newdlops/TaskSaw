type SessionKind = "shell" | "codex" | "gemini";
type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";
type LanguageCode = "en" | "ko";
type XtermTerminal = import("@xterm/xterm").Terminal;
type XtermTheme = NonNullable<import("@xterm/xterm").ITerminalOptions["theme"]>;

type SessionInfo = {
  id: string;
  kind: SessionKind;
  title: string;
  cwd: string;
};

type TerminalDataPayload = { sessionId: string; data: string };
type TerminalExitPayload = { sessionId: string; exitCode: number; signal: number };
type DirectoryDialogOptions = {
  defaultPath?: string;
  title?: string;
  buttonLabel?: string;
};

type TasksawApi = {
  createSession(input: { kind: SessionKind; cwd: string }): Promise<SessionInfo>;
  listSessions(): Promise<SessionInfo[]>;
  selectDirectory(options?: DirectoryDialogOptions): Promise<string | null>;
  createDirectory(options?: DirectoryDialogOptions): Promise<string | null>;
  writeTerminal(sessionId: string, data: string): void;
  resizeTerminal(sessionId: string, cols: number, rows: number): void;
  killSession(sessionId: string): void;
  onTerminalData(handler: (payload: TerminalDataPayload) => void): void;
  onTerminalExit(handler: (payload: TerminalExitPayload) => void): void;
};

type RendererWindow = Window & {
  Terminal?: typeof import("@xterm/xterm").Terminal;
  tasksaw: TasksawApi;
};

type UiMessage = { key: string; params?: Record<string, string> } | { raw: string } | null;

const TEXT = {
  en: {
    ui: {
      workspaceLabel: "Workspace",
      workspaceUnset: "No workspace selected",
      workspaceOpen: "Open Workspace",
      workspaceCreate: "Create Workspace",
      sessionsTitle: "Sessions",
      themeGroupLabel: "Theme",
      languageGroupLabel: "Language",
      themeSystem: "Auto",
      themeLight: "Light",
      themeDark: "Dark",
      languageEnglish: "English",
      languageKorean: "Korean",
      emptyState: "Choose a workspace, then create a terminal",
      openDialogTitle: "Open workspace",
      openDialogButton: "Open Folder",
      createDialogTitle: "Create workspace",
      createDialogButton: "Create Folder",
      close: "Close",
      statusLive: "live",
      statusExited: "exited"
    },
    logs: {
      workspaceReady: "workspace ready: {cwd}",
      created: "created: {title} @ {cwd}",
      closed: "closed: {title} @ {cwd}",
      exited: "session exited: {sessionId} (code={exitCode}, signal={signal})"
    },
    errors: {
      selectFolder: "Select the workspace folder first.",
      failedCreate: "Failed to create {kind} session: {message}",
      failedRestore: "Failed to restore sessions: {message}",
      failedXterm: "Renderer failed to initialize xterm"
    },
    kinds: {
      shell: "Shell",
      codex: "Codex",
      gemini: "Gemini"
    }
  },
  ko: {
    ui: {
      workspaceLabel: "워크스페이스",
      workspaceUnset: "선택된 워크스페이스 없음",
      workspaceOpen: "워크스페이스 열기",
      workspaceCreate: "워크스페이스 만들기",
      sessionsTitle: "세션",
      themeGroupLabel: "테마",
      languageGroupLabel: "언어",
      themeSystem: "자동",
      themeLight: "라이트",
      themeDark: "다크",
      languageEnglish: "영어",
      languageKorean: "한국어",
      emptyState: "워크스페이스를 고른 뒤 터미널을 만드세요",
      openDialogTitle: "워크스페이스 열기",
      openDialogButton: "폴더 열기",
      createDialogTitle: "워크스페이스 만들기",
      createDialogButton: "폴더 만들기",
      close: "닫기",
      statusLive: "실행 중",
      statusExited: "종료됨"
    },
    logs: {
      workspaceReady: "워크스페이스 준비됨: {cwd}",
      created: "생성됨: {title} @ {cwd}",
      closed: "닫힘: {title} @ {cwd}",
      exited: "세션 종료: {sessionId} (code={exitCode}, signal={signal})"
    },
    errors: {
      selectFolder: "먼저 워크스페이스 폴더를 선택하세요.",
      failedCreate: "{kind} 세션 생성 실패: {message}",
      failedRestore: "세션 복원 실패: {message}",
      failedXterm: "renderer에서 xterm 초기화에 실패했습니다"
    },
    kinds: {
      shell: "쉘",
      codex: "코덱스",
      gemini: "제미나이"
    }
  }
} as const;

const appWindow = window as unknown as RendererWindow;

const workspaceLabelEl = document.getElementById("workspace-label") as HTMLSpanElement;
const workspacePathEl = document.getElementById("workspace-path") as HTMLElement;
const workspaceOpenButton = document.getElementById("workspace-open") as HTMLButtonElement;
const workspaceCreateButton = document.getElementById("workspace-create") as HTMLButtonElement;
const newShellButton = document.getElementById("new-shell") as HTMLButtonElement;
const newCodexButton = document.getElementById("new-codex") as HTMLButtonElement;
const newGeminiButton = document.getElementById("new-gemini") as HTMLButtonElement;
const sessionSectionTitle = document.getElementById("session-section-title") as HTMLDivElement;
const sessionListEl = document.getElementById("session-list") as HTMLUListElement;
const terminalRoot = document.getElementById("terminal-root") as HTMLDivElement;
const logbar = document.getElementById("logbar") as HTMLDivElement;
const themeSwitcher = document.getElementById("theme-switcher") as HTMLDivElement;
const languageSwitcher = document.getElementById("language-switcher") as HTMLDivElement;
const themeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-theme-option]"));
const languageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-language-option]"));
const darkThemeMedia = appWindow.matchMedia("(prefers-color-scheme: dark)");

const terminals = new Map<string, XtermTerminal>();
const terminalPanes = new Map<string, HTMLElement>();
const terminalContainers = new Map<string, HTMLDivElement>();
const sessionStatusBadges = new Map<string, HTMLSpanElement>();
const sessionKindBadges = new Map<string, HTMLSpanElement>();
const sessionCloseButtons = new Map<string, HTMLButtonElement>();
const sessions: SessionInfo[] = [];

const THEME_STORAGE_KEY = "tasksaw-theme";
const WORKSPACE_STORAGE_KEY = "tasksaw-last-workspace";
const LANGUAGE_STORAGE_KEY = "tasksaw-language";
const XTERM_THEMES = {
  light: {
    background: "#fffaf0",
    foreground: "#1f2937",
    cursor: "#2563eb",
    cursorAccent: "#fffaf0",
    selectionBackground: "rgba(37, 99, 235, 0.20)",
    black: "#1f2937",
    red: "#c2410c",
    green: "#15803d",
    yellow: "#a16207",
    blue: "#2563eb",
    magenta: "#7c3aed",
    cyan: "#0f766e",
    white: "#e5e7eb",
    brightBlack: "#6b7280",
    brightRed: "#ea580c",
    brightGreen: "#16a34a",
    brightYellow: "#ca8a04",
    brightBlue: "#3b82f6",
    brightMagenta: "#8b5cf6",
    brightCyan: "#06b6d4",
    brightWhite: "#111827"
  },
  dark: {
    background: "#111720",
    foreground: "#e5e7eb",
    cursor: "#7cc8ff",
    cursorAccent: "#111720",
    selectionBackground: "rgba(124, 200, 255, 0.24)",
    black: "#111827",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#d1d5db",
    brightBlack: "#6b7280",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fcd34d",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#f9fafb"
  }
} as const satisfies Record<ResolvedTheme, XtermTheme>;

let activeSessionId: string | null = null;
let themePreference: ThemePreference = getInitialThemePreference();
let languagePreference: LanguageCode = getInitialLanguagePreference();
let currentWorkspacePath: string | null = getInitialWorkspacePath();
let lastLogMessage: UiMessage = null;

function translate(key: string, params: Record<string, string> = {}): string {
  const resolvedValue = key.split(".").reduce<unknown>((current, part) => {
    if (typeof current === "object" && current !== null && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, TEXT[languagePreference] as unknown);

  const template = typeof resolvedValue === "string" ? resolvedValue : key;
  return template.replace(/\{(\w+)\}/g, (_match, token) => params[token] ?? `{${token}}`);
}

function translateKind(kind: SessionKind): string {
  return translate(`kinds.${kind}`);
}

function renderMessage(target: HTMLElement, message: UiMessage) {
  if (!message) {
    target.textContent = "";
    return;
  }

  target.textContent = "key" in message
    ? translate(message.key, message.params)
    : message.raw;
}

function logLocalized(key: string, params: Record<string, string> = {}) {
  lastLogMessage = { key, params };
  renderMessage(logbar, lastLogMessage);
}

function logRaw(message: string) {
  lastLogMessage = { raw: message };
  renderMessage(logbar, lastLogMessage);
}

function refreshLogbar() {
  renderMessage(logbar, lastLogMessage);
}

function isThemePreference(value: string | undefined): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isLanguageCode(value: string | undefined): value is LanguageCode {
  return value === "en" || value === "ko";
}

function getInitialThemePreference(): ThemePreference {
  const themePreferenceAttr = document.documentElement.dataset.themePreference;
  if (isThemePreference(themePreferenceAttr)) return themePreferenceAttr;

  try {
    const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY) ?? undefined;
    if (isThemePreference(storedPreference)) return storedPreference;
  } catch {
    // Ignore storage access failures and fall back to the system theme.
  }

  return "system";
}

function getInitialLanguagePreference(): LanguageCode {
  try {
    const storedPreference = window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? undefined;
    if (isLanguageCode(storedPreference)) return storedPreference;
  } catch {
    // Ignore storage access failures and fall back to the document/browser language.
  }

  if (isLanguageCode(document.documentElement.lang)) {
    return document.documentElement.lang;
  }

  return window.navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function getInitialWorkspacePath(): string | null {
  const storedPath = readStoredWorkspacePath();
  return storedPath.length > 0 ? storedPath : null;
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return darkThemeMedia.matches ? "dark" : "light";
}

function persistThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore storage access failures and continue with an in-memory selection.
  }
}

function persistLanguagePreference(preference: LanguageCode) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Ignore storage access failures and continue with an in-memory selection.
  }
}

function readStoredWorkspacePath(): string {
  try {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function persistWorkspacePath(workspacePath: string) {
  try {
    if (workspacePath.length === 0) {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspacePath);
  } catch {
    // Ignore storage access failures and continue with the current in-memory path.
  }
}

function updateThemeControls(preference: ThemePreference) {
  for (const button of themeButtons) {
    const isActive = button.dataset.themeOption === preference;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));

    if (button.dataset.themeOption === "system") button.textContent = translate("ui.themeSystem");
    if (button.dataset.themeOption === "light") button.textContent = translate("ui.themeLight");
    if (button.dataset.themeOption === "dark") button.textContent = translate("ui.themeDark");
  }
}

function updateLanguageControls(preference: LanguageCode) {
  for (const button of languageButtons) {
    const isActive = button.dataset.languageOption === preference;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));

    if (button.dataset.languageOption === "en") button.textContent = translate("ui.languageEnglish");
    if (button.dataset.languageOption === "ko") button.textContent = translate("ui.languageKorean");
  }
}

function syncTerminalThemes(theme: ResolvedTheme) {
  for (const terminal of terminals.values()) {
    terminal.options.theme = XTERM_THEMES[theme];
  }
}

function updateWorkspaceSummary() {
  workspaceLabelEl.textContent = translate("ui.workspaceLabel");
  workspaceOpenButton.textContent = translate("ui.workspaceOpen");
  workspaceCreateButton.textContent = translate("ui.workspaceCreate");
  workspacePathEl.textContent = currentWorkspacePath ?? translate("ui.workspaceUnset");
  workspacePathEl.classList.toggle("empty", currentWorkspacePath === null);
  workspacePathEl.title = currentWorkspacePath ?? "";
}

function updateSessionCreationState() {
  const disabled = currentWorkspacePath === null;
  newShellButton.disabled = disabled;
  newCodexButton.disabled = disabled;
  newGeminiButton.disabled = disabled;
}

function refreshTerminalPaneCopy() {
  for (const session of sessions) {
    const kindBadge = sessionKindBadges.get(session.id);
    if (kindBadge) kindBadge.textContent = translateKind(session.kind);

    const statusBadge = sessionStatusBadges.get(session.id);
    if (statusBadge) {
      const hasExited = terminalPanes.get(session.id)?.classList.contains("exited") ?? false;
      statusBadge.textContent = hasExited ? translate("ui.statusExited") : translate("ui.statusLive");
    }

    const closeButton = sessionCloseButtons.get(session.id);
    if (closeButton) closeButton.textContent = translate("ui.close");
  }
}

function refreshLocalizedContent() {
  document.documentElement.lang = languagePreference;

  newShellButton.textContent = `+${translateKind("shell")}`;
  newCodexButton.textContent = `+${translateKind("codex")}`;
  newGeminiButton.textContent = `+${translateKind("gemini")}`;
  sessionSectionTitle.textContent = translate("ui.sessionsTitle");
  terminalRoot.dataset.emptyMessage = translate("ui.emptyState");
  themeSwitcher.setAttribute("aria-label", translate("ui.themeGroupLabel"));
  languageSwitcher.setAttribute("aria-label", translate("ui.languageGroupLabel"));

  updateWorkspaceSummary();
  updateThemeControls(themePreference);
  updateLanguageControls(languagePreference);
  renderSessionList();
  refreshTerminalPaneCopy();
  refreshLogbar();
  updateSessionCreationState();
  updateTerminalRootState();
}

function applyThemePreference(preference: ThemePreference, persist = true) {
  themePreference = preference;

  const resolvedTheme = resolveTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolvedTheme;
  updateThemeControls(preference);
  syncTerminalThemes(resolvedTheme);

  if (persist) persistThemePreference(preference);
}

function applyLanguagePreference(preference: LanguageCode, persist = true) {
  languagePreference = preference;
  refreshLocalizedContent();

  if (persist) persistLanguagePreference(preference);
}

function setCurrentWorkspacePath(workspacePath: string | null, persist = true) {
  const trimmedPath = workspacePath?.trim() ?? "";
  currentWorkspacePath = trimmedPath.length > 0 ? trimmedPath : null;

  if (persist) persistWorkspacePath(currentWorkspacePath ?? "");

  updateWorkspaceSummary();
  updateSessionCreationState();
}

function getSuggestedWorkspacePath(): string | undefined {
  const suggestedPath = currentWorkspacePath ?? readStoredWorkspacePath();
  return suggestedPath.length > 0 ? suggestedPath : undefined;
}

function useWorkspacePath(workspacePath: string) {
  setCurrentWorkspacePath(workspacePath);
  logLocalized("logs.workspaceReady", { cwd: workspacePath });
}

async function browseWorkspace() {
  try {
    const selectedPath = await appWindow.tasksaw.selectDirectory({
      defaultPath: getSuggestedWorkspacePath(),
      title: translate("ui.openDialogTitle"),
      buttonLabel: translate("ui.openDialogButton")
    });

    if (!selectedPath) return;
    useWorkspacePath(selectedPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logRaw(message);
  }
}

async function createWorkspaceDirectory() {
  try {
    const selectedPath = await appWindow.tasksaw.createDirectory({
      defaultPath: getSuggestedWorkspacePath(),
      title: translate("ui.createDialogTitle"),
      buttonLabel: translate("ui.createDialogButton")
    });

    if (!selectedPath) return;
    useWorkspacePath(selectedPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logRaw(message);
  }
}

function updateTerminalRootState() {
  terminalRoot.dataset.count = String(sessions.length);
  terminalRoot.classList.toggle("empty", sessions.length === 0);
}

function fitAllSessions() {
  for (const [sessionId, terminal] of terminals.entries()) {
    fitSession(sessionId, terminal);
  }
}

function scheduleFitAllSessions() {
  appWindow.requestAnimationFrame(() => fitAllSessions());
}

function setActiveSession(sessionId: string) {
  activeSessionId = sessionId;

  for (const [id, pane] of terminalPanes.entries()) {
    pane.classList.toggle("active", id === sessionId);
  }

  for (const li of sessionListEl.querySelectorAll("li")) {
    li.classList.toggle("active", li.getAttribute("data-id") === sessionId);
  }

  const terminal = terminals.get(sessionId);
  if (terminal) {
    fitSession(sessionId, terminal);
    terminal.focus();
  }
}

function fitSession(sessionId: string, terminal: XtermTerminal) {
  const terminalViewport = terminalContainers.get(sessionId);
  const viewportRect = terminalViewport?.getBoundingClientRect();
  const fallbackRect = terminalRoot.getBoundingClientRect();
  const availableWidth = Math.max(
    viewportRect && viewportRect.width > 0 ? viewportRect.width : fallbackRect.width,
    360
  );
  const availableHeight = Math.max(
    viewportRect && viewportRect.height > 0 ? viewportRect.height : fallbackRect.height,
    200
  );
  const cols = Math.max(40, Math.floor(availableWidth / 9));
  const rows = Math.max(10, Math.floor(availableHeight / 18));
  terminal.resize(cols, rows);
  appWindow.tasksaw.resizeTerminal(sessionId, cols, rows);
}

function renderSessionList() {
  sessionListEl.innerHTML = "";

  for (const session of sessions) {
    const li = document.createElement("li");
    li.setAttribute("data-id", session.id);

    const meta = document.createElement("span");
    meta.className = "session-meta";

    const title = document.createElement("span");
    title.className = "session-title";
    title.textContent = session.title;

    const cwd = document.createElement("span");
    cwd.className = "session-cwd";
    cwd.textContent = session.cwd;
    cwd.title = session.cwd;

    const kind = document.createElement("span");
    kind.className = "session-kind";
    kind.textContent = translateKind(session.kind);

    meta.append(title, cwd);
    li.append(meta, kind);

    if (session.id === activeSessionId) li.classList.add("active");
    li.onclick = () => setActiveSession(session.id);
    sessionListEl.appendChild(li);
  }
}

function mountTerminal(session: SessionInfo) {
  const pane = document.createElement("section");
  pane.className = "terminal-pane";
  pane.setAttribute("data-id", session.id);
  pane.addEventListener("mousedown", () => setActiveSession(session.id));

  const header = document.createElement("header");
  header.className = "terminal-pane-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "terminal-pane-title-wrap";

  const title = document.createElement("strong");
  title.className = "terminal-pane-title";
  title.textContent = session.title;

  const pathLabel = document.createElement("span");
  pathLabel.className = "terminal-pane-path";
  pathLabel.textContent = session.cwd;
  pathLabel.title = session.cwd;

  const kindBadge = document.createElement("span");
  kindBadge.className = "terminal-pane-kind";
  kindBadge.textContent = translateKind(session.kind);

  const statusBadge = document.createElement("span");
  statusBadge.className = "terminal-pane-status";
  statusBadge.textContent = translate("ui.statusLive");

  titleWrap.append(title, pathLabel, kindBadge, statusBadge);

  const actions = document.createElement("div");
  actions.className = "terminal-pane-actions";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "terminal-pane-close";
  closeButton.textContent = translate("ui.close");
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    appWindow.tasksaw.killSession(session.id);
    removeSession(session.id);
  });

  actions.appendChild(closeButton);
  header.append(titleWrap, actions);

  const container = document.createElement("div");
  container.className = "terminal-viewport";

  pane.append(header, container);
  terminalRoot.appendChild(pane);

  if (typeof appWindow.Terminal !== "function") {
    logLocalized("errors.failedXterm");
    throw new Error(translate("errors.failedXterm"));
  }

  const terminal = new appWindow.Terminal({
    cursorBlink: true,
    fontSize: 14,
    theme: XTERM_THEMES[resolveTheme(themePreference)]
  });

  terminal.open(container);
  terminal.onData((data: string) => {
    appWindow.tasksaw.writeTerminal(session.id, data);
  });

  terminals.set(session.id, terminal);
  terminalPanes.set(session.id, pane);
  terminalContainers.set(session.id, container);
  sessionStatusBadges.set(session.id, statusBadge);
  sessionKindBadges.set(session.id, kindBadge);
  sessionCloseButtons.set(session.id, closeButton);

  fitSession(session.id, terminal);
  updateTerminalRootState();
}

function removeSession(sessionId: string) {
  const sessionIndex = sessions.findIndex((session) => session.id === sessionId);
  if (sessionIndex === -1) return;

  const [removedSession] = sessions.splice(sessionIndex, 1);
  terminals.get(sessionId)?.dispose();
  terminals.delete(sessionId);
  terminalContainers.delete(sessionId);
  sessionStatusBadges.delete(sessionId);
  sessionKindBadges.delete(sessionId);
  sessionCloseButtons.delete(sessionId);
  terminalPanes.get(sessionId)?.remove();
  terminalPanes.delete(sessionId);

  if (activeSessionId === sessionId) {
    const nextActiveSession = sessions[sessionIndex] ?? sessions[sessionIndex - 1] ?? null;
    activeSessionId = nextActiveSession?.id ?? null;
  }

  renderSessionList();
  updateTerminalRootState();

  if (activeSessionId) setActiveSession(activeSessionId);

  scheduleFitAllSessions();
  logLocalized("logs.closed", {
    title: removedSession.title,
    cwd: removedSession.cwd
  });
}

function markSessionExited(sessionId: string) {
  terminalPanes.get(sessionId)?.classList.add("exited");
  const statusBadge = sessionStatusBadges.get(sessionId);
  if (statusBadge) {
    statusBadge.textContent = translate("ui.statusExited");
  }
}

async function createSession(kind: SessionKind) {
  if (!currentWorkspacePath) {
    logLocalized("errors.selectFolder");
    return;
  }

  const session = await appWindow.tasksaw.createSession({ kind, cwd: currentWorkspacePath });
  sessions.push(session);
  renderSessionList();
  mountTerminal(session);
  setActiveSession(session.id);
  scheduleFitAllSessions();
  persistWorkspacePath(currentWorkspacePath);
  logLocalized("logs.created", {
    title: session.title,
    cwd: session.cwd
  });
}

async function handleCreateSession(kind: SessionKind) {
  try {
    await createSession(kind);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logLocalized("errors.failedCreate", {
      kind: translateKind(kind),
      message
    });
  }
}

async function restoreSessions() {
  const existingSessions = await appWindow.tasksaw.listSessions();
  if (existingSessions.length === 0) {
    updateTerminalRootState();
    return;
  }

  sessions.splice(0, sessions.length, ...existingSessions);
  renderSessionList();

  for (const session of existingSessions) {
    mountTerminal(session);
  }

  if (!currentWorkspacePath) {
    setCurrentWorkspacePath(existingSessions[existingSessions.length - 1]!.cwd, false);
  }

  setActiveSession(existingSessions[existingSessions.length - 1]!.id);
  scheduleFitAllSessions();
}

appWindow.tasksaw.onTerminalData(({ sessionId, data }: TerminalDataPayload) => {
  const terminal = terminals.get(sessionId);
  if (terminal) terminal.write(data);
});

appWindow.tasksaw.onTerminalExit(({ sessionId, exitCode, signal }: TerminalExitPayload) => {
  if (!terminalPanes.has(sessionId)) return;
  markSessionExited(sessionId);
  logLocalized("logs.exited", {
    sessionId,
    exitCode: String(exitCode),
    signal: String(signal)
  });
});

workspaceOpenButton.addEventListener("click", () => void browseWorkspace());
workspaceCreateButton.addEventListener("click", () => void createWorkspaceDirectory());
newShellButton.addEventListener("click", () => void handleCreateSession("shell"));
newCodexButton.addEventListener("click", () => void handleCreateSession("codex"));
newGeminiButton.addEventListener("click", () => void handleCreateSession("gemini"));

for (const button of themeButtons) {
  const themeOption = button.dataset.themeOption;
  if (!isThemePreference(themeOption)) continue;
  button.addEventListener("click", () => applyThemePreference(themeOption));
}

for (const button of languageButtons) {
  const languageOption = button.dataset.languageOption;
  if (!isLanguageCode(languageOption)) continue;
  button.addEventListener("click", () => applyLanguagePreference(languageOption));
}

darkThemeMedia.addEventListener("change", () => {
  if (themePreference === "system") {
    applyThemePreference("system", false);
  }
});

applyThemePreference(themePreference, false);
applyLanguagePreference(languagePreference, false);

appWindow.addEventListener("resize", () => {
  fitAllSessions();
});

restoreSessions().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logLocalized("errors.failedRestore", { message });
});
