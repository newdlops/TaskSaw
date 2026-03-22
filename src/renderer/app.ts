type SessionKind = "shell" | "codex" | "gemini";
type ManagedToolId = Extract<SessionKind, "codex" | "gemini">;
type ThemePreference = "light" | "dark";
type ResolvedTheme = "light" | "dark";
type LanguageCode = "en" | "ko";
type OrchestratorMode = "gemini_only" | "codex_only" | "cross_review";
type OrchestratorContinuationMode = "resume" | "next_action";
type OrchestratorNodeRole = "task" | "stage";
type XtermTerminal = import("@xterm/xterm").Terminal;
type XtermTheme = NonNullable<import("@xterm/xterm").ITerminalOptions["theme"]>;

type SessionInfo = {
  id: string;
  kind: SessionKind;
  title: string;
  cwd: string;
  hidden?: boolean;
};

type TerminalDataPayload = { sessionId: string; data: string };
type TerminalExitPayload = { sessionId: string; exitCode: number; signal: number };
type RunStatus = "pending" | "running" | "done" | "failed" | "paused" | "escalated";
type ManagedToolUsage = {
  remainingPercent?: number | null;
  statusMessage?: string | null;
  percentRemaining?: number | null;
  used?: number | null;
  max?: number | null;
  codex?: {
    fiveHourRemainingPercent: number | null;
    weeklyRemainingPercent: number | null;
  } | null;
  gemini?: {
    models?: Array<{
      modelId: string;
      displayName: string;
      remainingPercent: number | null;
    }> | null;
  } | null;
} | null;

type ManagedToolStatus = {
  id: "codex" | "gemini";
  displayName: string;
  installed: boolean;
  version: string | null;
  usage?: ManagedToolUsage;
};
type DirectoryDialogOptions = {
  defaultPath?: string;
  title?: string;
  buttonLabel?: string;
  message?: string;
};
type OrchestratorRunSummary = {
  id: string;
  goal: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  finalSummary: string | null;
};
type OrchestratorAcceptanceCriterion = {
  description: string;
  status: string;
};
type OrchestratorModelRef = {
  id: string;
  provider: string;
  model: string;
  tier?: string;
  reasoningEffort?: string;
};
type OrchestratorModelAssignment = {
  abstractPlanner?: OrchestratorModelRef;
  gatherer?: OrchestratorModelRef;
  concretePlanner?: OrchestratorModelRef;
  reviewer?: OrchestratorModelRef;
  executor?: OrchestratorModelRef;
  verifier?: OrchestratorModelRef;
};
type OrchestratorPlanNode = {
  id: string;
  parentId: string | null;
  title: string;
  objective: string;
  depth: number;
  kind: "planning" | "execution";
  role: OrchestratorNodeRole;
  stagePhase: string | null;
  phase: string;
  assignedModels?: OrchestratorModelAssignment;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  acceptanceCriteria: {
    items: OrchestratorAcceptanceCriterion[];
  };
};
type OrchestratorEvent = {
  id: string;
  runId: string;
  nodeId: string | null;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
};
type OrchestratorApprovalOption = {
  optionId: string;
  kind?: string | null;
  label?: string | null;
};
type OrchestratorPendingApproval = {
  requestId: string;
  title: string;
  message: string;
  details: string;
  options: OrchestratorApprovalOption[];
};
type ApprovalToast = {
  requestId: string;
  title: string;
  message: string;
};
type QueuedPendingApproval = OrchestratorPendingApproval & {
  nodeId: string;
  nodeTitle: string;
  createdAt: string;
};
type OrchestratorUserInputOption = {
  label: string;
  description?: string | null;
};
type OrchestratorUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  options?: OrchestratorUserInputOption[];
  isOther?: boolean;
  isSecret?: boolean;
};
type OrchestratorPendingUserInput = {
  requestId: string;
  title: string;
  message: string;
  questions: OrchestratorUserInputQuestion[];
};
type OrchestratorPendingInteractiveSession = {
  requestId: string;
  runId: string;
  nodeId: string;
  title: string;
  message: string;
  commandText: string;
  cwd: string;
  createdAt: string;
  sessionId: string | null;
  transcript: string;
  exitCode: number | null;
  signal: number | null;
  exited: boolean;
  responseSubmitted: boolean;
  terminateRequested: boolean;
};
type OrchestratorWorkingMemory = {
  facts: Array<{ statement: string }>;
  openQuestions: Array<{ question: string; status: string }>;
  unknowns: Array<{ description: string; status: string }>;
  conflicts: Array<{ summary: string; status: string }>;
  decisions: Array<{ summary: string; rationale: string }>;
};
type OrchestratorNextAction = {
  title: string;
  objective: string;
  rationale: string;
  priority: "critical" | "high" | "medium" | "low";
};
type OrchestratorCarryForward = {
  facts: string[];
  openQuestions: string[];
  projectPaths: string[];
  evidenceSummaries: string[];
};
type OrchestratorRunDetail = {
  run: {
    id: string;
    goal: string;
    status: RunStatus;
    continuedFromRunId?: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
  };
  nodes: OrchestratorPlanNode[];
  events: OrchestratorEvent[];
  workingMemory: OrchestratorWorkingMemory;
  evidenceBundles: Array<{ summary: string }>;
  finalReport?: {
    summary: string;
    outcomes: string[];
    unresolvedRisks: string[];
    nextActions?: OrchestratorNextAction[];
    carryForward?: OrchestratorCarryForward;
  };
};
type OrchestratorRunResponse =
  | {
    status: "completed";
    detail: OrchestratorRunDetail;
  }
  | {
    status: "cancelled";
    detail: OrchestratorRunDetail;
  }
  | {
    status: "login_required";
    missingToolIds: ManagedToolId[];
    loginSessions: SessionInfo[];
  };

type OrchestratorProgressTone = "idle" | "active" | "done" | "failed" | "paused" | "escalated";
type OrchestratorDetailTab = "node" | "memory";
type OrchestratorNodeProgressStepState = "done" | "active" | "pending" | "failed";
type OrchestratorNodeProgressStep = {
  phase: string;
  label: string;
  state: OrchestratorNodeProgressStepState;
  detail: string;
};
type OrchestratorNodeProgressView = {
  tone: OrchestratorProgressTone;
  summary: string;
  detail: string;
  objective: string;
  model: string;
  executionStatus: string;
  elapsed: string;
  updatedAt: string;
  completionRatio: number;
  steps: OrchestratorNodeProgressStep[];
};
type SelectedNodeLiveView = {
  status: string;
  progress: OrchestratorNodeProgressView | null;
  terminal: string;
  log: string;
  hasLog: boolean;
  requestJson: string;
  responseJson: string;
  executionPlan: string;
  hasExecutionPlan: boolean;
  pendingApproval: OrchestratorPendingApproval | null;
  pendingUserInput: OrchestratorPendingUserInput | null;
};

const DEFAULT_ORCHESTRATOR_MAX_DEPTH = 2;
const MIN_ORCHESTRATOR_MAX_DEPTH = 1;
const MAX_ORCHESTRATOR_MAX_DEPTH = 6;

type TasksawApi = {
  createSession(input: {
    kind: SessionKind;
    cwd: string;
    title?: string;
    commandText?: string;
    hidden?: boolean;
    workspaceAccessDialog?: DirectoryDialogOptions;
  }): Promise<SessionInfo | null>;
  listSessions(): Promise<SessionInfo[]>;
  updateManagedTools(): Promise<ManagedToolStatus[]>;
  getManagedToolStatuses(): Promise<ManagedToolStatus[]>;
  resetAppState(): Promise<void>;
  runOrchestrator(input: {
    goal: string;
    mode: OrchestratorMode;
    language?: LanguageCode;
    continuationMode?: OrchestratorContinuationMode | null;
    nextActionIndex?: number | null;
    maxDepth?: number | null;
    workspacePath?: string | null;
    continueFromRunId?: string | null;
    workspaceAccessDialog?: DirectoryDialogOptions;
  }): Promise<OrchestratorRunResponse | null>;
  cancelOrchestratorRun(runId: string): Promise<boolean>;
  respondOrchestratorApproval(input: {
    requestId: string;
    optionId?: string | null;
    approved: boolean;
  }): Promise<boolean>;
  respondOrchestratorUserInput(input: {
    requestId: string;
    submitted: boolean;
    answers?: Record<string, string[]>;
  }): Promise<boolean>;
  respondOrchestratorInteractiveSession(input: {
    requestId: string;
    outcome: "completed" | "terminated" | "cancelled" | "failed";
    sessionId?: string | null;
    exitCode?: number | null;
    signal?: number | null;
    transcript?: string | null;
  }): Promise<boolean>;
  listOrchestratorRuns(): Promise<OrchestratorRunSummary[]>;
  getOrchestratorRun(runId: string): Promise<OrchestratorRunDetail>;
  selectDirectory(options?: DirectoryDialogOptions): Promise<string | null>;
  createDirectory(options?: DirectoryDialogOptions): Promise<string | null>;
  writeTerminal(sessionId: string, data: string): void;
  resizeTerminal(sessionId: string, cols: number, rows: number): void;
  killSession(sessionId: string): void;
  onTerminalData(handler: (payload: TerminalDataPayload) => void): void;
  onTerminalExit(handler: (payload: TerminalExitPayload) => void): void;
  onOrchestratorEvent(handler: (payload: OrchestratorEvent) => void): void;
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
      themeLight: "Light",
      themeDark: "Dark",
      languageEnglish: "English",
      languageKorean: "Korean",
      emptyState: "Choose a workspace, then create a terminal",
      openDialogTitle: "Open workspace",
      openDialogButton: "Open Folder",
      createDialogTitle: "Create workspace",
      createDialogButton: "Create Folder",
      permissionDialogTitle: "Grant workspace access",
      permissionDialogButton: "Grant Access",
      permissionDialogMessage: "TaskSaw needs folder access before starting this terminal. Select the workspace folder.",
      toolsUpdate: "Update AI Tools",
      resetApp: "Reset All Data",
      resetAppConfirm: "Delete all TaskSaw records and log out managed tool sessions? This cannot be undone.",
      orchestratorTitle: "Orchestrator",
      orchestratorSubtitle: "Run the ordered DFS orchestrator with the live Gemini and Codex CLI model catalogs and inspect node prompts.",
      orchestratorGoalLabel: "Goal",
      orchestratorModeLabel: "Mode",
      orchestratorDepthLabel: "Max Depth",
      orchestratorModeCrossReview: "Cross Review: live Codex + live Gemini",
      orchestratorModeGeminiOnly: "Gemini Only: live Gemini model",
      orchestratorModeCodexOnly: "Codex Only: live Codex model",
      orchestratorGoalPlaceholder: "Describe the task you want the orchestrator to run",
      orchestratorRun: "Run Orchestrator",
      orchestratorStop: "Stop Run",
      orchestratorContinue: "Resume Selected",
      orchestratorRunNextAction: "Run Next Action",
      orchestratorResumeTooltip: "Resume the selected run with the same goal. TaskSaw reuses the previous run's full evidence bundles, working memory, and project structure so the orchestrator can continue from the same local context.",
      orchestratorRunNextActionTooltip: "Start a new run from the selected review handoff task. TaskSaw uses the selected next action objective as the new goal and carries forward only the trimmed handoff memory that the previous review marked as relevant.",
      orchestratorRefresh: "Refresh Runs",
      orchestratorRunsTitle: "Recent Runs",
      orchestratorDetailTitle: "Run Detail",
      orchestratorDetailTabNode: "Node Detail",
      orchestratorDetailTabMemory: "Working Memory",
      orchestratorDetailCopy: "Copy",
      orchestratorOpenViewer: "Large View",
      orchestratorNodeLiveTitle: "Selected Node Live",
      orchestratorNodeRequestTitle: "Request JSON",
      orchestratorNodeResponseTitle: "Response JSON",
      orchestratorNodePlanTitle: "Execution Plan",
      orchestratorNodeTerminalTitle: "Interaction Terminal",
      orchestratorNodeProgressCurrent: "Current Work",
      orchestratorNodeProgressObjective: "Objective",
      orchestratorNodeProgressModel: "Active Model",
      orchestratorNodeProgressExecution: "Execution",
      orchestratorNodeProgressElapsed: "Elapsed",
      orchestratorNodeProgressUpdated: "Latest Update",
      orchestratorNodeProgressTrack: "Phase Track",
      orchestratorNodeCommandTitle: "Command",
      orchestratorNodeLogTitle: "Node Log",
      orchestratorApprovalTitle: "Approval Required",
      orchestratorApprovalWaiting: "Waiting for input",
      orchestratorApprovalApprove: "Approve",
      orchestratorApprovalDeny: "Deny",
      orchestratorApprovalReview: "Review",
      orchestratorApprovalAlert: "Approval request received",
      orchestratorApprovalQueueButton: "Input Waiting ({count})",
      orchestratorPendingApprovalsTitle: "Input Waiting",
      orchestratorPendingApprovalsEmpty: "No pending approval requests.",
      orchestratorNextActionsTitle: "Review Next Actions",
      orchestratorNextActionsEmpty: "No review-derived next actions are available for this run yet.",
      orchestratorApprovalEmpty: "No pending approval request.",
      orchestratorUserInputTitle: "Input Required",
      orchestratorUserInputWaiting: "Waiting for response",
      orchestratorUserInputSubmit: "Submit",
      orchestratorUserInputCancel: "Cancel",
      orchestratorUserInputEmpty: "No pending input request.",
      interactiveSessionTitle: "Interactive Session",
      interactiveSessionStarting: "Starting",
      interactiveSessionRunning: "Running",
      interactiveSessionFailed: "Failed",
      interactiveSessionTerminated: "Terminated",
      interactiveSessionCompleted: "Completed",
      interactiveSessionTerminate: "Terminate",
      interactiveSessionClose: "Close",
      interactiveSessionCommandEmpty: "No interactive command recorded.",
      orchestratorUserInputPlaceholder: "Type your response",
      orchestratorUserInputOtherLabel: "Other",
      orchestratorWorkingMemoryTitle: "Working Memory",
      orchestratorWorkingMemoryEmpty: "No working-memory entries yet.",
      orchestratorWorkingMemoryFacts: "Facts",
      orchestratorWorkingMemoryOpenQuestions: "Open Questions",
      orchestratorWorkingMemoryUnknowns: "Unknowns",
      orchestratorWorkingMemoryConflicts: "Conflicts",
      orchestratorWorkingMemoryDecisions: "Decisions",
      orchestratorLogTitle: "Orchestrator Log",
      orchestratorTreeTitle: "Node Graph",
      orchestratorTreeEmpty: "No nodes yet.",
      orchestratorTreeMeta: "{count} nodes",
      orchestratorSelectedNodeTitle: "Selected Node",
      orchestratorSelectedNodeEvents: "Node Events",
      orchestratorNoRuns: "No orchestrator runs yet.",
      orchestratorNoDetail: "Select a run to inspect its nodes, live command flow, and working memory.",
      orchestratorNodeLiveEmpty: "Select a node to inspect its live command flow.",
      orchestratorNodeRequestEmpty: "No node request JSON yet.",
      orchestratorNodeResponseEmpty: "No node response payloads yet.",
      orchestratorNodePlanEmpty: "No execution plan has been produced for this node yet.",
      orchestratorNodeCommandEmpty: "No command has been dispatched yet.",
      orchestratorNodeTerminalEmpty: "Select a node to inspect its live interaction stream.",
      orchestratorNodeLogEmpty: "No node events yet.",
      orchestratorLogEmpty: "No orchestrator events yet.",
      orchestratorNextActionSelected: "Selected",
      orchestratorNextActionPriority: "{priority} priority",
      orchestratorCarryForwardSummary: "Trimmed handoff: {facts} facts, {questions} open questions, {paths} project paths, {evidence} evidence bundles",
      orchestratorCommandStatusIdle: "Queued",
      orchestratorCommandStatusDispatched: "Dispatched",
      orchestratorCommandStatusResponded: "Response received",
      orchestratorCommandStatusFailed: "Failed",
      workspaceTabsLabel: "Workspace Tabs",
      openOrchestratorTab: "Open Orchestrator",
      focusOrchestratorTab: "Focus Orchestrator",
      noOpenTabsTitle: "No open tabs",
      noOpenTabsCopy: "Open the orchestrator tab or start a terminal session.",
      logViewerTitle: "Log Viewer",
      close: "Close",
      statusLive: "live",
      statusExited: "exited"
    },
    logs: {
      workspaceReady: "workspace ready: {cwd}",
      preparingTool: "preparing {tool}…",
      toolsUpdated: "managed tools updated: {details}",
      created: "created: {title} @ {cwd}",
      closed: "closed: {title} @ {cwd}",
      exited: "session exited: {sessionId} (code={exitCode}, signal={signal})",
      resetStarted: "resetting TaskSaw data…",
      resetCompleted: "TaskSaw data reset completed",
      orchestratorRunning: "running {mode} orchestrator…",
      orchestratorStopping: "stopping orchestrator run: {runId}",
      orchestratorCancelled: "orchestrator run cancelled: {runId}",
      orchestratorCompleted: "orchestrator run completed: {runId}",
      orchestratorLoaded: "loaded orchestrator run: {runId}",
      orchestratorDetailCopied: "run detail copied",
      clipboardCopied: "{title} copied"
    },
    errors: {
      selectFolder: "Select the workspace folder first.",
      failedCreate: "Failed to create {kind} session: {message}",
      failedRestore: "Failed to restore sessions: {message}",
      failedXterm: "Renderer failed to initialize xterm",
      failedReset: "Failed to reset TaskSaw data: {message}",
      orchestratorGoalMissing: "Enter an orchestrator goal first.",
      orchestratorContinueMissing: "Select an orchestrator run to continue.",
      orchestratorNextActionMissing: "Select a review next action from the selected run first.",
      orchestratorWorkspaceMissing: "Select the workspace folder before running the orchestrator.",
      orchestratorStopUnavailable: "There is no active orchestrator run to stop.",
      orchestratorLoginRequired: "Missing login session for {tools}. Log in from a TaskSaw terminal tab, then retry.",
      failedOrchestratorRun: "Failed to run orchestrator: {message}",
      failedOrchestratorStop: "Failed to stop orchestrator: {message}",
      failedLoadOrchestratorRuns: "Failed to load orchestrator runs: {message}",
      failedCopyOrchestratorDetail: "Failed to copy run detail: {message}",
      failedCopyClipboard: "Failed to copy {title}: {message}"
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
      themeLight: "라이트",
      themeDark: "다크",
      languageEnglish: "영어",
      languageKorean: "한국어",
      emptyState: "워크스페이스를 고른 뒤 터미널을 만드세요",
      openDialogTitle: "워크스페이스 열기",
      openDialogButton: "폴더 열기",
      createDialogTitle: "워크스페이스 만들기",
      createDialogButton: "폴더 만들기",
      permissionDialogTitle: "워크스페이스 접근 권한 부여",
      permissionDialogButton: "권한 부여",
      permissionDialogMessage: "이 터미널을 시작하려면 TaskSaw가 폴더 접근 권한을 받아야 합니다. 워크스페이스 폴더를 선택하세요.",
      toolsUpdate: "AI 도구 업데이트",
      resetApp: "전체 초기화",
      resetAppConfirm: "TaskSaw의 모든 기록을 삭제하고 관리형 도구 로그인 세션도 종료합니다. 되돌릴 수 없습니다.",
      orchestratorTitle: "오케스트레이터",
      orchestratorSubtitle: "실시간 Gemini/Codex CLI 모델 카탈로그를 사용해 ordered DFS orchestrator를 실행하고 노드 프롬프트를 확인합니다.",
      orchestratorGoalLabel: "목표",
      orchestratorModeLabel: "모드",
      orchestratorDepthLabel: "최대 깊이",
      orchestratorModeCrossReview: "상호 리뷰: 실시간 Codex + 실시간 Gemini",
      orchestratorModeGeminiOnly: "Gemini 단독: 실시간 Gemini 모델",
      orchestratorModeCodexOnly: "Codex 단독: 실시간 Codex 모델",
      orchestratorGoalPlaceholder: "오케스트레이터가 수행할 작업을 입력하세요",
      orchestratorRun: "오케스트레이터 실행",
      orchestratorStop: "실행 중단",
      orchestratorContinue: "같은 목표 재개",
      orchestratorRunNextAction: "다음 과제 실행",
      orchestratorResumeTooltip: "선택한 실행을 같은 목표로 다시 이어서 시작합니다. 이전 실행의 evidence bundle, working memory, project structure를 그대로 승계해 같은 로컬 맥락에서 재개합니다.",
      orchestratorRunNextActionTooltip: "선택한 리뷰 handoff의 다음 과제를 새 목표로 시작합니다. 이전 리뷰가 중요하다고 표시한 축약 메모리만 승계해 다음 작업에 맞는 가벼운 컨텍스트로 이어갑니다.",
      orchestratorRefresh: "실행 목록 새로고침",
      orchestratorRunsTitle: "최근 실행",
      orchestratorDetailTitle: "실행 상세",
      orchestratorDetailTabNode: "노드 상세",
      orchestratorDetailTabMemory: "워킹 메모리",
      orchestratorDetailCopy: "복사",
      orchestratorOpenViewer: "크게 보기",
      orchestratorNodeLiveTitle: "선택 노드 실시간 상태",
      orchestratorNodeRequestTitle: "요청 JSON",
      orchestratorNodeResponseTitle: "응답 JSON",
      orchestratorNodePlanTitle: "실행 계획",
      orchestratorNodeTerminalTitle: "상호작용 터미널",
      orchestratorNodeProgressCurrent: "현재 작업",
      orchestratorNodeProgressObjective: "목표",
      orchestratorNodeProgressModel: "실행 모델",
      orchestratorNodeProgressExecution: "실행 상태",
      orchestratorNodeProgressElapsed: "경과 시간",
      orchestratorNodeProgressUpdated: "최근 업데이트",
      orchestratorNodeProgressTrack: "단계 진행",
      orchestratorNodeCommandTitle: "전달 명령",
      orchestratorNodeLogTitle: "노드 로그",
      orchestratorApprovalTitle: "승인 요청",
      orchestratorApprovalWaiting: "입력 대기 중",
      orchestratorApprovalApprove: "승인",
      orchestratorApprovalDeny: "거절",
      orchestratorApprovalReview: "열기",
      orchestratorApprovalAlert: "승인 요청이 도착했습니다",
      orchestratorApprovalQueueButton: "입력 대기중 ({count})",
      orchestratorPendingApprovalsTitle: "입력 대기중",
      orchestratorPendingApprovalsEmpty: "대기 중인 승인 요청이 없습니다.",
      orchestratorNextActionsTitle: "리뷰 다음 과제",
      orchestratorNextActionsEmpty: "이 실행에는 리뷰에서 정리된 다음 과제가 아직 없습니다.",
      orchestratorApprovalEmpty: "대기 중인 승인 요청이 없습니다.",
      orchestratorUserInputTitle: "입력 요청",
      orchestratorUserInputWaiting: "응답 대기 중",
      orchestratorUserInputSubmit: "제출",
      orchestratorUserInputCancel: "취소",
      orchestratorUserInputEmpty: "대기 중인 입력 요청이 없습니다.",
      interactiveSessionTitle: "대화형 세션",
      interactiveSessionStarting: "시작 중",
      interactiveSessionRunning: "실행 중",
      interactiveSessionFailed: "실패",
      interactiveSessionTerminated: "종료됨",
      interactiveSessionCompleted: "완료됨",
      interactiveSessionTerminate: "강제 종료",
      interactiveSessionClose: "닫기",
      interactiveSessionCommandEmpty: "기록된 대화형 명령이 없습니다.",
      orchestratorUserInputPlaceholder: "응답을 입력하세요",
      orchestratorUserInputOtherLabel: "직접 입력",
      orchestratorWorkingMemoryTitle: "워킹 메모리",
      orchestratorWorkingMemoryEmpty: "아직 working memory 항목이 없습니다.",
      orchestratorWorkingMemoryFacts: "사실",
      orchestratorWorkingMemoryOpenQuestions: "열린 질문",
      orchestratorWorkingMemoryUnknowns: "미확인 항목",
      orchestratorWorkingMemoryConflicts: "충돌",
      orchestratorWorkingMemoryDecisions: "결정",
      orchestratorLogTitle: "오케스트레이터 로그",
      orchestratorTreeTitle: "노드 그래프",
      orchestratorTreeEmpty: "아직 생성된 노드가 없습니다.",
      orchestratorTreeMeta: "노드 {count}개",
      orchestratorSelectedNodeTitle: "선택한 노드",
      orchestratorSelectedNodeEvents: "노드 이벤트",
      orchestratorNoRuns: "아직 오케스트레이터 실행이 없습니다.",
      orchestratorNoDetail: "실행 하나를 선택하면 노드, 실시간 명령 흐름, working memory를 볼 수 있습니다.",
      orchestratorNodeLiveEmpty: "노드를 선택하면 명령 전달 상태와 실시간 로그를 볼 수 있습니다.",
      orchestratorNodeRequestEmpty: "아직 노드 요청 JSON이 없습니다.",
      orchestratorNodeResponseEmpty: "아직 노드 응답 payload가 없습니다.",
      orchestratorNodePlanEmpty: "이 노드에는 아직 실행 계획이 만들어지지 않았습니다.",
      orchestratorNodeCommandEmpty: "아직 전달된 명령이 없습니다.",
      orchestratorNodeTerminalEmpty: "노드를 선택하면 실시간 상호작용 흐름을 볼 수 있습니다.",
      orchestratorNodeLogEmpty: "아직 노드 이벤트가 없습니다.",
      orchestratorLogEmpty: "아직 오케스트레이터 이벤트가 없습니다.",
      orchestratorNextActionSelected: "선택됨",
      orchestratorNextActionPriority: "{priority} 우선순위",
      orchestratorCarryForwardSummary: "축약 handoff: 사실 {facts}개, 열린 질문 {questions}개, 프로젝트 경로 {paths}개, 근거 번들 {evidence}개",
      orchestratorCommandStatusIdle: "대기 중",
      orchestratorCommandStatusDispatched: "전달됨",
      orchestratorCommandStatusResponded: "응답 수신",
      orchestratorCommandStatusFailed: "실패",
      workspaceTabsLabel: "워크스페이스 탭",
      openOrchestratorTab: "오케스트레이터 열기",
      focusOrchestratorTab: "오케스트레이터 보기",
      noOpenTabsTitle: "열린 탭이 없습니다",
      noOpenTabsCopy: "오케스트레이터 탭을 열거나 터미널 세션을 시작하세요.",
      logViewerTitle: "로그 보기",
      close: "닫기",
      statusLive: "실행 중",
      statusExited: "종료됨"
    },
    logs: {
      workspaceReady: "워크스페이스 준비됨: {cwd}",
      preparingTool: "{tool} 준비 중…",
      toolsUpdated: "관리형 도구 업데이트 완료: {details}",
      created: "생성됨: {title} @ {cwd}",
      closed: "닫힘: {title} @ {cwd}",
      exited: "세션 종료: {sessionId} (code={exitCode}, signal={signal})",
      resetStarted: "TaskSaw 데이터를 초기화하는 중…",
      resetCompleted: "TaskSaw 데이터 초기화 완료",
      orchestratorRunning: "{mode} 오케스트레이터 실행 중…",
      orchestratorStopping: "오케스트레이터 실행 중단 중: {runId}",
      orchestratorCancelled: "오케스트레이터 실행 중단됨: {runId}",
      orchestratorCompleted: "오케스트레이터 실행 완료: {runId}",
      orchestratorLoaded: "오케스트레이터 실행 로드됨: {runId}",
      orchestratorDetailCopied: "실행 상세를 복사했습니다",
      clipboardCopied: "{title} 내용을 복사했습니다"
    },
    errors: {
      selectFolder: "먼저 워크스페이스 폴더를 선택하세요.",
      failedCreate: "{kind} 세션 생성 실패: {message}",
      failedRestore: "세션 복원 실패: {message}",
      failedXterm: "renderer에서 xterm 초기화에 실패했습니다",
      failedReset: "TaskSaw 데이터 초기화 실패: {message}",
      orchestratorGoalMissing: "먼저 오케스트레이터 목표를 입력하세요.",
      orchestratorContinueMissing: "이어갈 오케스트레이터 실행을 먼저 선택하세요.",
      orchestratorNextActionMissing: "선택한 실행에서 리뷰 다음 과제를 먼저 고르세요.",
      orchestratorWorkspaceMissing: "오케스트레이터를 실행하기 전에 워크스페이스 폴더를 선택하세요.",
      orchestratorStopUnavailable: "중단할 활성 오케스트레이터 실행이 없습니다.",
      orchestratorLoginRequired: "{tools} 로그인 세션이 없습니다. TaskSaw 터미널에서 로그인한 뒤 다시 실행하세요.",
      failedOrchestratorRun: "오케스트레이터 실행 실패: {message}",
      failedOrchestratorStop: "오케스트레이터 중단 실패: {message}",
      failedLoadOrchestratorRuns: "오케스트레이터 실행 목록 로드 실패: {message}",
      failedCopyOrchestratorDetail: "실행 상세 복사 실패: {message}",
      failedCopyClipboard: "{title} 내용을 복사하지 못했습니다: {message}"
    },
    kinds: {
      shell: "쉘",
      codex: "코덱스",
      gemini: "제미나이"
    }
  }
} as const;

const appWindow = window as unknown as RendererWindow;

const layoutEl = document.getElementById("layout") as HTMLDivElement;
const sidebarEl = document.getElementById("sidebar") as HTMLElement;
const workspaceLabelEl = document.getElementById("workspace-label") as HTMLSpanElement;
const workspacePathEl = document.getElementById("workspace-path") as HTMLElement;
const workspaceOpenButton = document.getElementById("workspace-open") as HTMLButtonElement;
const workspaceCreateButton = document.getElementById("workspace-create") as HTMLButtonElement;
const newShellButton = document.getElementById("new-shell") as HTMLButtonElement;
const newCodexButton = document.getElementById("new-codex") as HTMLButtonElement;
const codexUsageEl = document.getElementById("codex-usage") as HTMLSpanElement;
const newGeminiButton = document.getElementById("new-gemini") as HTMLButtonElement;
const geminiUsageEl = document.getElementById("gemini-usage") as HTMLSpanElement;
const autoApproveCheckbox = document.getElementById("auto-approve-checkbox") as HTMLInputElement;
const approvalQueueButton = document.getElementById("approval-queue-button") as HTMLButtonElement;
const toolsUpdateButton = document.getElementById("tools-update") as HTMLButtonElement;
const resetAppButton = document.getElementById("app-reset") as HTMLButtonElement;
const sessionSectionTitle = document.getElementById("session-section-title") as HTMLDivElement;
const sessionListEl = document.getElementById("session-list") as HTMLUListElement;
const orchestratorTitleEl = document.getElementById("orchestrator-title") as HTMLDivElement;
const orchestratorSubtitleEl = document.getElementById("orchestrator-subtitle") as HTMLDivElement;
const orchestratorGoalLabelEl = document.getElementById("orchestrator-goal-label") as HTMLSpanElement;
const orchestratorModeLabelEl = document.getElementById("orchestrator-mode-label") as HTMLSpanElement;
const orchestratorDepthLabelEl = document.getElementById("orchestrator-depth-label") as HTMLSpanElement;
const orchestratorGoalInput = document.getElementById("orchestrator-goal") as HTMLTextAreaElement;
const orchestratorModeSelect = document.getElementById("orchestrator-mode") as HTMLSelectElement;
const orchestratorDepthInput = document.getElementById("orchestrator-depth") as HTMLInputElement;
const orchestratorRefreshButton = document.getElementById("orchestrator-refresh") as HTMLButtonElement;
const orchestratorStopButton = document.getElementById("orchestrator-stop") as HTMLButtonElement;
const orchestratorContinueButton = document.getElementById("orchestrator-continue") as HTMLButtonElement;
const orchestratorRunNextActionButton = document.getElementById("orchestrator-run-next-action") as HTMLButtonElement;
const orchestratorRunButton = document.getElementById("orchestrator-run") as HTMLButtonElement;
const orchestratorRunsTitleEl = document.getElementById("orchestrator-runs-title") as HTMLDivElement;
const orchestratorRunListEl = document.getElementById("orchestrator-run-list") as HTMLUListElement;
const orchestratorDetailTitleEl = document.getElementById("orchestrator-detail-title") as HTMLDivElement;
const orchestratorDetailTabNodeButton = document.getElementById("orchestrator-detail-tab-node") as HTMLButtonElement;
const orchestratorDetailTabMemoryButton = document.getElementById("orchestrator-detail-tab-memory") as HTMLButtonElement;
const orchestratorNextActionsEl = document.getElementById("orchestrator-next-actions") as HTMLElement;
const orchestratorNextActionsTitleEl = document.getElementById("orchestrator-next-actions-title") as HTMLDivElement;
const orchestratorNextActionsStatusEl = document.getElementById("orchestrator-next-actions-status") as HTMLSpanElement;
const orchestratorNextActionsSummaryEl = document.getElementById("orchestrator-next-actions-summary") as HTMLDivElement;
const orchestratorNextActionsListEl = document.getElementById("orchestrator-next-actions-list") as HTMLDivElement;
const orchestratorDetailPanelNodeEl = document.getElementById("orchestrator-detail-panel-node") as HTMLElement;
const orchestratorDetailPanelMemoryEl = document.getElementById("orchestrator-detail-panel-memory") as HTMLElement;
const orchestratorNodeLiveTitleEl = document.getElementById("orchestrator-node-live-title") as HTMLDivElement;
const orchestratorNodeLiveStatusEl = document.getElementById("orchestrator-node-live-status") as HTMLSpanElement;
const orchestratorNodeLiveMetaEl = document.getElementById("orchestrator-node-live-meta") as HTMLDivElement;
const orchestratorPendingApprovalsEl = document.getElementById("orchestrator-pending-approvals") as HTMLElement;
const orchestratorPendingApprovalsTitleEl = document.getElementById("orchestrator-pending-approvals-title") as HTMLDivElement;
const orchestratorPendingApprovalsStatusEl = document.getElementById("orchestrator-pending-approvals-status") as HTMLSpanElement;
const orchestratorPendingApprovalsListEl = document.getElementById("orchestrator-pending-approvals-list") as HTMLDivElement;
const orchestratorNodeApprovalEl = document.getElementById("orchestrator-node-approval") as HTMLElement;
const orchestratorNodeApprovalTitleEl = document.getElementById("orchestrator-node-approval-title") as HTMLDivElement;
const orchestratorNodeApprovalStatusEl = document.getElementById("orchestrator-node-approval-status") as HTMLSpanElement;
const orchestratorNodeApprovalMessageEl = document.getElementById("orchestrator-node-approval-message") as HTMLDivElement;
const orchestratorNodeApprovalDetailsEl = document.getElementById("orchestrator-node-approval-details") as HTMLPreElement;
const orchestratorNodeApprovalActionsEl = document.getElementById("orchestrator-node-approval-actions") as HTMLDivElement;
const orchestratorNodeUserInputEl = document.getElementById("orchestrator-node-user-input") as HTMLElement;
const orchestratorNodeUserInputTitleEl = document.getElementById("orchestrator-node-user-input-title") as HTMLDivElement;
const orchestratorNodeUserInputStatusEl = document.getElementById("orchestrator-node-user-input-status") as HTMLSpanElement;
const orchestratorNodeUserInputMessageEl = document.getElementById("orchestrator-node-user-input-message") as HTMLDivElement;
const orchestratorNodeUserInputFormEl = document.getElementById("orchestrator-node-user-input-form") as HTMLFormElement;
const orchestratorNodeUserInputActionsEl = document.getElementById("orchestrator-node-user-input-actions") as HTMLDivElement;
const orchestratorNodeRequestOpenButton = document.getElementById("orchestrator-node-request-open") as HTMLButtonElement;
const orchestratorNodeResponseOpenButton = document.getElementById("orchestrator-node-response-open") as HTMLButtonElement;
const orchestratorNodePlanOpenButton = document.getElementById("orchestrator-node-plan-open") as HTMLButtonElement;
const orchestratorNodeTerminalTitleEl = document.getElementById("orchestrator-node-terminal-title") as HTMLDivElement;
const orchestratorNodeTerminalOpenButton = document.getElementById("orchestrator-node-terminal-open") as HTMLButtonElement;
const orchestratorNodeTerminalCopyButton = document.getElementById("orchestrator-node-terminal-copy") as HTMLButtonElement;
const orchestratorNodeTerminalEl = document.getElementById("orchestrator-node-terminal") as HTMLDivElement;
const orchestratorNodeLogOpenButton = document.getElementById("orchestrator-node-log-open") as HTMLButtonElement;
const orchestratorNodeLogEl = document.getElementById("orchestrator-node-log") as HTMLPreElement;
const orchestratorNodeRequestDataEl = document.getElementById("orchestrator-node-request-data") as HTMLPreElement;
const orchestratorNodeResponseDataEl = document.getElementById("orchestrator-node-response-data") as HTMLPreElement;
const orchestratorNodePlanDataEl = document.getElementById("orchestrator-node-plan-data") as HTMLPreElement;
const orchestratorWorkingMemoryTitleEl = document.getElementById("orchestrator-working-memory-title") as HTMLDivElement;
const orchestratorWorkingMemoryOpenButton = document.getElementById("orchestrator-working-memory-open") as HTMLButtonElement;
const orchestratorWorkingMemoryCopyButton = document.getElementById("orchestrator-working-memory-copy") as HTMLButtonElement;
const orchestratorWorkingMemoryEl = document.getElementById("orchestrator-working-memory") as HTMLPreElement;
const orchestratorLogTitleEl = document.getElementById("orchestrator-log-title") as HTMLDivElement;
const orchestratorLogOpenButton = document.getElementById("orchestrator-log-open") as HTMLButtonElement;
const orchestratorLogCopyButton = document.getElementById("orchestrator-log-copy") as HTMLButtonElement;
const orchestratorLogEl = document.getElementById("orchestrator-log") as HTMLPreElement;
const orchestratorTreeTitleEl = document.getElementById("orchestrator-tree-title") as HTMLDivElement;
const orchestratorTreeMetaEl = document.getElementById("orchestrator-tree-meta") as HTMLSpanElement;
const orchestratorTreeEl = document.getElementById("orchestrator-tree") as HTMLDivElement;
const mainEl = document.getElementById("main") as HTMLElement;
const workspaceTabsEl = document.getElementById("workspace-tabs") as HTMLDivElement;
const workspaceOpenOrchestratorButton = document.getElementById("workspace-open-orchestrator") as HTMLButtonElement;
const workspaceEmptyEl = document.getElementById("workspace-empty") as HTMLElement;
const workspaceEmptyTitleEl = document.getElementById("workspace-empty-title") as HTMLDivElement;
const workspaceEmptyCopyEl = document.getElementById("workspace-empty-copy") as HTMLParagraphElement;
const workspaceEmptyOpenOrchestratorButton = document.getElementById("workspace-empty-open-orchestrator") as HTMLButtonElement;
const logViewerDialogEl = document.getElementById("log-viewer-dialog") as HTMLDivElement;
const logViewerTitleEl = document.getElementById("log-viewer-title") as HTMLDivElement;
const logViewerCopyButton = document.getElementById("log-viewer-copy") as HTMLButtonElement;
const logViewerCloseButton = document.getElementById("log-viewer-close") as HTMLButtonElement;
const logViewerContentEl = document.getElementById("log-viewer-content") as HTMLPreElement;
const approvalDialogEl = document.getElementById("approval-dialog") as HTMLDivElement;
const approvalDialogTitleEl = document.getElementById("approval-dialog-title") as HTMLDivElement;
const approvalDialogStatusEl = document.getElementById("approval-dialog-status") as HTMLSpanElement;
const approvalDialogCloseButton = document.getElementById("approval-dialog-close") as HTMLButtonElement;
const approvalDialogListEl = document.getElementById("approval-dialog-list") as HTMLDivElement;
const approvalDialogMessageEl = document.getElementById("approval-dialog-message") as HTMLDivElement;
const approvalDialogDetailsEl = document.getElementById("approval-dialog-details") as HTMLPreElement;
const approvalDialogActionsEl = document.getElementById("approval-dialog-actions") as HTMLDivElement;
const interactiveSessionDialogEl = document.getElementById("interactive-session-dialog") as HTMLDivElement;
const interactiveSessionDialogTitleEl = document.getElementById("interactive-session-dialog-title") as HTMLDivElement;
const interactiveSessionDialogStatusEl = document.getElementById("interactive-session-dialog-status") as HTMLSpanElement;
const interactiveSessionDialogTerminateButton = document.getElementById("interactive-session-dialog-terminate") as HTMLButtonElement;
const interactiveSessionDialogCloseButton = document.getElementById("interactive-session-dialog-close") as HTMLButtonElement;
const interactiveSessionDialogMessageEl = document.getElementById("interactive-session-dialog-message") as HTMLDivElement;
const interactiveSessionDialogCommandEl = document.getElementById("interactive-session-dialog-command") as HTMLPreElement;
const interactiveSessionDialogTerminalEl = document.getElementById("interactive-session-dialog-terminal") as HTMLDivElement;
const approvalToastContainerEl = document.getElementById("approval-toast-container") as HTMLDivElement;
const mainSplitterEl = document.getElementById("main-splitter") as HTMLDivElement;
const terminalRoot = document.getElementById("terminal-root") as HTMLDivElement;
const logbarMessageEl = document.getElementById("logbar-message") as HTMLDivElement;
const themeSwitcher = document.getElementById("theme-switcher") as HTMLDivElement;
const languageSwitcher = document.getElementById("language-switcher") as HTMLDivElement;
const themeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-theme-option]"));
const languageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-language-option]"));

const terminals = new Map<string, XtermTerminal>();
const terminalPanes = new Map<string, HTMLElement>();
const terminalContainers = new Map<string, HTMLDivElement>();
const sessionStatusBadges = new Map<string, HTMLSpanElement>();
const sessionKindBadges = new Map<string, HTMLSpanElement>();
const sessionCloseButtons = new Map<string, HTMLButtonElement>();
const terminalDimensions = new Map<string, { cols: number; rows: number }>();
const pendingInteractiveSessions = new Map<string, OrchestratorPendingInteractiveSession>();
const sessions: SessionInfo[] = [];
const orchestratorRuns: OrchestratorRunSummary[] = [];
const selectedNextActionIndexByRun = new Map<string, number>();

const THEME_STORAGE_KEY = "tasksaw-theme";
const WORKSPACE_STORAGE_KEY = "tasksaw-last-workspace";
const LANGUAGE_STORAGE_KEY = "tasksaw-language";
const MAIN_SPLITTER_RATIO_STORAGE_KEY = "tasksaw-main-splitter-ratio";
const MAIN_SPLITTER_MIN_RATIO = 0;
const MAIN_SPLITTER_MAX_RATIO = 1;
const ORCHESTRATOR_NODE_LOG_EVENT_LIMIT = 24;
const ORCHESTRATOR_RUN_LOG_EVENT_LIMIT = 180;
const ORCHESTRATOR_PHASE_TRACK = [
  "abstract_plan",
  "gather",
  "evidence_consolidation",
  "concrete_plan",
  "execute",
  "verify",
  "review"
] as const;
const TASKSAW_PROMPT_MARKER = "TASKSAW_PROMPT_ENVELOPE_JSON";
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
let isToolUpdateRunning = false;
let isResetting = false;
let selectedOrchestratorRunId: string | null = null;
let selectedOrchestratorRun: OrchestratorRunDetail | null = null;
let isOrchestratorRunning = false;
let isOrchestratorStopRequested = false;
let orchestratorMode: OrchestratorMode = "cross_review";
let liveOrchestratorRunId: string | null = null;
let liveOrchestratorRefreshHandle: number | null = null;
let mainSplitterRatio = getInitialMainSplitterRatio();
let orchestratorRenderHandle: number | null = null;
let orchestratorRunListRenderPending = false;
let orchestratorDetailRenderPending = false;
let orchestratorTreeRenderPending = false;
let lastOrchestratorRunListSignature = "";
let lastOrchestratorDetailSignature = "";
let lastOrchestratorTreeSignature = "";
let fitAllSessionsHandle: number | null = null;
let fitOrchestratorNodeTerminalHandle: number | null = null;
let fitOrchestratorNodeTerminalRetryCount = 0;
let activeWorkspaceTabId: string | null = "orchestrator";
let isOrchestratorTabOpen = true;
let selectedOrchestratorNodeId: string | null = null;
let activeOrchestratorDetailTab: OrchestratorDetailTab = "node";
let pendingApprovalActionRequestId: string | null = null;
let pendingUserInputActionRequestId: string | null = null;
let orchestratorElapsedClock = 0;
let orchestratorNodeTerminal: XtermTerminal | null = null;
let orchestratorNodeTerminalText = "";
let orchestratorNodeTerminalRenderKey = "";
let activeLogViewerSource: {
  titleElement: HTMLElement;
  contentElement: HTMLElement;
  emptyMessage: string;
} | null = null;
let activeInteractiveSessionRequestId: string | null = null;
let interactiveSessionTerminal: XtermTerminal | null = null;
let interactiveSessionFitHandle: number | null = null;
let activeApprovalDialogRequestId: string | null = null;
const approvalToasts = new Map<string, ApprovalToast>();
const pendingUserInputDrafts = new Map<string, Record<string, string>>();

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

function translateOrchestratorMode(mode: OrchestratorMode): string {
  if (mode === "gemini_only") {
    return translate("ui.orchestratorModeGeminiOnly");
  }

  if (mode === "codex_only") {
    return translate("ui.orchestratorModeCodexOnly");
  }

  return translate("ui.orchestratorModeCrossReview");
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
  renderMessage(logbarMessageEl, lastLogMessage);
}

function logRaw(message: string) {
  lastLogMessage = { raw: message };
  renderMessage(logbarMessageEl, lastLogMessage);
}

function refreshLogbar() {
  renderMessage(logbarMessageEl, lastLogMessage);
}

function syncDialogBodyState() {
  document.body.classList.toggle(
    "dialog-open",
    !logViewerDialogEl.hidden || !approvalDialogEl.hidden || !interactiveSessionDialogEl.hidden
  );
}

function renderApprovalToastList() {
  approvalToastContainerEl.replaceChildren();

  for (const toast of approvalToasts.values()) {
    const card = document.createElement("div");
    card.className = "toast-card";

    const header = document.createElement("div");
    header.className = "toast-card-header";

    const title = document.createElement("div");
    title.className = "toast-card-title";
    title.textContent = toast.title;

    const status = document.createElement("span");
    status.className = "orchestrator-node-approval-status";
    status.textContent = translate("ui.orchestratorApprovalAlert");

    header.append(title, status);

    const message = document.createElement("div");
    message.className = "toast-card-message";
    message.textContent = toast.message;

    const actions = document.createElement("div");
    actions.className = "toast-card-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "orchestrator-copy-button";
    openButton.textContent = translate("ui.orchestratorApprovalReview");
    openButton.addEventListener("click", () => {
      activeApprovalDialogRequestId = toast.requestId;
      renderApprovalDialog();
    });

    actions.appendChild(openButton);
    card.append(header, message, actions);
    approvalToastContainerEl.appendChild(card);
  }
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return "n/a";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  return date.toLocaleString(languagePreference === "ko" ? "ko-KR" : "en-US", {
    hour12: false
  });
}

function parseIsoTimestamp(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : value;
}

function formatElapsedDuration(startAt: string | null | undefined, endAt?: string | null | undefined): string {
  const startMs = parseIsoTimestamp(startAt);
  if (startMs === null) {
    return languagePreference === "ko" ? "알 수 없음" : "Unknown";
  }

  const endMs = parseIsoTimestamp(endAt ?? null) ?? Date.now();
  const durationMs = Math.max(0, endMs - startMs);
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (languagePreference === "ko") {
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}시간`);
    if (hours > 0 || minutes > 0) parts.push(`${minutes}분`);
    parts.push(`${seconds}초`);
    return parts.join(" ");
  }

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

function truncateText(value: string, maxLength = 320): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

function getRequestedOrchestratorMaxDepth(): number {
  const parsed = Number.parseInt(orchestratorDepthInput.value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ORCHESTRATOR_MAX_DEPTH;
  }

  return Math.min(MAX_ORCHESTRATOR_MAX_DEPTH, Math.max(MIN_ORCHESTRATOR_MAX_DEPTH, parsed));
}

function tryBeautifyJsonString(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return null;
  }

  const looksLikeJson = (
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );

  if (!looksLikeJson) {
    return null;
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

function formatDisplayString(value: string, maxLength = 320): string {
  return truncateText(tryBeautifyJsonString(value) ?? value, maxLength);
}

function formatDisplayValue(value: unknown, maxLength = 320): string {
  if (typeof value === "string") {
    return formatDisplayString(value, maxLength);
  }

  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  return truncateText(JSON.stringify(value, null, 2), maxLength);
}

function createEmptyWorkingMemory(): OrchestratorWorkingMemory {
  return {
    facts: [],
    openQuestions: [],
    unknowns: [],
    conflicts: [],
    decisions: []
  };
}

function deriveRunStatusFromEvent(currentStatus: RunStatus, event: OrchestratorEvent): RunStatus {
  if (event.type === "run_completed") return "done";
  if (event.type === "run_failed") return "failed";
  if (event.type === "run_paused") return "paused";
  if (currentStatus === "done" || currentStatus === "failed" || currentStatus === "paused" || currentStatus === "escalated") return currentStatus;
  return "running";
}

function createLiveOrchestratorRunDetail(event: OrchestratorEvent): OrchestratorRunDetail {
  const goal = typeof event.payload.goal === "string"
    ? event.payload.goal
    : ((selectedOrchestratorRun?.run.goal ?? orchestratorGoalInput.value.trim()) || "Running orchestrator");

  return {
    run: {
      id: event.runId,
      goal,
      status: deriveRunStatusFromEvent("pending", event),
      continuedFromRunId: typeof event.payload.continuedFromRunId === "string"
        ? event.payload.continuedFromRunId
        : null,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      completedAt: event.type === "run_completed" ? event.createdAt : null
    },
    nodes: [],
    events: [event],
    workingMemory: createEmptyWorkingMemory(),
    evidenceBundles: []
  };
}

function upsertLiveOrchestratorNode(detail: OrchestratorRunDetail, event: OrchestratorEvent) {
  if (!event.nodeId) {
    return;
  }

  if (event.type === "node_created") {
    const existingNodeIndex = detail.nodes.findIndex((node) => node.id === event.nodeId);
    const title = typeof event.payload.title === "string" ? event.payload.title : event.nodeId;
    const objective = typeof event.payload.objective === "string" ? event.payload.objective : title;
    const phase = typeof event.payload.phase === "string" ? event.payload.phase : "init";
    const depth = typeof event.payload.depth === "number" ? event.payload.depth : 0;
    const parentId = typeof event.payload.parentId === "string" ? event.payload.parentId : null;
    const role = event.payload.role === "stage" ? "stage" : "task";
    const stagePhase = typeof event.payload.stagePhase === "string" ? event.payload.stagePhase : null;

    const nextNode: OrchestratorPlanNode = {
      id: event.nodeId,
      parentId,
      title,
      objective,
      depth,
      kind: typeof event.payload.kind === "string" && event.payload.kind === "execution" ? "execution" : "planning",
      role,
      stagePhase,
      phase,
      assignedModels: existingNodeIndex === -1 ? undefined : detail.nodes[existingNodeIndex]!.assignedModels,
      createdAt: existingNodeIndex === -1 ? event.createdAt : detail.nodes[existingNodeIndex]!.createdAt,
      updatedAt: event.createdAt,
      completedAt: phase === "done" ? event.createdAt : (existingNodeIndex === -1 ? null : detail.nodes[existingNodeIndex]!.completedAt),
      acceptanceCriteria: {
        items: existingNodeIndex === -1 ? [] : detail.nodes[existingNodeIndex]!.acceptanceCriteria.items
      }
    };

    if (existingNodeIndex === -1) {
      detail.nodes.push(nextNode);
    } else {
      detail.nodes[existingNodeIndex] = nextNode;
    }

    return;
  }

  const node = detail.nodes.find((candidate) => candidate.id === event.nodeId);
  if (!node) {
    return;
  }

  node.updatedAt = event.createdAt;

  if (event.type === "phase_transition" && typeof event.payload.to === "string") {
    node.phase = event.payload.to;
    if (event.payload.to === "done") {
      node.completedAt = event.createdAt;
    }
    return;
  }

  if (event.type === "node_failed" && typeof event.payload.phase === "string") {
    node.phase = event.payload.phase;
    node.completedAt = event.createdAt;
  }
}

function mergeLiveOrchestratorEvent(detail: OrchestratorRunDetail, event: OrchestratorEvent): OrchestratorRunDetail {
  const alreadyIncluded = detail.events.some((existingEvent) => existingEvent.id === event.id);
  const goal = typeof event.payload.goal === "string" ? event.payload.goal : detail.run.goal;
  const continuedFromRunId = typeof event.payload.continuedFromRunId === "string"
    ? event.payload.continuedFromRunId
    : detail.run.continuedFromRunId;

  detail.run.goal = goal;
  detail.run.continuedFromRunId = continuedFromRunId;
  detail.run.status = deriveRunStatusFromEvent(detail.run.status, event);
  detail.run.updatedAt = event.createdAt;
  detail.run.completedAt = event.type === "run_completed" ? event.createdAt : detail.run.completedAt;

  if (!alreadyIncluded) {
    detail.events.push(event);
  }

  upsertLiveOrchestratorNode(detail, event);

  return detail;
}

function toOrchestratorRunSummary(detail: OrchestratorRunDetail): OrchestratorRunSummary {
  return {
    id: detail.run.id,
    goal: detail.run.goal,
    status: detail.run.status,
    createdAt: detail.run.createdAt,
    updatedAt: detail.run.updatedAt,
    completedAt: detail.run.completedAt,
    finalSummary: detail.finalReport?.summary ?? null
  };
}

function upsertOrchestratorRunSummary(summary: OrchestratorRunSummary) {
  const index = orchestratorRuns.findIndex((run) => run.id === summary.id);
  if (index === -1) {
    orchestratorRuns.push(summary);
  } else {
    orchestratorRuns[index] = summary;
  }

  orchestratorRuns.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  scheduleOrchestratorRender({ list: true, detail: false });
}

async function refreshLiveOrchestratorRun(runId: string) {
  try {
    const detail = await appWindow.tasksaw.getOrchestratorRun(runId);
    upsertOrchestratorRunSummary(toOrchestratorRunSummary(detail));

    if (selectedOrchestratorRunId === runId || liveOrchestratorRunId === runId) {
      selectedOrchestratorRunId = runId;
      selectedOrchestratorRun = detail;
      scheduleOrchestratorRender();
    }
  } catch {
    // Ignore live refresh misses while the snapshot is being written.
  }
}

function scheduleLiveOrchestratorRunRefresh(runId: string) {
  if (liveOrchestratorRefreshHandle !== null) {
    window.clearTimeout(liveOrchestratorRefreshHandle);
  }

  liveOrchestratorRefreshHandle = window.setTimeout(() => {
    liveOrchestratorRefreshHandle = null;
    void refreshLiveOrchestratorRun(runId);
  }, 120);
}

function scheduleOrchestratorRender(options: { list?: boolean; detail?: boolean } = {}) {
  if (options.list ?? true) {
    orchestratorRunListRenderPending = true;
  }

  if (options.detail ?? true) {
    orchestratorDetailRenderPending = true;
  }

  if (options.detail ?? true) {
    orchestratorTreeRenderPending = true;
  }

  if (orchestratorRenderHandle !== null) {
    return;
  }

  orchestratorRenderHandle = appWindow.requestAnimationFrame(() => {
    orchestratorRenderHandle = null;

    const shouldRenderList = orchestratorRunListRenderPending;
    const shouldRenderDetail = orchestratorDetailRenderPending;
    const shouldRenderTree = orchestratorTreeRenderPending;
    orchestratorRunListRenderPending = false;
    orchestratorDetailRenderPending = false;
    orchestratorTreeRenderPending = false;

    if (shouldRenderList) {
      renderOrchestratorRunList();
    }

    if (shouldRenderDetail) {
      renderOrchestratorDetail();
    }

    if (shouldRenderTree) {
      renderOrchestratorTree();
    }
  });
}

function summarizeEvent(event: OrchestratorEvent): string[] {
  const payload = event.payload;
  const eventLabel = (value: string) => translateOrchestratorEventLabel(value);

  if (event.type === "run_created") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("run created")}`,
      String(payload.goal ?? event.runId)
    ];
  }

  if (event.type === "node_created") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("node created")}`,
      `${String(payload.title ?? event.nodeId ?? "unknown node")} (depth ${String(payload.depth ?? "n/a")})`
    ];
  }

  if (event.type === "phase_transition") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("phase")}`,
      `${formatNodePhaseLabel(String(payload.from ?? "unknown"))} -> ${formatNodePhaseLabel(String(payload.to ?? "unknown"))}`
    ];
  }

  if (event.type === "acceptance_updated") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("acceptance")}`,
      `${String(payload.criterionId ?? "unknown")} => ${String(payload.status ?? "unknown")}`
    ];
  }

  if (event.type === "evidence_attached") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("evidence attached")}`,
      String(payload.bundleId ?? "unknown bundle")
    ];
  }

  if (event.type === "scheduler_progress") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("scheduler")}`,
      typeof payload.message === "string"
        ? translateSchedulerProgressMessage(payload.message)
        : (languagePreference === "ko" ? "스케줄러 진행 업데이트" : "scheduler progress")
    ];
  }

  if (event.type === "node_decomposed") {
    const childTitles = Array.isArray(payload.childTitles) ? payload.childTitles.join(", ") : "";
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("decomposed")}`,
      `children: ${childTitles || "n/a"}`
    ];
  }

  if (event.type === "approval_requested") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("approval requested")}`,
      typeof payload.title === "string" && payload.title.trim().length > 0
        ? payload.title.trim()
        : (typeof payload.message === "string" ? payload.message : translate("ui.orchestratorApprovalWaiting"))
    ];
  }

  if (event.type === "approval_resolved") {
    const outcome = typeof payload.outcome === "string" ? payload.outcome : (payload.approved === true ? "selected" : "rejected");
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("approval resolved")}`,
      outcome === "selected"
        ? (languagePreference === "ko" ? "사용자 승인" : "User approved")
        : outcome === "internally_cancelled"
          ? (languagePreference === "ko" ? "시스템 내부 차단" : "Blocked internally")
          : (languagePreference === "ko" ? "사용자 거절" : "User denied")
    ];
  }

  if (event.type === "user_input_requested") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("input requested")}`,
      typeof payload.title === "string" && payload.title.trim().length > 0
        ? payload.title.trim()
        : (typeof payload.message === "string" ? payload.message : translate("ui.orchestratorUserInputWaiting"))
    ];
  }

  if (event.type === "user_input_resolved") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("input resolved")}`,
      payload.submitted === true
        ? (languagePreference === "ko" ? "사용자 입력 제출" : "User input submitted")
        : (languagePreference === "ko" ? "사용자 입력 취소" : "User input cancelled")
    ];
  }

  if (event.type === "execution_status") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("execution status")}`,
      typeof payload.message === "string" && payload.message.trim().length > 0
        ? payload.message.trim()
        : formatExecutionStatusLabel(typeof payload.state === "string" ? payload.state : undefined)
    ];
  }

  if (event.type === "model_invocation") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("invoke")} ${String(payload.capability ?? "unknown")} via ${formatModelLabel(
        typeof payload.modelId === "string" ? payload.modelId : undefined,
        typeof payload.model === "string" ? payload.model : undefined,
        typeof payload.provider === "string" ? payload.provider : undefined
      )}`,
      typeof payload.objective === "string"
        ? formatDisplayString(payload.objective, 320)
        : (languagePreference === "ko" ? "모델 호출 시작" : "Model invocation started")
    ];
  }

  if (event.type === "model_response") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("response")} ${String(payload.capability ?? "unknown")} via ${formatModelLabel(
        typeof payload.modelId === "string" ? payload.modelId : undefined,
        typeof payload.model === "string" ? payload.model : undefined,
        typeof payload.provider === "string" ? payload.provider : undefined
      )}`,
      extractModelResultSummary(payload.result)
    ];
  }

  if (event.type === "node_failed") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("node failed")}`,
      `${formatNodePhaseLabel(String(payload.phase ?? "unknown"))}: ${formatDisplayValue(payload.error ?? "unknown error", 2400)}`
    ];
  }

  if (event.type === "run_failed") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("run failed")}`,
      formatDisplayValue(payload.error ?? "unknown error", 2400)
    ];
  }

  if (event.type === "run_paused") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("run paused")}`,
      formatDisplayValue(payload.reason ?? "paused", 2400)
    ];
  }

  if (event.type === "run_completed") {
    return [
      `[${formatTimestamp(event.createdAt)}] ${eventLabel("run completed")}`,
      formatDisplayValue(payload.summary ?? "completed", 2400)
    ];
  }

  return [
    `[${formatTimestamp(event.createdAt)}] ${event.type}`,
    formatDisplayValue(payload, 2400)
  ];
}

function formatLiveOrchestratorEvent(event: OrchestratorEvent): string {
  const [header, body] = withLogLevel(summarizeEvent(event), getEventLogLevel(event));
  return `${header}: ${body}`;
}

function formatNodePhaseLabel(phase: string): string {
  const labels = languagePreference === "ko"
    ? {
      init: "시작 전",
      abstract_plan: "방향 설정",
      gather: "정보 수집",
      evidence_consolidation: "근거 정리",
      concrete_plan: "실행 계획",
      review: "검토",
      execute: "실행 중",
      verify: "검증",
      done: "완료",
      replan: "재계획",
      escalated: "상위 판단 필요"
    }
    : {
      init: "Queued",
      abstract_plan: "Scoping",
      gather: "Gathering",
      evidence_consolidation: "Consolidating",
      concrete_plan: "Planning",
      review: "Reviewing",
      execute: "Executing",
      verify: "Verifying",
      done: "Done",
      replan: "Replanning",
      escalated: "Escalated"
    };

  return labels[phase as keyof typeof labels] ?? phase.replaceAll("_", " ");
}

function getDisplayedNodePhase(node: OrchestratorPlanNode): string {
  return node.role === "stage" && typeof node.stagePhase === "string" && node.stagePhase.length > 0
    ? node.stagePhase
    : node.phase;
}

function formatNodeRoleLabel(node: OrchestratorPlanNode): string {
  if (node.role === "stage") {
    return formatNodePhaseLabel(getDisplayedNodePhase(node));
  }

  if (node.kind === "execution") {
    return languagePreference === "ko" ? "실행 태스크" : "Execution Task";
  }

  return languagePreference === "ko" ? "태스크" : "Task";
}

function formatModelLabel(modelId: string | null | undefined, modelName?: string | null, provider?: string | null): string {
  const parts = [modelName, provider, modelId]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value.length > 0));

  const uniqueParts = Array.from(new Set(parts));
  return uniqueParts[0] ? uniqueParts.join(" · ") : "unknown";
}

function extractModelResultSummary(result: unknown): string {
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    if (summary.length > 0) {
      return formatDisplayString(summary, 320);
    }

    const findings = Array.isArray(record.findings)
      ? record.findings.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (findings.length > 0) {
      return formatDisplayString(findings.join(" | "), 320);
    }
  }

  if (result === undefined) {
    return languagePreference === "ko" ? "모델 응답 수신" : "Model response received";
  }

  return formatDisplayValue(result, 320);
}

function formatAssignedModelLabel(model: OrchestratorModelRef): string {
  const label = formatModelLabel(model.id, model.model, model.provider);
  const tier = model.tier?.trim();
  const reasoning = model.reasoningEffort?.trim();
  const parts = [label];
  if (tier) parts.push(tier);
  if (reasoning) parts.push(`${reasoning} reasoning`);
  return parts.join(" · ");
}

function getAssignedNodeModels(node: OrchestratorPlanNode): string[] {
  const assignedModels = node.assignedModels ? Object.values(node.assignedModels) : [];

  return Array.from(new Set(
    assignedModels
      .filter((model): model is OrchestratorModelRef => Boolean(model))
      .map((model) => formatAssignedModelLabel(model))
  ));
}

function getUsedNodeModels(detail: OrchestratorRunDetail, node: OrchestratorPlanNode): string[] {
  const assignedModelsById = new Map(
    (node.assignedModels ? Object.values(node.assignedModels) : [])
      .filter((model): model is OrchestratorModelRef => Boolean(model))
      .map((model) => [model.id, model] as const)
  );

  return Array.from(new Set(
    detail.events
      .filter((event) => event.nodeId === node.id && event.type === "model_invocation")
      .map((event) => {
        const modelId = typeof event.payload.modelId === "string" ? event.payload.modelId : undefined;
        const assignedModel = modelId ? assignedModelsById.get(modelId) : undefined;
        return assignedModel
          ? formatAssignedModelLabel(assignedModel)
          : formatModelLabel(
            modelId,
            typeof event.payload.model === "string" ? event.payload.model : undefined,
            typeof event.payload.provider === "string" ? event.payload.provider : undefined
          );
      })
  ));
}

function getNodeModelLabels(detail: OrchestratorRunDetail, node: OrchestratorPlanNode): string[] {
  const usedModels = getUsedNodeModels(detail, node);
  if (usedModels.length > 0) {
    return usedModels;
  }

  return getAssignedNodeModels(node);
}

function formatCommand(command: string[]): string {
  if (command.length === 0) {
    return translate("ui.orchestratorNodeCommandEmpty");
  }

  return command
    .map((part) => (/^[a-zA-Z0-9._/:=-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

function getNodeEvents(detail: OrchestratorRunDetail, nodeId: string): OrchestratorEvent[] {
  return detail.events.filter((event) => event.nodeId === nodeId);
}

function getTaskStageChildren(detail: OrchestratorRunDetail, node: OrchestratorPlanNode): OrchestratorPlanNode[] {
  return detail.nodes.filter((candidate) => candidate.parentId === node.id && candidate.role === "stage");
}

function collectNodeSubtreeIds(detail: OrchestratorRunDetail, nodeId: string, acc: Set<string>) {
  if (acc.has(nodeId)) {
    return;
  }

  acc.add(nodeId);
  for (const child of detail.nodes) {
    if (child.parentId === nodeId) {
      collectNodeSubtreeIds(detail, child.id, acc);
    }
  }
}

function getDisplayNodeEvents(detail: OrchestratorRunDetail, node: OrchestratorPlanNode): OrchestratorEvent[] {
  if (node.role === "stage") {
    return getNodeEvents(detail, node.id);
  }

  const visibleNodeIds = new Set([node.id, ...getTaskStageChildren(detail, node).map((child) => child.id)]);
  for (const child of detail.nodes) {
    if (child.parentId === node.id && child.role === "task" && child.kind === "execution") {
      collectNodeSubtreeIds(detail, child.id, visibleNodeIds);
    }
  }

  return detail.events.filter((event) => event.nodeId !== null && visibleNodeIds.has(event.nodeId));
}

function getLatestEventFromList(events: OrchestratorEvent[], type: string): OrchestratorEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === type) {
      return event;
    }
  }

  return null;
}

function parseEventTimestamp(event: OrchestratorEvent | null): number {
  if (!event) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = Date.parse(event.createdAt);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function mapCapabilityToPhase(capability: string | null | undefined): string | null {
  const normalized = capability?.trim();
  if (!normalized) {
    return null;
  }

  if (normalized === "abstractPlan") return "abstract_plan";
  if (normalized === "gather") return "gather";
  if (normalized === "concretePlan") return "concrete_plan";
  if (normalized === "review") return "review";
  if (normalized === "execute") return "execute";
  if (normalized === "verify") return "verify";
  return null;
}

function getNodeSchedulerMessage(event: OrchestratorEvent | null): string {
  if (!event) {
    return "";
  }

  return typeof event.payload.message === "string"
    ? translateSchedulerProgressMessage(event.payload.message.trim())
    : "";
}

function isNodeDetailEvent(event: OrchestratorEvent): boolean {
  return event.type === "phase_transition"
    || event.type === "acceptance_updated"
    || event.type === "evidence_attached"
    || event.type === "model_invocation"
    || event.type === "model_response"
    || event.type === "approval_requested"
    || event.type === "approval_resolved"
    || event.type === "user_input_requested"
    || event.type === "user_input_resolved"
    || event.type === "interactive_session_requested"
    || event.type === "interactive_session_resolved"
    || event.type === "execution_status"
    || event.type === "node_failed";
}

function isNodeTerminalEvent(event: OrchestratorEvent): boolean {
  return event.type === "terminal_output";
}

function buildNodeTerminalTranscript(
  nodeEvents: OrchestratorEvent[],
  fallbackTranscript: string
): string {
  const terminalEvents = nodeEvents.filter(isNodeTerminalEvent);
  if (terminalEvents.length === 0) {
    return fallbackTranscript;
  }

  let transcript = "";
  let lastSessionId: string | null = null;

  for (const event of terminalEvents) {
    const sessionId = typeof event.payload.sessionId === "string" && event.payload.sessionId.trim().length > 0
      ? event.payload.sessionId.trim()
      : null;
    const title = typeof event.payload.title === "string" && event.payload.title.trim().length > 0
      ? event.payload.title.trim()
      : sessionId;
    const text = typeof event.payload.text === "string" ? event.payload.text : "";
    if (!text) {
      continue;
    }

    if (sessionId && sessionId !== lastSessionId) {
      const header = title ?? sessionId;
      if (transcript.length > 0 && !transcript.endsWith("\n")) {
        transcript += "\n";
      }
      transcript += `\n=== ${header} ===\n`;
      lastSessionId = sessionId;
    }

    transcript += text;
  }

  return transcript.trim().length > 0 ? transcript : fallbackTranscript;
}

function humanizePayloadKey(key: string): string {
  const humanized = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ");

  if (languagePreference === "ko") {
    const labels: Record<string, string> = {
      message: "메시지",
      "allow decomposition": "분해 허용",
      "source run id": "원본 실행 ID",
      "seeded evidence count": "시드 근거 개수",
      "seeded fact count": "시드 사실 개수",
      "seeded open question count": "시드 열린 질문 개수",
      "seeded project structure directory count": "시드 구조 디렉터리 개수",
      "seeded project structure key file count": "시드 구조 핵심 파일 개수",
      "parent node id": "부모 노드 ID",
      "child index": "하위 순번",
      "child count": "하위 노드 개수",
      "node depth": "노드 깊이",
      "max depth": "최대 깊이",
      "proposed child count": "제안된 하위 노드 개수",
      capability: "capability",
      "failed model id": "실패 모델 ID",
      "fallback model id": "대체 모델 ID",
      error: "오류",
      "directory count": "디렉터리 개수",
      "key file count": "핵심 파일 개수",
      "open question count": "열린 질문 개수",
      "contradiction count": "모순 개수",
      attempt: "시도",
      objectives: "목표",
      contradictions: "모순",
      "inspection objective count": "inspection 목표 개수",
      "inspection objectives": "inspection 목표",
      resolution: "정리 결과",
      "bundle id": "번들 ID",
      title: "제목",
      details: "세부 내용",
      locations: "위치",
      options: "선택지",
      questions: "질문",
      answers: "응답",
      approved: "승인됨",
      submitted: "제출됨",
      "option id": "선택 옵션 ID",
      state: "실행 상태",
      status: "상태",
      summary: "요약",
      reason: "사유",
      outputs: "출력"
    };

    return labels[humanized] ?? humanized;
  }

  return humanized;
}

function translateOrchestratorEventLabel(label: string): string {
  if (languagePreference === "ko") {
    const labels: Record<string, string> = {
      "run created": "실행 생성",
      "node created": "노드 생성",
      phase: "단계",
      acceptance: "승인 기준",
      "evidence attached": "근거 연결",
      scheduler: "스케줄러",
      decomposed: "분해",
      invoke: "호출",
      response: "응답",
      "approval requested": "승인 요청",
      "approval resolved": "승인 처리",
      "input requested": "입력 요청",
      "input resolved": "입력 처리",
      "interactive session requested": "대화형 세션 요청",
      "interactive session resolved": "대화형 세션 종료",
      "execution status": "실행 상태",
      "node failed": "노드 실패",
      "run failed": "실행 실패",
      "run paused": "실행 일시중지",
      "run completed": "실행 완료"
    };

    return labels[label] ?? label;
  }

  return label;
}

function translateSchedulerProgressMessage(message: string): string {
  const normalized = message.trim();
  if (normalized.length === 0) {
    return normalized;
  }

  if (languagePreference === "ko") {
    const messages: Record<string, string> = {
      "Starting orchestrator run": "오케스트레이터 실행 시작",
      "Seeded run from previous snapshot": "이전 스냅샷에서 실행 시드 적용",
      "Ignoring inspection child tasks because inspection nodes only refresh project structure memory": "inspection 노드는 프로젝트 구조 메모리만 갱신하므로 하위 작업은 무시함",
      "Executing child subtree": "하위 서브트리 실행 중",
      "Skipping decomposition because the goal requested a short test tree": "목표가 짧은 테스트 트리를 요구해 분해를 건너뜀",
      "Skipping decomposition because max depth was reached": "최대 깊이에 도달해 분해를 건너뜀",
      "Retrying capability with fallback model": "fallback 모델로 capability 재시도 중",
      "Project structure memory updated": "프로젝트 구조 메모리 갱신됨",
      "Stopping repeated project structure inspection because the structure memory did not change": "구조 메모리가 바뀌지 않아 반복 inspection 중단",
      "Project structure inspection requested": "프로젝트 구조 inspection 요청됨",
      "Executing project structure inspection node": "프로젝트 구조 inspection 노드 실행 중",
      "Project structure inspection completed": "프로젝트 구조 inspection 완료",
      "Using fallback model because the primary model was disabled earlier in the run": "이번 실행에서 주 모델이 비활성화되어 fallback 모델 사용 중"
    };

    return messages[normalized] ?? normalized;
  }

  return normalized;
}

function formatPayloadDetails(
  payload: Record<string, unknown>,
  excludedKeys: string[] = [],
  maxLength = 480
): string[] {
  const excluded = new Set(excludedKeys);
  const orderedEntries = Object.entries(payload)
    .filter(([key, value]) => {
      if (excluded.has(key)) {
        return false;
      }

      if (value === null || value === undefined) {
        return false;
      }

      if (Array.isArray(value) && value.length === 0) {
        return false;
      }

      return true;
    })
    .sort(([left], [right]) => left.localeCompare(right));

  return orderedEntries.map(([key, value]) => `${humanizePayloadKey(key)}: ${formatDisplayValue(value, maxLength)}`);
}

function formatModelInvocationDebugLog(event: OrchestratorEvent): string[] {
  const lines = summarizeEvent(event);
  const command = Array.isArray(event.payload.command)
    ? event.payload.command.filter((value): value is string => typeof value === "string")
    : [];
  const prompt = typeof event.payload.prompt === "string"
    ? event.payload.prompt.trim()
    : formatDisplayValue(event.payload.prompt ?? {}, 2400);

  if (command.length > 0) {
    lines.push(`command: ${formatCommand(command)}`);
  }

  if (prompt.length > 0) {
    lines.push("");
    lines.push("prompt");
    lines.push(formatDisplayString(prompt, 2400));
  }

  return lines;
}

function formatModelResponseDebugLog(event: OrchestratorEvent): string[] {
  const lines = summarizeEvent(event);
  const result = formatDisplayValue(event.payload.result ?? {}, 2400);
  const rawStdout = typeof event.payload.rawStdout === "string" ? event.payload.rawStdout.trim() : "";
  const rawStderr = typeof event.payload.rawStderr === "string" ? event.payload.rawStderr.trim() : "";

  if (result.length > 0) {
    lines.push("");
    lines.push("result");
    lines.push(result);
  }

  if (rawStdout.length > 0) {
    lines.push("");
    lines.push("stdout");
    lines.push(formatDisplayString(rawStdout, 2400));
  }

  if (rawStderr.length > 0) {
    lines.push("");
    lines.push("stderr");
    lines.push(formatDisplayString(rawStderr, 2400));
  }

  return lines;
}

function formatExecutionStatusDebugLog(event: OrchestratorEvent): string[] {
  const lines = summarizeEvent(event);
  const state = typeof event.payload.state === "string" ? event.payload.state : "";
  const message = typeof event.payload.message === "string" ? event.payload.message.trim() : "";
  const command = typeof event.payload.command === "string" ? event.payload.command.trim() : "";
  const cwd = typeof event.payload.cwd === "string" ? event.payload.cwd.trim() : "";
  const outputPreview = typeof event.payload.outputPreview === "string" ? event.payload.outputPreview.trim() : "";
  const processId = typeof event.payload.processId === "string" ? event.payload.processId.trim() : "";

  if (command.length > 0) {
    lines.push(`command: ${command}`);
  }

  if (cwd.length > 0) {
    lines.push(`cwd: ${cwd}`);
  }

  if (state === "command_output" && message.length > 0) {
    lines.push("");
    lines.push(languagePreference === "ko" ? "command output" : "command output");
    lines.push(formatDisplayString(message, 2400));
  }

  if (state === "terminal_interaction" && message.length > 0) {
    lines.push("");
    lines.push(languagePreference === "ko" ? "stdin" : "stdin");
    lines.push(formatDisplayString(message, 2400));
  }

  if (outputPreview.length > 0) {
    lines.push("");
    lines.push(languagePreference === "ko" ? "output preview" : "output preview");
    lines.push(formatDisplayString(outputPreview, 2400));
  }

  if (processId.length > 0) {
    lines.push(`process id: ${processId}`);
  }

  const detailLines = formatPayloadDetails(
    event.payload,
    [
      "state",
      "message",
      "command",
      "cwd",
      "outputPreview",
      "processId"
    ],
    2400
  );

  if (detailLines.length > 0) {
    lines.push(...detailLines);
  }

  return lines;
}

function serializeViewerValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return tryBeautifyJsonString(trimmed) ?? trimmed;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractPromptEnvelopeJson(promptValue: unknown): string {
  if (typeof promptValue !== "string") {
    return serializeViewerValue(promptValue);
  }

  const prompt = promptValue.trim();
  if (prompt.length === 0) {
    return "";
  }

  const markerIndex = prompt.indexOf(TASKSAW_PROMPT_MARKER);
  if (markerIndex === -1) {
    return tryBeautifyJsonString(prompt) ?? prompt;
  }

  const jsonStart = prompt.indexOf("{", markerIndex);
  if (jsonStart === -1) {
    return prompt;
  }

  const envelopeText = prompt.slice(jsonStart).trim();
  return tryBeautifyJsonString(envelopeText) ?? envelopeText;
}

function formatNodeFlowHeader(event: OrchestratorEvent): string {
  const capability = typeof event.payload.capability === "string" ? event.payload.capability : event.type;
  const modelLabel = formatModelLabel(
    typeof event.payload.modelId === "string" ? event.payload.modelId : undefined,
    typeof event.payload.model === "string" ? event.payload.model : undefined,
    typeof event.payload.provider === "string" ? event.payload.provider : undefined
  );

  return `[${formatTimestamp(event.createdAt)}] ${capability} via ${modelLabel}`;
}

function buildNodeRequestJsonView(nodeEvents: OrchestratorEvent[]): string {
  const invocationEvents = nodeEvents.filter((event) => event.type === "model_invocation");
  if (invocationEvents.length === 0) {
    return translate("ui.orchestratorNodeRequestEmpty");
  }

  return invocationEvents
    .map((event) => {
      const requestJson = extractPromptEnvelopeJson(event.payload.prompt);
      return [
        formatNodeFlowHeader(event),
        "",
        requestJson.length > 0 ? requestJson : translate("ui.orchestratorNodeRequestEmpty")
      ].join("\n");
    })
    .join("\n\n");
}

function buildNodeResponseJsonView(nodeEvents: OrchestratorEvent[]): string {
  const responseEvents = nodeEvents.filter((event) => event.type === "model_response");
  if (responseEvents.length === 0) {
    return translate("ui.orchestratorNodeResponseEmpty");
  }

  return responseEvents
    .map((event) => {
      const responseJson = serializeViewerValue(event.payload.result);
      return [
        formatNodeFlowHeader(event),
        "",
        responseJson.length > 0 ? responseJson : translate("ui.orchestratorNodeResponseEmpty")
      ].join("\n");
    })
    .join("\n\n");
}

function normalizeExecutionPlanPayload(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const record = result as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  if (typeof record.summary === "string" && record.summary.trim().length > 0) {
    normalized.summary = record.summary.trim();
  }

  if (Array.isArray(record.childTasks) && record.childTasks.length > 0) {
    normalized.childTasks = record.childTasks;
  }

  if (Array.isArray(record.executionNotes) && record.executionNotes.length > 0) {
    normalized.executionNotes = record.executionNotes;
  }

  if (typeof record.needsProjectStructureInspection === "boolean") {
    normalized.needsProjectStructureInspection = record.needsProjectStructureInspection;
  }

  if (Array.isArray(record.inspectionObjectives) && record.inspectionObjectives.length > 0) {
    normalized.inspectionObjectives = record.inspectionObjectives;
  }

  if (Array.isArray(record.projectStructureContradictions) && record.projectStructureContradictions.length > 0) {
    normalized.projectStructureContradictions = record.projectStructureContradictions;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function buildNodeExecutionPlanView(nodeEvents: OrchestratorEvent[]): { text: string; hasPlan: boolean } {
  const planSections = nodeEvents
    .filter((event) => event.type === "model_response" && event.payload.capability === "concretePlan")
    .map((event) => {
      const normalizedPlan = normalizeExecutionPlanPayload(event.payload.result);
      if (!normalizedPlan) {
        return null;
      }

      return [
        formatNodeFlowHeader(event),
        "",
        serializeViewerValue(normalizedPlan)
      ].join("\n");
    })
    .filter((section): section is string => Boolean(section));

  if (planSections.length === 0) {
    return {
      text: translate("ui.orchestratorNodePlanEmpty"),
      hasPlan: false
    };
  }

  return {
    text: planSections.join("\n\n"),
    hasPlan: true
  };
}

function describeApprovalOptionLabel(option: OrchestratorApprovalOption): string {
  const explicitLabel = option.label?.trim();
  if (explicitLabel) {
    return explicitLabel;
  }

  const kind = option.kind?.trim() ?? "";
  if (kind === "allow_once") {
    return languagePreference === "ko" ? "한 번만 승인" : "Allow once";
  }
  if (kind === "allow_for_session") {
    return languagePreference === "ko" ? "세션 동안 승인" : "Allow for session";
  }
  if (kind === "reject_once") {
    return languagePreference === "ko" ? "거절" : "Reject";
  }

  return kind.length > 0 ? kind.replaceAll("_", " ") : option.optionId;
}

function formatExecutionStatusLabel(state: string | undefined): string {
  if (!state) {
    return languagePreference === "ko" ? "대기 중" : "Queued";
  }

  if (languagePreference === "ko") {
    const labels: Record<string, string> = {
      queued: "대기 중",
      reviewing: "검토 중",
      review_completed: "검토 정리 완료",
      review_failed: "검토 정리 실패",
      review_approved: "검토 승인됨",
      review_rejected: "검토 거절됨",
      running: "실행 중",
      executed: "실행 완료",
      verifying: "검증 중",
      completed: "완료",
      failed: "실패",
      verification_failed: "검증 실패",
      awaiting_user_approval: "승인 대기",
      awaiting_user_input: "추가 입력 대기",
      awaiting_interactive_session: "대화형 세션 대기",
      approval_granted: "사용자 승인됨",
      approval_denied: "사용자 거절",
      approval_blocked: "시스템 내부 차단",
      user_input_submitted: "입력 제출됨",
      user_input_cancelled: "입력 취소됨",
      interactive_session_completed: "대화형 세션 완료",
      interactive_session_failed: "대화형 세션 실패",
      interactive_session_terminated: "대화형 세션 종료됨",
      interactive_session_cancelled: "대화형 세션 취소됨",
      planning_update: "계획 갱신 중",
      tool_progress: "도구 진행 중",
      running_command: "명령 실행 중",
      command_output: "명령 출력 수신 중",
      command_completed: "명령 실행 완료",
      command_failed: "명령 실행 실패",
      command_declined: "명령 실행 거절됨",
      terminal_interaction: "터미널 입력 대기"
    };
    return labels[state] ?? state;
  }

  const labels: Record<string, string> = {
    queued: "Queued",
    reviewing: "Reviewing",
    review_completed: "Review completed",
    review_failed: "Review failed",
    review_approved: "Review approved",
    review_rejected: "Review rejected",
    running: "Running",
    executed: "Executed",
    verifying: "Verifying",
    completed: "Completed",
    failed: "Failed",
    verification_failed: "Verification failed",
    awaiting_user_approval: "Waiting for approval",
    awaiting_user_input: "Waiting for additional input",
    awaiting_interactive_session: "Waiting for interactive session",
    approval_granted: "Approved",
    approval_denied: "Denied",
    approval_blocked: "Blocked internally",
    user_input_submitted: "Input submitted",
    user_input_cancelled: "Input cancelled",
    interactive_session_completed: "Interactive session completed",
    interactive_session_failed: "Interactive session failed",
    interactive_session_terminated: "Interactive session terminated",
    interactive_session_cancelled: "Interactive session cancelled",
    planning_update: "Planning update",
    tool_progress: "Tool in progress",
    running_command: "Running command",
    command_output: "Streaming command output",
    command_completed: "Command completed",
    command_failed: "Command failed",
    command_declined: "Command declined",
    terminal_interaction: "Waiting for terminal input"
  };
  return labels[state] ?? state;
}

function getLatestExecutionStatusEvent(nodeEvents: OrchestratorEvent[]): OrchestratorEvent | null {
  return getLatestEventFromList(nodeEvents, "execution_status");
}

function getPendingApproval(nodeEvents: OrchestratorEvent[]): OrchestratorPendingApproval | null {
  const resolvedRequestIds = new Set(
    nodeEvents
      .filter((event) => event.type === "approval_resolved")
      .map((event) => String(event.payload.requestId ?? "").trim())
      .filter((requestId) => requestId.length > 0)
  );
  if (pendingApprovalActionRequestId) {
    resolvedRequestIds.add(pendingApprovalActionRequestId);
  }
  const pendingRequest = [...nodeEvents]
    .reverse()
    .find((event) => event.type === "approval_requested" && !resolvedRequestIds.has(String(event.payload.requestId ?? "").trim()));

  if (!pendingRequest) {
    return null;
  }

  const requestId = String(pendingRequest.payload.requestId ?? "").trim();
  if (!requestId) {
    return null;
  }

  const options = Array.isArray(pendingRequest.payload.options)
    ? pendingRequest.payload.options
      .filter((option): option is Record<string, unknown> => typeof option === "object" && option !== null)
      .map((option) => ({
        optionId: typeof option.optionId === "string" ? option.optionId : "",
        kind: typeof option.kind === "string" ? option.kind : null,
        label: typeof option.label === "string" ? option.label : null
      }))
      .filter((option) => option.optionId.length > 0)
    : [];

  return {
    requestId,
    title: typeof pendingRequest.payload.title === "string" && pendingRequest.payload.title.trim().length > 0
      ? pendingRequest.payload.title.trim()
      : translate("ui.orchestratorApprovalTitle"),
    message: typeof pendingRequest.payload.message === "string" && pendingRequest.payload.message.trim().length > 0
      ? pendingRequest.payload.message.trim()
      : translate("ui.orchestratorApprovalWaiting"),
    details: typeof pendingRequest.payload.details === "string" ? pendingRequest.payload.details.trim() : "",
    options
  };
}

function listPendingApprovals(detail: OrchestratorRunDetail | null): QueuedPendingApproval[] {
  if (!detail) {
    return [];
  }

  const resolvedRequestIds = new Set(
    detail.events
      .filter((event) => event.type === "approval_resolved")
      .map((event) => String(event.payload.requestId ?? "").trim())
      .filter((requestId) => requestId.length > 0)
  );
  const nodeById = new Map(detail.nodes.map((node) => [node.id, node]));
  const approvals: QueuedPendingApproval[] = [];

  for (const event of detail.events) {
    if (event.type !== "approval_requested" || !event.nodeId) {
      continue;
    }

    const requestId = String(event.payload.requestId ?? "").trim();
    if (!requestId || resolvedRequestIds.has(requestId) || approvals.some((entry) => entry.requestId === requestId)) {
      continue;
    }

    const nodeEvents = detail.events.filter((entry) => entry.nodeId === event.nodeId);
    const pendingApproval = getPendingApproval(nodeEvents);
    if (!pendingApproval) {
      continue;
    }

    approvals.push({
      ...pendingApproval,
      nodeId: event.nodeId,
      nodeTitle: nodeById.get(event.nodeId)?.title ?? event.nodeId,
      createdAt: event.createdAt
    });
  }

  return approvals.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function getActivePendingApproval(): QueuedPendingApproval | null {
  const pendingApprovals = listPendingApprovals(selectedOrchestratorRun);
  if (pendingApprovals.length === 0) {
    return null;
  }

  return pendingApprovals.find((approval) => approval.requestId === activeApprovalDialogRequestId)
    ?? pendingApprovals[0]
    ?? null;
}

function renderApprovalQueueButton() {
  const pendingCount = listPendingApprovals(selectedOrchestratorRun).length;
  approvalQueueButton.textContent = translate("ui.orchestratorApprovalQueueButton", {
    count: String(pendingCount)
  });
  approvalQueueButton.disabled = pendingCount === 0;
}

function createApprovalActionButtons(
  container: HTMLElement,
  pendingApproval: OrchestratorPendingApproval,
  options: { closeDialogOnAction?: boolean } = {}
) {
  const { closeDialogOnAction = false } = options;
  const hasAllowOptions = pendingApproval.options.some((option) => option.kind?.startsWith("allow"));
  const actions = hasAllowOptions
    ? pendingApproval.options.filter((option) => option.kind?.startsWith("allow"))
    : pendingApproval.options;

  for (const option of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "orchestrator-copy-button";
    button.textContent = describeApprovalOptionLabel(option);
    button.disabled = pendingApprovalActionRequestId === pendingApproval.requestId;
    button.addEventListener("click", () => {
      if (closeDialogOnAction) {
        closeApprovalDialog();
      }
      void respondToPendingApproval(pendingApproval.requestId, true, option.optionId);
    });
    container.appendChild(button);
  }

  const denyButton = document.createElement("button");
  denyButton.type = "button";
  denyButton.className = "orchestrator-copy-button";
  denyButton.textContent = translate("ui.orchestratorApprovalDeny");
  denyButton.disabled = pendingApprovalActionRequestId === pendingApproval.requestId;
  denyButton.addEventListener("click", () => {
    if (closeDialogOnAction) {
      closeApprovalDialog();
    }
    void respondToPendingApproval(pendingApproval.requestId, false);
  });
  container.appendChild(denyButton);
}

function renderApprovalDialog() {
  const pendingApprovals = listPendingApprovals(selectedOrchestratorRun);
  const pendingApproval = getActivePendingApproval();
  approvalDialogListEl.replaceChildren();
  approvalDialogActionsEl.replaceChildren();

  if (!pendingApproval) {
    approvalDialogEl.hidden = true;
    syncDialogBodyState();
    return;
  }

  approvalDialogTitleEl.textContent = pendingApproval.title;
  approvalDialogStatusEl.textContent = translate("ui.orchestratorApprovalWaiting");
  approvalDialogMessageEl.textContent = pendingApproval.message;
  approvalDialogDetailsEl.textContent = pendingApproval.details;

  for (const approval of pendingApprovals) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "approval-dialog-item";
    if (approval.requestId === pendingApproval.requestId) {
      item.classList.add("active");
    }

    const itemTitle = document.createElement("div");
    itemTitle.className = "approval-dialog-item-title";
    itemTitle.textContent = approval.nodeTitle;

    const itemCopy = document.createElement("div");
    itemCopy.className = "approval-dialog-item-copy";
    itemCopy.textContent = approval.message;

    item.append(itemTitle, itemCopy);
    item.addEventListener("click", () => {
      activeApprovalDialogRequestId = approval.requestId;
      renderApprovalDialog();
    });
    approvalDialogListEl.appendChild(item);
  }

  createApprovalActionButtons(approvalDialogActionsEl, pendingApproval, { closeDialogOnAction: true });
  approvalDialogEl.hidden = false;
  syncDialogBodyState();
}

function openApprovalDialog(requestId?: string) {
  activeApprovalDialogRequestId = requestId ?? getActivePendingApproval()?.requestId ?? null;
  renderApprovalDialog();
}

function closeApprovalDialog() {
  activeApprovalDialogRequestId = null;
  approvalDialogEl.hidden = true;
  syncDialogBodyState();
}

function getInteractiveSessionStatusLabel(request: OrchestratorPendingInteractiveSession): string {
  const hasTerminationSignal = typeof request.signal === "number" && request.signal > 0;
  if (!request.sessionId) {
    return translate("ui.interactiveSessionStarting");
  }

  if (!request.exited) {
    return translate("ui.interactiveSessionRunning");
  }

  if (request.terminateRequested || hasTerminationSignal) {
    return translate("ui.interactiveSessionTerminated");
  }

  if (request.exitCode !== 0) {
    return translate("ui.interactiveSessionFailed");
  }

  return translate("ui.interactiveSessionCompleted");
}

function getActiveInteractiveSession(): OrchestratorPendingInteractiveSession | null {
  if (!activeInteractiveSessionRequestId) {
    return null;
  }

  return pendingInteractiveSessions.get(activeInteractiveSessionRequestId) ?? null;
}

function getNextPendingInteractiveSession(): OrchestratorPendingInteractiveSession | null {
  for (const request of pendingInteractiveSessions.values()) {
    if (!request.responseSubmitted) {
      return request;
    }
  }

  return null;
}

function ensureInteractiveSessionTerminal() {
  if (interactiveSessionTerminal || typeof appWindow.Terminal !== "function") {
    return;
  }

  interactiveSessionTerminal = new appWindow.Terminal({
    cursorBlink: true,
    fontSize: 14,
    theme: XTERM_THEMES[resolveTheme(themePreference)]
  });
  interactiveSessionTerminal.open(interactiveSessionDialogTerminalEl);
  interactiveSessionTerminal.onData((data: string) => {
    const request = getActiveInteractiveSession();
    if (!request?.sessionId || request.exited) {
      return;
    }

    appWindow.tasksaw.writeTerminal(request.sessionId, data);
  });
}

function fitInteractiveSessionTerminal() {
  const request = getActiveInteractiveSession();
  if (!request?.sessionId || !interactiveSessionTerminal) {
    return;
  }

  const rect = interactiveSessionDialogTerminalEl.getBoundingClientRect();
  const cols = Math.max(40, Math.floor(Math.max(rect.width, 360) / 9));
  const rows = Math.max(10, Math.floor(Math.max(rect.height, 200) / 18));
  interactiveSessionTerminal.resize(cols, rows);
  appWindow.tasksaw.resizeTerminal(request.sessionId, cols, rows);
}

function scheduleFitInteractiveSessionTerminal() {
  if (interactiveSessionFitHandle !== null) {
    return;
  }

  interactiveSessionFitHandle = appWindow.requestAnimationFrame(() => {
    interactiveSessionFitHandle = null;
    fitInteractiveSessionTerminal();
  });
}

function hideInteractiveSessionDialog() {
  activeInteractiveSessionRequestId = null;
  interactiveSessionDialogEl.hidden = true;
  interactiveSessionDialogCloseButton.hidden = true;
  interactiveSessionDialogTerminateButton.hidden = false;
  syncDialogBodyState();
}

function trimInteractiveTranscript(transcript: string): string {
  return transcript.length > 32_000 ? transcript.slice(-32_000) : transcript;
}

function renderInteractiveSessionDialog() {
  const request = getActiveInteractiveSession();
  if (!request) {
    hideInteractiveSessionDialog();
    return;
  }

  ensureInteractiveSessionTerminal();
  interactiveSessionDialogTitleEl.textContent = request.title || translate("ui.interactiveSessionTitle");
  interactiveSessionDialogStatusEl.textContent = getInteractiveSessionStatusLabel(request);
  interactiveSessionDialogMessageEl.textContent = request.message;
  interactiveSessionDialogCommandEl.textContent = request.commandText || translate("ui.interactiveSessionCommandEmpty");
  interactiveSessionDialogTerminateButton.hidden = request.exited;
  interactiveSessionDialogTerminateButton.disabled = request.exited;
  interactiveSessionDialogCloseButton.hidden = !request.exited;
  interactiveSessionDialogEl.hidden = false;
  syncDialogBodyState();

  if (interactiveSessionTerminal) {
    interactiveSessionTerminal.reset();
    if (request.transcript.length > 0) {
      interactiveSessionTerminal.write(request.transcript);
    }
    scheduleFitInteractiveSessionTerminal();
  }
}

async function respondInteractiveSession(request: OrchestratorPendingInteractiveSession) {
  const hasTerminationSignal = typeof request.signal === "number" && request.signal > 0;
  if (request.responseSubmitted) {
    return;
  }

  request.responseSubmitted = true;
  await appWindow.tasksaw.respondOrchestratorInteractiveSession({
    requestId: request.requestId,
    outcome: request.terminateRequested
      ? "terminated"
      : hasTerminationSignal
        ? "terminated"
      : request.exited
        ? request.exitCode === 0
          ? "completed"
          : "failed"
        : "cancelled",
    sessionId: request.sessionId,
    exitCode: request.exitCode,
    signal: request.signal,
    transcript: request.transcript
  }).catch(() => false);
}

async function finalizeInteractiveSession(requestId: string) {
  const request = pendingInteractiveSessions.get(requestId);
  if (!request) {
    return;
  }

  await respondInteractiveSession(request);
  pendingInteractiveSessions.delete(requestId);
  if (activeInteractiveSessionRequestId === requestId) {
    hideInteractiveSessionDialog();
  }

  const nextRequest = getNextPendingInteractiveSession();
  if (nextRequest) {
    activeInteractiveSessionRequestId = nextRequest.requestId;
    renderInteractiveSessionDialog();
    if (!nextRequest.sessionId) {
      void ensureInteractiveSessionModalSession(nextRequest);
    }
  }
}

async function ensureInteractiveSessionModalSession(request: OrchestratorPendingInteractiveSession) {
  if (request.sessionId || request.responseSubmitted) {
    return;
  }

  renderInteractiveSessionDialog();
  try {
    const session = await appWindow.tasksaw.createSession({
      kind: "shell",
      cwd: request.cwd,
      title: request.title || translate("ui.interactiveSessionTitle"),
      commandText: request.commandText,
      hidden: true
    });
    if (!session) {
      request.exited = true;
      request.terminateRequested = true;
      await finalizeInteractiveSession(request.requestId);
      return;
    }

    request.sessionId = session.id;
    renderInteractiveSessionDialog();
  } catch (error: unknown) {
    request.exited = true;
    request.terminateRequested = true;
    request.transcript = trimInteractiveTranscript(
      `${request.transcript}${error instanceof Error ? error.message : String(error)}\n`
    );
    await finalizeInteractiveSession(request.requestId);
  }
}

async function openQueuedInteractiveSession(request: OrchestratorPendingInteractiveSession) {
  if (activeInteractiveSessionRequestId && activeInteractiveSessionRequestId !== request.requestId) {
    return;
  }

  activeInteractiveSessionRequestId = request.requestId;
  renderInteractiveSessionDialog();
  await ensureInteractiveSessionModalSession(request);
}

async function terminateActiveInteractiveSession() {
  const request = getActiveInteractiveSession();
  if (!request) {
    return;
  }

  request.terminateRequested = true;
  renderInteractiveSessionDialog();

  if (request.sessionId && !request.exited) {
    appWindow.tasksaw.killSession(request.sessionId);
    return;
  }

  request.exited = true;
  await finalizeInteractiveSession(request.requestId);
}

function queueInteractiveSessionRequest(event: OrchestratorEvent) {
  const requestId = typeof event.payload.requestId === "string" ? event.payload.requestId.trim() : "";
  if (!requestId || pendingInteractiveSessions.has(requestId)) {
    return;
  }

  const request: OrchestratorPendingInteractiveSession = {
    requestId,
    runId: event.runId,
    nodeId: event.nodeId ?? "",
    title: typeof event.payload.title === "string" && event.payload.title.trim().length > 0
      ? event.payload.title.trim()
      : translate("ui.interactiveSessionTitle"),
    message: typeof event.payload.message === "string" && event.payload.message.trim().length > 0
      ? event.payload.message.trim()
      : translate("ui.interactiveSessionStarting"),
    commandText: typeof event.payload.commandText === "string" ? event.payload.commandText.trim() : "",
    cwd: typeof event.payload.cwd === "string" ? event.payload.cwd.trim() : currentWorkspacePath ?? "",
    createdAt: event.createdAt,
    sessionId: null,
    transcript: "",
    exitCode: null,
    signal: null,
    exited: false,
    responseSubmitted: false,
    terminateRequested: false
  };

  pendingInteractiveSessions.set(requestId, request);
  if (!activeInteractiveSessionRequestId) {
    void openQueuedInteractiveSession(request);
  }
}

function showApprovalToast(pendingApproval: OrchestratorPendingApproval) {
  approvalToasts.set(pendingApproval.requestId, {
    requestId: pendingApproval.requestId,
    title: pendingApproval.title,
    message: pendingApproval.message
  });
  renderApprovalToastList();
}

function resolveApprovalToast(requestId: string) {
  approvalToasts.delete(requestId);
  renderApprovalToastList();
}

function getPendingUserInput(nodeEvents: OrchestratorEvent[]): OrchestratorPendingUserInput | null {
  const resolvedRequestIds = new Set(
    nodeEvents
      .filter((event) => event.type === "user_input_resolved")
      .map((event) => String(event.payload.requestId ?? "").trim())
      .filter((requestId) => requestId.length > 0)
  );
  const pendingRequest = [...nodeEvents]
    .reverse()
    .find((event) => event.type === "user_input_requested" && !resolvedRequestIds.has(String(event.payload.requestId ?? "").trim()));

  if (!pendingRequest) {
    return null;
  }

  const requestId = String(pendingRequest.payload.requestId ?? "").trim();
  if (!requestId) {
    return null;
  }

  const questions = Array.isArray(pendingRequest.payload.questions)
    ? pendingRequest.payload.questions
      .filter((question): question is Record<string, unknown> => typeof question === "object" && question !== null)
      .map((question, index) => ({
        id: typeof question.id === "string" && question.id.trim().length > 0 ? question.id.trim() : `question-${index + 1}`,
        header: typeof question.header === "string" && question.header.trim().length > 0 ? question.header.trim() : `Question ${index + 1}`,
        question: typeof question.question === "string" && question.question.trim().length > 0
          ? question.question.trim()
          : translate("ui.orchestratorUserInputPlaceholder"),
        options: Array.isArray(question.options)
          ? question.options
            .filter((option): option is Record<string, unknown> => typeof option === "object" && option !== null)
            .map((option) => ({
              label: typeof option.label === "string" ? option.label.trim() : "",
              description: typeof option.description === "string" ? option.description.trim() : null
            }))
            .filter((option) => option.label.length > 0)
          : undefined,
        isOther: Boolean(question.isOther),
        isSecret: Boolean(question.isSecret)
      }))
    : [];

  return {
    requestId,
    title: typeof pendingRequest.payload.title === "string" && pendingRequest.payload.title.trim().length > 0
      ? pendingRequest.payload.title.trim()
      : translate("ui.orchestratorUserInputTitle"),
    message: typeof pendingRequest.payload.message === "string" && pendingRequest.payload.message.trim().length > 0
      ? pendingRequest.payload.message.trim()
      : translate("ui.orchestratorUserInputWaiting"),
    questions
  };
}

function getUserInputDraftValue(requestId: string, questionId: string): string {
  return pendingUserInputDrafts.get(requestId)?.[questionId] ?? "";
}

function setUserInputDraftValue(requestId: string, questionId: string, value: string) {
  const existingDraft = pendingUserInputDrafts.get(requestId) ?? {};
  pendingUserInputDrafts.set(requestId, {
    ...existingDraft,
    [questionId]: value
  });
}

function getEventLogLevel(event: OrchestratorEvent): "DEBUG" | "INFO" | "WARN" | "ERROR" {
  if (event.type === "model_invocation" || event.type === "model_response") {
    return "DEBUG";
  }

  if (
    event.type === "approval_requested"
    || event.type === "user_input_requested"
    || event.type === "interactive_session_requested"
  ) {
    return "WARN";
  }

  if (event.type === "run_paused") {
    return "WARN";
  }

  if (event.type === "node_failed" || event.type === "run_failed") {
    return "ERROR";
  }

  return "INFO";
}

function withLogLevel(lines: string[], level: ReturnType<typeof getEventLogLevel>): string[] {
  if (lines.length === 0) {
    return [`[${level}]`];
  }

  return [`[${level}] ${lines[0]}`, ...lines.slice(1)];
}

function isOrchestratorOverviewEvent(event: OrchestratorEvent): boolean {
  return event.type !== "" && event.type !== "terminal_output";
}

function formatOrchestratorLogEntry(detail: OrchestratorRunDetail, event: OrchestratorEvent): string {
  const [header, body] = withLogLevel(summarizeEvent(event), getEventLogLevel(event));
  const nodeTitle = event.nodeId
    ? detail.nodes.find((node) => node.id === event.nodeId)?.title ?? event.nodeId
    : null;
  const headerWithNode = nodeTitle ? `${header} · ${nodeTitle}` : header;
  const detailLines: string[] = [];

  if (event.type === "scheduler_progress") {
    detailLines.push(...formatPayloadDetails(event.payload, ["message"], 600));
  } else if (event.type === "node_created") {
    detailLines.push(...formatPayloadDetails(event.payload, ["title", "depth"], 360));
  } else if (event.type === "phase_transition") {
    detailLines.push(...formatPayloadDetails(event.payload, ["from", "to"], 360));
  } else if (event.type === "approval_requested") {
    detailLines.push(...formatPayloadDetails(event.payload, ["title", "message", "details"], 600));
    if (typeof event.payload.details === "string" && event.payload.details.trim().length > 0) {
      detailLines.push(formatDisplayString(event.payload.details, 600));
    }
  } else if (event.type === "user_input_requested") {
    detailLines.push(...formatPayloadDetails(event.payload, ["title", "message", "questions"], 600));
    if (Array.isArray(event.payload.questions) && event.payload.questions.length > 0) {
      detailLines.push(`questions: ${formatDisplayValue(event.payload.questions, 600)}`);
    }
  } else if (event.type === "interactive_session_requested") {
    detailLines.push(...formatPayloadDetails(event.payload, ["title", "message", "commandText", "cwd"], 600));
    const commandText = typeof event.payload.commandText === "string" ? event.payload.commandText.trim() : "";
    if (commandText.length > 0) {
      detailLines.push(`command: ${commandText}`);
    }
    const cwd = typeof event.payload.cwd === "string" ? event.payload.cwd.trim() : "";
    if (cwd.length > 0) {
      detailLines.push(`cwd: ${cwd}`);
    }
  } else if (event.type === "interactive_session_resolved") {
    detailLines.push(...formatPayloadDetails(event.payload, ["transcriptPreview"], 600));
    const transcriptPreview = typeof event.payload.transcriptPreview === "string" ? event.payload.transcriptPreview.trim() : "";
    if (transcriptPreview.length > 0) {
      detailLines.push(`transcript preview: ${formatDisplayString(transcriptPreview, 600)}`);
    }
  } else if (event.type === "approval_resolved" || event.type === "user_input_resolved" || event.type === "execution_status") {
    detailLines.push(...formatPayloadDetails(event.payload, ["message"], 480));
  } else if (event.type === "node_decomposed") {
    detailLines.push(...formatPayloadDetails(event.payload, [], 360));
  } else if (event.type === "model_invocation") {
    const command = Array.isArray(event.payload.command)
      ? event.payload.command.filter((value): value is string => typeof value === "string")
      : [];
    if (command.length > 0) {
      detailLines.push(`command: ${formatCommand(command)}`);
    }
    if (typeof event.payload.prompt === "string" && event.payload.prompt.trim().length > 0) {
      detailLines.push(`prompt preview: ${formatDisplayString(event.payload.prompt, 560)}`);
    }
  } else if (event.type === "model_response") {
    detailLines.push(`result preview: ${extractModelResultSummary(event.payload.result)}`);
    if (typeof event.payload.rawStderr === "string" && event.payload.rawStderr.trim().length > 0) {
      detailLines.push(`stderr preview: ${formatDisplayString(event.payload.rawStderr, 360)}`);
    }
  } else if (event.type === "node_failed" || event.type === "run_failed") {
    detailLines.push(...formatPayloadDetails(event.payload, ["error", "phase"], 600));
  } else if (event.type === "run_completed" || event.type === "run_paused" || event.type === "acceptance_updated") {
    detailLines.push(...formatPayloadDetails(event.payload, ["summary", "reason", "criterionId", "status"], 480));
  } else if (event.type === "evidence_attached") {
    detailLines.push(...formatPayloadDetails(event.payload, ["bundleId"], 360));
  }

  return [headerWithNode, body, ...detailLines]
    .filter((line) => line.length > 0)
    .join("\n");
}

function resolveNodeElapsedEnd(detail: OrchestratorRunDetail, node: OrchestratorPlanNode, tone: OrchestratorProgressTone): string | null {
  if (node.completedAt) {
    return node.completedAt;
  }

  if (tone === "failed" || tone === "done" || tone === "paused" || tone === "escalated") {
    return node.updatedAt || detail.run.updatedAt;
  }

  if (detail.run.status === "done" || detail.run.status === "failed" || detail.run.status === "paused" || detail.run.status === "escalated") {
    return node.updatedAt || detail.run.updatedAt;
  }

  return null;
}

function buildNodeProgressView(
  detail: OrchestratorRunDetail,
  node: OrchestratorPlanNode,
  nodeEvents: OrchestratorEvent[]
): OrchestratorNodeProgressView {
  const displayedPhase = getDisplayedNodePhase(node);
  const selectedNodeModels = getNodeModelLabels(detail, node);
  const lastScheduler = getLatestEventFromList(nodeEvents, "scheduler_progress");
  const lastInvocation = getLatestEventFromList(nodeEvents, "model_invocation");
  const lastResponse = getLatestEventFromList(nodeEvents, "model_response");
  const lastFailure = getLatestEventFromList(nodeEvents, "node_failed");
  const lastExecutionStatus = getLatestExecutionStatusEvent(nodeEvents);
  const pendingApproval = getPendingApproval(nodeEvents);
  const pendingUserInput = getPendingUserInput(nodeEvents);
  const lastEvent = nodeEvents[nodeEvents.length - 1] ?? null;
  const currentCapabilityPhase = mapCapabilityToPhase(
    typeof lastInvocation?.payload.capability === "string" ? lastInvocation.payload.capability : undefined
  );
  const invocationInFlight = parseEventTimestamp(lastInvocation) > parseEventTimestamp(lastResponse)
    && parseEventTimestamp(lastInvocation) > parseEventTimestamp(lastFailure);
  const schedulerMessage = getNodeSchedulerMessage(lastScheduler);
  const defaultDetail = schedulerMessage || formatDisplayString(node.objective, 220);
  const responseSummary = lastResponse ? extractModelResultSummary(lastResponse.payload.result) : "";
  const failurePhase = typeof lastFailure?.payload.phase === "string" ? lastFailure.payload.phase : node.phase;
  const modelLabel = selectedNodeModels.join(", ") || (languagePreference === "ko" ? "모델 미정" : "Model pending");
  const executionStatus = formatExecutionStatusLabel(
    typeof lastExecutionStatus?.payload.state === "string" ? lastExecutionStatus.payload.state : undefined
  );

  let tone: OrchestratorProgressTone = "idle";
  let summary = formatNodeRoleLabel(node);
  let detailLine = defaultDetail;

  if (lastFailure) {
    tone = "failed";
    summary = `${formatNodePhaseLabel(failurePhase)} · ${languagePreference === "ko" ? "실패" : "Failed"}`;
    detailLine = formatDisplayValue(lastFailure.payload.error ?? "unknown error", 240);
  } else if (node.phase === "done") {
    tone = "done";
    summary = languagePreference === "ko" ? "노드 완료" : "Node completed";
    detailLine = responseSummary || defaultDetail;
  } else if (node.phase === "escalated") {
    tone = "escalated";
    summary = languagePreference === "ko" ? "상위 판단 대기" : "Waiting for escalation";
    detailLine = defaultDetail;
  } else if (detail.run.status === "paused") {
    tone = "paused";
    summary = languagePreference === "ko" ? "실행 일시중지" : "Run paused";
    detailLine = defaultDetail;
  } else if (node.phase === "replan") {
    tone = "paused";
    summary = languagePreference === "ko" ? "inspection 뒤 재계획 중" : "Replanning after inspection";
    detailLine = defaultDetail;
  } else if (pendingApproval) {
    tone = "paused";
    summary = executionStatus;
    detailLine = pendingApproval.title || pendingApproval.message;
  } else if (pendingUserInput) {
    tone = "paused";
    summary = executionStatus;
    detailLine = pendingUserInput.title || pendingUserInput.message;
  } else if (invocationInFlight && lastInvocation) {
    tone = "active";
    const activeModelLabel = formatModelLabel(
      typeof lastInvocation.payload.modelId === "string" ? lastInvocation.payload.modelId : undefined,
      typeof lastInvocation.payload.model === "string" ? lastInvocation.payload.model : undefined,
      typeof lastInvocation.payload.provider === "string" ? lastInvocation.payload.provider : undefined
    );
    summary = `${formatNodePhaseLabel(currentCapabilityPhase ?? node.phase)} · ${activeModelLabel}`;
    detailLine = schedulerMessage || (languagePreference === "ko" ? "모델 응답 대기 중" : "Waiting for model response");
  } else if (displayedPhase !== "init") {
    tone = "active";
    summary = formatNodeRoleLabel(node);
    detailLine = responseSummary || defaultDetail;
  }

  const completedPhases = new Set(
    nodeEvents
      .filter((event) => event.type === "phase_transition")
      .map((event) => String(event.payload.from ?? ""))
      .filter((phase): phase is string => ORCHESTRATOR_PHASE_TRACK.includes(phase as (typeof ORCHESTRATOR_PHASE_TRACK)[number]))
  );
  const observedPhases = new Set(
    nodeEvents
      .flatMap((event) => {
        if (event.type !== "phase_transition") {
          return [];
        }

        return [String(event.payload.from ?? ""), String(event.payload.to ?? "")];
      })
      .filter((phase): phase is string => ORCHESTRATOR_PHASE_TRACK.includes(phase as (typeof ORCHESTRATOR_PHASE_TRACK)[number]))
  );

  if (currentCapabilityPhase) {
    observedPhases.add(currentCapabilityPhase);
  }

  if (ORCHESTRATOR_PHASE_TRACK.includes(displayedPhase as (typeof ORCHESTRATOR_PHASE_TRACK)[number])) {
    observedPhases.add(displayedPhase);
  }

  const maxObservedIndex = Math.max(
    ...Array.from(observedPhases).map((phase) => ORCHESTRATOR_PHASE_TRACK.indexOf(phase as (typeof ORCHESTRATOR_PHASE_TRACK)[number])),
    0
  );
  const visiblePhases = (node.phase === "done" || node.phase === "escalated")
    ? ORCHESTRATOR_PHASE_TRACK.slice(0, maxObservedIndex + 1)
    : ORCHESTRATOR_PHASE_TRACK;
  const activePhase = ORCHESTRATOR_PHASE_TRACK.includes(displayedPhase as (typeof ORCHESTRATOR_PHASE_TRACK)[number])
    ? displayedPhase
    : currentCapabilityPhase;
  const failureMessage = lastFailure
    ? formatDisplayValue(lastFailure.payload.error ?? "unknown error", 140)
    : "";
  const activeMessage = schedulerMessage || (
    invocationInFlight
      ? (languagePreference === "ko" ? "응답 대기 중" : "Waiting for response")
      : responseSummary
  );
  const steps = visiblePhases.map((phase) => {
    let state: OrchestratorNodeProgressStepState = "pending";
    let stepDetail = "";

    if (lastFailure && phase === failurePhase) {
      state = "failed";
      stepDetail = failureMessage;
    } else if (activePhase === phase && node.phase !== "done" && node.phase !== "escalated") {
      state = "active";
      stepDetail = activeMessage;
    } else if (completedPhases.has(phase) || (node.phase === "done" && observedPhases.has(phase))) {
      state = "done";
      if (phase === currentCapabilityPhase && responseSummary) {
        stepDetail = responseSummary;
      }
    }

    return {
      phase,
      label: formatNodePhaseLabel(phase),
      state,
      detail: stepDetail
    };
  });
  const completedStepCount = steps.filter((step) => step.state === "done").length;
  const activeStepCount = steps.some((step) => step.state === "active" || step.state === "failed") ? 1 : 0;
  const completionRatio = steps.length === 0
    ? 0
    : Math.min(1, (completedStepCount + (tone === "done" ? 1 : activeStepCount * 0.55)) / steps.length);
  const elapsed = formatElapsedDuration(node.createdAt, resolveNodeElapsedEnd(detail, node, tone));

  return {
    tone,
    summary,
    detail: detailLine,
    objective: node.objective,
    model: modelLabel,
    executionStatus,
    elapsed,
    updatedAt: formatTimestamp(lastEvent?.createdAt ?? detail.run.updatedAt),
    completionRatio,
    steps
  };
}

function buildSelectedNodeLiveView(detail: OrchestratorRunDetail | null): SelectedNodeLiveView {
  if (!detail) {
    return {
      status: translate("ui.orchestratorCommandStatusIdle"),
      progress: null,
      terminal: translate("ui.orchestratorNodeTerminalEmpty"),
      log: translate("ui.orchestratorNodeLogEmpty"),
      hasLog: false,
      requestJson: translate("ui.orchestratorNodeRequestEmpty"),
      responseJson: translate("ui.orchestratorNodeResponseEmpty"),
      executionPlan: translate("ui.orchestratorNodePlanEmpty"),
      hasExecutionPlan: false,
      pendingApproval: null,
      pendingUserInput: null
    };
  }

  const selectedNode = resolveSelectedOrchestratorNode(detail);
  if (!selectedNode) {
    return {
      status: translate("ui.orchestratorCommandStatusIdle"),
      progress: null,
      terminal: translate("ui.orchestratorNodeTerminalEmpty"),
      log: translate("ui.orchestratorNodeLogEmpty"),
      hasLog: false,
      requestJson: translate("ui.orchestratorNodeRequestEmpty"),
      responseJson: translate("ui.orchestratorNodeResponseEmpty"),
      executionPlan: translate("ui.orchestratorNodePlanEmpty"),
      hasExecutionPlan: false,
      pendingApproval: null,
      pendingUserInput: null
    };
  }

  const nodeEvents = getDisplayNodeEvents(detail, selectedNode);
  const progress = buildNodeProgressView(detail, selectedNode, nodeEvents);
  const pendingApproval = getPendingApproval(nodeEvents);
  const pendingUserInput = getPendingUserInput(nodeEvents);
  const lastInvocation = getLatestEventFromList(nodeEvents, "model_invocation");
  const lastResponse = getLatestEventFromList(nodeEvents, "model_response");
  const lastFailure = getLatestEventFromList(nodeEvents, "node_failed");
  const command = Array.isArray(lastInvocation?.payload.command)
    ? lastInvocation.payload.command.filter((value): value is string => typeof value === "string")
    : [];

  let status = translate("ui.orchestratorCommandStatusIdle");
  if (pendingApproval) {
    status = translate("ui.orchestratorApprovalWaiting");
  } else if (pendingUserInput) {
    status = translate("ui.orchestratorUserInputWaiting");
  } else if (lastFailure) {
    status = translate("ui.orchestratorCommandStatusFailed");
  } else if (lastResponse) {
    status = translate("ui.orchestratorCommandStatusResponded");
  } else if (lastInvocation) {
    status = translate("ui.orchestratorCommandStatusDispatched");
  } else if (selectedNode.phase === "done") {
    status = translate("ui.orchestratorCommandStatusResponded");
  }

  const nodeLogEvents = nodeEvents
    .filter((event) => isNodeDetailEvent(event))
    .slice(-ORCHESTRATOR_NODE_LOG_EVENT_LIMIT);
  const logLines: string[] = [];
  for (const event of nodeLogEvents) {
    let lines: string[];
    if (event.type === "model_invocation") {
      lines = formatModelInvocationDebugLog(event);
    } else if (event.type === "model_response") {
      lines = formatModelResponseDebugLog(event);
    } else if (event.type === "execution_status") {
      lines = formatExecutionStatusDebugLog(event);
    } else {
      lines = summarizeEvent(event);
    }
    logLines.push(...withLogLevel(lines, getEventLogLevel(event)));
    logLines.push("");
  }

  const executionPlanView = buildNodeExecutionPlanView(nodeEvents);
  const terminalSections: string[] = [];
  if (command.length > 0) {
    terminalSections.push(`$ ${formatCommand(command)}`);
  }
  if (pendingApproval) {
    terminalSections.push(`[approval] ${pendingApproval.title || pendingApproval.message}`);
  }
  if (pendingUserInput) {
    terminalSections.push(`[input] ${pendingUserInput.title || pendingUserInput.message}`);
  }
  if (logLines.length > 0) {
    terminalSections.push(logLines.join("\n").trim());
  }

  const fallbackTerminal = terminalSections.join("\n\n").trim() || translate("ui.orchestratorNodeTerminalEmpty");

  return {
    status,
    progress,
    terminal: buildNodeTerminalTranscript(nodeEvents, fallbackTerminal),
    log: logLines.join("\n").trim() || translate("ui.orchestratorNodeLogEmpty"),
    hasLog: nodeLogEvents.length > 0,
    requestJson: buildNodeRequestJsonView(nodeEvents),
    responseJson: buildNodeResponseJsonView(nodeEvents),
    executionPlan: executionPlanView.text,
    hasExecutionPlan: executionPlanView.hasPlan,
    pendingApproval,
    pendingUserInput
  };
}

function buildWorkingMemoryText(detail: OrchestratorRunDetail | null): string {
  if (!detail) {
    return translate("ui.orchestratorWorkingMemoryEmpty");
  }

  const sections: string[] = [];
  const appendSection = (title: string, lines: string[]) => {
    if (lines.length === 0) {
      return;
    }

    sections.push(`${title} (${lines.length})`, ...lines.map((line, index) => `${index + 1}. ${line}`), "");
  };

  appendSection(
    translate("ui.orchestratorWorkingMemoryFacts"),
    detail.workingMemory.facts.map((fact) => fact.statement.trim()).filter((statement) => statement.length > 0)
  );
  appendSection(
    translate("ui.orchestratorWorkingMemoryOpenQuestions"),
    detail.workingMemory.openQuestions
      .filter((question) => question.status === "open")
      .map((question) => question.question.trim())
      .filter((question) => question.length > 0)
  );
  appendSection(
    translate("ui.orchestratorWorkingMemoryUnknowns"),
    detail.workingMemory.unknowns
      .filter((unknown) => unknown.status === "open")
      .map((unknown) => unknown.description.trim())
      .filter((description) => description.length > 0)
  );
  appendSection(
    translate("ui.orchestratorWorkingMemoryConflicts"),
    detail.workingMemory.conflicts
      .filter((conflict) => conflict.status === "open")
      .map((conflict) => conflict.summary.trim())
      .filter((summary) => summary.length > 0)
  );
  appendSection(
    translate("ui.orchestratorWorkingMemoryDecisions"),
    detail.workingMemory.decisions
      .map((decision) => {
        const summary = decision.summary.trim();
        const rationale = decision.rationale.trim();
        if (!summary && !rationale) {
          return "";
        }

        return rationale.length > 0 ? `${summary}\n   rationale: ${rationale}` : summary;
      })
      .filter((entry) => entry.length > 0)
  );

  return sections.length > 0
    ? sections.join("\n").trim()
    : translate("ui.orchestratorWorkingMemoryEmpty");
}

function buildOrchestratorLog(detail: OrchestratorRunDetail | null): string {
  if (!detail) {
    return translate("ui.orchestratorLogEmpty");
  }

  const visibleEvents = detail.events
    .filter((event) => isOrchestratorOverviewEvent(event))
    .slice(-ORCHESTRATOR_RUN_LOG_EVENT_LIMIT);
  if (visibleEvents.length === 0) {
    return translate("ui.orchestratorLogEmpty");
  }

  return visibleEvents
    .map((event) => formatOrchestratorLogEntry(detail, event))
    .join("\n\n")
    .trim();
}

function renderNodeProgressPanel(container: HTMLDivElement, progress: OrchestratorNodeProgressView | null) {
  container.replaceChildren();

  if (!progress) {
    container.textContent = translate("ui.orchestratorNodeLiveEmpty");
    return;
  }

  const shell = document.createElement("div");
  shell.className = `orchestrator-progress-shell tone-${progress.tone}`;

  const overview = document.createElement("div");
  overview.className = "orchestrator-progress-overview";

  const kicker = document.createElement("div");
  kicker.className = "orchestrator-progress-kicker";
  kicker.textContent = translate("ui.orchestratorNodeProgressCurrent");

  const summary = document.createElement("div");
  summary.className = "orchestrator-progress-summary";

  const pulse = document.createElement("span");
  pulse.className = "orchestrator-progress-pulse";

  const summaryText = document.createElement("strong");
  summaryText.textContent = progress.summary;

  summary.append(pulse, summaryText);

  const detail = document.createElement("div");
  detail.className = "orchestrator-progress-detail";
  detail.textContent = progress.detail;

  overview.append(kicker, summary, detail);

  const stats = document.createElement("dl");
  stats.className = "orchestrator-progress-stats";

  const appendStat = (label: string, value: string) => {
    const row = document.createElement("div");
    row.className = "orchestrator-progress-stat";

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    description.textContent = value;

    row.append(term, description);
    stats.appendChild(row);
  };

  appendStat(translate("ui.orchestratorNodeProgressObjective"), progress.objective);
  appendStat(translate("ui.orchestratorNodeProgressModel"), progress.model);
  appendStat(translate("ui.orchestratorNodeProgressExecution"), progress.executionStatus);
  appendStat(translate("ui.orchestratorNodeProgressElapsed"), progress.elapsed);
  appendStat(translate("ui.orchestratorNodeProgressUpdated"), progress.updatedAt);

  const track = document.createElement("div");
  track.className = "orchestrator-progress-track";

  const trackHeader = document.createElement("div");
  trackHeader.className = "orchestrator-progress-kicker";
  trackHeader.textContent = translate("ui.orchestratorNodeProgressTrack");

  const bar = document.createElement("div");
  bar.className = "orchestrator-progress-bar";

  const fill = document.createElement("div");
  fill.className = "orchestrator-progress-bar-fill";
  fill.style.width = `${Math.max(0, Math.min(100, progress.completionRatio * 100))}%`;

  bar.appendChild(fill);

  const steps = document.createElement("ol");
  steps.className = "orchestrator-progress-steps";

  for (const step of progress.steps) {
    const item = document.createElement("li");
    item.className = `orchestrator-progress-step state-${step.state}`;

    const marker = document.createElement("span");
    marker.className = "orchestrator-progress-step-marker";

    const body = document.createElement("div");
    body.className = "orchestrator-progress-step-body";

    const title = document.createElement("div");
    title.className = "orchestrator-progress-step-title";
    title.textContent = step.label;

    body.appendChild(title);

    if (step.detail.length > 0) {
      const subtitle = document.createElement("div");
      subtitle.className = "orchestrator-progress-step-detail";
      subtitle.textContent = step.detail;
      body.appendChild(subtitle);
    }

    item.append(marker, body);
    steps.appendChild(item);
  }

  track.append(trackHeader, bar, steps);
  shell.append(overview, stats, track);
  container.appendChild(shell);
}

function renderNodeApprovalCard(pendingApproval: OrchestratorPendingApproval | null) {
  orchestratorNodeApprovalEl.hidden = pendingApproval === null;
  orchestratorNodeApprovalActionsEl.replaceChildren();

  if (!pendingApproval) {
    orchestratorNodeApprovalTitleEl.textContent = translate("ui.orchestratorApprovalTitle");
    orchestratorNodeApprovalStatusEl.textContent = translate("ui.orchestratorApprovalWaiting");
    orchestratorNodeApprovalMessageEl.textContent = translate("ui.orchestratorApprovalEmpty");
    orchestratorNodeApprovalDetailsEl.textContent = "";
    return;
  }

  orchestratorNodeApprovalTitleEl.textContent = pendingApproval.title;
  orchestratorNodeApprovalStatusEl.textContent = translate("ui.orchestratorApprovalWaiting");
  orchestratorNodeApprovalMessageEl.textContent = pendingApproval.message;
  orchestratorNodeApprovalDetailsEl.textContent = pendingApproval.details;
  createApprovalActionButtons(orchestratorNodeApprovalActionsEl, pendingApproval);
}

function renderPendingApprovalsCard(pendingApprovals: QueuedPendingApproval[]) {
  orchestratorPendingApprovalsEl.hidden = false;
  orchestratorPendingApprovalsTitleEl.textContent = translate("ui.orchestratorPendingApprovalsTitle");
  orchestratorPendingApprovalsStatusEl.textContent = String(pendingApprovals.length);
  orchestratorPendingApprovalsListEl.replaceChildren();

  if (pendingApprovals.length === 0) {
    const empty = document.createElement("div");
    empty.className = "orchestrator-pending-approval-copy";
    empty.textContent = translate("ui.orchestratorPendingApprovalsEmpty");
    orchestratorPendingApprovalsListEl.appendChild(empty);
    return;
  }

  for (const approval of pendingApprovals) {
    const item = document.createElement("div");
    item.className = "orchestrator-pending-approval-item";

    const head = document.createElement("div");
    head.className = "orchestrator-pending-approval-head";

    const title = document.createElement("div");
    title.className = "orchestrator-pending-approval-title";
    title.textContent = approval.nodeTitle;
    title.title = approval.nodeTitle;

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "orchestrator-copy-button";
    openButton.textContent = translate("ui.orchestratorApprovalReview");
    openButton.disabled = pendingApprovalActionRequestId === approval.requestId;
    openButton.addEventListener("click", () => {
      openApprovalDialog(approval.requestId);
    });

    head.append(title, openButton);

    const copy = document.createElement("div");
    copy.className = "orchestrator-pending-approval-copy";
    copy.textContent = approval.message || translate("ui.orchestratorApprovalEmpty");

    item.append(head, copy);
    orchestratorPendingApprovalsListEl.appendChild(item);
  }
}

function renderNodeUserInputCard(pendingUserInput: OrchestratorPendingUserInput | null) {
  orchestratorNodeUserInputEl.hidden = pendingUserInput === null;
  orchestratorNodeUserInputFormEl.replaceChildren();
  orchestratorNodeUserInputActionsEl.replaceChildren();

  if (!pendingUserInput) {
    orchestratorNodeUserInputTitleEl.textContent = translate("ui.orchestratorUserInputTitle");
    orchestratorNodeUserInputStatusEl.textContent = translate("ui.orchestratorUserInputWaiting");
    orchestratorNodeUserInputMessageEl.textContent = translate("ui.orchestratorUserInputEmpty");
    return;
  }

  orchestratorNodeUserInputTitleEl.textContent = pendingUserInput.title;
  orchestratorNodeUserInputStatusEl.textContent = translate("ui.orchestratorUserInputWaiting");
  orchestratorNodeUserInputMessageEl.textContent = pendingUserInput.message;

  for (const question of pendingUserInput.questions) {
    const wrapper = document.createElement("div");
    wrapper.className = "orchestrator-node-user-input-question";

    const header = document.createElement("div");
    header.className = "orchestrator-node-user-input-question-header";

    const title = document.createElement("strong");
    title.textContent = question.header;

    const meta = document.createElement("span");
    meta.textContent = question.isSecret
      ? (languagePreference === "ko" ? "비공개 입력" : "Secret input")
      : (question.options && question.options.length > 0
        ? (languagePreference === "ko" ? "선택 또는 입력" : "Select or type")
        : (languagePreference === "ko" ? "텍스트 입력" : "Text input"));

    header.append(title, meta);

    const copy = document.createElement("div");
    copy.className = "orchestrator-node-user-input-question-copy";
    copy.textContent = question.question;

    wrapper.append(header, copy);

    if (question.options && question.options.length > 0) {
      const select = document.createElement("select");
      select.name = question.id;
      select.disabled = pendingUserInputActionRequestId === pendingUserInput.requestId;

      const placeholderOption = document.createElement("option");
      placeholderOption.value = "";
      placeholderOption.textContent = languagePreference === "ko" ? "선택하세요" : "Select an option";
      select.appendChild(placeholderOption);

      for (const option of question.options) {
        const optionEl = document.createElement("option");
        optionEl.value = option.label;
        optionEl.textContent = option.description
          ? `${option.label} - ${option.description}`
          : option.label;
        select.appendChild(optionEl);
      }

      select.value = getUserInputDraftValue(pendingUserInput.requestId, question.id);
      select.addEventListener("change", () => {
        setUserInputDraftValue(pendingUserInput.requestId, question.id, select.value);
      });
      wrapper.appendChild(select);
    }

    if (!question.options || question.isOther) {
      const draftKey = question.options ? `${question.id}__other` : question.id;
      const control: HTMLInputElement | HTMLTextAreaElement = question.isSecret
        ? document.createElement("input")
        : (question.options ? document.createElement("input") : document.createElement("textarea"));

      if (control instanceof HTMLInputElement) {
        control.type = question.isSecret ? "password" : "text";
      }

      control.setAttribute("name", draftKey);
      control.setAttribute("placeholder", translate("ui.orchestratorUserInputPlaceholder"));
      control.disabled = pendingUserInputActionRequestId === pendingUserInput.requestId;
      control.value = getUserInputDraftValue(pendingUserInput.requestId, draftKey);
      control.addEventListener("input", () => {
        setUserInputDraftValue(pendingUserInput.requestId, draftKey, control.value);
      });
      wrapper.appendChild(control);
    }

    orchestratorNodeUserInputFormEl.appendChild(wrapper);
  }

  const submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.className = "orchestrator-copy-button";
  submitButton.textContent = translate("ui.orchestratorUserInputSubmit");
  submitButton.disabled = pendingUserInputActionRequestId === pendingUserInput.requestId;
  submitButton.addEventListener("click", () => {
    void respondToPendingUserInput(pendingUserInput);
  });

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "orchestrator-copy-button";
  cancelButton.textContent = translate("ui.orchestratorUserInputCancel");
  cancelButton.disabled = pendingUserInputActionRequestId === pendingUserInput.requestId;
  cancelButton.addEventListener("click", () => {
    void respondToPendingUserInput(pendingUserInput, true);
  });

  orchestratorNodeUserInputActionsEl.append(submitButton, cancelButton);
}

function renderOrchestratorDetailTabs() {
  const isNodeTab = activeOrchestratorDetailTab === "node";
  orchestratorDetailTabNodeButton.classList.toggle("active", isNodeTab);
  orchestratorDetailTabNodeButton.setAttribute("aria-selected", String(isNodeTab));
  orchestratorDetailTabMemoryButton.classList.toggle("active", !isNodeTab);
  orchestratorDetailTabMemoryButton.setAttribute("aria-selected", String(!isNodeTab));
  orchestratorDetailPanelNodeEl.hidden = !isNodeTab;
  orchestratorDetailPanelMemoryEl.hidden = isNodeTab;
  if (isNodeTab) {
    scheduleFitOrchestratorNodeTerminal();
  }
}

function setActiveOrchestratorDetailTab(tab: OrchestratorDetailTab) {
  activeOrchestratorDetailTab = tab;
  renderOrchestratorDetailTabs();
}

function getReviewNextActions(detail: OrchestratorRunDetail | null): OrchestratorNextAction[] {
  return detail?.finalReport?.nextActions ?? [];
}

function getSelectedNextActionIndex(detail: OrchestratorRunDetail | null): number | null {
  if (!detail) {
    return null;
  }

  const nextActions = getReviewNextActions(detail);
  if (nextActions.length === 0) {
    selectedNextActionIndexByRun.delete(detail.run.id);
    return null;
  }

  const storedIndex = selectedNextActionIndexByRun.get(detail.run.id);
  const normalizedIndex = storedIndex === undefined
    ? 0
    : Math.max(0, Math.min(nextActions.length - 1, storedIndex));
  selectedNextActionIndexByRun.set(detail.run.id, normalizedIndex);
  return normalizedIndex;
}

function getSelectedNextAction(detail: OrchestratorRunDetail | null): OrchestratorNextAction | null {
  const index = getSelectedNextActionIndex(detail);
  if (index === null) {
    return null;
  }

  return getReviewNextActions(detail)[index] ?? null;
}

function formatNextActionPriority(priority: OrchestratorNextAction["priority"]): string {
  const localizedPriority = languagePreference === "ko"
    ? ({
        critical: "매우 높음",
        high: "높음",
        medium: "보통",
        low: "낮음"
      } as const)[priority]
    : ({
        critical: "Critical",
        high: "High",
        medium: "Medium",
        low: "Low"
      } as const)[priority];
  return translate("ui.orchestratorNextActionPriority", { priority: localizedPriority });
}

function buildCarryForwardSummary(carryForward: OrchestratorCarryForward | undefined): string {
  return translate("ui.orchestratorCarryForwardSummary", {
    facts: String(carryForward?.facts.length ?? 0),
    questions: String(carryForward?.openQuestions.length ?? 0),
    paths: String(carryForward?.projectPaths.length ?? 0),
    evidence: String(carryForward?.evidenceSummaries.length ?? 0)
  });
}

function buildNextActionTooltip(action: OrchestratorNextAction, detail: OrchestratorRunDetail): string {
  const carryForwardSummary = buildCarryForwardSummary(detail.finalReport?.carryForward);
  return [
    action.title,
    "",
    formatNextActionPriority(action.priority),
    "",
    action.objective,
    "",
    action.rationale,
    "",
    carryForwardSummary,
    detail.finalReport?.carryForward?.projectPaths.length
      ? detail.finalReport.carryForward.projectPaths.join("\n")
      : null
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function renderReviewNextActionsCard(detail: OrchestratorRunDetail | null) {
  const nextActions = getReviewNextActions(detail);
  const selectedAction = getSelectedNextAction(detail);
  orchestratorNextActionsTitleEl.textContent = translate("ui.orchestratorNextActionsTitle");
  orchestratorNextActionsSummaryEl.textContent = detail?.finalReport?.carryForward
    ? buildCarryForwardSummary(detail.finalReport.carryForward)
    : selectedAction?.rationale ?? "";
  orchestratorNextActionsSummaryEl.title = detail?.finalReport?.carryForward
    ? [
        buildCarryForwardSummary(detail.finalReport.carryForward),
        "",
        ...detail.finalReport.carryForward.facts,
        ...detail.finalReport.carryForward.openQuestions,
        ...detail.finalReport.carryForward.projectPaths,
        ...detail.finalReport.carryForward.evidenceSummaries
      ].join("\n")
    : (selectedAction?.rationale ?? "");
  orchestratorNextActionsListEl.innerHTML = "";
  orchestratorNextActionsStatusEl.textContent = String(nextActions.length);
  orchestratorNextActionsEl.hidden = false;

  if (!detail || nextActions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "orchestrator-next-action-empty";
    empty.textContent = translate("ui.orchestratorNextActionsEmpty");
    orchestratorNextActionsListEl.appendChild(empty);
    return;
  }

  const selectedIndex = getSelectedNextActionIndex(detail) ?? 0;
  for (const [index, action] of nextActions.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "orchestrator-next-action-item";
    button.classList.toggle("active", index === selectedIndex);
    button.title = buildNextActionTooltip(action, detail);

    const header = document.createElement("div");
    header.className = "orchestrator-next-action-head";

    const title = document.createElement("strong");
    title.className = "orchestrator-next-action-title";
    title.textContent = action.title;

    const badges = document.createElement("div");
    badges.className = "orchestrator-next-action-badges";

    const priority = document.createElement("span");
    priority.className = "orchestrator-next-action-badge";
    priority.textContent = formatNextActionPriority(action.priority);

    badges.appendChild(priority);
    if (index === selectedIndex) {
      const selectedBadge = document.createElement("span");
      selectedBadge.className = "orchestrator-next-action-badge selected";
      selectedBadge.textContent = translate("ui.orchestratorNextActionSelected");
      badges.appendChild(selectedBadge);
    }

    header.append(title, badges);

    const objective = document.createElement("div");
    objective.className = "orchestrator-next-action-objective";
    objective.textContent = action.objective;

    const rationale = document.createElement("div");
    rationale.className = "orchestrator-next-action-rationale";
    rationale.textContent = action.rationale;

    button.append(header, objective, rationale);
    button.addEventListener("click", () => {
      selectedNextActionIndexByRun.set(detail.run.id, index);
      renderOrchestratorDetail();
    });
    orchestratorNextActionsListEl.appendChild(button);
  }
}

function getNodeActivityPreview(detail: OrchestratorRunDetail, node: OrchestratorPlanNode): {
  tone: OrchestratorProgressTone;
  summary: string;
} {
  if (node.role === "task") {
    const stageChildren = getTaskStageChildren(detail, node);
    const activeStage = [...stageChildren]
      .reverse()
      .find((child) => child.phase !== "done" && child.phase !== "escalated")
      ?? stageChildren.at(-1);

    if (activeStage) {
      const progress = buildNodeProgressView(detail, activeStage, getNodeEvents(detail, activeStage.id));
      return {
        tone: progress.tone,
        summary: progress.detail.length > 0
          ? `${formatNodeRoleLabel(node)} · ${progress.summary} · ${truncateText(progress.detail, 72)}`
          : `${formatNodeRoleLabel(node)} · ${progress.summary}`
      };
    }
  }

  const progress = buildNodeProgressView(detail, node, getNodeEvents(detail, node.id));
  return {
    tone: progress.tone,
    summary: progress.detail.length > 0
      ? `${progress.summary} · ${truncateText(progress.detail, 96)}`
      : progress.summary
  };
}

function resolveSelectedOrchestratorNode(detail: OrchestratorRunDetail | null): OrchestratorPlanNode | null {
  if (!detail || detail.nodes.length === 0) {
    selectedOrchestratorNodeId = null;
    return null;
  }

  const existingNode = selectedOrchestratorNodeId
    ? detail.nodes.find((node) => node.id === selectedOrchestratorNodeId) ?? null
    : null;
  if (existingNode) {
    return existingNode;
  }

  const defaultNode = [...detail.nodes]
    .reverse()
    .find((node) => node.role === "stage" && node.phase !== "done" && node.phase !== "escalated")
    ?? [...detail.nodes].reverse().find((node) => node.role === "stage")
    ?? detail.nodes.find((node) => node.parentId === null)
    ?? detail.nodes[0]
    ?? null;
  selectedOrchestratorNodeId = defaultNode?.id ?? null;
  return defaultNode;
}

function shouldTickSelectedNodeProgress(detail: OrchestratorRunDetail | null): boolean {
  if (!detail) {
    return false;
  }

  const node = resolveSelectedOrchestratorNode(detail);
  if (!node || node.completedAt) {
    return false;
  }

  return detail.run.status === "pending" || detail.run.status === "running";
}

function renderOrchestratorRunList() {
  const signature = `${languagePreference}|${selectedOrchestratorRunId ?? ""}|${orchestratorRuns
    .map((run) => `${run.id}:${run.status}:${run.updatedAt}`)
    .join("|")}`;
  if (signature === lastOrchestratorRunListSignature) {
    return;
  }

  lastOrchestratorRunListSignature = signature;
  orchestratorRunListEl.innerHTML = "";

  if (orchestratorRuns.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty";
    emptyItem.textContent = translate("ui.orchestratorNoRuns");
    orchestratorRunListEl.appendChild(emptyItem);
    return;
  }

  for (const run of orchestratorRuns) {
    const item = document.createElement("li");
    if (run.id === selectedOrchestratorRunId) item.classList.add("active");

    const goal = document.createElement("strong");
    goal.className = "orchestrator-run-goal";
    goal.textContent = run.goal;

    const meta = document.createElement("span");
    meta.className = "orchestrator-run-meta";
    meta.textContent = `${run.status} · ${formatTimestamp(run.updatedAt)}`;

    item.append(goal, meta);
    item.addEventListener("click", () => {
      void selectOrchestratorRun(run.id);
    });
    orchestratorRunListEl.appendChild(item);
  }
}

function renderOrchestratorDetail() {
  const selectedNode = resolveSelectedOrchestratorNode(selectedOrchestratorRun);
  const signature = selectedOrchestratorRun
    ? [
      languagePreference,
      selectedOrchestratorRun.run.id,
      selectedOrchestratorRun.run.status,
      selectedOrchestratorRun.run.updatedAt,
      selectedOrchestratorRun.run.completedAt ?? "",
      String(selectedOrchestratorRun.nodes.length),
      String(selectedOrchestratorRun.events.length),
      selectedOrchestratorRun.finalReport?.summary ?? "",
      selectedOrchestratorRun.finalReport?.nextActions?.map((action) => `${action.title}:${action.priority}`).join("~") ?? "",
      String(getSelectedNextActionIndex(selectedOrchestratorRun) ?? -1),
      selectedNode?.id ?? "",
      shouldTickSelectedNodeProgress(selectedOrchestratorRun) ? String(orchestratorElapsedClock) : "",
      String(selectedOrchestratorRun.workingMemory.facts.length),
      String(selectedOrchestratorRun.workingMemory.openQuestions.filter((question) => question.status === "open").length),
      String(selectedOrchestratorRun.workingMemory.unknowns.filter((unknown) => unknown.status === "open").length),
      String(selectedOrchestratorRun.workingMemory.conflicts.filter((conflict) => conflict.status === "open").length),
      String(selectedOrchestratorRun.workingMemory.decisions.length)
    ].join("|")
    : `__empty__:${languagePreference}`;

  if (signature === lastOrchestratorDetailSignature) {
    return;
  }

  lastOrchestratorDetailSignature = signature;
  const liveView = buildSelectedNodeLiveView(selectedOrchestratorRun);
  const selectedNodeRenderKey = selectedOrchestratorRun && selectedNode
    ? `${selectedOrchestratorRun.run.id}:${selectedNode.id}`
    : "__empty__";
  const pendingApprovals = listPendingApprovals(selectedOrchestratorRun);
  renderReviewNextActionsCard(selectedOrchestratorRun);
  orchestratorNodeLiveStatusEl.textContent = liveView.status;
  renderNodeProgressPanel(orchestratorNodeLiveMetaEl, liveView.progress);
  renderPendingApprovalsCard(pendingApprovals);
  renderNodeApprovalCard(liveView.pendingApproval);
  renderNodeUserInputCard(liveView.pendingUserInput);
  orchestratorNodeRequestDataEl.textContent = liveView.requestJson;
  orchestratorNodeResponseDataEl.textContent = liveView.responseJson;
  orchestratorNodePlanDataEl.textContent = liveView.executionPlan;
  orchestratorNodeRequestOpenButton.disabled = liveView.progress === null;
  orchestratorNodeResponseOpenButton.disabled = liveView.progress === null;
  orchestratorNodePlanOpenButton.disabled = !liveView.hasExecutionPlan;
  orchestratorNodeLogOpenButton.disabled = !liveView.hasLog;
  renderOrchestratorNodeTerminalTranscript(liveView.terminal, selectedNodeRenderKey);
  orchestratorNodeLogEl.textContent = liveView.log;
  orchestratorWorkingMemoryEl.textContent = buildWorkingMemoryText(selectedOrchestratorRun);
  orchestratorWorkingMemoryOpenButton.disabled = selectedOrchestratorRun === null;
  orchestratorWorkingMemoryCopyButton.disabled = selectedOrchestratorRun === null;
  orchestratorLogEl.textContent = buildOrchestratorLog(selectedOrchestratorRun);
  renderApprovalQueueButton();
  renderOrchestratorDetailTabs();
  syncLogViewerContent();
  renderApprovalDialog();
}

function renderOrchestratorTree() {
  const selectedNode = resolveSelectedOrchestratorNode(selectedOrchestratorRun);
  const signature = selectedOrchestratorRun
    ? [
      languagePreference,
      selectedOrchestratorRun.run.id,
      selectedOrchestratorRun.run.updatedAt,
      selectedNode?.id ?? "",
      selectedOrchestratorRun.nodes
        .map((node) => `${node.id}:${node.parentId ?? "root"}:${node.role}:${node.stagePhase ?? "-"}:${node.phase}:${node.depth}:${node.title}`)
        .join("|")
    ].join("|")
    : `__empty__:${languagePreference}`;

  if (signature === lastOrchestratorTreeSignature) {
    return;
  }

  lastOrchestratorTreeSignature = signature;
  orchestratorTreeTitleEl.textContent = translate("ui.orchestratorTreeTitle");

  const detail = selectedOrchestratorRun;
  const nodes = selectedOrchestratorRun?.nodes ?? [];
  orchestratorTreeMetaEl.textContent = translate("ui.orchestratorTreeMeta", { count: String(nodes.length) });
  orchestratorTreeEl.innerHTML = "";

  if (!detail || nodes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "orchestrator-tree-empty";
    empty.textContent = translate("ui.orchestratorTreeEmpty");
    orchestratorTreeEl.appendChild(empty);
    return;
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childMap = new Map<string | null, OrchestratorPlanNode[]>();

  for (const node of nodes) {
    const parentKey = node.parentId && nodeById.has(node.parentId) ? node.parentId : null;
    const siblings = childMap.get(parentKey) ?? [];
    siblings.push(node);
    childMap.set(parentKey, siblings);
  }

  const buildTreeList = (parentId: string | null): HTMLUListElement | null => {
    const children = childMap.get(parentId);
    if (!children || children.length === 0) {
      return null;
    }

    const list = document.createElement("ul");
    list.className = parentId === null ? "orchestrator-tree-list" : "orchestrator-tree-children";

    for (const node of children) {
      const item = document.createElement("li");
      item.className = "orchestrator-tree-item";

      const card = document.createElement("button");
      card.type = "button";
      card.className = `orchestrator-tree-node role-${node.role} phase-${getDisplayedNodePhase(node)}`;
      if (selectedNode?.id === node.id) {
        card.classList.add("active");
      }
      card.title = node.objective;
      card.addEventListener("click", () => {
        selectedOrchestratorNodeId = node.id;
        renderOrchestratorTree();
        renderOrchestratorDetail();
      });

      const head = document.createElement("div");
      head.className = "orchestrator-tree-node-head";

      const title = document.createElement("strong");
      title.className = "orchestrator-tree-node-title";
      title.textContent = node.title;

      const phase = document.createElement("span");
      phase.className = "orchestrator-tree-node-phase";
      phase.textContent = formatNodeRoleLabel(node);

      head.append(title, phase);

      const depth = document.createElement("div");
      depth.className = "orchestrator-tree-node-depth";
      depth.textContent = node.role === "stage"
        ? (languagePreference === "ko" ? `단계 · depth ${node.depth}` : `stage · depth ${node.depth}`)
        : (languagePreference === "ko" ? `태스크 · depth ${node.depth}` : `task · depth ${node.depth}`);

      const objective = document.createElement("div");
      objective.className = "orchestrator-tree-node-objective";
      objective.textContent = node.objective;

      const models = getNodeModelLabels(detail, node);
      const modelSummary = document.createElement("div");
      modelSummary.className = "orchestrator-tree-node-models";
      modelSummary.textContent = models.length > 0
        ? models.join(", ")
        : (languagePreference === "ko" ? "모델 미정" : "Model pending");

      const activity = getNodeActivityPreview(detail, node);
      const activitySummary = document.createElement("div");
      activitySummary.className = `orchestrator-tree-node-activity tone-${activity.tone}`;
      activitySummary.textContent = activity.summary;

      card.append(head, depth, objective, modelSummary, activitySummary);
      item.append(card);

      const branch = buildTreeList(node.id);
      if (branch) {
        item.append(branch);
      }

      list.appendChild(item);
    }

    return list;
  };

  const rootList = buildTreeList(null);
  if (rootList) {
    orchestratorTreeEl.appendChild(rootList);
  }
}

function isThemePreference(value: string | undefined): value is ThemePreference {
  return value === "light" || value === "dark";
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

    if (storedPreference === "system") {
      const resolvedTheme: ThemePreference = appWindow.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      window.localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
      return resolvedTheme;
    }
  } catch {
    // Ignore storage access failures and fall back to the default theme.
  }

  return "light";
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
  return preference;
}

function persistThemePreference(preference: ThemePreference) {
  try {
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

function getInitialMainSplitterRatio(): number | null {
  try {
    const storedRatio = window.localStorage.getItem(MAIN_SPLITTER_RATIO_STORAGE_KEY);
    if (!storedRatio) return null;

    const ratio = Number.parseFloat(storedRatio);
    if (!Number.isFinite(ratio)) return null;
    if (ratio < MAIN_SPLITTER_MIN_RATIO || ratio > MAIN_SPLITTER_MAX_RATIO) return null;
    return ratio;
  } catch {
    return null;
  }
}

function persistMainSplitterRatio(ratio: number) {
  try {
    window.localStorage.setItem(MAIN_SPLITTER_RATIO_STORAGE_KEY, ratio.toFixed(4));
  } catch {
    // Ignore storage access failures and keep the in-memory size.
  }
}

function clearMainSplitterRatio() {
  try {
    window.localStorage.removeItem(MAIN_SPLITTER_RATIO_STORAGE_KEY);
  } catch {
    // Ignore storage access failures and keep the computed size.
  }
}

function isDesktopMainSplitterEnabled(): boolean {
  return false;
}

function setMainSplitterRatio(ratio: number, persist = true) {
  const clampedRatio = Math.min(MAIN_SPLITTER_MAX_RATIO, Math.max(MAIN_SPLITTER_MIN_RATIO, ratio));
  mainSplitterRatio = clampedRatio;

  if (!isDesktopMainSplitterEnabled()) {
    mainEl.style.removeProperty("--orchestrator-panel-height");
    return;
  }

  const computedStyle = appWindow.getComputedStyle(mainEl);
  const splitterSize = Number.parseFloat(computedStyle.getPropertyValue("--main-splitter-size")) || 12;
  const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
  const minHeight = Number.parseFloat(computedStyle.getPropertyValue("--orchestrator-panel-min-height")) || 280;
  const maxHeight = Math.max(
    minHeight,
    mainEl.clientHeight
      - paddingTop
      - paddingBottom
      - splitterSize
      - (Number.parseFloat(computedStyle.getPropertyValue("--terminal-panel-min-height")) || 220)
  );
  const availableHeight = Math.max(0, maxHeight);
  const nextHeight = Math.min(maxHeight, Math.max(minHeight, availableHeight * clampedRatio));
  mainEl.style.setProperty("--orchestrator-panel-height", `${nextHeight}px`);

  if (persist) {
    persistMainSplitterRatio(clampedRatio);
  }
}

function syncMainSplitterLayout(persist = false) {
  if (!isDesktopMainSplitterEnabled()) {
    mainEl.style.removeProperty("--orchestrator-panel-height");
    if (!persist) return;
    clearMainSplitterRatio();
    return;
  }

  if (mainSplitterRatio === null) {
    mainSplitterRatio = 0.46;
  }

  setMainSplitterRatio(mainSplitterRatio, persist);
}

function updateMainSplitterAria() {
  if (!isDesktopMainSplitterEnabled()) {
    mainSplitterEl.setAttribute("aria-valuenow", "0");
    return;
  }

  const rect = mainEl.getBoundingClientRect();
  mainSplitterEl.setAttribute("aria-valuemin", String(MAIN_SPLITTER_MIN_RATIO * 100));
  mainSplitterEl.setAttribute("aria-valuemax", String(MAIN_SPLITTER_MAX_RATIO * 100));
  if (rect.height <= 0) return;

  const computedStyle = appWindow.getComputedStyle(mainEl);
  const currentHeightValue = mainEl.style.getPropertyValue("--orchestrator-panel-height");
  const currentHeight = Number.parseFloat(currentHeightValue) || Number.parseFloat(computedStyle.getPropertyValue("--orchestrator-panel-height"));
  if (!Number.isFinite(currentHeight)) return;

  const splitterSize = Number.parseFloat(computedStyle.getPropertyValue("--main-splitter-size")) || 12;
  const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
  const usableHeight = Math.max(1, rect.height - paddingTop - paddingBottom - splitterSize);
  const valueNow = Math.round((currentHeight / usableHeight) * 100);
  mainSplitterEl.setAttribute(
    "aria-valuenow",
    String(Math.min(MAIN_SPLITTER_MAX_RATIO * 100, Math.max(MAIN_SPLITTER_MIN_RATIO * 100, valueNow)))
  );
}

function initializeMainSplitter() {
  syncMainSplitterLayout();
  updateMainSplitterAria();

  const updateFromClientY = (clientY: number, persist = true) => {
    const rect = mainEl.getBoundingClientRect();
    const computedStyle = appWindow.getComputedStyle(mainEl);
    const splitterSize = Number.parseFloat(computedStyle.getPropertyValue("--main-splitter-size")) || 12;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const usableHeight = rect.height - paddingTop - paddingBottom - splitterSize;
    if (usableHeight <= 0) return;

    const offset = clientY - rect.top - paddingTop;
    const ratio = offset / usableHeight;
    setMainSplitterRatio(ratio, persist);
    updateMainSplitterAria();
    scheduleFitAllSessions();
  };

  mainSplitterEl.addEventListener("pointerdown", (event) => {
    if (!isDesktopMainSplitterEnabled()) return;
    event.preventDefault();
    document.body.dataset.mainSplitterDragging = "true";
    mainSplitterEl.setPointerCapture(event.pointerId);
  });

  mainSplitterEl.addEventListener("pointermove", (event) => {
    if (document.body.dataset.mainSplitterDragging !== "true") return;
    updateFromClientY(event.clientY, false);
  });

  const finishDrag = (event: PointerEvent) => {
    if (document.body.dataset.mainSplitterDragging !== "true") return;
    document.body.dataset.mainSplitterDragging = "false";
    if (mainSplitterEl.hasPointerCapture(event.pointerId)) {
      mainSplitterEl.releasePointerCapture(event.pointerId);
    }
    updateFromClientY(event.clientY, true);
  };

  mainSplitterEl.addEventListener("pointerup", finishDrag);
  mainSplitterEl.addEventListener("pointercancel", finishDrag);

  mainSplitterEl.addEventListener("keydown", (event) => {
    if (!isDesktopMainSplitterEnabled()) return;

    if (mainSplitterRatio === null) {
      mainSplitterRatio = 0.46;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMainSplitterRatio(mainSplitterRatio - 0.03);
      updateMainSplitterAria();
      scheduleFitAllSessions();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMainSplitterRatio(mainSplitterRatio + 0.03);
      updateMainSplitterAria();
      scheduleFitAllSessions();
    }
  });
}

function updateThemeControls(preference: ThemePreference) {
  for (const button of themeButtons) {
    const isActive = button.dataset.themeOption === preference;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));

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
  if (orchestratorNodeTerminal) {
    orchestratorNodeTerminal.options.theme = XTERM_THEMES[theme];
  }
  if (interactiveSessionTerminal) {
    interactiveSessionTerminal.options.theme = XTERM_THEMES[theme];
  }
}

function normalizeTerminalTextForXterm(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

function resolveReadOnlyTerminalDimension(
  candidates: number[],
  minimum: number,
  maximum = Number.POSITIVE_INFINITY
): number | null {
  const finiteCandidates = candidates
    .filter((candidate) => Number.isFinite(candidate) && candidate > 0)
    .map((candidate) => Math.min(candidate, maximum));
  if (finiteCandidates.length === 0) {
    return null;
  }

  return Math.max(Math.min(...finiteCandidates), minimum);
}

function fitReadOnlyTerminal(container: HTMLElement, terminal: XtermTerminal): boolean {
  const viewportRect = container.getBoundingClientRect();
  const parentElement = container.parentElement;
  const parentRect = parentElement?.getBoundingClientRect() ?? null;
  const maxViewportWidth = Math.max(360, appWindow.innerWidth - 48);
  const availableWidth = resolveReadOnlyTerminalDimension(
    [
      container.clientWidth,
      viewportRect.width,
      parentElement?.clientWidth ?? 0,
      parentRect?.width ?? 0
    ],
    360,
    maxViewportWidth
  );
  const availableHeight = resolveReadOnlyTerminalDimension(
    [
      container.clientHeight,
      viewportRect.height,
      parentElement?.clientHeight ?? 0,
      parentRect?.height ?? 0
    ],
    220
  );
  if (availableWidth === null || availableHeight === null) {
    return false;
  }

  const cols = Math.max(40, Math.floor(availableWidth / 9));
  const rows = Math.max(12, Math.floor(availableHeight / 18));
  terminal.resize(cols, rows);
  return true;
}

function ensureOrchestratorNodeTerminal() {
  if (orchestratorNodeTerminal || typeof appWindow.Terminal !== "function") {
    return;
  }

  const terminal = new appWindow.Terminal({
    cursorBlink: false,
    disableStdin: true,
    fontSize: 13,
    theme: XTERM_THEMES[resolveTheme(themePreference)]
  });
  terminal.open(orchestratorNodeTerminalEl);
  orchestratorNodeTerminal = terminal;
  if (!fitReadOnlyTerminal(orchestratorNodeTerminalEl, terminal)) {
    scheduleFitOrchestratorNodeTerminal();
  }
}

function fitOrchestratorNodeTerminal(): boolean {
  if (!orchestratorNodeTerminal) {
    return false;
  }

  return fitReadOnlyTerminal(orchestratorNodeTerminalEl, orchestratorNodeTerminal);
}

function scheduleFitOrchestratorNodeTerminal() {
  if (fitOrchestratorNodeTerminalHandle !== null) {
    return;
  }

  fitOrchestratorNodeTerminalHandle = appWindow.requestAnimationFrame(() => {
    fitOrchestratorNodeTerminalHandle = null;
    const fitted = fitOrchestratorNodeTerminal();
    if (fitted) {
      fitOrchestratorNodeTerminalRetryCount = 0;
      return;
    }

    if (
      fitOrchestratorNodeTerminalRetryCount >= 2
      || orchestratorDetailPanelNodeEl.hidden
      || activeOrchestratorDetailTab !== "node"
    ) {
      fitOrchestratorNodeTerminalRetryCount = 0;
      return;
    }

    fitOrchestratorNodeTerminalRetryCount += 1;
    appWindow.setTimeout(() => {
      scheduleFitOrchestratorNodeTerminal();
    }, 32);
  });
}

function renderOrchestratorNodeTerminalTranscript(content: string, renderKey: string) {
  const previousText = orchestratorNodeTerminalText;
  ensureOrchestratorNodeTerminal();

  if (!orchestratorNodeTerminal) {
    orchestratorNodeTerminalText = content;
    orchestratorNodeTerminalEl.textContent = content;
    return;
  }

  const normalizedContent = normalizeTerminalTextForXterm(content);
  const normalizedPrevious = normalizeTerminalTextForXterm(previousText);
  const shouldAppendOnly = renderKey === orchestratorNodeTerminalRenderKey
    && normalizedContent.startsWith(normalizedPrevious);

  if (!shouldAppendOnly) {
    orchestratorNodeTerminal.reset();
    if (normalizedContent.length > 0) {
      orchestratorNodeTerminal.write(normalizedContent);
    }
  } else {
    const delta = normalizedContent.slice(normalizedPrevious.length);
    if (delta.length > 0) {
      orchestratorNodeTerminal.write(delta);
    }
  }

  orchestratorNodeTerminalText = content;
  orchestratorNodeTerminalRenderKey = renderKey;
  scheduleFitOrchestratorNodeTerminal();
}

function updateWorkspaceSummary() {
  workspaceLabelEl.textContent = translate("ui.workspaceLabel");
  workspaceOpenButton.textContent = translate("ui.workspaceOpen");
  workspaceCreateButton.textContent = translate("ui.workspaceCreate");
  toolsUpdateButton.textContent = translate("ui.toolsUpdate");
  workspacePathEl.textContent = currentWorkspacePath ?? translate("ui.workspaceUnset");
  workspacePathEl.classList.toggle("empty", currentWorkspacePath === null);
  workspacePathEl.title = currentWorkspacePath ?? "";
}

function updateSessionCreationState() {
  const disabled = currentWorkspacePath === null || isResetting;
  workspaceOpenButton.disabled = isResetting;
  workspaceCreateButton.disabled = isResetting;
  newShellButton.disabled = disabled;
  newCodexButton.disabled = disabled || isToolUpdateRunning;
  newGeminiButton.disabled = disabled || isToolUpdateRunning;
  toolsUpdateButton.disabled = isToolUpdateRunning || isResetting || isOrchestratorRunning;
  resetAppButton.disabled = isToolUpdateRunning || isResetting || isOrchestratorRunning;
}

function updateOrchestratorControls() {
  const missingWorkspace = currentWorkspacePath === null;
  const controlsDisabled = isOrchestratorRunning || isResetting;
  orchestratorRunButton.disabled = controlsDisabled || missingWorkspace;
  orchestratorStopButton.disabled = !isOrchestratorRunning || !liveOrchestratorRunId || isOrchestratorStopRequested || isResetting;
  orchestratorContinueButton.disabled = controlsDisabled || !selectedOrchestratorRunId || missingWorkspace;
  orchestratorRunNextActionButton.disabled = controlsDisabled || !getSelectedNextAction(selectedOrchestratorRun) || missingWorkspace;
  orchestratorRefreshButton.disabled = controlsDisabled;
  orchestratorModeSelect.disabled = controlsDisabled;
  resetAppButton.disabled = isToolUpdateRunning || isResetting || isOrchestratorRunning;
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
  resetAppButton.textContent = translate("ui.resetApp");
  sessionSectionTitle.textContent = translate("ui.sessionsTitle");
  orchestratorTitleEl.textContent = translate("ui.orchestratorTitle");
  orchestratorSubtitleEl.textContent = translate("ui.orchestratorSubtitle");
  orchestratorGoalLabelEl.textContent = translate("ui.orchestratorGoalLabel");
  orchestratorModeLabelEl.textContent = translate("ui.orchestratorModeLabel");
  orchestratorDepthLabelEl.textContent = translate("ui.orchestratorDepthLabel");
  orchestratorGoalInput.placeholder = translate("ui.orchestratorGoalPlaceholder");
  orchestratorContinueButton.textContent = translate("ui.orchestratorContinue");
  orchestratorContinueButton.title = translate("ui.orchestratorResumeTooltip");
  orchestratorRunNextActionButton.textContent = translate("ui.orchestratorRunNextAction");
  orchestratorRunNextActionButton.title = translate("ui.orchestratorRunNextActionTooltip");
  orchestratorStopButton.textContent = translate("ui.orchestratorStop");
  orchestratorRunButton.textContent = translate("ui.orchestratorRun");
  orchestratorRefreshButton.textContent = translate("ui.orchestratorRefresh");
  orchestratorRunsTitleEl.textContent = translate("ui.orchestratorRunsTitle");
  orchestratorDetailTitleEl.textContent = translate("ui.orchestratorDetailTitle");
  orchestratorDetailTabNodeButton.textContent = translate("ui.orchestratorDetailTabNode");
  orchestratorDetailTabMemoryButton.textContent = translate("ui.orchestratorDetailTabMemory");
  orchestratorNodeLiveTitleEl.textContent = translate("ui.orchestratorNodeLiveTitle");
  orchestratorNodeApprovalTitleEl.textContent = translate("ui.orchestratorApprovalTitle");
  orchestratorNodeApprovalStatusEl.textContent = translate("ui.orchestratorApprovalWaiting");
  orchestratorNodeUserInputTitleEl.textContent = translate("ui.orchestratorUserInputTitle");
  orchestratorNodeUserInputStatusEl.textContent = translate("ui.orchestratorUserInputWaiting");
  orchestratorNodeRequestOpenButton.textContent = translate("ui.orchestratorNodeRequestTitle");
  orchestratorNodeResponseOpenButton.textContent = translate("ui.orchestratorNodeResponseTitle");
  orchestratorNodePlanOpenButton.textContent = translate("ui.orchestratorNodePlanTitle");
  orchestratorNodeTerminalTitleEl.textContent = translate("ui.orchestratorNodeTerminalTitle");
  orchestratorNodeTerminalOpenButton.textContent = translate("ui.orchestratorOpenViewer");
  orchestratorNodeTerminalCopyButton.textContent = translate("ui.orchestratorDetailCopy");
  orchestratorNodeLogOpenButton.textContent = translate("ui.orchestratorNodeLogTitle");
  orchestratorWorkingMemoryTitleEl.textContent = translate("ui.orchestratorWorkingMemoryTitle");
  orchestratorWorkingMemoryOpenButton.textContent = translate("ui.orchestratorOpenViewer");
  orchestratorWorkingMemoryCopyButton.textContent = translate("ui.orchestratorDetailCopy");
  orchestratorLogTitleEl.textContent = translate("ui.orchestratorLogTitle");
  orchestratorLogOpenButton.textContent = translate("ui.orchestratorOpenViewer");
  orchestratorLogCopyButton.textContent = translate("ui.orchestratorDetailCopy");
  logViewerTitleEl.textContent = activeLogViewerSource?.titleElement.textContent?.trim() || translate("ui.logViewerTitle");
  logViewerCopyButton.textContent = translate("ui.orchestratorDetailCopy");
  logViewerCloseButton.textContent = translate("ui.close");
  approvalDialogCloseButton.textContent = translate("ui.close");
  workspaceEmptyTitleEl.textContent = translate("ui.noOpenTabsTitle");
  workspaceEmptyCopyEl.textContent = translate("ui.noOpenTabsCopy");
  const crossReviewOption = orchestratorModeSelect.querySelector('option[value="cross_review"]');
  const geminiOnlyOption = orchestratorModeSelect.querySelector('option[value="gemini_only"]');
  const codexOnlyOption = orchestratorModeSelect.querySelector('option[value="codex_only"]');
  if (crossReviewOption) crossReviewOption.textContent = translate("ui.orchestratorModeCrossReview");
  if (geminiOnlyOption) geminiOnlyOption.textContent = translate("ui.orchestratorModeGeminiOnly");
  if (codexOnlyOption) codexOnlyOption.textContent = translate("ui.orchestratorModeCodexOnly");
  orchestratorModeSelect.value = orchestratorMode;
  terminalRoot.dataset.emptyMessage = translate("ui.emptyState");
  themeSwitcher.setAttribute("aria-label", translate("ui.themeGroupLabel"));
  languageSwitcher.setAttribute("aria-label", translate("ui.languageGroupLabel"));

  updateWorkspaceSummary();
  updateThemeControls(themePreference);
  updateLanguageControls(languagePreference);
  renderSessionList();
  refreshTerminalPaneCopy();
  refreshLogbar();
  renderApprovalQueueButton();
  updateSessionCreationState();
  updateOrchestratorControls();
  updateTerminalRootState();
  renderOrchestratorRunList();
  renderOrchestratorDetail();
  renderOrchestratorDetailTabs();
  renderOrchestratorTree();
  renderWorkspaceTabs();
  renderWorkspacePanels();
  renderApprovalDialog();
  renderApprovalToastList();
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("clipboard unavailable");
  }
}

async function respondToPendingApproval(
  requestId: string,
  approved: boolean,
  optionId?: string
) {
  pendingApprovalActionRequestId = requestId;
  renderOrchestratorDetail();
  renderApprovalDialog();

  try {
    const acknowledged = await appWindow.tasksaw.respondOrchestratorApproval({
      requestId,
      approved,
      optionId: optionId ?? null
    });

    if (!acknowledged) {
      throw new Error("approval request was no longer pending");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logLocalized("errors.failedOrchestratorRun", { message });
  } finally {
    pendingApprovalActionRequestId = null;
    renderOrchestratorDetail();
    renderApprovalDialog();
  }
}

function collectPendingUserInputAnswers(pendingUserInput: OrchestratorPendingUserInput): Record<string, string[]> {
  const draft = pendingUserInputDrafts.get(pendingUserInput.requestId) ?? {};
  const answers: Record<string, string[]> = {};

  for (const question of pendingUserInput.questions) {
    const values = new Set<string>();
    const selectedValue = draft[question.id]?.trim() ?? "";
    const otherValue = draft[`${question.id}__other`]?.trim() ?? "";

    if (selectedValue.length > 0) {
      values.add(selectedValue);
    }
    if (otherValue.length > 0) {
      values.add(otherValue);
    }

    answers[question.id] = [...values];
  }

  return answers;
}

async function respondToPendingUserInput(
  pendingUserInput: OrchestratorPendingUserInput,
  cancelled = false
) {
  pendingUserInputActionRequestId = pendingUserInput.requestId;
  renderOrchestratorDetail();

  try {
    const answers = cancelled ? undefined : collectPendingUserInputAnswers(pendingUserInput);
    const acknowledged = await appWindow.tasksaw.respondOrchestratorUserInput({
      requestId: pendingUserInput.requestId,
      submitted: !cancelled,
      answers
    });

    if (!acknowledged) {
      throw new Error("user input request was no longer pending");
    }

    pendingUserInputDrafts.delete(pendingUserInput.requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logLocalized("errors.failedOrchestratorRun", { message });
  } finally {
    pendingUserInputActionRequestId = null;
    renderOrchestratorDetail();
  }
}

async function copyOrchestratorSection(
  titleElement: HTMLElement,
  contentElement: HTMLElement,
  emptyMessage: string
) {
  const title = titleElement.textContent?.trim() || "Clipboard";
  const content = contentElement.textContent?.trim() ?? "";
  const textToCopy = content.length > 0 ? content : emptyMessage;

  try {
    await copyTextToClipboard(textToCopy);
    logLocalized("logs.clipboardCopied", { title });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logLocalized("errors.failedCopyClipboard", { title, message });
  }
}

async function copyOrchestratorTextSection(
  titleElement: HTMLElement,
  content: string,
  emptyMessage: string
) {
  const title = titleElement.textContent?.trim() || "Clipboard";
  const textToCopy = content.trim().length > 0 ? content : emptyMessage;

  try {
    await copyTextToClipboard(textToCopy);
    logLocalized("logs.clipboardCopied", { title });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logLocalized("errors.failedCopyClipboard", { title, message });
  }
}

function openLogViewer(
  titleElement: HTMLElement,
  contentElement: HTMLElement,
  emptyMessage: string
) {
  activeLogViewerSource = {
    titleElement,
    contentElement,
    emptyMessage
  };
  logViewerTitleEl.textContent = titleElement.textContent?.trim() || translate("ui.logViewerTitle");
  logViewerContentEl.textContent = contentElement.textContent?.trim() || emptyMessage;
  logViewerDialogEl.hidden = false;
  syncDialogBodyState();
}

function openTextLogViewer(
  titleElement: HTMLElement,
  content: string,
  emptyMessage: string
) {
  logViewerTitleEl.textContent = titleElement.textContent?.trim() || translate("ui.logViewerTitle");
  logViewerContentEl.textContent = content.trim().length > 0 ? content : emptyMessage;
  activeLogViewerSource = null;
  logViewerDialogEl.hidden = false;
  syncDialogBodyState();
}

function syncLogViewerContent() {
  if (!activeLogViewerSource || logViewerDialogEl.hidden) {
    return;
  }

  logViewerTitleEl.textContent = activeLogViewerSource.titleElement.textContent?.trim() || translate("ui.logViewerTitle");
  logViewerContentEl.textContent = activeLogViewerSource.contentElement.textContent?.trim() || activeLogViewerSource.emptyMessage;
}

function closeLogViewer() {
  activeLogViewerSource = null;
  logViewerDialogEl.hidden = true;
  syncDialogBodyState();
}

async function copyLogViewerContent() {
  await copyOrchestratorSection(
    logViewerTitleEl,
    logViewerContentEl,
    ""
  );
}

function setOrchestratorTransientDetail(message: string) {
  orchestratorNodeLiveStatusEl.textContent = translate("ui.orchestratorCommandStatusIdle");
  orchestratorNodeLiveMetaEl.textContent = message;
  renderNodeApprovalCard(null);
  renderNodeUserInputCard(null);
  orchestratorNodeRequestDataEl.textContent = translate("ui.orchestratorNodeRequestEmpty");
  orchestratorNodeResponseDataEl.textContent = translate("ui.orchestratorNodeResponseEmpty");
  orchestratorNodePlanDataEl.textContent = translate("ui.orchestratorNodePlanEmpty");
  orchestratorNodeRequestOpenButton.disabled = true;
  orchestratorNodeResponseOpenButton.disabled = true;
  orchestratorNodePlanOpenButton.disabled = true;
  orchestratorNodeLogOpenButton.disabled = true;
  renderOrchestratorNodeTerminalTranscript(translate("ui.orchestratorNodeTerminalEmpty"), "__empty__");
  orchestratorNodeLogEl.textContent = message;
  orchestratorWorkingMemoryEl.textContent = message;
  orchestratorWorkingMemoryOpenButton.disabled = true;
  orchestratorWorkingMemoryCopyButton.disabled = true;
  orchestratorLogEl.textContent = message;
  renderOrchestratorDetailTabs();
  syncLogViewerContent();
}

function applyThemePreference(preference: ThemePreference, persist = true) {
  themePreference = preference;

  const resolvedTheme = resolveTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolvedTheme;
  updateThemeControls(preference);
  syncTerminalThemes(resolvedTheme);
  scheduleFitOrchestratorNodeTerminal();

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
  updateOrchestratorControls();
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

async function selectOrchestratorRun(runId: string) {
  selectedOrchestratorRunId = runId;
  selectedOrchestratorRun = null;
  selectedOrchestratorNodeId = null;
  updateOrchestratorControls();
  renderOrchestratorRunList();
  lastOrchestratorDetailSignature = `__loading__:${runId}:${languagePreference}`;
  lastOrchestratorTreeSignature = `__loading__:${runId}:${languagePreference}`;
  setOrchestratorTransientDetail("Loading…");
  renderOrchestratorTree();

  try {
    selectedOrchestratorRun = await appWindow.tasksaw.getOrchestratorRun(runId);
    renderOrchestratorDetail();
    renderOrchestratorTree();
    logLocalized("logs.orchestratorLoaded", { runId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logLocalized("errors.failedLoadOrchestratorRuns", { message });
  }
}

async function loadOrchestratorRuns(preserveSelection = true) {
  const runs = await appWindow.tasksaw.listOrchestratorRuns();
  orchestratorRuns.splice(0, orchestratorRuns.length, ...runs);
  renderOrchestratorRunList();

  const nextSelection = preserveSelection
    ? orchestratorRuns.find((run) => run.id === selectedOrchestratorRunId)?.id ?? orchestratorRuns[0]?.id ?? null
    : selectedOrchestratorRunId;

  if (!nextSelection) {
    selectedOrchestratorRunId = null;
    selectedOrchestratorRun = null;
    selectedOrchestratorNodeId = null;
    updateOrchestratorControls();
    renderOrchestratorDetail();
    renderOrchestratorTree();
    return;
  }

  await selectOrchestratorRun(nextSelection);
}

function isOrchestratorMode(value: string): value is OrchestratorMode {
  return value === "gemini_only" || value === "codex_only" || value === "cross_review";
}

async function stopOrchestratorRun() {
  if (!isOrchestratorRunning || !liveOrchestratorRunId) {
    logLocalized("errors.orchestratorStopUnavailable");
    return;
  }

  isOrchestratorStopRequested = true;
  updateOrchestratorControls();
  logLocalized("logs.orchestratorStopping", { runId: liveOrchestratorRunId });

  try {
    const cancelled = await appWindow.tasksaw.cancelOrchestratorRun(liveOrchestratorRunId);
    if (!cancelled) {
      isOrchestratorStopRequested = false;
      updateOrchestratorControls();
      logLocalized("errors.orchestratorStopUnavailable");
    }
  } catch (error: unknown) {
    isOrchestratorStopRequested = false;
    updateOrchestratorControls();
    const message = error instanceof Error ? error.message : String(error);
    logLocalized("errors.failedOrchestratorStop", { message });
  }
}

async function runOrchestrator(options?: {
  continueFromRunId?: string | null;
  continuationMode?: OrchestratorContinuationMode;
  nextActionIndex?: number | null;
  goalOverride?: string | null;
}) {
  const continueFromRunId = options?.continueFromRunId ?? null;
  const continuationMode = options?.continuationMode ?? "resume";
  if (continueFromRunId && !selectedOrchestratorRunId) {
    logLocalized("errors.orchestratorContinueMissing");
    return;
  }

  const goal = options?.goalOverride?.trim() || orchestratorGoalInput.value.trim() || (
    continueFromRunId
      ? (selectedOrchestratorRun?.run.goal ?? orchestratorRuns.find((run) => run.id === continueFromRunId)?.goal ?? "")
      : ""
  );
  if (goal.length === 0) {
    logLocalized("errors.orchestratorGoalMissing");
    return;
  }

  if (!currentWorkspacePath) {
    logLocalized("errors.orchestratorWorkspaceMissing");
    return;
  }

  isOrchestratorRunning = true;
  isOrchestratorStopRequested = false;
  liveOrchestratorRunId = null;
  if (liveOrchestratorRefreshHandle !== null) {
    window.clearTimeout(liveOrchestratorRefreshHandle);
    liveOrchestratorRefreshHandle = null;
  }
  updateOrchestratorControls();
  logLocalized("logs.orchestratorRunning", { mode: translateOrchestratorMode(orchestratorMode) });
  selectedOrchestratorRun = null;
  selectedOrchestratorNodeId = null;
  lastOrchestratorDetailSignature = `__running__:${orchestratorMode}:${goal}:${languagePreference}`;
  lastOrchestratorTreeSignature = `__running__:${orchestratorMode}:${goal}:${languagePreference}`;
  setOrchestratorTransientDetail(translate("logs.orchestratorRunning", { mode: translateOrchestratorMode(orchestratorMode) }));
  renderOrchestratorTree();

  try {
    const maxDepth = getRequestedOrchestratorMaxDepth();
    orchestratorDepthInput.value = String(maxDepth);
    const response = await appWindow.tasksaw.runOrchestrator({
      goal,
      mode: orchestratorMode,
      language: languagePreference,
      continuationMode: continueFromRunId ? continuationMode : null,
      nextActionIndex: continueFromRunId ? (options?.nextActionIndex ?? null) : null,
      maxDepth,
      workspacePath: currentWorkspacePath,
      continueFromRunId,
      workspaceAccessDialog: {
        defaultPath: currentWorkspacePath ?? undefined,
        title: translate("ui.permissionDialogTitle"),
        buttonLabel: translate("ui.permissionDialogButton"),
        message: translate("ui.permissionDialogMessage")
      }
    });

    if (!response) return;
    if (response.status === "login_required") {
      for (const [index, session] of response.loginSessions.entries()) {
        attachSessionToUi(session, {
          activate: index === response.loginSessions.length - 1,
          logCreated: false
        });
      }
      logLocalized("errors.orchestratorLoginRequired", {
        tools: response.missingToolIds.map((toolId) => translateKind(toolId)).join(", ")
      });
      return;
    }

    const detail = response.detail;
    if (response.status === "cancelled") {
      selectedOrchestratorRun = detail;
      selectedOrchestratorRunId = detail.run.id;
      renderOrchestratorDetail();
      renderOrchestratorTree();
      await loadOrchestratorRuns();
      logLocalized("logs.orchestratorCancelled", { runId: detail.run.id });
      return;
    }

    selectedOrchestratorRun = detail;
    selectedOrchestratorRunId = detail.run.id;
    renderOrchestratorDetail();
    renderOrchestratorTree();
    await loadOrchestratorRuns();
    logLocalized("logs.orchestratorCompleted", { runId: detail.run.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logLocalized("errors.failedOrchestratorRun", { message });
    try {
      await loadOrchestratorRuns();
    } catch (loadError: unknown) {
      const loadMessage = loadError instanceof Error ? loadError.message : String(loadError);
      logLocalized("errors.failedLoadOrchestratorRuns", { message: loadMessage });
    }
  } finally {
    isOrchestratorRunning = false;
    isOrchestratorStopRequested = false;
    liveOrchestratorRunId = null;
    updateOrchestratorControls();
    refreshToolStatuses().catch((error) => console.error("Failed to refresh tool statuses after orchestrator run:", error));
  }
}

async function runSelectedNextAction() {
  if (!selectedOrchestratorRunId || !selectedOrchestratorRun) {
    logLocalized("errors.orchestratorContinueMissing");
    return;
  }

  const nextActionIndex = getSelectedNextActionIndex(selectedOrchestratorRun);
  const nextAction = getSelectedNextAction(selectedOrchestratorRun);
  if (nextActionIndex === null || !nextAction) {
    logLocalized("errors.orchestratorNextActionMissing");
    return;
  }

  await runOrchestrator({
    continueFromRunId: selectedOrchestratorRunId,
    continuationMode: "next_action",
    nextActionIndex,
    goalOverride: nextAction.objective
  });
}

function hasSession(sessionId: string | null): sessionId is string {
  return sessionId !== null && sessions.some((session) => session.id === sessionId);
}

function resolveActiveWorkspaceTab(preferredTabId: string | null = activeWorkspaceTabId): string | null {
  if (preferredTabId === "orchestrator" && isOrchestratorTabOpen) {
    return "orchestrator";
  }

  if (hasSession(preferredTabId)) {
    return preferredTabId;
  }

  if (isOrchestratorTabOpen) {
    return "orchestrator";
  }

  if (hasSession(activeSessionId)) {
    return activeSessionId;
  }

  return sessions[sessions.length - 1]?.id ?? null;
}

function renderWorkspaceTabs() {
  workspaceTabsEl.innerHTML = "";
  workspaceTabsEl.setAttribute("aria-label", translate("ui.workspaceTabsLabel"));

  const appendTab = (
    id: string,
    title: string,
    onSelect: () => void,
    options: { kind?: string; closable?: boolean; onClose?: () => void } = {}
  ) => {
    const active = activeWorkspaceTabId === id;

    const tab = document.createElement("div");
    tab.className = "workspace-tab";
    if (active) tab.classList.add("active");

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "workspace-tab-select";
    selectButton.setAttribute("role", "tab");
    selectButton.setAttribute("aria-selected", String(active));

    const label = document.createElement("span");
    label.className = "workspace-tab-label";

    const titleEl = document.createElement("span");
    titleEl.className = "workspace-tab-title";
    titleEl.textContent = title;
    label.appendChild(titleEl);

    if (options.kind) {
      const kindBadge = document.createElement("span");
      kindBadge.className = "workspace-tab-kind";
      kindBadge.textContent = options.kind;
      label.appendChild(kindBadge);
    }

    selectButton.appendChild(label);
    selectButton.addEventListener("click", onSelect);
    tab.appendChild(selectButton);

    if (options.closable && options.onClose) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "workspace-tab-close";
      closeButton.textContent = "×";
      closeButton.title = translate("ui.close");
      closeButton.setAttribute("aria-label", translate("ui.close"));
      closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onClose?.();
      });
      tab.appendChild(closeButton);
    }

    workspaceTabsEl.appendChild(tab);
  };

  if (isOrchestratorTabOpen) {
    appendTab("orchestrator", translate("ui.orchestratorTitle"), () => {
      activateWorkspaceTab("orchestrator");
    }, {
      closable: true,
      onClose: () => closeOrchestratorTab()
    });
  }

  for (const session of sessions) {
    appendTab(session.id, session.title, () => {
      activateWorkspaceTab(session.id, true);
    }, {
      kind: translateKind(session.kind),
      closable: true,
      onClose: () => closeSession(session.id)
    });
  }

  const hasTabs = isOrchestratorTabOpen || sessions.length > 0;
  workspaceTabsEl.hidden = !hasTabs;
  const orchestratorButtonLabel = isOrchestratorTabOpen
    ? translate("ui.focusOrchestratorTab")
    : translate("ui.openOrchestratorTab");
  workspaceOpenOrchestratorButton.textContent = orchestratorButtonLabel;
  workspaceOpenOrchestratorButton.disabled = isOrchestratorTabOpen && activeWorkspaceTabId === "orchestrator";
  workspaceEmptyOpenOrchestratorButton.textContent = translate("ui.openOrchestratorTab");
}

function renderWorkspacePanels(focusTerminal = false) {
  activeWorkspaceTabId = resolveActiveWorkspaceTab(activeWorkspaceTabId);

  const activeTerminalTabId = activeWorkspaceTabId !== null && activeWorkspaceTabId !== "orchestrator"
    ? activeWorkspaceTabId
    : null;
  const showOrchestrator = activeWorkspaceTabId === "orchestrator" && isOrchestratorTabOpen;
  const showTerminal = activeTerminalTabId !== null && terminalPanes.has(activeTerminalTabId);
  const showEmpty = !showOrchestrator && !showTerminal && !isOrchestratorTabOpen && sessions.length === 0;

  const orchestratorPanelEl = document.getElementById("orchestrator-panel") as HTMLElement;
  orchestratorPanelEl.hidden = !showOrchestrator;
  orchestratorPanelEl.setAttribute("aria-hidden", String(!showOrchestrator));

  terminalRoot.hidden = !showTerminal;
  terminalRoot.setAttribute("aria-hidden", String(!showTerminal));

  workspaceEmptyEl.hidden = !showEmpty;
  workspaceEmptyEl.setAttribute("aria-hidden", String(!showEmpty));

  for (const [sessionId, pane] of terminalPanes.entries()) {
    const isActive = sessionId === activeTerminalTabId;
    pane.hidden = !isActive;
    pane.classList.toggle("active", isActive);
  }

  if (showTerminal && activeTerminalTabId) {
    const terminal = terminals.get(activeTerminalTabId);
    if (terminal) {
      fitSession(activeTerminalTabId, terminal);
      if (focusTerminal) {
        terminal.focus();
      }
    }
  }

  if (showOrchestrator) {
    scheduleFitOrchestratorNodeTerminal();
  }
}

function activateWorkspaceTab(tabId: string | null, focusTerminal = false) {
  if (tabId !== null && tabId !== "orchestrator") {
    activeSessionId = tabId;
  }

  activeWorkspaceTabId = resolveActiveWorkspaceTab(tabId);
  renderSessionList();
  renderWorkspaceTabs();
  renderWorkspacePanels(focusTerminal);
}

function openOrchestratorTab() {
  isOrchestratorTabOpen = true;
  activateWorkspaceTab("orchestrator");
}

function closeOrchestratorTab() {
  isOrchestratorTabOpen = false;
  if (activeWorkspaceTabId === "orchestrator") {
    activeWorkspaceTabId = null;
  }

  activateWorkspaceTab(activeSessionId);
}

function closeSession(sessionId: string) {
  appWindow.tasksaw.killSession(sessionId);
  removeSession(sessionId);
}

function updateTerminalRootState() {
  const hasSessions = sessions.length > 0;
  terminalRoot.dataset.count = String(sessions.length);
  terminalRoot.classList.toggle("empty", !hasSessions);
  document.body.dataset.hasSessions = String(hasSessions);
  layoutEl.dataset.hasSessions = String(hasSessions);
  sidebarEl.setAttribute("aria-hidden", String(!hasSessions));
  sessionSectionTitle.hidden = !hasSessions;
  sessionListEl.hidden = !hasSessions;
  mainSplitterEl.setAttribute("aria-hidden", String(!hasSessions));
  syncMainSplitterLayout();
  updateMainSplitterAria();
}

function fitAllSessions() {
  const activeTerminalTabId = activeWorkspaceTabId !== null && activeWorkspaceTabId !== "orchestrator"
    ? activeWorkspaceTabId
    : null;

  if (activeTerminalTabId) {
    const terminal = terminals.get(activeTerminalTabId);
    if (terminal) {
      fitSession(activeTerminalTabId, terminal);
    }
  }
}

function scheduleFitAllSessions() {
  if (fitAllSessionsHandle !== null) {
    return;
  }

  fitAllSessionsHandle = appWindow.requestAnimationFrame(() => {
    fitAllSessionsHandle = null;
    fitAllSessions();
  });
}

function setActiveSession(sessionId: string) {
  activeSessionId = sessionId;
  activateWorkspaceTab(sessionId, true);
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

  const previousDimensions = terminalDimensions.get(sessionId);
  if (previousDimensions?.cols === cols && previousDimensions.rows === rows) {
    return;
  }

  terminalDimensions.set(sessionId, { cols, rows });
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

    if (session.id === activeWorkspaceTabId) li.classList.add("active");
    li.onclick = () => setActiveSession(session.id);
    sessionListEl.appendChild(li);
  }
}

function mountTerminal(session: SessionInfo) {
  const pane = document.createElement("section");
  pane.className = "terminal-pane";
  pane.setAttribute("data-id", session.id);
  pane.hidden = true;
  pane.addEventListener("mousedown", () => activateWorkspaceTab(session.id));

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
    closeSession(session.id);
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
  renderWorkspaceTabs();
  renderWorkspacePanels();
}

function removeSession(sessionId: string) {
  const sessionIndex = sessions.findIndex((session) => session.id === sessionId);
  if (sessionIndex === -1) return;

  const [removedSession] = sessions.splice(sessionIndex, 1);
  teardownSessionUi(sessionId);

  if (activeSessionId === sessionId) {
    const nextActiveSession = sessions[sessionIndex] ?? sessions[sessionIndex - 1] ?? null;
    activeSessionId = nextActiveSession?.id ?? null;
  }

  updateTerminalRootState();
  activateWorkspaceTab(activeWorkspaceTabId === sessionId ? activeSessionId : activeWorkspaceTabId);

  scheduleFitAllSessions();
  logLocalized("logs.closed", {
    title: removedSession.title,
    cwd: removedSession.cwd
  });
}

function teardownSessionUi(sessionId: string) {
  terminals.get(sessionId)?.dispose();
  terminals.delete(sessionId);
  terminalContainers.delete(sessionId);
  terminalDimensions.delete(sessionId);
  sessionStatusBadges.delete(sessionId);
  sessionKindBadges.delete(sessionId);
  sessionCloseButtons.delete(sessionId);
  terminalPanes.get(sessionId)?.remove();
  terminalPanes.delete(sessionId);
}

function clearAllLocalSessions() {
  for (const session of sessions) {
    teardownSessionUi(session.id);
  }

  sessions.splice(0, sessions.length);
  activeSessionId = null;
}

function markSessionExited(sessionId: string) {
  terminalPanes.get(sessionId)?.classList.add("exited");
  const statusBadge = sessionStatusBadges.get(sessionId);
  if (statusBadge) {
    statusBadge.textContent = translate("ui.statusExited");
  }
}

function attachSessionToUi(
  session: SessionInfo,
  options: {
    activate?: boolean;
    logCreated?: boolean;
  } = {}
) {
  const existingIndex = sessions.findIndex((entry) => entry.id === session.id);
  const isNewSession = existingIndex === -1;

  if (isNewSession) {
    sessions.push(session);
  } else {
    sessions[existingIndex] = session;
  }

  if (!terminalPanes.has(session.id)) {
    mountTerminal(session);
  }

  setCurrentWorkspacePath(session.cwd);
  persistWorkspacePath(session.cwd);

  if (options.activate !== false) {
    setActiveSession(session.id);
  }

  scheduleFitAllSessions();

  if (isNewSession && options.logCreated !== false) {
    logLocalized("logs.created", {
      title: session.title,
      cwd: session.cwd
    });
  }
}

async function createSession(kind: SessionKind) {
  if (!currentWorkspacePath) {
    logLocalized("errors.selectFolder");
    return;
  }

  if (kind !== "shell") {
    logLocalized("logs.preparingTool", { tool: translateKind(kind) });
  }

  const session = await appWindow.tasksaw.createSession({
    kind,
    cwd: currentWorkspacePath,
    workspaceAccessDialog: {
      defaultPath: currentWorkspacePath,
      title: translate("ui.permissionDialogTitle"),
      buttonLabel: translate("ui.permissionDialogButton"),
      message: translate("ui.permissionDialogMessage")
    }
  });
  if (!session) return;

  attachSessionToUi(session);
}

function normalizeRemainingPercent(usage: ManagedToolUsage): number | null {
  if (!usage) {
    return null;
  }

  const directPercent = typeof usage.remainingPercent === "number"
    ? usage.remainingPercent
    : typeof usage.percentRemaining === "number"
      ? usage.percentRemaining
      : null;
  if (typeof directPercent === "number" && Number.isFinite(directPercent)) {
    return Math.max(0, Math.min(100, Math.round(directPercent)));
  }

  if (typeof usage.used === "number" && typeof usage.max === "number" && Number.isFinite(usage.used) && Number.isFinite(usage.max) && usage.max > 0) {
    const remainingPercent = ((usage.max - usage.used) / usage.max) * 100;
    return Math.max(0, Math.min(100, Math.round(remainingPercent)));
  }

  return null;
}

function renderToolUsageStatus(status: ManagedToolStatus) {
  const usageEl = status.id === "codex" ? codexUsageEl : geminiUsageEl;
  if (!status.installed) {
    usageEl.hidden = true;
    usageEl.textContent = "";
    usageEl.removeAttribute("title");
    return;
  }

  const usage = status.usage ?? null;
  const remainingPercent = normalizeRemainingPercent(usage);
  const fallbackReason = languagePreference === "ko" ? "데이터 없음" : "No data";
  const leftLabel = languagePreference === "ko" ? "남음" : "left";
  const percentLabel = remainingPercent === null ? "--%" : `${remainingPercent}%`;

  let label = status.displayName;

  if (status.id === "codex") {
    label = `Codex ${percentLabel}`;
    if (usage?.codex) {
      const fiveHour = usage.codex.fiveHourRemainingPercent;
      const weekly = usage.codex.weeklyRemainingPercent;
      const details = [];
      if (fiveHour !== null) details.push(`5h:${fiveHour}%`);
      if (weekly !== null) details.push(`1w:${weekly}%`);
      if (details.length > 0) {
        label += ` (${details.join(" ")})`;
      }
    }
    label += ` ${leftLabel}`;
  } else if (status.id === "gemini") {
    if (usage?.gemini?.models && usage.gemini.models.length > 0) {
      const displayModels = usage.gemini.models.slice(0, 3);
      const modelLabels = displayModels.map(m => {
        const p = m.remainingPercent === null ? "n/a" : `${m.remainingPercent}%`;
        return `${m.displayName}:${p}`;
      });
      const suffix = usage.gemini.models.length > 3 ? "..." : "";
      label = `Gemini ${modelLabels.join(" ")}${suffix} ${leftLabel}`;
    } else {
      const p = remainingPercent === null ? "n/a" : `${remainingPercent}%`;
      label = `Gemini ${p} ${leftLabel}`;
    }

    if (usage?.statusMessage) {
      label += ` (${usage.statusMessage})`;
    }
  } else {
    label = `${status.displayName} ${percentLabel} ${leftLabel}`;
  }

  usageEl.textContent = label;
  usageEl.title = remainingPercent === null ? fallbackReason : usageEl.textContent;
  usageEl.hidden = false;
}

async function refreshToolStatuses() {
  try {
    const statuses = await appWindow.tasksaw.getManagedToolStatuses();
    for (const status of statuses) {
      renderToolUsageStatus(status);
    }
  } catch (error) {
    console.error("Failed to refresh tool statuses:", error);
  }
}

async function updateManagedTools() {
  isToolUpdateRunning = true;
  updateSessionCreationState();
  updateOrchestratorControls();
  logRaw("Updating managed Codex/Gemini...");

  try {
    const statuses = await appWindow.tasksaw.updateManagedTools();
    const details = statuses
      .map((status) => `${status.displayName} ${status.version ?? "unknown"}`)
      .join(", ");
    logLocalized("logs.toolsUpdated", { details });
    await refreshToolStatuses();
  } finally {
    isToolUpdateRunning = false;
    updateSessionCreationState();
    updateOrchestratorControls();
  }
}

function resetLocalAppState() {
  clearAllLocalSessions();
  orchestratorRuns.splice(0, orchestratorRuns.length);
  pendingUserInputDrafts.clear();
  pendingApprovalActionRequestId = null;
  pendingUserInputActionRequestId = null;
  activeApprovalDialogRequestId = null;
  approvalToasts.clear();
  selectedOrchestratorRunId = null;
  selectedOrchestratorRun = null;
  selectedOrchestratorNodeId = null;
  liveOrchestratorRunId = null;
  orchestratorGoalInput.value = "";
  orchestratorDepthInput.value = String(DEFAULT_ORCHESTRATOR_MAX_DEPTH);
  lastOrchestratorRunListSignature = "";
  lastOrchestratorDetailSignature = "";
  lastOrchestratorTreeSignature = "";
  setCurrentWorkspacePath(null);
  activeWorkspaceTabId = "orchestrator";
  isOrchestratorTabOpen = true;
  renderSessionList();
  renderOrchestratorRunList();
  renderOrchestratorDetail();
  renderOrchestratorTree();
  updateTerminalRootState();
  renderWorkspaceTabs();
  renderWorkspacePanels();
  renderApprovalQueueButton();
  renderApprovalDialog();
  renderApprovalToastList();
}

async function resetAppState() {
  if (!window.confirm(translate("ui.resetAppConfirm"))) {
    return;
  }

  isResetting = true;
  if (liveOrchestratorRefreshHandle !== null) {
    window.clearTimeout(liveOrchestratorRefreshHandle);
    liveOrchestratorRefreshHandle = null;
  }

  updateSessionCreationState();
  updateOrchestratorControls();
  logLocalized("logs.resetStarted");

  try {
    await appWindow.tasksaw.resetAppState();
    resetLocalAppState();
    logLocalized("logs.resetCompleted");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logLocalized("errors.failedReset", { message });
  } finally {
    isResetting = false;
    updateSessionCreationState();
    updateOrchestratorControls();
  }
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
    renderWorkspaceTabs();
    renderWorkspacePanels();
    return;
  }

  sessions.splice(0, sessions.length, ...existingSessions);

  for (const session of existingSessions) {
    mountTerminal(session);
  }

  if (!currentWorkspacePath) {
    setCurrentWorkspacePath(existingSessions[existingSessions.length - 1]!.cwd, false);
  }

  activeSessionId = existingSessions[existingSessions.length - 1]!.id;
  activateWorkspaceTab(isOrchestratorTabOpen ? "orchestrator" : activeSessionId);
  scheduleFitAllSessions();
}

appWindow.tasksaw.onTerminalData(({ sessionId, data }: TerminalDataPayload) => {
  const terminal = terminals.get(sessionId);
  if (terminal) terminal.write(data);

  const request = getActiveInteractiveSession();
  if (request?.sessionId === sessionId) {
    request.transcript = trimInteractiveTranscript(`${request.transcript}${data}`);
    interactiveSessionTerminal?.write(data);
  }
});

const autoApprovedRequestIds = new Set<string>();

appWindow.tasksaw.onOrchestratorEvent((event: OrchestratorEvent) => {
  if (event.type === "approval_resolved" && typeof event.payload.requestId === "string") {
    resolveApprovalToast(event.payload.requestId);
    if (activeApprovalDialogRequestId === event.payload.requestId) {
      activeApprovalDialogRequestId = null;
      renderApprovalDialog();
    }
    if (pendingApprovalActionRequestId === event.payload.requestId) {
      pendingApprovalActionRequestId = null;
    }
  }
  if (event.type === "user_input_resolved" && typeof event.payload.requestId === "string") {
    pendingUserInputDrafts.delete(event.payload.requestId);
    if (pendingUserInputActionRequestId === event.payload.requestId) {
      pendingUserInputActionRequestId = null;
    }
  }
  if (event.type === "interactive_session_requested") {
    queueInteractiveSessionRequest(event);
  }
  if (event.type === "interactive_session_resolved" && typeof event.payload.requestId === "string") {
    pendingInteractiveSessions.delete(event.payload.requestId);
    if (activeInteractiveSessionRequestId === event.payload.requestId) {
      hideInteractiveSessionDialog();
    }
  }
  if (
    (event.type === "run_paused" || event.type === "run_failed" || event.type === "run_completed")
    && getActiveInteractiveSession()?.runId === event.runId
  ) {
    const activeRequest = getActiveInteractiveSession();
    if (activeRequest?.sessionId && !activeRequest.exited) {
      appWindow.tasksaw.killSession(activeRequest.sessionId);
    }
    pendingInteractiveSessions.delete(activeRequest?.requestId ?? "");
    hideInteractiveSessionDialog();
  }

  if (!liveOrchestratorRunId && isOrchestratorRunning) {
    liveOrchestratorRunId = event.runId;
  }

  const baseDetail = selectedOrchestratorRun?.run.id === event.runId
    ? selectedOrchestratorRun
    : createLiveOrchestratorRunDetail(event);
  const liveDetail = mergeLiveOrchestratorEvent(baseDetail, event);

  upsertOrchestratorRunSummary(toOrchestratorRunSummary(liveDetail));
  logRaw(formatLiveOrchestratorEvent(event));

  if (liveOrchestratorRunId === event.runId || selectedOrchestratorRunId === event.runId) {
    selectedOrchestratorRunId = event.runId;
    selectedOrchestratorRun = liveDetail;
    updateOrchestratorControls();
    scheduleOrchestratorRender();
  }

  if (event.type === "approval_requested" && event.nodeId) {
    const nodeEvents = liveDetail.events.filter((entry) => entry.nodeId === event.nodeId);
    const pendingApproval = getPendingApproval(nodeEvents);
    if (pendingApproval) {
      if (autoApproveCheckbox.checked && !autoApprovedRequestIds.has(pendingApproval.requestId)) {
        autoApprovedRequestIds.add(pendingApproval.requestId);
        const allowOption = pendingApproval.options.find((opt) => opt.kind === "allow_once")
          ?? pendingApproval.options.find((opt) => typeof opt.kind === "string" && opt.kind.startsWith("allow"))
          ?? pendingApproval.options[0];
        void respondToPendingApproval(pendingApproval.requestId, true, allowOption?.optionId);
      } else if (!autoApproveCheckbox.checked) {
        showApprovalToast(pendingApproval);
        openApprovalDialog(pendingApproval.requestId);
      }
    }
  }

  scheduleLiveOrchestratorRunRefresh(event.runId);
});

appWindow.tasksaw.onTerminalExit(({ sessionId, exitCode, signal }: TerminalExitPayload) => {
  const activeRequest = getActiveInteractiveSession();
  if (activeRequest?.sessionId === sessionId) {
    activeRequest.exited = true;
    activeRequest.exitCode = exitCode;
    activeRequest.signal = signal;
    renderInteractiveSessionDialog();
    void finalizeInteractiveSession(activeRequest.requestId);
  }

  if (terminalPanes.has(sessionId)) {
    markSessionExited(sessionId);
    logLocalized("logs.exited", {
      sessionId,
      exitCode: String(exitCode),
      signal: String(signal)
    });
  }
});

workspaceOpenButton.addEventListener("click", () => void browseWorkspace());
workspaceCreateButton.addEventListener("click", () => void createWorkspaceDirectory());
newShellButton.addEventListener("click", () => void handleCreateSession("shell"));
newCodexButton.addEventListener("click", () => void handleCreateSession("codex"));
newGeminiButton.addEventListener("click", () => void handleCreateSession("gemini"));
approvalQueueButton.addEventListener("click", () => {
  openApprovalDialog();
});
toolsUpdateButton.addEventListener("click", () => void updateManagedTools());
resetAppButton.addEventListener("click", () => void resetAppState());
workspaceOpenOrchestratorButton.addEventListener("click", () => {
  openOrchestratorTab();
});
workspaceEmptyOpenOrchestratorButton.addEventListener("click", () => {
  openOrchestratorTab();
});
orchestratorDetailTabNodeButton.addEventListener("click", () => {
  setActiveOrchestratorDetailTab("node");
});
orchestratorDetailTabMemoryButton.addEventListener("click", () => {
  setActiveOrchestratorDetailTab("memory");
});
orchestratorNodeRequestOpenButton.addEventListener("click", () => {
  openLogViewer(
    orchestratorNodeRequestOpenButton,
    orchestratorNodeRequestDataEl,
    translate("ui.orchestratorNodeRequestEmpty")
  );
});
orchestratorNodeResponseOpenButton.addEventListener("click", () => {
  openLogViewer(
    orchestratorNodeResponseOpenButton,
    orchestratorNodeResponseDataEl,
    translate("ui.orchestratorNodeResponseEmpty")
  );
});
orchestratorNodePlanOpenButton.addEventListener("click", () => {
  openLogViewer(
    orchestratorNodePlanOpenButton,
    orchestratorNodePlanDataEl,
    translate("ui.orchestratorNodePlanEmpty")
  );
});
orchestratorNodeTerminalCopyButton.addEventListener("click", () => {
  void copyOrchestratorTextSection(
    orchestratorNodeTerminalTitleEl,
    orchestratorNodeTerminalText,
    translate("ui.orchestratorNodeTerminalEmpty")
  );
});
orchestratorNodeTerminalOpenButton.addEventListener("click", () => {
  openTextLogViewer(
    orchestratorNodeTerminalTitleEl,
    orchestratorNodeTerminalText,
    translate("ui.orchestratorNodeTerminalEmpty")
  );
});
orchestratorNodeLogOpenButton.addEventListener("click", () => {
  openLogViewer(
    orchestratorNodeLogOpenButton,
    orchestratorNodeLogEl,
    translate("ui.orchestratorNodeLogEmpty")
  );
});
orchestratorWorkingMemoryCopyButton.addEventListener("click", () => {
  void copyOrchestratorSection(
    orchestratorWorkingMemoryTitleEl,
    orchestratorWorkingMemoryEl,
    translate("ui.orchestratorWorkingMemoryEmpty")
  );
});
orchestratorWorkingMemoryOpenButton.addEventListener("click", () => {
  openLogViewer(
    orchestratorWorkingMemoryTitleEl,
    orchestratorWorkingMemoryEl,
    translate("ui.orchestratorWorkingMemoryEmpty")
  );
});
orchestratorLogCopyButton.addEventListener("click", () => {
  void copyOrchestratorSection(
    orchestratorLogTitleEl,
    orchestratorLogEl,
    translate("ui.orchestratorLogEmpty")
  );
});
orchestratorLogOpenButton.addEventListener("click", () => {
  openLogViewer(
    orchestratorLogTitleEl,
    orchestratorLogEl,
    translate("ui.orchestratorLogEmpty")
  );
});
logViewerCopyButton.addEventListener("click", () => {
  void copyLogViewerContent();
});
logViewerCloseButton.addEventListener("click", () => {
  closeLogViewer();
});
logViewerDialogEl.addEventListener("click", (event) => {
  if (event.target === logViewerDialogEl) {
    closeLogViewer();
  }
});
approvalDialogCloseButton.addEventListener("click", () => {
  closeApprovalDialog();
});
approvalDialogEl.addEventListener("click", (event) => {
  if (event.target === approvalDialogEl) {
    closeApprovalDialog();
  }
});
orchestratorRefreshButton.addEventListener("click", () => {
  void loadOrchestratorRuns();
});
orchestratorStopButton.addEventListener("click", () => {
  void stopOrchestratorRun();
});
orchestratorContinueButton.addEventListener("click", () => {
  void runOrchestrator({
    continueFromRunId: selectedOrchestratorRunId,
    continuationMode: "resume"
  });
});
orchestratorRunNextActionButton.addEventListener("click", () => {
  void runSelectedNextAction();
});
orchestratorRunButton.addEventListener("click", () => {
  void runOrchestrator();
});
orchestratorModeSelect.addEventListener("change", () => {
  const nextMode = orchestratorModeSelect.value;
  if (!isOrchestratorMode(nextMode)) return;
  orchestratorMode = nextMode;
  updateOrchestratorControls();
});
orchestratorDepthInput.addEventListener("change", () => {
  orchestratorDepthInput.value = String(getRequestedOrchestratorMaxDepth());
});

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

applyThemePreference(themePreference, false);
applyLanguagePreference(languagePreference, false);
initializeMainSplitter();
window.setInterval(() => {
  orchestratorElapsedClock += 1;
  if (shouldTickSelectedNodeProgress(selectedOrchestratorRun)) {
    scheduleOrchestratorRender({ list: false, detail: true });
  }
}, 1_000);

window.setInterval(() => {
  refreshToolStatuses().catch((error) => console.error("Failed to periodic refresh tool statuses:", error));
}, 60_000);

appWindow.addEventListener("resize", () => {
  syncMainSplitterLayout();
  updateMainSplitterAria();
  scheduleFitAllSessions();
  scheduleFitOrchestratorNodeTerminal();
  scheduleFitInteractiveSessionTerminal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !interactiveSessionDialogEl.hidden) {
    event.preventDefault();
    if (!interactiveSessionDialogTerminateButton.hidden) {
      void terminateActiveInteractiveSession();
    } else {
      hideInteractiveSessionDialog();
    }
    return;
  }

  if (event.key === "Escape" && !approvalDialogEl.hidden) {
    event.preventDefault();
    closeApprovalDialog();
    return;
  }

  if (event.key === "Escape" && !logViewerDialogEl.hidden) {
    event.preventDefault();
    closeLogViewer();
  }
});

interactiveSessionDialogTerminateButton.addEventListener("click", () => {
  void terminateActiveInteractiveSession();
});

interactiveSessionDialogCloseButton.addEventListener("click", () => {
  hideInteractiveSessionDialog();
});

restoreSessions().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logLocalized("errors.failedRestore", { message });
});

loadOrchestratorRuns().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logLocalized("errors.failedLoadOrchestratorRuns", { message });
});

refreshToolStatuses().catch((error: unknown) => {
  console.error("Failed to refresh tool statuses on init:", error);
});
