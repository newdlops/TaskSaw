import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import {
  ModelInvocationContext,
  OrchestratorApprovalDecision,
  OrchestratorApprovalOption,
  OrchestratorCapability
} from "./model-adapter";

const dynamicImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<unknown>;

type GeminiAcpModule = {
  PROTOCOL_VERSION: number;
  ndJsonStream: (output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>) => unknown;
  ClientSideConnection: new (
    toClient: () => object,
    stream: unknown
  ) => {
    initialize(params: Record<string, unknown>): Promise<unknown>;
    newSession(params: Record<string, unknown>): Promise<unknown>;
    setSessionMode?(params: Record<string, unknown>): Promise<unknown>;
    unstable_setSessionModel?(params: Record<string, unknown>): Promise<unknown>;
    prompt(params: Record<string, unknown>): Promise<unknown>;
  };
};

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

type GeminiAcpInvokerDependencies = {
  loadAcpModule?: (modulePath: string) => Promise<GeminiAcpModule>;
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

type GeminiAcpInvokerOptions = {
  executablePath: string;
  executableArgs: string[];
  acpModulePath: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  modeId?: string;
  fallbackModelIds?: string[];
  invalidStreamRetryCount?: number;
  dependencies?: GeminiAcpInvokerDependencies;
};

type GeminiNewSessionResponse = {
  sessionId?: string;
  modes?: {
    availableModes?: Array<{
      id?: string;
    }>;
  };
};

type GeminiPromptResponse = {
  stopReason?: string;
};

type GeminiPromptRuntime = {
  agentMessageChunks: string[];
  workspaceRoot: string;
  requestPermissionHandler: (params: {
    options?: Array<{
      optionId?: string;
      kind?: string;
    }>;
    toolCall?: {
      title?: string;
      kind?: string;
      locations?: Array<{ path?: string; uri?: string; label?: string }>;
      content?: Array<
        | {
          type?: string;
          path?: string;
          oldText?: string;
          newText?: string;
        }
        | {
          type?: string;
          content?: {
            type?: string;
            text?: string;
          };
        }
      >;
    };
  }) => Promise<OrchestratorApprovalDecision>;
};

type GeminiLiveSession = {
  child: SpawnedProcess;
  connection: {
    setSessionMode?(params: Record<string, unknown>): Promise<unknown>;
    unstable_setSessionModel?(params: Record<string, unknown>): Promise<unknown>;
    prompt(params: Record<string, unknown>): Promise<GeminiPromptResponse>;
  };
  sessionId: string;
  currentModelId: string | null;
  stderrBuffer: () => string;
};

class TasksawGeminiAcpClient {
  constructor(
    private readonly runtimeProvider: () => GeminiPromptRuntime | null
  ) {}

  async requestPermission(params: {
    options?: Array<{
      optionId?: string;
      kind?: string;
    }>;
    toolCall?: {
      title?: string;
      kind?: string;
      locations?: Array<{ path?: string; uri?: string; label?: string }>;
      content?: Array<
        | {
          type?: string;
          path?: string;
          oldText?: string;
          newText?: string;
        }
        | {
          type?: string;
          content?: {
            type?: string;
            text?: string;
          };
        }
      >;
    };
  }) {
    const runtime = this.runtimeProvider();
    if (!runtime) {
      return {
        outcome: {
          outcome: "cancelled" as const
        }
      };
    }

    const decision = await runtime.requestPermissionHandler(params);
    if (decision.outcome !== "selected" || !decision.optionId) {
      return {
        outcome: {
          outcome: "cancelled" as const
        }
      };
    }

    return {
      outcome: {
        outcome: "selected" as const,
        optionId: decision.optionId
      }
    };
  }

  async sessionUpdate(params: {
    update?: {
      sessionUpdate?: string;
      content?: {
        type?: string;
        text?: string;
      };
    };
  }) {
    const update = params.update;
    const runtime = this.runtimeProvider();
    if (
      runtime &&
      update?.sessionUpdate === "agent_message_chunk"
      && update.content?.type === "text"
      && typeof update.content.text === "string"
    ) {
      runtime.agentMessageChunks.push(update.content.text);
    }

    return undefined;
  }

  async writeTextFile(params: { path?: string; content?: string }) {
    const filePath = this.resolveWorkspacePath(params.path);
    const content = typeof params.content === "string" ? params.content : "";
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    return {};
  }

  async readTextFile(params: { path?: string }) {
    const filePath = this.resolveWorkspacePath(params.path);
    return {
      content: fs.readFileSync(filePath, "utf8")
    };
  }

  private resolveWorkspacePath(requestedPath: string | undefined): string {
    const runtime = this.runtimeProvider();
    if (!runtime) {
      throw new Error("Gemini ACP file operation was requested without an active prompt runtime");
    }

    if (!requestedPath || requestedPath.trim().length === 0) {
      throw new Error("Gemini ACP file operation did not specify a path");
    }

    const workspaceRoot = path.resolve(runtime.workspaceRoot);
    const candidatePath = path.isAbsolute(requestedPath)
      ? path.resolve(requestedPath)
      : path.resolve(workspaceRoot, requestedPath);
    const normalizedRoot = this.resolveExistingPath(workspaceRoot);
    const normalizedCandidate = this.resolveCandidatePath(candidatePath);

    if (normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)) {
      return normalizedCandidate;
    }

    throw new Error(`Gemini ACP file access escaped the workspace root: ${requestedPath}`);
  }

  private resolveCandidatePath(candidatePath: string): string {
    if (fs.existsSync(candidatePath)) {
      return this.resolveExistingPath(candidatePath);
    }

    const parentDirectory = path.dirname(candidatePath);
    const normalizedParent = this.resolveExistingPath(parentDirectory);
    return path.join(normalizedParent, path.basename(candidatePath));
  }

  private resolveExistingPath(targetPath: string): string {
    return fs.realpathSync.native?.(targetPath) ?? fs.realpathSync(targetPath);
  }
}

export function createGeminiAcpInvoker(options: GeminiAcpInvokerOptions) {
  const loadAcpModule = options.dependencies?.loadAcpModule ?? defaultLoadAcpModule;
  const spawnProcess = options.dependencies?.spawnProcess ?? defaultSpawnProcess;
  const desiredModeId = options.modeId ?? "plan";
  const command = [options.executablePath, ...options.executableArgs, "--acp"];
  const fallbackModelIds = options.fallbackModelIds ?? [];
  const invalidStreamRetryCount = Math.max(0, options.invalidStreamRetryCount ?? 1);
  const workspaceRoot = options.cwd ?? process.cwd();
  let activeRuntime: GeminiPromptRuntime | null = null;
  let activeSession: GeminiLiveSession | null = null;
  let invocationQueue: Promise<void> = Promise.resolve();

  return async (
    capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext
  ): Promise<{ stdout: string; stderr: string; command: string[] }> => {
    const runInvocation = invocationQueue.then(async () => {
      const attemptModels = buildGeminiAttemptModels(
        context.assignedModel.model,
        fallbackModelIds,
        invalidStreamRetryCount
      );
      const retryNotes: string[] = [];
      let lastError: unknown;

      for (let attemptIndex = 0; attemptIndex < attemptModels.length; attemptIndex += 1) {
        const modelId = attemptModels[attemptIndex]!;

        try {
          const session = await ensureSession(context.abortSignal);
          const stderrStartIndex = session.stderrBuffer().length;

          if (!session.connection.unstable_setSessionModel) {
            throw new Error("The installed Gemini ACP client does not support session model switching");
          }

          if (session.currentModelId !== modelId) {
            await withAbort(
              withTimeout(
                session.connection.unstable_setSessionModel({
                  sessionId: session.sessionId,
                  modelId
                }),
                5_000,
                `Timed out while switching the Gemini ACP session model to ${modelId}`
              ),
              context.abortSignal,
              async () => {
                await invalidateSession(session);
              },
              [
                "Gemini ACP model switching was aborted",
                `capability=${capability}`,
                `workflowStage=${context.workflowStage}`,
                `model=${modelId}`
              ].join(" · ")
            );
            session.currentModelId = modelId;
          }

          const agentMessageChunks: string[] = [];
          activeRuntime = {
            agentMessageChunks,
            workspaceRoot,
            requestPermissionHandler: async (permissionRequest) => {
              const optionsForUi: OrchestratorApprovalOption[] = (permissionRequest.options ?? [])
                .map((option) => ({
                  optionId: option.optionId?.trim() ?? "",
                  kind: option.kind?.trim(),
                  label: describePermissionOption(option.kind?.trim())
                }))
                .filter((option) => option.optionId.length > 0);
              const allowOption = optionsForUi.find((option) => option.kind === "allow_once")
                ?? optionsForUi.find((option) => option.kind?.startsWith("allow"))
                ?? optionsForUi[0];

              if (!context.requestUserApproval) {
                return allowOption
                  ? {
                      outcome: "selected",
                      optionId: allowOption.optionId
                    }
                  : {
                      outcome: "cancelled"
                    };
              }

              return context.requestUserApproval({
                abortSignal: context.abortSignal,
                title: permissionRequest.toolCall?.title?.trim() || undefined,
                message: buildPermissionRequestMessage(capability, modelId),
                details: buildPermissionRequestDetails(permissionRequest.toolCall),
                kind: permissionRequest.toolCall?.kind?.trim() || undefined,
                locations: extractPermissionRequestLocations(permissionRequest.toolCall),
                options: optionsForUi
              });
            }
          };

          try {
            const promptResult = await withAbort(
              session.connection.prompt({
                sessionId: session.sessionId,
                prompt: [
                  {
                    type: "text",
                    text: prompt
                  }
                ]
              }) as Promise<GeminiPromptResponse>,
              context.abortSignal,
              async () => {
                await invalidateSession(session);
              },
              [
                "Gemini ACP prompt was aborted",
                `capability=${capability}`,
                `workflowStage=${context.workflowStage}`,
                `model=${modelId}`
              ].join(" · ")
            );

            const stdout = agentMessageChunks.join("");
            if (stdout.trim().length === 0) {
              throw new Error(
                `Gemini ACP prompt completed with stopReason=${promptResult.stopReason ?? "unknown"} without any text output`
              );
            }

            return {
              stdout,
              stderr: session.stderrBuffer().slice(stderrStartIndex),
              command
            };
          } finally {
            activeRuntime = null;
          }
        } catch (error) {
          lastError = error;
          await invalidateSession();
          const message = formatGeminiAcpError(error);
          const shouldRetry = !context.abortSignal.aborted
            && attemptIndex < attemptModels.length - 1
            && isRetryableGeminiInvalidStreamMessage(message);

          if (!shouldRetry) {
            break;
          }

          retryNotes.push(`attempt ${attemptIndex + 1} failed for model=${modelId}: ${message}`);
        }
      }

      if (lastError instanceof Error && retryNotes.length > 0) {
        throw new Error(
          [
            lastError.message,
            "retry attempts:",
            ...retryNotes
          ].join("\n\n")
        );
      }

      throw lastError instanceof Error ? lastError : new Error(formatGeminiAcpError(lastError));
    });

    invocationQueue = runInvocation.then(() => undefined, () => undefined);
    return runInvocation;
  };

  async function ensureSession(abortSignal: AbortSignal): Promise<GeminiLiveSession> {
    if (activeSession && activeSession.child.exitCode === null && activeSession.child.signalCode === null) {
      return activeSession;
    }

    const acpModule = await loadAcpModule(options.acpModulePath);
    const child = spawnProcess(options.executablePath, [...options.executableArgs, "--acp"], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stderrBuffer = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 8_000) {
        stderrBuffer = stderrBuffer.slice(-8_000);
      }
    });

    try {
      if (!child.stdin || !child.stdout) {
        throw new Error("gemini --acp did not expose stdio handles");
      }

      const client = new TasksawGeminiAcpClient(() => activeRuntime);
      const stream = acpModule.ndJsonStream(
        Writable.toWeb(child.stdin as Writable) as unknown as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout as Readable) as unknown as ReadableStream<Uint8Array>
      );
      const connection = new acpModule.ClientSideConnection(() => client, stream);
      const onAbort = async () => {
        await stopChildProcess(child);
      };

      await withAbort(
        withTimeout(
          connection.initialize({
            protocolVersion: acpModule.PROTOCOL_VERSION,
            clientCapabilities: {
              fs: {
                readTextFile: true,
                writeTextFile: true
              }
            }
          }),
          10_000,
          "Timed out while initializing Gemini ACP"
        ),
        abortSignal,
        onAbort,
        "Gemini ACP initialization was aborted"
      );

      const session = await withAbort(
        withTimeout<GeminiNewSessionResponse>(
          connection.newSession({
            cwd: workspaceRoot,
            mcpServers: []
          }) as Promise<GeminiNewSessionResponse>,
          15_000,
          "Timed out while creating a Gemini ACP session"
        ),
        abortSignal,
        onAbort,
        "Gemini ACP session creation was aborted"
      );

      const sessionId = session.sessionId?.trim();
      if (!sessionId) {
        throw new Error("Gemini ACP did not return a session id");
      }

      const availableModeIds = session.modes?.availableModes
        ?.map((mode) => mode.id?.trim())
        .filter((modeId): modeId is string => Boolean(modeId))
        ?? [];
      if (availableModeIds.includes(desiredModeId) && connection.setSessionMode) {
        await withAbort(
          withTimeout(
            connection.setSessionMode({
              sessionId,
              modeId: desiredModeId
            }),
            5_000,
            `Timed out while switching the Gemini ACP session to ${desiredModeId} mode`
          ),
          abortSignal,
          onAbort,
          `Gemini ACP mode switching to ${desiredModeId} was aborted`
        );
      }

      const nextSession: GeminiLiveSession = {
        child,
        connection: {
          setSessionMode: connection.setSessionMode?.bind(connection),
          unstable_setSessionModel: connection.unstable_setSessionModel?.bind(connection),
          prompt: (params) => connection.prompt(params) as Promise<GeminiPromptResponse>
        },
        sessionId,
        currentModelId: null,
        stderrBuffer: () => stderrBuffer
      };
      activeSession = nextSession;

      return nextSession;
    } catch (error) {
      await stopChildProcess(child);
      const message = formatGeminiAcpError(error);
      const stderrPreview = stderrBuffer.trim();
      throw new Error(
        [
          `Gemini ACP invocation failed: ${message}`,
          `command:\n${command.join(" ")}`,
          stderrPreview.length > 0 ? `stderr preview:\n${stderrPreview.slice(-4_000)}` : null
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    }
  }

  async function invalidateSession(targetSession?: GeminiLiveSession | null): Promise<void> {
    const session = targetSession ?? activeSession;
    if (!session) {
      return;
    }

    if (activeSession === session) {
      activeSession = null;
    }

    activeRuntime = null;
    await stopChildProcess(session.child);
  }
}

function describePermissionOption(kind: string | undefined): string | undefined {
  if (!kind) {
    return undefined;
  }

  if (kind === "allow_once") {
    return "Allow once";
  }
  if (kind === "allow_for_session") {
    return "Allow for session";
  }
  if (kind === "reject_once") {
    return "Reject";
  }

  return kind
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildPermissionRequestMessage(capability: OrchestratorCapability, modelId: string): string {
  return `User approval is required before Gemini can continue ${capability} with ${modelId}.`;
}

function buildPermissionRequestDetails(toolCall: {
  title?: string;
  kind?: string;
  locations?: Array<{ path?: string; uri?: string; label?: string }>;
  content?: Array<
    | {
      type?: string;
      path?: string;
      oldText?: string;
      newText?: string;
    }
    | {
      type?: string;
      content?: {
        type?: string;
        text?: string;
      };
    }
  >;
} | undefined): string | undefined {
  if (!toolCall) {
    return undefined;
  }

  const lines: string[] = [];
  if (toolCall.title?.trim()) {
    lines.push(toolCall.title.trim());
  }
  if (toolCall.kind?.trim()) {
    lines.push(`kind: ${toolCall.kind.trim()}`);
  }

  const locations = extractPermissionRequestLocations(toolCall);
  if (locations.length > 0) {
    lines.push(`locations: ${locations.join(", ")}`);
  }

  for (const entry of toolCall.content ?? []) {
    if (entry.type === "diff") {
      const pathLabel = "path" in entry && typeof entry.path === "string" ? entry.path : "unknown file";
      const oldText = "oldText" in entry && typeof entry.oldText === "string" ? entry.oldText : "";
      const newText = "newText" in entry && typeof entry.newText === "string" ? entry.newText : "";
      lines.push(`diff: ${pathLabel}`);
      if (oldText.trim().length > 0) {
        lines.push(`--- before ---\n${oldText.trim().slice(0, 600)}`);
      }
      if (newText.trim().length > 0) {
        lines.push(`+++ after +++\n${newText.trim().slice(0, 600)}`);
      }
      continue;
    }

    const text = "content" in entry && entry.content?.type === "text" && typeof entry.content.text === "string"
      ? entry.content.text.trim()
      : "";
    if (text.length > 0) {
      lines.push(text.slice(0, 600));
    }
  }

  return lines.length > 0 ? lines.join("\n\n") : undefined;
}

function extractPermissionRequestLocations(toolCall: {
  locations?: Array<{ path?: string; uri?: string; label?: string }>;
} | undefined): string[] {
  return (toolCall?.locations ?? [])
    .map((location) => location.path ?? location.label ?? location.uri ?? "")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function buildGeminiAttemptModels(
  primaryModelId: string,
  fallbackModelIds: string[],
  invalidStreamRetryCount: number
): string[] {
  const attempts = [primaryModelId];

  for (let retryIndex = 0; retryIndex < invalidStreamRetryCount; retryIndex += 1) {
    attempts.push(primaryModelId);
  }

  for (const fallbackModelId of fallbackModelIds) {
    if (!fallbackModelId || attempts.includes(fallbackModelId)) {
      continue;
    }

    attempts.push(fallbackModelId);
  }

  return attempts;
}

function isRetryableGeminiInvalidStreamMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("model stream ended without a finish reason")
    || normalized.includes("model stream ended with empty response text")
    || normalized.includes("without any text output");
}

function formatGeminiAcpError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const candidateMessage = extractNestedErrorMessage(error);
    if (candidateMessage) {
      return candidateMessage;
    }

    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }

  return String(error);
}

function extractNestedErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const directMessage = typeof record.message === "string" ? record.message.trim() : "";
  if (directMessage.length > 0) {
    return directMessage;
  }

  const errorField = record.error;
  if (errorField && typeof errorField === "object") {
    const nestedMessage = extractNestedErrorMessage(errorField);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  const dataField = record.data;
  if (dataField && typeof dataField === "object") {
    const nestedMessage = extractNestedErrorMessage(dataField);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return null;
}

async function defaultLoadAcpModule(modulePath: string): Promise<GeminiAcpModule> {
  return dynamicImport(pathToFileURL(modulePath).href) as Promise<GeminiAcpModule>;
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
  return spawn(command, args, options) as unknown as SpawnedProcess;
}

async function stopChildProcess(child: SpawnedProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  try {
    await waitForExit(child, 1_000);
  } catch {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 1_000).catch(() => undefined);
    }
  }
}

function waitForExit(child: SpawnedProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while waiting for the Gemini ACP process to exit"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const onError = (error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const onExit = () => {
      cleanup();
      resolve();
    };

    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onAbort: () => Promise<void> | void,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      Promise.resolve(onAbort())
        .catch(() => undefined)
        .finally(() => reject(new Error(message)));
      return;
    }

    const abortHandler = () => {
      cleanup();
      Promise.resolve(onAbort())
        .catch(() => undefined)
        .finally(() => reject(new Error(message)));
    };

    const cleanup = () => {
      signal.removeEventListener("abort", abortHandler);
    };

    signal.addEventListener("abort", abortHandler, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}
