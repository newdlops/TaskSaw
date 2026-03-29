import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  ModelInvocationContext,
  OrchestratorApprovalOption,
  OrchestratorCapability,
  OrchestratorUserInputQuestion
} from "./model-adapter";
import {
  appendSessionContextLedger,
  buildSessionReusePrelude,
  buildSessionReuseScope,
  createSessionContextLedgerEntry,
  finalizeSessionContextLedgerEntry,
  SessionContextLedgerEntry
} from "./session-context-reuse";

type SpawnedProcess = {
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error" | "exit", listener: (...args: unknown[]) => void): SpawnedProcess;
  off(event: "error" | "exit", listener: (...args: unknown[]) => void): SpawnedProcess;
};

type CodexAppServerInvokerDependencies = {
  spawnProcess?: (
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      stdio: ["pipe", "pipe", "pipe"];
    }
  ) => SpawnedProcess;
};

type CodexAppServerInvokerOptions = {
  executablePath: string;
  executableArgs: string[];
  cwd?: string;
  env?: Record<string, string>;
  dependencies?: CodexAppServerInvokerDependencies;
  timeoutMs?: number;
  sessionPool?: CodexAppServerSessionPool;
};

type JsonRpcId = number | string;

type JsonRpcResponse = {
  id?: JsonRpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type JsonRpcRequest = {
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcNotification = {
  method: string;
  params?: Record<string, unknown>;
};

type CodexActiveTurn = {
  capability: OrchestratorCapability;
  context: ModelInvocationContext;
  turnId: string;
  latestAgentMessageText: string;
  agentMessageChunks: string[];
  turnCompleted: ReturnType<typeof createDeferred<void>>;
};

type CodexAppServerConnection = {
  child: SpawnedProcess;
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderrBuffer: string;
  threadId: string | null;
  nextRequestId: number;
  pendingResponses: Map<JsonRpcId, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
  stdoutCarryover: string;
  processingQueue: Promise<void>;
  activeTurn: CodexActiveTurn | null;
  initialized: boolean;
  closed: boolean;
};

type CodexAppServerScopedSessionState = {
  connection: CodexAppServerConnection | null;
  invocationQueue: Promise<void>;
  ledger: SessionContextLedgerEntry[];
};

export type CodexAppServerSessionPool = Map<string, CodexAppServerScopedSessionState>;

export function createCodexAppServerSessionPool(): CodexAppServerSessionPool {
  return new Map();
}

export function createCodexAppServerInvoker(options: CodexAppServerInvokerOptions) {
  const spawnProcess = options.dependencies?.spawnProcess ?? defaultSpawnProcess;
  const sessionPool = options.sessionPool ?? createCodexAppServerSessionPool();

  return async (
    capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext
  ): Promise<{ stdout: string; stderr: string; command: string[] }> => {
    const command = [options.executablePath, ...options.executableArgs, "app-server"];
    const workingDirectory = options.cwd ?? process.cwd();
    const scope = buildSessionReuseScope("codex-app-server", workingDirectory, capability, context);
    const scopedState = getOrCreateScopedState(scope.key);

    const runInvocation = scopedState.invocationQueue.then(async () => {
      context.reportTerminalEvent?.({
        stream: "system",
        text: `$ ${formatTerminalCommand(command)}\n`
      });
      const currentLedgerEntry = createSessionContextLedgerEntry(scope, capability, prompt, context);
      const replayPrelude = buildSessionReusePrelude(scope, scopedState.ledger, currentLedgerEntry);
      const promptText = replayPrelude ? `${replayPrelude}\n\n${prompt}` : prompt;
      let connection = await ensureConnection(scopedState);

      try {
        await ensureInitialized(scopedState, connection, context);
        await ensureThread(scopedState, connection, capability, context, workingDirectory);
        const result = await runTurn(scopedState, connection, capability, promptText, context, workingDirectory);
        scopedState.ledger = appendSessionContextLedger(
          scopedState.ledger,
          finalizeSessionContextLedgerEntry(currentLedgerEntry, result.stdout)
        );
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          command
        };
      } catch (error) {
        const failedConnection = connection;
        const failedThreadId = failedConnection.threadId ?? "";
        const failedTurnId = failedConnection.activeTurn?.turnId ?? "";
        const stderrPreview = failedConnection.stderrBuffer.trim();
        await invalidateSession(scopedState, failedConnection);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          [
            `Codex app-server invocation failed: ${message}`,
            `command:\n${command.join(" ")}`,
            failedThreadId ? `threadId=${failedThreadId}` : null,
            failedTurnId ? `turnId=${failedTurnId}` : null,
            stderrPreview ? `stderr preview:\n${stderrPreview.slice(-4_000)}` : null
          ]
            .filter(Boolean)
            .join("\n\n")
        );
      }
    });

    scopedState.invocationQueue = runInvocation.then(() => undefined, () => undefined);
    return runInvocation;
  };

  function getOrCreateScopedState(scopeKey: string): CodexAppServerScopedSessionState {
    const existing = sessionPool.get(scopeKey);
    if (existing) {
      return existing;
    }

    const initialState: CodexAppServerScopedSessionState = {
      connection: null,
      invocationQueue: Promise.resolve(),
      ledger: []
    };
    sessionPool.set(scopeKey, initialState);
    return initialState;
  }

  async function ensureConnection(
    scopedState: CodexAppServerScopedSessionState
  ): Promise<CodexAppServerConnection> {
    if (isConnectionAlive(scopedState.connection)) {
      return scopedState.connection;
    }

    const child = spawnProcess(options.executablePath, [...options.executableArgs, "app-server"], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdin = child.stdin;
    const stdout = child.stdout;
    if (!stdin || !stdout) {
      await stopChildProcess(child);
      throw new Error("codex app-server did not expose stdio handles");
    }

    const connection: CodexAppServerConnection = {
      child,
      stdin,
      stdout,
      stderrBuffer: "",
      threadId: null,
      nextRequestId: 1,
      pendingResponses: new Map(),
      stdoutCarryover: "",
      processingQueue: Promise.resolve(),
      activeTurn: null,
      initialized: false,
      closed: false
    };
    scopedState.connection = connection;

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      connection.stderrBuffer += text;
      if (connection.stderrBuffer.length > 8_000) {
        connection.stderrBuffer = connection.stderrBuffer.slice(-8_000);
      }
      connection.activeTurn?.context.reportTerminalEvent?.({
        stream: "stderr",
        text
      });
    });

    stdout.on("data", (chunk: Buffer | string) => {
      connection.stdoutCarryover += chunk.toString();
      let newlineIndex = connection.stdoutCarryover.indexOf("\n");

      while (newlineIndex !== -1) {
        const line = connection.stdoutCarryover.slice(0, newlineIndex).trim();
        connection.stdoutCarryover = connection.stdoutCarryover.slice(newlineIndex + 1);
        connection.processingQueue = connection.processingQueue
          .then(async () => {
            await handleMessage(scopedState, connection, line);
          })
          .catch((error) => {
            const err = error instanceof Error ? error : new Error(String(error));
            rejectPendingResponses(connection, err);
            connection.activeTurn?.turnCompleted.reject(err);
          });
        newlineIndex = connection.stdoutCarryover.indexOf("\n");
      }
    });

    child.once("error", (error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      connection.closed = true;
      rejectPendingResponses(connection, err);
      connection.activeTurn?.turnCompleted.reject(err);
      if (scopedState.connection === connection) {
        scopedState.connection = null;
      }
    });
    child.once("exit", (code, signal) => {
      connection.closed = true;
      if (scopedState.connection === connection) {
        scopedState.connection = null;
      }

      const error = new Error(
        `codex app-server exited before the turn completed (code=${code ?? "null"}, signal=${signal ?? "null"})`
      );
      rejectPendingResponses(connection, error);
      connection.activeTurn?.turnCompleted.reject(error);
    });

    return connection;
  }

  async function ensureInitialized(
    scopedState: CodexAppServerScopedSessionState,
    connection: CodexAppServerConnection,
    context: ModelInvocationContext
  ): Promise<void> {
    if (connection.initialized) {
      return;
    }

    await withAbort(
      sendRequest(connection, "initialize", {
        clientInfo: {
          name: "tasksaw-codex-app-server",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true
        }
      }),
      context.abortSignal,
      async () => {
        await invalidateSession(scopedState, connection);
      },
      "Codex app-server initialization was aborted"
    );
    connection.initialized = true;
  }

  async function ensureThread(
    scopedState: CodexAppServerScopedSessionState,
    connection: CodexAppServerConnection,
    capability: OrchestratorCapability,
    context: ModelInvocationContext,
    workingDirectory: string
  ): Promise<void> {
    if (connection.threadId) {
      return;
    }

    const threadResponse = asRecord(
      await withAbort(
        sendRequest(connection, "thread/start", {
          model: context.assignedModel.model,
          modelProvider: "openai",
          cwd: workingDirectory,
          approvalPolicy: capability === "execute" ? "on-request" : "never",
          approvalsReviewer: "user",
          sandbox: capability === "execute" ? "workspace-write" : "read-only",
          ephemeral: false,
          experimentalRawEvents: false,
          persistExtendedHistory: true
        }),
        context.abortSignal,
        async () => {
          await invalidateSession(scopedState, connection);
        },
        "Codex app-server thread start was aborted"
      )
    );
    connection.threadId = readString(asRecord(threadResponse.thread).id);
    if (!connection.threadId) {
      throw new Error("Codex app-server did not return a thread id");
    }
  }

  async function runTurn(
    scopedState: CodexAppServerScopedSessionState,
    connection: CodexAppServerConnection,
    capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext,
    workingDirectory: string
  ): Promise<{ stdout: string; stderr: string }> {
    const turnState: CodexActiveTurn = {
      capability,
      context,
      turnId: "",
      latestAgentMessageText: "",
      agentMessageChunks: [],
      turnCompleted: createDeferred<void>()
    };
    connection.activeTurn = turnState;
    const stderrStartIndex = connection.stderrBuffer.length;
    const onAbort = async () => {
      await invalidateSession(scopedState, connection);
    };

    try {
      const effort = context.assignedModel.reasoningEffort
        ? mapReasoningEffort(context.assignedModel.reasoningEffort)
        : null;
      const turnStartResult = asRecord(
        await withAbort(
          sendRequest(connection, "turn/start", {
            threadId: connection.threadId,
            input: [
              {
                type: "text",
                text: prompt,
                text_elements: []
              }
            ],
            model: context.assignedModel.model,
            approvalPolicy: capability === "execute" ? "on-request" : "never",
            approvalsReviewer: "user",
            cwd: workingDirectory,
            sandboxPolicy: buildCodexSandboxPolicy(capability, workingDirectory),
            effort
          }),
          context.abortSignal,
          onAbort,
          "Codex app-server turn start was aborted"
        )
      );
      turnState.turnId = readString(asRecord(turnStartResult.turn).id) || turnState.turnId;

      await withAbort(turnState.turnCompleted.promise, context.abortSignal, onAbort, "Codex app-server turn was aborted");
      await connection.processingQueue;

      const stdoutText = turnState.latestAgentMessageText.trim().length > 0
        ? turnState.latestAgentMessageText.trim()
        : turnState.agentMessageChunks.join("").trim();
      if (!stdoutText) {
        throw new Error("Codex app-server turn completed without any agent message output");
      }

      return {
        stdout: stdoutText,
        stderr: connection.stderrBuffer.slice(stderrStartIndex)
      };
    } finally {
      connection.activeTurn = null;
    }
  }

  function sendRequest(
    connection: CodexAppServerConnection,
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const id = connection.nextRequestId++;
    connection.stdin.write(`${JSON.stringify({ id, method, params: params ?? null })}\n`);
    return new Promise<unknown>((resolve, reject) => {
      connection.pendingResponses.set(id, { resolve, reject });
    });
  }

  function sendResponse(connection: CodexAppServerConnection, id: JsonRpcId, result: unknown) {
    connection.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  function sendError(connection: CodexAppServerConnection, id: JsonRpcId, message: string) {
    connection.stdin.write(`${JSON.stringify({ id, error: { code: -32000, message } })}\n`);
  }

  function rejectPendingResponses(connection: CodexAppServerConnection, error: Error) {
    for (const pending of connection.pendingResponses.values()) {
      pending.reject(error);
    }
    connection.pendingResponses.clear();
  }

  async function handleMessage(
    scopedState: CodexAppServerScopedSessionState,
    connection: CodexAppServerConnection,
    rawMessage: string
  ) {
    if (!rawMessage.trim()) {
      return;
    }

    const message = JSON.parse(rawMessage) as JsonRpcResponse & JsonRpcRequest & JsonRpcNotification;
    if (typeof message.id !== "undefined" && ("result" in message || "error" in message)) {
      const pending = connection.pendingResponses.get(message.id);
      if (!pending) {
        return;
      }

      connection.pendingResponses.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "Codex app-server returned an error"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.id !== "undefined" && typeof message.method === "string") {
      await handleServerRequest(scopedState, connection, {
        id: message.id,
        method: message.method,
        params: asRecord(message.params)
      });
      return;
    }

    if (typeof message.method === "string") {
      await handleNotification(connection, {
        method: message.method,
        params: asRecord(message.params)
      });
    }
  }

  async function handleNotification(
    connection: CodexAppServerConnection,
    notification: JsonRpcNotification
  ) {
    const params = asRecord(notification.params);
    const activeTurn = connection.activeTurn;

    if (notification.method === "error") {
      const errorRecord = asRecord(params.error);
      throw new Error(
        readString(errorRecord.message)
        || readString(params.message)
        || "Codex app-server reported an error"
      );
    }

    if (!activeTurn) {
      return;
    }

    const context = activeTurn.context;

    if (notification.method === "turn/started") {
      activeTurn.turnId = readString(asRecord(params.turn).id) || activeTurn.turnId;
      return;
    }

    if (notification.method === "turn/completed") {
      activeTurn.turnId = readString(asRecord(params.turn).id) || activeTurn.turnId;
      activeTurn.turnCompleted.resolve();
      return;
    }

    if (notification.method === "item/agentMessage/delta") {
      const delta = readString(params.delta);
      if (delta) {
        activeTurn.agentMessageChunks.push(delta);
        context.reportTerminalEvent?.({
          stream: "stdout",
          text: delta
        });
      }
      return;
    }

    if (notification.method === "item/plan/delta") {
      const delta = readString(params.delta);
      if (delta) {
        context.reportExecutionStatus?.("planning_update", delta);
        context.reportTerminalEvent?.({
          stream: "system",
          text: `${delta}\n`
        });
      }
      return;
    }

    if (notification.method === "item/mcpToolCall/progress") {
      const message = readString(params.message);
      if (message) {
        context.reportExecutionStatus?.("tool_progress", message);
        context.reportTerminalEvent?.({
          stream: "system",
          text: `[tool] ${message}\n`
        });
      }
      return;
    }

    if (notification.method === "item/started" || notification.method === "item/completed") {
      const item = asRecord(params.item);
      const itemType = readString(item.type);

      if (itemType === "agentMessage") {
        const text = readString(item.text);
        if (text) {
          activeTurn.latestAgentMessageText = text;
        }
        return;
      }

      if (itemType === "commandExecution") {
        const itemId = readString(item.id);
        const command = readString(item.command) || "unknown command";
        const status = readString(item.status) || (notification.method === "item/started" ? "inProgress" : "completed");

        if (notification.method === "item/started") {
          context.reportExecutionStatus?.("running_command", `Running command: ${command}`, {
            command,
            cwd: readString(item.cwd) || null,
            itemId: itemId || null
          });
          context.reportTerminalEvent?.({
            stream: "system",
            text: `$ ${command}\n`
          });
          return;
        }

        const aggregatedOutput = readString(item.aggregatedOutput);
        if (status === "completed") {
          context.reportExecutionStatus?.("command_completed", `Completed command: ${command}`, {
            command,
            itemId: itemId || null,
            exitCode: item.exitCode ?? null,
            outputPreview: aggregatedOutput ? aggregatedOutput.slice(-600) : null
          });
          context.reportTerminalEvent?.({
            stream: "system",
            text: `[command completed] ${command}\n`
          });
        } else if (status === "failed") {
          context.reportExecutionStatus?.("command_failed", `Failed command: ${command}`, {
            command,
            itemId: itemId || null,
            exitCode: item.exitCode ?? null,
            outputPreview: aggregatedOutput ? aggregatedOutput.slice(-600) : null
          });
          context.reportTerminalEvent?.({
            stream: "system",
            text: `[command failed] ${command}\n`
          });
        } else if (status === "declined") {
          context.reportExecutionStatus?.("command_declined", `Declined command: ${command}`, {
            command,
            itemId: itemId || null
          });
          context.reportTerminalEvent?.({
            stream: "system",
            text: `[command declined] ${command}\n`
          });
        }
      }
      return;
    }

    if (notification.method === "item/commandExecution/outputDelta") {
      const delta = readString(params.delta);
      if (delta) {
        context.reportExecutionStatus?.("command_output", delta.slice(-400), {
          itemId: readString(params.itemId) || null
        });
        context.reportTerminalEvent?.({
          stream: "stdout",
          text: delta
        });
      }
      return;
    }

    if (notification.method === "item/commandExecution/terminalInteraction") {
      const inputText = readString(params.stdin);
      if (inputText) {
        context.reportExecutionStatus?.("terminal_interaction", inputText, {
          itemId: readString(params.itemId) || null,
          processId: readString(params.processId) || null
        });
        context.reportTerminalEvent?.({
          stream: "input",
          text: inputText
        });
      }
    }
  }

  async function handleServerRequest(
    scopedState: CodexAppServerScopedSessionState,
    connection: CodexAppServerConnection,
    request: JsonRpcRequest
  ) {
    const activeTurn = connection.activeTurn;
    if (!activeTurn) {
      sendError(connection, request.id, `Unsupported Codex app-server request without an active turn: ${request.method}`);
      return;
    }

    const { capability, context } = activeTurn;
    const params = asRecord(request.params);

    if (
      request.method === "item/commandExecution/requestApproval"
      || request.method === "item/fileChange/requestApproval"
    ) {
      const message = buildCodexApprovalMessage(request.method, params);
      const details = buildCodexApprovalDetails(request.method, params);
      const reasonStr = `${message}\n${details ?? ""}`;
      const isGuessAndTestLoopBlocker = reasonStr.includes("interactive")
        || (reasonStr.includes("unauthorized") && reasonStr.includes("CLI"))
        || reasonStr.includes("re-mine")
        || reasonStr.includes("already attempted in this phase");

      if (capability === "gather" && isGuessAndTestLoopBlocker) {
        const rejectReason = `Auto-rejected during gather to prevent blind execution loops: ${message}. Please use static analysis (e.g. reading source code, --help manuals) instead of guessing CLI arguments.`;
        context.reportProgress?.(rejectReason, {
          capability,
          model: context.assignedModel.model,
          guardrailReason: message
        });
        sendError(connection, request.id, rejectReason);
        return;
      }

      const approvalOptions = buildCodexApprovalOptions(request.method);
      const approval = await context.requestUserApproval?.({
        abortSignal: context.abortSignal,
        title: request.method === "item/fileChange/requestApproval"
          ? "Codex file change approval"
          : "Codex command approval",
        message,
        details,
        kind: request.method,
        locations: extractCodexRequestLocations(params),
        options: approvalOptions
      });

      const optionId = approval?.outcome === "selected" ? approval.optionId : "decline";
      sendResponse(connection, request.id, {
        decision: optionId ?? "decline"
      });
      return;
    }

    if (request.method === "item/permissions/requestApproval") {
      const message = buildCodexApprovalMessage(request.method, params);
      const details = buildCodexApprovalDetails(request.method, params);
      const reasonStr = `${message}\n${details ?? ""}`;
      const isGuessAndTestLoopBlocker = reasonStr.includes("interactive")
        || (reasonStr.includes("unauthorized") && reasonStr.includes("CLI"))
        || reasonStr.includes("re-mine")
        || reasonStr.includes("already attempted in this phase");

      if (capability === "gather" && isGuessAndTestLoopBlocker) {
        const rejectReason = `Auto-rejected during gather to prevent blind execution loops: ${message}. Please use static analysis (e.g. reading source code, --help manuals) instead of guessing CLI arguments.`;
        context.reportProgress?.(rejectReason, {
          capability,
          model: context.assignedModel.model,
          guardrailReason: message
        });
        sendError(connection, request.id, rejectReason);
        return;
      }

      const approval = await context.requestUserApproval?.({
        abortSignal: context.abortSignal,
        title: "Codex permission approval",
        message,
        details,
        kind: request.method,
        locations: extractCodexRequestLocations(params),
        options: [
          {
            optionId: "turn",
            kind: "allow_once",
            label: "Allow for turn"
          },
          {
            optionId: "session",
            kind: "allow_for_session",
            label: "Allow for session"
          },
          {
            optionId: "decline",
            kind: "reject_once",
            label: "Decline"
          }
        ]
      });

      if (!approval || approval.outcome !== "selected" || approval.optionId === "decline") {
        sendError(connection, request.id, "User denied the requested permissions");
        return;
      }

      sendResponse(connection, request.id, {
        permissions: params.permissions ?? {},
        scope: approval.optionId === "session" ? "session" : "turn"
      });
      return;
    }

    if (request.method === "item/tool/requestUserInput" || request.method === "mcpServer/elicitation/request") {
      if (capability === "gather") {
        sendError(connection, request.id, "Auto-rejected during gather: interactive user input is not allowed during the gather phase. Please use read-only static analysis.");
        return;
      }

      const inputRequest = await context.requestUserInput?.({
        abortSignal: context.abortSignal,
        title: request.method === "item/tool/requestUserInput" ? "Codex user input requested" : "Codex elicitation requested",
        message: buildCodexInputMessage(request.method, params),
        questions: buildCodexInputQuestions(request.method, params)
      });

      if (!inputRequest || inputRequest.outcome !== "submitted" || !inputRequest.answers) {
        sendError(connection, request.id, "User cancelled the requested input");
        return;
      }

      sendResponse(
        connection,
        request.id,
        request.method === "item/tool/requestUserInput"
          ? { answers: normalizeCodexInputAnswers(inputRequest.answers) }
          : {
              response: {
                action: "accept",
                content: normalizeCodexInputAnswers(inputRequest.answers)
              }
            }
      );
      return;
    }

    sendError(connection, request.id, `Unsupported Codex app-server request: ${request.method}`);
  }

  async function invalidateSession(
    scopedState: CodexAppServerScopedSessionState,
    targetConnection?: CodexAppServerConnection | null
  ) {
    const connection = targetConnection ?? scopedState.connection;
    if (!connection) {
      return;
    }

    if (scopedState.connection === connection) {
      scopedState.connection = null;
    }

    connection.closed = true;
    connection.activeTurn = null;
    rejectPendingResponses(connection, new Error("Codex app-server session was invalidated"));
    await stopChildProcess(connection.child);
  }

  function isConnectionAlive(connection: CodexAppServerConnection | null): connection is CodexAppServerConnection {
    return Boolean(
      connection
      && !connection.closed
      && connection.child.exitCode === null
      && connection.child.signalCode === null
    );
  }
}

function buildCodexApprovalOptions(method: string): OrchestratorApprovalOption[] {
  if (method === "item/fileChange/requestApproval") {
    return [
      {
        optionId: "accept",
        kind: "allow_once",
        label: "Approve once"
      },
      {
        optionId: "acceptForSession",
        kind: "allow_for_session",
        label: "Approve for session"
      },
      {
        optionId: "decline",
        kind: "reject_once",
        label: "Decline"
      }
    ];
  }

  return [
    {
      optionId: "accept",
      kind: "allow_once",
      label: "Approve once"
    },
    {
      optionId: "acceptForSession",
      kind: "allow_for_session",
      label: "Approve for session"
    },
    {
      optionId: "decline",
      kind: "reject_once",
      label: "Decline"
    },
    {
      optionId: "cancel",
      kind: "reject_once",
      label: "Cancel turn"
    }
  ];
}

function buildCodexApprovalMessage(method: string, params: Record<string, unknown>): string {
  if (method === "item/permissions/requestApproval") {
    return readString(params.reason) || "Codex is requesting additional permissions.";
  }

  if (method === "item/fileChange/requestApproval") {
    return readString(params.reason) || "Codex wants to apply a file change.";
  }

  const command = readString(params.command);
  if (command) {
    return `Codex wants to run: ${command}`;
  }

  return readString(params.reason) || "Codex requested approval to continue.";
}

function buildCodexApprovalDetails(method: string, params: Record<string, unknown>): string | undefined {
  const lines: string[] = [];
  const cwd = readString(params.cwd);
  if (cwd) {
    lines.push(`cwd: ${cwd}`);
  }

  if (method === "item/permissions/requestApproval") {
    lines.push(JSON.stringify(params.permissions ?? {}, null, 2));
  }

  const command = readString(params.command);
  if (command) {
    lines.push(`command: ${command}`);
    const normalizationNote = getCodexCommandNormalizationNote(command);
    if (normalizationNote) {
      lines.push(normalizationNote);
    }
  }

  const reason = readString(params.reason);
  if (reason && reason !== buildCodexApprovalMessage(method, params)) {
    lines.push(reason);
  }

  const commandActions = Array.isArray(params.commandActions) ? params.commandActions : [];
  if (commandActions.length > 0) {
    lines.push(JSON.stringify(commandActions, null, 2));
  }

  return lines.length > 0 ? lines.join("\n\n") : undefined;
}

function getCodexCommandNormalizationNote(command: string): string | null {
  const normalized = command.trim();
  if (!/\bnode\s+--test\b/.test(normalized) || !/\bsrc\/.*\.ts\b/.test(normalized)) {
    return null;
  }

  return "Preferred verification path for this repo: run npm run build first, then use built dist tests (for example node --test dist/...) or the project's documented test script.";
}

function extractCodexRequestLocations(params: Record<string, unknown>): string[] {
  const locations: string[] = [];
  const cwd = readString(params.cwd);
  if (cwd) {
    locations.push(cwd);
  }

  const grantRoot = readString(params.grantRoot);
  if (grantRoot) {
    locations.push(grantRoot);
  }

  return locations;
}

function buildCodexInputMessage(method: string, params: Record<string, unknown>): string {
  if (method === "mcpServer/elicitation/request") {
    return readString(params.message) || "Codex needs input for an MCP elicitation.";
  }

  const questions = Array.isArray(params.questions) ? params.questions : [];
  if (questions.length === 1) {
    const question = asRecord(questions[0]);
    return readString(question.question) || "Codex needs additional input.";
  }

  return "Codex needs additional input to continue.";
}

function buildCodexInputQuestions(method: string, params: Record<string, unknown>): OrchestratorUserInputQuestion[] {
  if (method === "item/tool/requestUserInput") {
    const questions = Array.isArray(params.questions) ? params.questions : [];
    return questions
      .map((question) => asRecord(question))
      .map((question, index) => ({
        id: readString(question.id) || `question-${index + 1}`,
        header: readString(question.header) || `Question ${index + 1}`,
        question: readString(question.question) || "Provide input",
        isOther: Boolean(question.isOther),
        isSecret: Boolean(question.isSecret),
        options: Array.isArray(question.options)
          ? question.options
            .map((option) => asRecord(option))
            .map((option) => ({
              label: readString(option.label) || "",
              description: readString(option.description) || undefined
            }))
            .filter((option) => option.label.length > 0)
          : undefined
      }));
  }

  return [
    {
      id: "response",
      header: "Response",
      question: readString(params.message) || "Provide input",
      options: undefined
    }
  ];
}

function normalizeCodexInputAnswers(answers: Record<string, string[]>): Record<string, { answers: string[] }> {
  return Object.fromEntries(
    Object.entries(answers).map(([questionId, values]) => [
      questionId,
      {
        answers: values.filter((value) => value.trim().length > 0)
      }
    ])
  );
}

function mapReasoningEffort(value: string): string | null {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  if (value === "xhigh") {
    return "high";
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  let settled = false;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      innerResolve(value);
    };
    reject = (reason) => {
      if (settled) {
        return;
      }
      settled = true;
      innerReject(reason);
    };
  });
  void promise.catch(() => {});

  return {
    promise,
    resolve,
    reject,
    get settled() {
      return settled;
    }
  };
}

function buildCodexSandboxPolicy(capability: OrchestratorCapability, workspacePath: string): Record<string, unknown> {
  const restrictedReadAccess = {
    type: "restricted",
    includePlatformDefaults: true,
    readableRoots: [workspacePath]
  };

  if (capability === "execute") {
    return {
      type: "workspaceWrite",
      writableRoots: [workspacePath],
      readOnlyAccess: restrictedReadAccess,
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    };
  }

  return {
    type: "readOnly",
    access: restrictedReadAccess,
    networkAccess: false
  };
}

async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onAbort: () => void | Promise<void>,
  abortMessage: string
): Promise<T> {
  if (signal.aborted) {
    await onAbort();
    throw signal.reason instanceof Error ? signal.reason : new Error(abortMessage);
  }

  return await new Promise<T>((resolve, reject) => {
    const abortHandler = async () => {
      signal.removeEventListener("abort", abortHandler);
      try {
        await onAbort();
      } finally {
        reject(signal.reason instanceof Error ? signal.reason : new Error(abortMessage));
      }
    };

    signal.addEventListener("abort", abortHandler, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abortHandler);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abortHandler);
        reject(error);
      }
    );
  });
}

async function stopChildProcess(child: SpawnedProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve();
    }, 1_000);

    const onExit = () => {
      clearTimeout(timeout);
      resolve();
    };

    child.once("exit", onExit);
  });
}

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio: ["pipe", "pipe", "pipe"];
  }
): SpawnedProcess {
  return spawn(command, args, options);
}

function formatTerminalCommand(command: string[]): string {
  return command
    .map((part) => (/^[a-zA-Z0-9._/:=@-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}
