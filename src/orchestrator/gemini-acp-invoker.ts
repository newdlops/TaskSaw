import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { ModelInvocationContext, OrchestratorCapability } from "./model-adapter";

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

class TasksawGeminiAcpClient {
  private readonly workspaceRoot: string;

  constructor(
    private readonly agentMessageChunks: string[],
    workspaceRoot: string
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  async requestPermission(params: {
    options?: Array<{
      optionId?: string;
      kind?: string;
    }>;
  }) {
    const allowOnceOption = params.options?.find((option) => option.kind === "allow_once")
      ?? params.options?.find((option) => option.kind?.startsWith("allow"))
      ?? params.options?.[0];

    if (!allowOnceOption?.optionId) {
      return {
        outcome: {
          outcome: "cancelled" as const
        }
      };
    }

    return {
      outcome: {
        outcome: "selected" as const,
        optionId: allowOnceOption.optionId
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
    if (
      update?.sessionUpdate === "agent_message_chunk"
      && update.content?.type === "text"
      && typeof update.content.text === "string"
    ) {
      this.agentMessageChunks.push(update.content.text);
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
    if (!requestedPath || requestedPath.trim().length === 0) {
      throw new Error("Gemini ACP file operation did not specify a path");
    }

    const candidatePath = path.isAbsolute(requestedPath)
      ? path.resolve(requestedPath)
      : path.resolve(this.workspaceRoot, requestedPath);
    const normalizedRoot = this.resolveExistingPath(this.workspaceRoot);
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
  const baseTimeoutMs = options.timeoutMs ?? 30_000;
  const command = [options.executablePath, ...options.executableArgs, "--acp"];

  return async (
    _capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext
  ): Promise<{ stdout: string; stderr: string; command: string[] }> => {
    const abortSignal = context.abortSignal;
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

      const agentMessageChunks: string[] = [];
      const client = new TasksawGeminiAcpClient(agentMessageChunks, options.cwd ?? process.cwd());
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
            cwd: options.cwd ?? process.cwd(),
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

      if (!connection.unstable_setSessionModel) {
        throw new Error("The installed Gemini ACP client does not support session model switching");
      }

      await withAbort(
        withTimeout(
          connection.unstable_setSessionModel({
            sessionId,
            modelId: context.assignedModel.model
          }),
          5_000,
          `Timed out while switching the Gemini ACP session model to ${context.assignedModel.model}`
        ),
        abortSignal,
        onAbort,
        `Gemini ACP model switching to ${context.assignedModel.model} was aborted`
      );

      const promptTimeoutMs = resolveGeminiPromptTimeoutMs(baseTimeoutMs, _capability, context);
      const promptResult = await withAbort(
        withTimeout<GeminiPromptResponse>(
          connection.prompt({
            sessionId,
            prompt: [
              {
                type: "text",
                text: prompt
              }
            ]
          }) as Promise<GeminiPromptResponse>,
          promptTimeoutMs,
          [
            "Timed out while waiting for the Gemini ACP prompt to complete",
            `capability=${_capability}`,
            `workflowStage=${context.workflowStage}`,
            `model=${context.assignedModel.model}`,
            `timeoutMs=${promptTimeoutMs}`
          ].join(" · ")
        ),
        abortSignal,
        onAbort,
        "Gemini ACP prompt was aborted"
      );

      const stdout = agentMessageChunks.join("");
      if (stdout.trim().length === 0) {
        throw new Error(
          `Gemini ACP prompt completed with stopReason=${promptResult.stopReason ?? "unknown"} without any text output`
        );
      }

      return {
        stdout,
        stderr: stderrBuffer,
        command
      };
    } catch (error) {
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
    } finally {
      await stopChildProcess(child);
    }
  };
}

function resolveGeminiPromptTimeoutMs(
  baseTimeoutMs: number,
  capability: OrchestratorCapability,
  context: ModelInvocationContext
): number {
  const capabilityFloorMs = capability === "abstractPlan" || capability === "concretePlan"
    ? 90_000
    : capability === "review" || capability === "verify"
      ? 75_000
      : capability === "gather" || capability === "execute"
        ? 120_000
        : 60_000;
  const reasoningBonusMs = context.assignedModel.reasoningEffort === "xhigh"
    ? 60_000
    : context.assignedModel.reasoningEffort === "high"
      ? 30_000
      : context.assignedModel.reasoningEffort === "medium"
        ? 10_000
        : 0;
  const discoveryBonusMs = context.workflowStage === "project_structure_discovery"
    ? 30_000
    : context.workflowStage === "project_structure_inspection"
      ? 15_000
      : 0;

  return Math.max(baseTimeoutMs, capabilityFloorMs + reasoningBonusMs + discoveryBonusMs);
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
