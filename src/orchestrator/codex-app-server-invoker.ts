import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  ModelInvocationContext,
  OrchestratorApprovalOption,
  OrchestratorCapability,
  OrchestratorUserInputQuestion
} from "./model-adapter";

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

export function createCodexAppServerInvoker(options: CodexAppServerInvokerOptions) {
  const spawnProcess = options.dependencies?.spawnProcess ?? defaultSpawnProcess;

  return async (
    capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext
  ): Promise<{ stdout: string; stderr: string; command: string[] }> => {
    const command = [options.executablePath, ...options.executableArgs, "app-server"];
    context.reportTerminalEvent?.({
      stream: "system",
      text: `$ ${formatTerminalCommand(command)}\n`
    });
    const workingDirectory = options.cwd ?? process.cwd();
    const child = spawnProcess(options.executablePath, [...options.executableArgs, "app-server"], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stderrBuffer = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderrBuffer += text;
      if (stderrBuffer.length > 8_000) {
        stderrBuffer = stderrBuffer.slice(-8_000);
      }
      context.reportTerminalEvent?.({
        stream: "stderr",
        text
      });
    });

    const stdin = child.stdin;
    const stdout = child.stdout;
    if (!stdin || !stdout) {
      await stopChildProcess(child);
      throw new Error("codex app-server did not expose stdio handles");
    }

    const pendingResponses = new Map<JsonRpcId, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let nextRequestId = 1;
    let stdoutCarryover = "";
    let processingQueue = Promise.resolve();
    let latestAgentMessageText = "";
    const agentMessageChunks: string[] = [];
    let threadId = "";
    let turnId = "";

    const onAbort = async () => {
      await stopChildProcess(child);
    };

    const turnCompleted = createDeferred<void>();
    const commandCompletionStates = new Map<string, string>();

    const sendRequest = (method: string, params?: Record<string, unknown>) => {
      const id = nextRequestId++;
      const payload = JSON.stringify({
        id,
        method,
        params: params ?? null
      });
      stdin.write(`${payload}\n`);
      return new Promise<unknown>((resolve, reject) => {
        pendingResponses.set(id, { resolve, reject });
      });
    };

    const sendResponse = (id: JsonRpcId, result: unknown) => {
      stdin.write(`${JSON.stringify({ id, result })}\n`);
    };

    const sendError = (id: JsonRpcId, message: string) => {
      stdin.write(`${JSON.stringify({ id, error: { code: -32000, message } })}\n`);
    };

    const rejectPendingResponses = (error: Error) => {
      for (const pending of pendingResponses.values()) {
        pending.reject(error);
      }
      pendingResponses.clear();
    };

    const handleNotification = async (notification: JsonRpcNotification) => {
      const params = asRecord(notification.params);

      if (notification.method === "turn/started") {
        turnId = readString(asRecord(params.turn).id) || turnId;
        return;
      }

      if (notification.method === "turn/completed") {
        turnId = readString(asRecord(params.turn).id) || turnId;
        turnCompleted.resolve();
        return;
      }

      if (notification.method === "error") {
        const errorRecord = asRecord(params.error);
        throw new Error(
          readString(errorRecord.message)
          || readString(params.message)
          || "Codex app-server reported an error"
        );
      }

      if (notification.method === "item/agentMessage/delta") {
        const delta = readString(params.delta);
        if (delta) {
          agentMessageChunks.push(delta);
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
            latestAgentMessageText = text;
          }
          return;
        }

        if (itemType === "commandExecution") {
          const itemId = readString(item.id);
          const command = readString(item.command) || "unknown command";
          const status = readString(item.status) || (notification.method === "item/started" ? "inProgress" : "completed");

          if (notification.method === "item/started") {
            commandCompletionStates.set(itemId, "started");
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
    };

    const handleServerRequest = async (request: JsonRpcRequest) => {
      const params = asRecord(request.params);

      if (
        request.method === "item/commandExecution/requestApproval"
        || request.method === "item/fileChange/requestApproval"
      ) {
        const message = buildCodexApprovalMessage(request.method, params);
        const details = buildCodexApprovalDetails(request.method, params);
        
        const reasonStr = `${message}\n${details ?? ""}`;
        const isGuessAndTestLoopBlocker = reasonStr.includes("interactive") ||
          (reasonStr.includes("unauthorized") && reasonStr.includes("CLI")) ||
          reasonStr.includes("re-mine") ||
          reasonStr.includes("already attempted in this phase");

        if (capability === "gather" && isGuessAndTestLoopBlocker) {
          const rejectReason = `Auto-rejected during gather to prevent blind execution loops: ${message}. Please use static analysis (e.g. reading source code, --help manuals) instead of guessing CLI arguments.`;
          context.reportProgress?.(
            rejectReason,
            {
              capability,
              model: context.assignedModel.model,
              guardrailReason: message
            }
          );
          sendError(request.id, rejectReason);
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
        sendResponse(request.id, {
          decision: optionId ?? "decline"
        });
        return;
      }

      if (request.method === "item/permissions/requestApproval") {
        const message = buildCodexApprovalMessage(request.method, params);
        const details = buildCodexApprovalDetails(request.method, params);

        const reasonStr = `${message}\n${details ?? ""}`;
        const isGuessAndTestLoopBlocker = reasonStr.includes("interactive") ||
          (reasonStr.includes("unauthorized") && reasonStr.includes("CLI")) ||
          reasonStr.includes("re-mine") ||
          reasonStr.includes("already attempted in this phase");

        if (capability === "gather" && isGuessAndTestLoopBlocker) {
          const rejectReason = `Auto-rejected during gather to prevent blind execution loops: ${message}. Please use static analysis (e.g. reading source code, --help manuals) instead of guessing CLI arguments.`;
          context.reportProgress?.(
            rejectReason,
            {
              capability,
              model: context.assignedModel.model,
              guardrailReason: message
            }
          );
          sendError(request.id, rejectReason);
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

        if (!approval || approval.outcome !== "selected") {
          sendError(request.id, "User denied the requested permissions");
          return;
        }

        if (approval.optionId === "decline") {
          sendError(request.id, "User denied the requested permissions");
          return;
        }

        sendResponse(request.id, {
          permissions: params.permissions ?? {},
          scope: approval.optionId === "session" ? "session" : "turn"
        });
        return;
      }

      if (request.method === "item/tool/requestUserInput" || request.method === "mcpServer/elicitation/request") {
        if (capability === "gather") {
          sendError(request.id, "Auto-rejected during gather: interactive user input is not allowed during the gather phase. Please use read-only static analysis.");
          return;
        }

        const inputRequest = await context.requestUserInput?.({
          abortSignal: context.abortSignal,
          title: request.method === "item/tool/requestUserInput" ? "Codex user input requested" : "Codex elicitation requested",
          message: buildCodexInputMessage(request.method, params),
          questions: buildCodexInputQuestions(request.method, params)
        });

        if (!inputRequest || inputRequest.outcome !== "submitted" || !inputRequest.answers) {
          sendError(request.id, "User cancelled the requested input");
          return;
        }

        sendResponse(
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

      sendError(request.id, `Unsupported Codex app-server request: ${request.method}`);
    };

    const handleMessage = async (rawMessage: string) => {
      if (!rawMessage.trim()) {
        return;
      }

      const message = JSON.parse(rawMessage) as JsonRpcResponse & JsonRpcRequest & JsonRpcNotification;
      if (typeof message.id !== "undefined" && ("result" in message || "error" in message)) {
        const pending = pendingResponses.get(message.id);
        if (!pending) {
          return;
        }

        pendingResponses.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? "Codex app-server returned an error"));
        } else {
          pending.resolve(message.result);
        }
        return;
      }

      if (typeof message.id !== "undefined" && typeof message.method === "string") {
        await handleServerRequest({
          id: message.id,
          method: message.method,
          params: asRecord(message.params)
        });
        return;
      }

      if (typeof message.method === "string") {
        await handleNotification({
          method: message.method,
          params: asRecord(message.params)
        });
      }
    };

    stdout.on("data", (chunk: Buffer | string) => {
      stdoutCarryover += chunk.toString();
      let newlineIndex = stdoutCarryover.indexOf("\n");

      while (newlineIndex !== -1) {
        const line = stdoutCarryover.slice(0, newlineIndex).trim();
        stdoutCarryover = stdoutCarryover.slice(newlineIndex + 1);
        processingQueue = processingQueue
          .then(async () => {
            await handleMessage(line);
          })
          .catch((error) => {
            turnCompleted.reject(error instanceof Error ? error : new Error(String(error)));
          });
        newlineIndex = stdoutCarryover.indexOf("\n");
      }
    });

    child.once("error", (error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      rejectPendingResponses(err);
      turnCompleted.reject(err);
    });
    child.once("exit", (code, signal) => {
      if (turnCompleted.settled) {
        return;
      }

      const error = new Error(
        `codex app-server exited before the turn completed (code=${code ?? "null"}, signal=${signal ?? "null"})`
      );
      rejectPendingResponses(error);
      turnCompleted.reject(error);
    });

    try {
      await withAbort(
        sendRequest("initialize", {
          clientInfo: {
            name: "tasksaw-codex-app-server",
            version: "0.1.0"
          },
          capabilities: {
            experimentalApi: true
          }
        }),
        context.abortSignal,
        onAbort,
        "Codex app-server initialization was aborted"
      );

      const threadResponse = asRecord(
        await withAbort(
          sendRequest("thread/start", {
            model: context.assignedModel.model,
            modelProvider: "openai",
            cwd: workingDirectory,
            approvalPolicy: capability === "execute" ? "on-request" : "never",
            approvalsReviewer: "user",
            sandbox: capability === "execute" ? "workspace-write" : "read-only",
            ephemeral: true,
            experimentalRawEvents: false,
            persistExtendedHistory: false
          }),
          context.abortSignal,
          onAbort,
          "Codex app-server thread start was aborted"
        )
      );
      threadId = readString(asRecord(threadResponse.thread).id);
      if (!threadId) {
        throw new Error("Codex app-server did not return a thread id");
      }

      const effort = context.assignedModel.reasoningEffort
        ? mapReasoningEffort(context.assignedModel.reasoningEffort)
        : null;
      const turnStartParams: Record<string, unknown> = {
        threadId,
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
      };

      const turnStartResult = asRecord(
        await withAbort(
          sendRequest("turn/start", turnStartParams),
          context.abortSignal,
          onAbort,
          "Codex app-server turn start was aborted"
        )
      );
      turnId = readString(asRecord(turnStartResult.turn).id) || turnId;

      await withAbort(turnCompleted.promise, context.abortSignal, onAbort, "Codex app-server turn was aborted");
      await processingQueue;

      const stdoutText = latestAgentMessageText.trim().length > 0
        ? latestAgentMessageText.trim()
        : agentMessageChunks.join("").trim();
      if (!stdoutText) {
        throw new Error("Codex app-server turn completed without any agent message output");
      }

      return {
        stdout: stdoutText,
        stderr: stderrBuffer,
        command
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stderrPreview = stderrBuffer.trim();
      throw new Error(
        [
          `Codex app-server invocation failed: ${message}`,
          `command:\n${command.join(" ")}`,
          threadId ? `threadId=${threadId}` : null,
          turnId ? `turnId=${turnId}` : null,
          stderrPreview ? `stderr preview:\n${stderrPreview.slice(-4_000)}` : null
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    } finally {
      await stopChildProcess(child);
    }
  };
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
