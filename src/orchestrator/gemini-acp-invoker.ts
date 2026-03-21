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
  promptInactivityTimeoutMs?: number;
  modeId?: string;
  modeByCapability?: Partial<Record<OrchestratorCapability, string>>;
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
  capability: OrchestratorCapability;
  agentMessageChunks: string[];
  workspaceRoot: string;
  reportTerminalChunk?: (stream: "system" | "stdout" | "stderr", text: string) => void;
  touchActivity: () => void;
  pauseActivity: () => void;
  resumeActivity: () => void;
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
  availableModeIds: string[];
  currentModeId: string | null;
  currentModelId: string | null;
  stderrBuffer: () => string;
};

type ReadOnlyProbeGuardState = {
  attemptedCommandFingerprints: Set<string>;
  hypothesisCounts: Map<string, number>;
};

const DEFAULT_GEMINI_MODE_BY_CAPABILITY: Partial<Record<OrchestratorCapability, string>> = {
  execute: "default"
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
      runtime.touchActivity();
      runtime.agentMessageChunks.push(update.content.text);
      runtime.reportTerminalChunk?.("stdout", update.content.text);
    }

    return undefined;
  }

  async writeTextFile(params: { path?: string; content?: string }) {
    const runtime = this.runtimeProvider();
    if (!runtime) {
      throw new Error("Gemini ACP file write was requested without an active prompt runtime");
    }
    if (runtime.capability !== "execute") {
      throw new Error(`Gemini ACP file writes are only allowed during execute; current capability=${runtime.capability}`);
    }

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
  const configuredModeId = options.modeId?.trim();
  const configuredModeByCapability = Object.fromEntries(
    Object.entries(options.modeByCapability ?? {})
      .map(([capability, modeId]) => [capability, modeId?.trim() ?? ""])
      .filter(([, modeId]) => modeId.length > 0)
  ) as Partial<Record<OrchestratorCapability, string>>;
  const startupTimeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
    ? Math.max(1_000, Math.trunc(options.timeoutMs))
    : null;
  const promptInactivityTimeoutMs = typeof options.promptInactivityTimeoutMs === "number" && Number.isFinite(options.promptInactivityTimeoutMs)
    ? Math.max(1_000, Math.trunc(options.promptInactivityTimeoutMs))
    : null;
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
      const readOnlyProbeGuardState: ReadOnlyProbeGuardState = {
        attemptedCommandFingerprints: new Set(),
        hypothesisCounts: new Map()
      };
      const retryNotes: string[] = [];
      let lastError: unknown;

      for (let attemptIndex = 0; attemptIndex < attemptModels.length; attemptIndex += 1) {
        const modelId = attemptModels[attemptIndex]!;
        const desiredModeId = resolveDesiredModeId(capability);

        try {
          context.reportTerminalEvent?.({
            stream: "system",
            text: `$ ${formatTerminalCommand(command)}\n`
          });
          const session = await ensureSession(context.abortSignal);
          await ensureSessionMode(session, desiredModeId, context.abortSignal, capability, context.workflowStage);
          const stderrStartIndex = session.stderrBuffer().length;

          if (!session.connection.unstable_setSessionModel) {
            throw new Error("The installed Gemini ACP client does not support session model switching");
          }

          if (session.currentModelId !== modelId) {
            await withAbort(
              withOptionalTimeout(
                session.connection.unstable_setSessionModel({
                  sessionId: session.sessionId,
                  modelId
                }),
                startupTimeoutMs,
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
          const promptActivity = createInactivityController(
            promptInactivityTimeoutMs,
            `Timed out while waiting for Gemini ACP prompt activity for ${capability} with ${modelId}`
          );
          const runtime: GeminiPromptRuntime = {
            capability,
            agentMessageChunks,
            workspaceRoot,
            reportTerminalChunk: (stream, text) => {
              context.reportTerminalEvent?.({
                stream,
                text
              });
            },
            touchActivity: () => promptActivity.touch(),
            pauseActivity: () => promptActivity.pause(),
            resumeActivity: () => promptActivity.resume(),
            requestPermissionHandler: async (permissionRequest) => {
              const toolCallSummary = summarizePermissionToolCall(permissionRequest.toolCall);
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
              promptActivity.touch();

              const disallowedReason = getDisallowedToolCallReasonForCapability(capability, permissionRequest.toolCall);
              if (disallowedReason) {
                const decision: OrchestratorApprovalDecision = {
                  outcome: "cancelled"
                };
                context.reportProgress?.(
                  disallowedReason,
                  {
                    capability,
                    model: modelId,
                    toolCall: toolCallSummary ?? null
                  }
                );
                promptActivity.touch();
                return decision;
              }

              const bootstrapSketchReason = getBootstrapSketchExecuteRejectionReason({
                capability,
                workflowStage: context.workflowStage,
                toolCall: permissionRequest.toolCall,
                workspaceRoot
              });
              if (bootstrapSketchReason) {
                const decision: OrchestratorApprovalDecision = {
                  outcome: "cancelled"
                };
                context.reportProgress?.(
                  bootstrapSketchReason,
                  {
                    capability,
                    model: modelId,
                    toolCall: toolCallSummary ?? null
                  }
                );
                promptActivity.touch();
                return decision;
              }

              const repeatedProbeReason = getReadOnlyProbeGuardRejectionReason({
                capability,
                workflowStage: context.workflowStage,
                toolCall: permissionRequest.toolCall,
                workspaceRoot,
                state: readOnlyProbeGuardState
              });
              if (repeatedProbeReason) {
                const decision: OrchestratorApprovalDecision = {
                  outcome: "cancelled"
                };
                context.reportProgress?.(
                  repeatedProbeReason,
                  {
                    capability,
                    model: modelId,
                    toolCall: toolCallSummary ?? null
                  }
                );
                promptActivity.touch();
                return decision;
              }

              const interactiveSessionCommand = getInteractiveSessionHandoffCommand(permissionRequest.toolCall);
              if (interactiveSessionCommand && context.requestInteractiveSession) {
                context.reportProgress?.(
                  "Opening modal interactive session for CLI tool call",
                  {
                    capability,
                    model: modelId,
                    toolCall: toolCallSummary ?? null
                  }
                );
                promptActivity.pause();
                try {
                  const response = await context.requestInteractiveSession({
                    abortSignal: context.abortSignal,
                    title: permissionRequest.toolCall?.title?.trim() || undefined,
                    message: buildInteractiveSessionRequestMessage(context.outputLanguage),
                    commandText: interactiveSessionCommand,
                    cwd: workspaceRoot
                  });
                  context.reportProgress?.(
                    response.outcome === "completed"
                      ? "Interactive CLI session completed; original Gemini tool call was cancelled to avoid hanging the ACP run"
                      : response.outcome === "terminated"
                        ? "Interactive CLI session was terminated; original Gemini tool call was cancelled"
                        : "Interactive CLI session was cancelled; original Gemini tool call was cancelled",
                    {
                      capability,
                      model: modelId,
                      toolCall: toolCallSummary ?? null,
                      sessionId: response.sessionId ?? null,
                      exitCode: response.exitCode ?? null,
                      signal: response.signal ?? null
                    }
                  );
                  return {
                    outcome: "cancelled"
                  };
                } finally {
                  promptActivity.resume();
                  promptActivity.touch();
                }
              }

              if (!context.requestUserApproval) {
                const decision: OrchestratorApprovalDecision = allowOption
                  ? {
                      outcome: "selected",
                      optionId: allowOption.optionId
                    }
                  : {
                      outcome: "cancelled"
                    };
                context.reportProgress?.(
                  decision.outcome === "selected"
                    ? "Gemini tool call auto-approved and resumed"
                    : "Gemini tool call auto-rejected",
                  {
                    capability,
                    model: modelId,
                    toolCall: toolCallSummary ?? null
                  }
                );
                promptActivity.touch();
                return decision;
              }

              promptActivity.pause();
              try {
                const decision = await context.requestUserApproval({
                  abortSignal: context.abortSignal,
                  title: permissionRequest.toolCall?.title?.trim() || undefined,
                  message: buildPermissionRequestMessage(capability, modelId),
                  details: buildPermissionRequestDetails(permissionRequest.toolCall),
                  kind: permissionRequest.toolCall?.kind?.trim() || undefined,
                  locations: extractPermissionRequestLocations(permissionRequest.toolCall),
                  options: optionsForUi
                });
                context.reportProgress?.(
                  decision.outcome === "selected"
                    ? "Gemini tool call approved and waiting for result"
                    : "Gemini tool call rejected",
                  {
                    capability,
                    model: modelId,
                    toolCall: toolCallSummary ?? null,
                    optionId: decision.optionId ?? null
                  }
                );
                return decision;
              } finally {
                promptActivity.resume();
                promptActivity.touch();
              }
            }
          };
          activeRuntime = runtime;

          try {
            context.reportProgress?.("Waiting for Gemini ACP prompt completion", {
              capability,
              model: modelId
            });
            const promptResult = await withAbort(
              promptActivity.wrap(
                session.connection.prompt({
                  sessionId: session.sessionId,
                  prompt: [
                    {
                      type: "text",
                      text: prompt
                    }
                  ]
                }) as Promise<GeminiPromptResponse>
              ),
              context.abortSignal,
              async () => {
                promptActivity.stop();
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
            promptActivity.stop();
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

  function resolveDesiredModeId(capability: OrchestratorCapability): string | undefined {
    return configuredModeByCapability[capability]
      ?? configuredModeId
      ?? DEFAULT_GEMINI_MODE_BY_CAPABILITY[capability];
  }

  async function ensureSessionMode(
    session: GeminiLiveSession,
    desiredModeId: string | undefined,
    abortSignal: AbortSignal,
    capability: OrchestratorCapability,
    workflowStage: ModelInvocationContext["workflowStage"]
  ): Promise<void> {
    if (!desiredModeId || session.currentModeId === desiredModeId || !session.connection.setSessionMode) {
      return;
    }
    if (!session.availableModeIds.includes(desiredModeId)) {
      return;
    }

    await withAbort(
      withOptionalTimeout(
        session.connection.setSessionMode({
          sessionId: session.sessionId,
          modeId: desiredModeId
        }),
        startupTimeoutMs,
        `Timed out while switching the Gemini ACP session to ${desiredModeId} mode`
      ),
      abortSignal,
      async () => {
        await invalidateSession(session);
      },
      [
        `Gemini ACP mode switching to ${desiredModeId} was aborted`,
        `capability=${capability}`,
        `workflowStage=${workflowStage}`
      ].join(" · ")
    );
    session.currentModeId = desiredModeId;
  }

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
      const text = chunk.toString();
      stderrBuffer += text;
      if (stderrBuffer.length > 8_000) {
        stderrBuffer = stderrBuffer.slice(-8_000);
      }
      activeRuntime?.reportTerminalChunk?.("stderr", text);
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
        withOptionalTimeout(
          connection.initialize({
            protocolVersion: acpModule.PROTOCOL_VERSION,
            clientCapabilities: {
              fs: {
                readTextFile: true,
                writeTextFile: true
              }
            }
          }),
          startupTimeoutMs,
          "Timed out while initializing Gemini ACP"
        ),
        abortSignal,
        onAbort,
        "Gemini ACP initialization was aborted"
      );

      const session = await withAbort(
        withOptionalTimeout<GeminiNewSessionResponse>(
          connection.newSession({
            cwd: workspaceRoot,
            mcpServers: []
          }) as Promise<GeminiNewSessionResponse>,
          startupTimeoutMs,
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

      const nextSession: GeminiLiveSession = {
        child,
        connection: {
          setSessionMode: connection.setSessionMode?.bind(connection),
          unstable_setSessionModel: connection.unstable_setSessionModel?.bind(connection),
          prompt: (params) => connection.prompt(params) as Promise<GeminiPromptResponse>
        },
        sessionId,
        availableModeIds,
        currentModeId: null,
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

function formatTerminalCommand(command: string[]): string {
  return command
    .map((part) => (/^[a-zA-Z0-9._/:=@-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
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

function summarizePermissionToolCall(toolCall: {
  title?: string;
  kind?: string;
  locations?: Array<{ path?: string; uri?: string; label?: string }>;
} | undefined): string | undefined {
  if (!toolCall) {
    return undefined;
  }

  const title = toolCall.title?.trim();
  if (title) {
    return title;
  }

  const kind = toolCall.kind?.trim();
  if (kind) {
    return kind;
  }

  return extractPermissionRequestLocations(toolCall)[0];
}

function extractPermissionRequestLocations(toolCall: {
  locations?: Array<{ path?: string; uri?: string; label?: string }>;
} | undefined): string[] {
  return (toolCall?.locations ?? [])
    .map((location) => location.path ?? location.label ?? location.uri ?? "")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function isReadOnlyGeminiCapability(capability: OrchestratorCapability): boolean {
  return capability !== "execute";
}

function disallowsExecuteToolCallsInCapability(capability: OrchestratorCapability): boolean {
  return capability === "abstractPlan" || capability === "concretePlan" || capability === "review";
}

function getDisallowedToolCallReasonForCapability(
  capability: OrchestratorCapability,
  toolCall: {
    title?: string;
    kind?: string;
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
  } | undefined
): string | null {
  const kind = toolCall?.kind?.trim();
  if (kind === "other") {
    return "Rejected Gemini tool call because generic approval requests are not supported";
  }
  if (kind === "edit") {
    return capability !== "execute" ? "Rejected Gemini tool call because this phase is read-only" : null;
  }
  if (kind !== "execute") {
    return null;
  }
  if (disallowsExecuteToolCallsInCapability(capability)) {
    return "Rejected Gemini tool call because this phase is read-only";
  }
  if (!isReadOnlyGeminiCapability(capability)) {
    return null;
  }

  return isDisallowedReadOnlyExecuteToolCall(toolCall)
    ? "Rejected Gemini tool call because this phase is read-only"
    : null;
}

function isDisallowedReadOnlyExecuteToolCall(toolCall: {
  title?: string;
  kind?: string;
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
} | undefined): boolean {
  const lowerText = [
    toolCall?.title ?? "",
    ...(toolCall?.content ?? []).map((entry) => {
      if ("content" in entry && entry.content?.type === "text" && typeof entry.content.text === "string") {
        return entry.content.text;
      }
      return "";
    })
  ]
    .join("\n")
    .toLowerCase();

  return READ_ONLY_MUTATION_COMMAND_PATTERNS.some((pattern) => pattern.test(lowerText));
}

const READ_ONLY_MUTATION_COMMAND_PATTERNS = [
  /\bnpm\s+(?:run\s+)?build\b/,
  /\bpnpm\s+build\b/,
  /\byarn\s+build\b/,
  /\bbun\s+run\s+build\b/,
  /\bnext\s+build\b/,
  /\bvite\s+build\b/,
  /\bwebpack\b/,
  /\btsc\b/,
  /\bcargo\s+build\b/,
  /\bgradle(?:\s|$)/,
  /\bmvn(?:\s|$)/,
  /\bmake(?:\s|$)/,
  /\bcmake(?:\s|$)/,
  /\bnpm\s+(?:run\s+)?test\b/,
  /\bpnpm\s+test\b/,
  /\byarn\s+test\b/,
  /\brm\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bgit\s+(?:add|apply|am|checkout|clean|commit|merge|mv|rebase|reset|restore|revert|rm)\b/,
  /\bsed\s+-i\b/,
  /\bperl\s+-i\b/,
  /<<[-~]?\s*['"]?[a-z0-9_]+['"]?/,
  /(^|[\s;&|])>>?\s*[^=\s][^\s]*/
] as const;

const READ_ONLY_HYPOTHESIS_CUTOFF_BY_STAGE: Partial<Record<ModelInvocationContext["workflowStage"], number>> = {
  bootstrap_sketch: 3,
  project_structure_discovery: 4,
  project_structure_inspection: 4,
  task_orchestration: 4
};

const BOOTSTRAP_SKETCH_ALLOWED_READ_ONLY_COMMANDS = new Set([
  "ls",
  "find",
  "rg",
  "grep",
  "sed",
  "cat",
  "head",
  "tail",
  "file",
  "pwd"
]);

const COMMAND_FAMILY_SKIP_SET = new Set([
  "cat",
  "ls",
  "find",
  "grep",
  "rg",
  "sed",
  "head",
  "tail",
  "file",
  "which",
  "stat"
]);

const EXTERNAL_TOOL_SURFACE_COMMANDS = new Set([
  "gemini",
  "codex"
]);

const SHELL_WRAPPER_COMMANDS = new Set([
  "env",
  "command",
  "timeout",
  "nohup",
  "sh",
  "bash",
  "zsh",
  "/bin/sh",
  "/bin/bash",
  "/bin/zsh"
]);

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

function getReadOnlyProbeGuardRejectionReason(params: {
  capability: OrchestratorCapability;
  workflowStage: ModelInvocationContext["workflowStage"];
  toolCall: {
    title?: string;
    kind?: string;
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
  } | undefined;
  workspaceRoot: string;
  state: ReadOnlyProbeGuardState;
}): string | null {
  const kind = params.toolCall?.kind?.trim();
  if (kind !== "execute" || !isReadOnlyGeminiCapability(params.capability) || disallowsExecuteToolCallsInCapability(params.capability)) {
    return null;
  }

  const commandFingerprint = buildExecuteToolCallFingerprint(params.toolCall);
  if (commandFingerprint && params.state.attemptedCommandFingerprints.has(commandFingerprint)) {
    return "Rejected Gemini tool call because this command was already attempted in this phase";
  }

  const hypothesisKeys = buildReadOnlyHypothesisKeys(params.toolCall?.title ?? "", params.workspaceRoot);
  const cutoff = READ_ONLY_HYPOTHESIS_CUTOFF_BY_STAGE[params.workflowStage] ?? 6;
  for (const key of hypothesisKeys) {
    const count = params.state.hypothesisCounts.get(key) ?? 0;
    if (count >= cutoff) {
      return "Rejected Gemini tool call because repeated probing hit the cutoff for this investigation thread";
    }
  }

  if (commandFingerprint) {
    params.state.attemptedCommandFingerprints.add(commandFingerprint);
  }
  for (const key of hypothesisKeys) {
    params.state.hypothesisCounts.set(key, (params.state.hypothesisCounts.get(key) ?? 0) + 1);
  }

  return null;
}

function getBootstrapSketchExecuteRejectionReason(params: {
  capability: OrchestratorCapability;
  workflowStage: ModelInvocationContext["workflowStage"];
  toolCall: {
    title?: string;
    kind?: string;
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
  } | undefined;
  workspaceRoot: string;
}): string | null {
  const kind = params.toolCall?.kind?.trim();
  if (params.workflowStage !== "bootstrap_sketch" || kind !== "execute" || !isReadOnlyGeminiCapability(params.capability)) {
    return null;
  }

  const commandText = buildExecuteToolCallFingerprint(params.toolCall);
  if (!commandText) {
    return null;
  }

  if (tokenizeCommandText(commandText).some((token) => isShellOperatorToken(token))) {
    return "Rejected Gemini tool call because bootstrap sketch must stay shallow; defer multi-step CLI probing to later stages";
  }

  const commandName = extractPrimaryCommandName(commandText);
  if (!commandName || !BOOTSTRAP_SKETCH_ALLOWED_READ_ONLY_COMMANDS.has(commandName)) {
    return "Rejected Gemini tool call because bootstrap sketch must stay workspace-local and low-cost";
  }

  if (extractExternalResourceKeys(commandText, params.workspaceRoot).length > 0) {
    return "Rejected Gemini tool call because bootstrap sketch must stay workspace-local and low-cost";
  }

  return null;
}

function buildExecuteToolCallFingerprint(toolCall: {
  title?: string;
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
} | undefined): string | null {
  const textParts = [
    toolCall?.title ?? "",
    ...(toolCall?.content ?? []).map((entry) =>
      "content" in entry && entry.content?.type === "text" && typeof entry.content.text === "string"
        ? entry.content.text
        : ""
    )
  ];
  const normalized = normalizeShellLikeText(textParts.join("\n"));
  return normalized.length > 0 ? normalized : null;
}

function buildReadOnlyHypothesisKeys(commandText: string, workspaceRoot: string): string[] {
  const keys = new Set<string>();
  const toolSurfaceKey = buildExternalToolSurfaceKey(commandText, workspaceRoot);
  if (toolSurfaceKey) {
    keys.add(toolSurfaceKey);
  }
  const commandFamilyKey = buildCommandFamilyKey(commandText);
  if (commandFamilyKey) {
    keys.add(commandFamilyKey);
  }
  for (const key of extractExternalResourceKeys(commandText, workspaceRoot)) {
    keys.add(key);
  }
  return [...keys];
}

function buildExternalToolSurfaceKey(commandText: string, workspaceRoot: string): string | null {
  const tokens = tokenizeCommandText(commandText)
    .map((token) => stripOuterQuotes(token).trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const commandIndex = findPrimaryCommandIndex(tokens);
  const commandToken = tokens[commandIndex];
  if (!commandToken) {
    return null;
  }

  const commandName = path.basename(commandToken).toLowerCase();
  if (EXTERNAL_TOOL_SURFACE_COMMANDS.has(commandName)) {
    return `surface:${commandName}`;
  }

  const normalizedCommandToken = commandToken.replace(/\\/g, "/");
  if (!normalizedCommandToken.includes("/managed-tools/")) {
    return null;
  }

  if (!looksLikePathToken(normalizedCommandToken) || isWorkspaceRelativePath(normalizedCommandToken, path.resolve(workspaceRoot))) {
    return null;
  }

  return `surface:${commandName}`;
}

function buildCommandFamilyKey(commandText: string): string | null {
  const commandName = extractPrimaryCommandName(commandText);
  if (!commandName) {
    return null;
  }
  if (COMMAND_FAMILY_SKIP_SET.has(commandName)) {
    return null;
  }

  const tokens = tokenizeCommandText(commandText)
    .map((token) => stripOuterQuotes(token).trim())
    .filter(Boolean);
  const commandIndex = findPrimaryCommandIndex(tokens);
  const argumentTerms: string[] = [];
  for (const token of tokens.slice(commandIndex + 1)) {
    if (token.startsWith("-") || isShellOperatorToken(token) || isEnvironmentAssignmentToken(token)) {
      continue;
    }

    const normalizedToken = normalizeHypothesisToken(token);
    if (!normalizedToken) {
      continue;
    }

    for (const part of normalizedToken.split(/\s+/).filter((entry) => entry.length > 0)) {
      if (part.length < 3 || COMMON_HYPOTHESIS_STOP_WORDS.has(part)) {
        continue;
      }
      argumentTerms.push(part);
      if (argumentTerms.length >= 2) {
        break;
      }
    }

    if (argumentTerms.length >= 2) {
      break;
    }
  }

  return normalizeShellLikeText([commandName, ...argumentTerms].join(" "));
}

function getInteractiveSessionHandoffCommand(toolCall: {
  title?: string;
  kind?: string;
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
} | undefined): string | null {
  if (toolCall?.kind?.trim() !== "execute") {
    return null;
  }

  const commandText = buildExecuteToolCallFingerprint(toolCall);
  if (!commandText) {
    return null;
  }

  return looksLikeInteractiveCliCommand(commandText) ? commandText : null;
}

function looksLikeInteractiveCliCommand(commandText: string): boolean {
  const normalizedCommandText = normalizeShellLikeText(commandText).toLowerCase();
  const commandName = extractPrimaryCommandName(normalizedCommandText);
  if (!commandName) {
    return false;
  }

  if (!EXTERNAL_TOOL_SURFACE_COMMANDS.has(path.basename(commandName).toLowerCase())) {
    return false;
  }

  if (/(?:^|\s)\/[a-z][\w-]*/i.test(normalizedCommandText)) {
    return true;
  }

  if (/\b(?:-p|--prompt)\b/i.test(normalizedCommandText)) {
    return true;
  }

  if (
    tokenizeCommandText(normalizedCommandText).some((token) => isShellOperatorToken(token))
    && /\b(?:-p|--prompt)\b|(?:^|\s)\/[a-z][\w-]*/i.test(normalizedCommandText)
  ) {
    return true;
  }

  return /\b(?:login|auth)\b(?!\s+(?:status|--help|-h)\b)/i.test(normalizedCommandText);
}

function buildInteractiveSessionRequestMessage(outputLanguage: ModelInvocationContext["outputLanguage"]): string {
  return outputLanguage === "ko"
    ? "이 CLI 명령은 대화형 입력을 요구할 수 있습니다. TaskSaw가 모달 세션을 열었으니 입력을 완료하거나 세션을 종료하면 오케스트레이터가 이어집니다."
    : "This CLI command may require interactive input. TaskSaw opened a modal session; complete the interaction or terminate the session to resume orchestration.";
}

function extractPrimaryCommandName(commandText: string): string | null {
  const tokens = tokenizeCommandText(commandText)
    .map((token) => stripOuterQuotes(token).trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const commandIndex = findPrimaryCommandIndex(tokens);
  const commandToken = tokens[commandIndex];
  if (!commandToken) {
    return null;
  }

  return path.basename(commandToken).toLowerCase();
}

function findPrimaryCommandIndex(tokens: string[]): number {
  let commandIndex = 0;
  while (commandIndex < tokens.length) {
    const token = tokens[commandIndex]!;
    if (isShellOperatorToken(token) || isEnvironmentAssignmentToken(token) || token.startsWith("-")) {
      commandIndex += 1;
      continue;
    }
    if (SHELL_WRAPPER_COMMANDS.has(token.toLowerCase()) && commandIndex < tokens.length - 1) {
      commandIndex += 1;
      continue;
    }
    break;
  }
  return commandIndex;
}

function extractExternalResourceKeys(commandText: string, workspaceRoot: string): string[] {
  const workspaceRootPath = path.resolve(workspaceRoot);
  const keys = new Set<string>();

  for (const rawToken of tokenizeCommandText(commandText)) {
    const token = stripOuterQuotes(rawToken).trim();
    if (!token || isShellOperatorToken(token) || token.startsWith("-")) {
      continue;
    }

    const normalizedToken = token.replace(/\\/g, "/");
    const packageName = extractNodeModulePackageName(normalizedToken);
    if (packageName) {
      keys.add(`package:${packageName}`);
      continue;
    }

    const homeDotdir = extractHomeDotdirKey(normalizedToken);
    if (homeDotdir) {
      keys.add(homeDotdir);
      continue;
    }

    if (!looksLikePathToken(normalizedToken)) {
      continue;
    }

    if (isWorkspaceRelativePath(normalizedToken, workspaceRootPath)) {
      continue;
    }

    const externalPathKey = buildExternalPathKey(normalizedToken);
    if (externalPathKey) {
      keys.add(externalPathKey);
    }
  }

  return [...keys];
}

function tokenizeCommandText(commandText: string): string[] {
  return [...commandText.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? "")
    .filter((token) => token.length > 0);
}

function stripOuterQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "\"" || first === "'" || first === "`") && first === last) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function isShellOperatorToken(value: string): boolean {
  return value === "|" || value === "||" || value === "&&" || value === ";" || value === ">" || value === ">>" || value === "<";
}

function isEnvironmentAssignmentToken(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(value);
}

function normalizeShellLikeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHypothesisToken(value: string): string {
  return value
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[@]/g, "")
    .replace(/[^a-z0-9/._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNodeModulePackageName(value: string): string | null {
  const normalized = value.replace(/\\/g, "/");
  const match = normalized.match(/\/node_modules\/((?:@[^/]+\/[^/]+)|(?:[^/]+))/);
  return match?.[1]?.trim() ?? null;
}

function extractHomeDotdirKey(value: string): string | null {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("~/.")) {
    const [dotdir] = normalized.slice(2).split("/").filter(Boolean);
    return dotdir ? `home:${dotdir}` : null;
  }

  const homeDirectory = process.env.HOME?.replace(/\\/g, "/");
  if (homeDirectory && normalized.startsWith(`${homeDirectory}/.`)) {
    const relative = normalized.slice(homeDirectory.length + 1);
    const [dotdir] = relative.split("/").filter(Boolean);
    return dotdir ? `home:${dotdir}` : null;
  }

  return null;
}

function looksLikePathToken(value: string): boolean {
  return value.startsWith("/")
    || value.startsWith("~/")
    || value.startsWith("./")
    || value.startsWith("../")
    || value.includes("/");
}

function isWorkspaceRelativePath(value: string, workspaceRoot: string): boolean {
  if (value.startsWith("~/")) {
    return false;
  }

  const candidatePath = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(workspaceRoot, value);
  return candidatePath === workspaceRoot || candidatePath.startsWith(`${workspaceRoot}${path.sep}`);
}

function buildExternalPathKey(value: string): string | null {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const trimmedSegments = normalized.endsWith("/") || !segments[segments.length - 1]?.includes(".")
    ? segments.slice(0, 3)
    : segments.slice(0, 3 + Math.max(0, segments.length - 4));
  const family = trimmedSegments.slice(0, 3).join("/");
  return family.length > 0 ? `external:${family}` : null;
}

const COMMON_HYPOTHESIS_STOP_WORDS = new Set([
  "json",
  "text",
  "with",
  "from",
  "that",
  "this",
  "help",
  "version",
  "status"
]);

type InactivityController = {
  wrap: <T>(promise: Promise<T>) => Promise<T>;
  touch: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

function createInactivityController(timeoutMs: number | null, message: string): InactivityController {
  if (!timeoutMs || timeoutMs <= 0) {
    return {
      wrap: <T>(promise: Promise<T>) => promise,
      touch: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      stop: () => undefined
    };
  }

  let timer: NodeJS.Timeout | null = null;
  let paused = false;
  let stopped = false;
  let rejectTimeout: ((error: Error) => void) | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = (error) => reject(error);
  });

  const schedule = () => {
    if (paused || stopped) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      stopped = true;
      rejectTimeout?.(new Error(message));
    }, timeoutMs);
  };

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    wrap: <T>(promise: Promise<T>) => {
      schedule();
      return Promise.race([
        promise.finally(() => {
          stopped = true;
          clear();
        }),
        timeoutPromise
      ]);
    },
    touch: () => {
      if (!paused && !stopped) {
        schedule();
      }
    },
    pause: () => {
      if (stopped) {
        return;
      }

      paused = true;
      clear();
    },
    resume: () => {
      if (stopped) {
        return;
      }

      paused = false;
      schedule();
    },
    stop: () => {
      stopped = true;
      clear();
    }
  };
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

function withOptionalTimeout<T>(promise: Promise<T>, timeoutMs: number | null, message: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  return withTimeout(promise, timeoutMs, message);
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
