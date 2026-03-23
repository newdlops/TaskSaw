import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { ManagedToolId, ManagedToolModelCatalog, ManagedToolStatus } from "./types";

type ToolDefinition = {
  id: ManagedToolId;
  displayName: string;
  packageName: string;
  executableName: string;
};

type ResolvedCommand = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

type NodeRuntime = {
  command: string;
  env: Record<string, string>;
};

type ManagedToolAuthState = {
  toolId: ManagedToolId;
  authenticated: boolean;
  message: string | null;
};

type ManagedGeminiAuthPreflight = {
  authenticated: boolean;
  message: string | null;
};

type GeminiModelsModule = {
  PREVIEW_GEMINI_MODEL: string;
  PREVIEW_GEMINI_3_1_MODEL: string;
  PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL: string;
  PREVIEW_GEMINI_FLASH_MODEL: string;
  PREVIEW_GEMINI_3_1_FLASH_LITE_MODEL: string;
  DEFAULT_GEMINI_MODEL: string;
  DEFAULT_GEMINI_FLASH_MODEL: string;
  DEFAULT_GEMINI_FLASH_LITE_MODEL: string;
  PREVIEW_GEMINI_MODEL_AUTO: string;
  DEFAULT_GEMINI_MODEL_AUTO: string;
  VALID_GEMINI_MODELS: Set<string>;
  resolveModel: (
    requestedModel: string,
    useGemini3_1?: boolean,
    useCustomToolModel?: boolean,
    hasAccessToPreview?: boolean
  ) => string;
  resolveClassifierModel: (
    requestedModel: string,
    modelAlias: string,
    useGemini3_1?: boolean,
    useCustomToolModel?: boolean
  ) => string;
};

type InstructionSource = {
  path: string;
  content: string;
};

type GeminiUsageRecord = {
  modelId: string | null;
  remainingPercent: number | null;
  statusMessage?: string | null;
};

const dynamicImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<unknown>;

const CODEX_INSTRUCTION_CANDIDATES = ["AGENTS.MD", "AGENTS.md", "agents.md", "agents.MD"];
const GEMINI_CONTEXT_FILE_CANDIDATES = ["GEMINI.MD", "GEMINI.md", "gemini.md", "gemini.MD", "Gemini.md"];

const TOOL_DEFINITIONS: Record<ManagedToolId, ToolDefinition> = {
  codex: {
    id: "codex",
    displayName: "Codex",
    packageName: "@openai/codex",
    executableName: "codex"
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini",
    packageName: "@google/gemini-cli",
    executableName: "gemini"
  }
};

export class ToolManager {
  private readonly toolingRoot: string;
  private readonly installRoot: string;
  private readonly binDirectory: string;
  private readonly homeDirectory: string;
  private readonly runtimeDirectory: string;
  private readonly installPromises = new Map<ManagedToolId, Promise<ManagedToolStatus>>();
  private readonly modelCatalogPromises = new Map<string, Promise<ManagedToolModelCatalog>>();
  private readonly resolvedModelCatalogs = new Map<string, ManagedToolModelCatalog>();
  private observedGeminiRemainingPercent: number | null = null;
  private observedGeminiStatusMessage: string | null = null;
  private ptyExecutor?: (kind: ManagedToolId, commandText: string) => Promise<string>;
  private activeSessionQueryTrigger?: () => void;

  constructor(private userDataDirectory: string) {
    this.toolingRoot = path.join(userDataDirectory, "managed-tools");
    this.installRoot = path.join(this.toolingRoot, "packages");
    this.binDirectory = path.join(this.toolingRoot, "bin");
    this.homeDirectory = path.join(this.toolingRoot, "home");
    this.runtimeDirectory = path.join(this.toolingRoot, "runtime");
    this.ensureBaseDirectories();
  }

  setPtyExecutor(executor: (kind: ManagedToolId, commandText: string) => Promise<string>) {
    this.ptyExecutor = executor;
  }

  setActiveSessionQueryTrigger(trigger: () => void) {
    this.activeSessionQueryTrigger = trigger;
  }

  updateObservedGeminiUsage(percent: number | null, message: string | null = null) {
    this.observedGeminiRemainingPercent = percent !== null ? this.clampPercentage(percent) : null;
    this.observedGeminiStatusMessage = message;
  }

  getHomeDirectory(): string {
    this.ensureBaseDirectories();
    return this.homeDirectory;
  }

  getRuntimeDirectory(): string {
    this.ensureBaseDirectories();
    return this.runtimeDirectory;
  }

  getBinDirectory(): string {
    this.ensureBaseDirectories();
    return this.binDirectory;
  }

  async getStatus(toolId: ManagedToolId): Promise<ManagedToolStatus> {
    const baseStatus = this.getInstalledStatus(toolId);

    let usage: ManagedToolStatus["usage"] = null;
    if (baseStatus.installed) {
      if (toolId === "codex") {
        usage = await this.getCodexUsage();
      } else if (toolId === "gemini") {
        usage = await this.getGeminiUsage();
      }
    }

    return {
      ...baseStatus,
      usage
    };
  }

  async getAllStatuses(): Promise<ManagedToolStatus[]> {
    const toolIds = Object.keys(TOOL_DEFINITIONS) as ManagedToolId[];
    return Promise.all(toolIds.map((toolId) => this.getStatus(toolId)));
  }

  private async getCodexUsage(): Promise<ManagedToolStatus["usage"]> {
    try {
      const helperPath = path.join(os.homedir(), ".codex", "bin", "codex-rate-limits");
      if (!fs.existsSync(helperPath)) {
        return null;
      }
      const child = spawn(helperPath, ["--json"], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          child.kill();
          resolve(null);
        }, 5000);

        child.on("close", (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            resolve(null);
            return;
          }
          try {
            const data = JSON.parse(stdout);
            const remainingPercent = typeof data?.primary?.left === "number"
              ? data.primary.left
              : typeof data?.remainingPercent === "number"
                ? data.remainingPercent
                : null;

            if (typeof remainingPercent !== "number") {
              resolve(null);
              return;
            }

            resolve({
              remainingPercent,
              codex: {
                fiveHourRemainingPercent: typeof data?.fiveHour?.left === "number" ? data.fiveHour.left : null,
                weeklyRemainingPercent: typeof data?.weekly?.left === "number" ? data.weekly.left : null
              }
            });
          } catch {
            resolve(null);
          }
        });

        child.on("error", () => {
          clearTimeout(timeout);
          resolve(null);
        });
      });
    } catch {
      return null;
    }
  }

  private async getGeminiUsage(): Promise<ManagedToolStatus["usage"]> {
    try {
      const catalog = this.resolvedModelCatalogs.get("gemini:")
        ?? await this.discoverModelCatalog("gemini").catch(() => null);

      if (!catalog || !catalog.models) {
        return null;
      }

      const usageStats = await this.queryGeminiModelUsageStats();
      const usageRecords = this.extractGeminiUsageRecords(usageStats);

      const models = catalog.models
        .filter((model) => !model.hidden)
        .map((model) => {
          let displayName = model.displayName;
          if (displayName.toLowerCase().startsWith("gemini ")) {
            displayName = displayName.slice(7);
          }
          return {
            modelId: model.id,
            displayName,
            remainingPercent: this.findGeminiRemainingPercentForModel(model.id, usageRecords, false)
          };
        });

      const selectedModelId = catalog.currentModelId ?? models[0]?.modelId ?? null;
      let remainingPercent = selectedModelId
        ? this.findGeminiRemainingPercentForModel(selectedModelId, usageRecords, true)
        : null;

      let statusMessage = this.observedGeminiStatusMessage;
      if (!statusMessage) {
        statusMessage = usageRecords.find(r => r.statusMessage)?.statusMessage ?? null;
      }

      if (remainingPercent === null && this.observedGeminiRemainingPercent !== null) {
        remainingPercent = this.observedGeminiRemainingPercent;
      }

      if (remainingPercent === null && !statusMessage) {
        this.activeSessionQueryTrigger?.();
      }

      return {
        remainingPercent,
        statusMessage,
        gemini: { models }
      };
    } catch {
      return null;
    }
  }

  private async queryGeminiModelUsageStats(): Promise<unknown> {
    const launchCommand = this.resolveInstalledLaunchCommand("gemini");
    if (!launchCommand) {
      return null;
    }

    const env = this.buildManagedCommandEnv("gemini", launchCommand.env);
    const commandAttempts = [
      ["-p", "/stats session", "-o", "json"],
      ["-p", "/stats model", "-o", "json"],
      ["/stats session", "-o", "json"],
      ["retrieveuserquota", "-o", "json"]
    ];

    for (const args of commandAttempts) {
      const result = await this.runJsonCommand(launchCommand.command, [...launchCommand.args, ...args], env, 5_000);
      
      if (result && typeof result === "object") {
        if (!("code" in result)) {
          return result;
        }

        const raw = result as { stdout: string; stderr: string; code: number | null; error?: string };
        
        // If it's a JSON parse error but we have output, check for quota messages
        if (raw.error === "json_parse_failed" || raw.code !== 0) {
          const combined = `${raw.stdout}\n${raw.stderr}`.toLowerCase();
          if (combined.includes("exhausted your capacity") || combined.includes("quota will reset after") || combined.includes("quota_exhausted")) {
            // Let it fall through to the next attempt or fallback
            continue;
          }
        }
      }
    }

    // PTY Fallback
    if (this.ptyExecutor) {
      try {
        const rawOutput = await this.ptyExecutor("gemini", "/stats session");
        const parsedUsage = this.parseGeminiUsageFromText(rawOutput);
        if (parsedUsage) {
          return [{
            modelId: "unknown",
            remainingPercent: parsedUsage.percent,
            statusMessage: parsedUsage.message
          }];
        }
      } catch {
        // Ignore fallback failures
      }
    }

    this.activeSessionQueryTrigger?.();
    return null;
  }

  private parseGeminiUsageFromText(text: string): { percent: number | null, message: string | null } | null {
    const lowerText = text.toLowerCase();
    
    // Detect quota exhausted
    if (lowerText.includes("exhausted your capacity") || lowerText.includes("quota will reset after") || lowerText.includes("quota_exhausted")) {
      const resetMatch = lowerText.match(/quota will reset after ([^\s.]+)/);
      const statusMessage = resetMatch ? `Quota exhausted (resets after ${resetMatch[1]})` : "Quota exhausted";
      return { percent: 0, message: statusMessage };
    }

    // Detect numeric patterns like 10/100 or 90% remaining
    const remainingMatch = lowerText.match(/(\d+)%\s*remaining/);
    if (remainingMatch?.[1]) {
      return { percent: parseInt(remainingMatch[1], 10), message: null };
    }

    // Match patterns like "usage: 10/100" or "requests: 10 / 100"
    const quotaMatch = lowerText.match(/(?:usage|requests):\s*(\d+)\s*\/\s*(\d+)/);
    if (quotaMatch?.[1] && quotaMatch?.[2]) {
      const used = parseInt(quotaMatch[1], 10);
      const total = parseInt(quotaMatch[2], 10);
      if (total > 0) {
        return { percent: ((total - used) / total) * 100, message: null };
      }
    }

    // Match patterns like "10 / 100 requests used (10%)"
    const usedPercentMatch = lowerText.match(/(\d+)\s*\/\s*(\d+)\s*(?:requests|tokens)\s*used\s*\((\d+)%\)/);
    if (usedPercentMatch?.[3]) {
      return { percent: 100 - parseInt(usedPercentMatch[3], 10), message: null };
    }

    return null;
  }

  private async runJsonCommand(
    command: string,
    args: string[],
    env: Record<string, string>,
    timeoutMs: number
  ): Promise<unknown> {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    return await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve({ stdout, stderr, code: null, error: "timeout" });
      }, timeoutMs);

      const logExecution = (code: number | null, error?: Error) => {
        const logPath = path.join(process.cwd(), "gemini_debug.log");
        const timestamp = new Date().toISOString();
        const logEntries = [
          `--- ${timestamp} ---`,
          `Command: ${command}`,
          `Args: ${JSON.stringify(args)}`,
          `Exit Code: ${code}`
        ];
        if (error) logEntries.push(`Error: ${error.message}`);
        logEntries.push(`STDOUT: ${stdout}`);
        logEntries.push(`STDERR: ${stderr}`);
        logEntries.push("---------------------------\n");

        try {
          fs.appendFileSync(logPath, logEntries.join("\n"));
        } catch {
          // Ignore logging failures
        }
      };

      child.on("close", (code) => {
        clearTimeout(timeout);
        logExecution(code);
        if (code !== 0) {
          resolve({ stdout, stderr, code });
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ stdout, stderr, code, error: "json_parse_failed" });
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        logExecution(null, err);
        resolve({ stdout, stderr, code: null, error: err.message });
      });
    });
  }

  private extractGeminiUsageRecords(stats: unknown): GeminiUsageRecord[] {
    const records: GeminiUsageRecord[] = [];
    const visit = (value: unknown, parentModelId: string | null = null) => {
      if (!value || typeof value !== "object") {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(v => visit(v, parentModelId));
        return;
      }

      const currentModelId = this.readFirstString(value as Record<string, unknown>, [
        "model",
        "modelId",
        "model_id",
        "id",
        "name",
        "displayName",
        "display_name",
        "modelName"
      ]) || parentModelId;

      const record = this.parseGeminiUsageRecord(value as Record<string, unknown>, currentModelId);
      if (record) {
        records.push(record);
      }

      Object.values(value).forEach(v => visit(v, currentModelId));
    };

    visit(stats);
    return records;
  }

  private parseGeminiUsageRecord(value: Record<string, unknown>, modelId: string | null): GeminiUsageRecord | null {
    const remainingPercent = this.readGeminiRemainingPercent(value);
    const statusMessage = typeof value.statusMessage === "string" ? value.statusMessage : null;

    if (remainingPercent === null) {
      return null;
    }

    return {
      modelId: modelId ?? "unknown",
      remainingPercent,
      statusMessage
    };
  }

  private findGeminiRemainingPercentForModel(modelId: string, records: GeminiUsageRecord[], allowFallback: boolean): number | null {
    const normalizedModelId = this.normalizeGeminiModelIdentifier(modelId);
    
    // First, try to find an exact match for this model
    for (const record of records) {
      if (record.remainingPercent === null) {
        continue;
      }

      if (record.modelId && record.modelId !== "unknown") {
        if (this.normalizeGeminiModelIdentifier(record.modelId) === normalizedModelId) {
          return record.remainingPercent;
        }
      }
    }

    // Only if no exact match is found, should we consider an "unknown" record
    // but only as a global fallback if it's allowed (e.g. for the selected model)
    // or if it's a generic record without a status message (which likely applies to the whole account/session)
    const hasStatusMessage = records.some(r => r.statusMessage);
    if (allowFallback || !hasStatusMessage) {
      for (const record of records) {
        if (record.remainingPercent !== null && (record.modelId === "unknown" || !record.modelId)) {
          return record.remainingPercent;
        }
      }
    }

    return null;
  }

  private normalizeGeminiModelIdentifier(value: string): string {
    return value.trim().toLowerCase().replace(/^models\//, "");
  }

  private readGeminiRemainingPercent(value: Record<string, unknown>): number | null {
    const directPercent = this.readFirstNumber(value, [
      "remainingPercent",
      "remaining_percentage",
      "remainingPercentage",
      "percentRemaining",
      "remaining_pct"
    ]);
    if (directPercent !== null) {
      return this.clampPercentage(directPercent);
    }

    const remaining = this.readFirstNumber(value, [
      "remaining",
      "remainingQuota",
      "remaining_quota",
      "remaining_per_day",
      "remaining_per_minute",
      "left",
      "available"
    ]);
    const quota = this.readFirstNumber(value, [
      "quota",
      "limit",
      "limit_per_day",
      "limit_per_minute",
      "max",
      "total",
      "totalQuota",
      "total_quota",
      "capacity"
    ]);
    if (remaining !== null && quota !== null && quota > 0) {
      return this.clampPercentage((remaining / quota) * 100);
    }

    const used = this.readFirstNumber(value, [
      "used",
      "usage",
      "usedQuota",
      "used_quota",
      "used_in_session",
      "consumed",
      "count"
    ]);
    const usedPercentage = this.readFirstNumber(value, ["usedPercentage", "used_percentage", "usedPercent", "used_percent", "consumption_percentage"]);
    
    if (usedPercentage !== null) {
      return this.clampPercentage(100 - usedPercentage);
    }

    if (used !== null && quota !== null && quota > 0) {
      return this.clampPercentage(((quota - used) / quota) * 100);
    }

    return null;
  }

  private readFirstString(value: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
    }

    return null;
  }

  private readFirstNumber(value: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private clampPercentage(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  buildManagedExecutionEnvironment(toolId: ManagedToolId): Record<string, string> {
    const runtimeDirectory = this.getRuntimeDirectory();
    const tempDirectory = path.join(runtimeDirectory, "tmp");
    const xdgCacheDirectory = path.join(runtimeDirectory, "xdg-cache");
    const xdgConfigDirectory = path.join(runtimeDirectory, "xdg-config");
    const xdgStateDirectory = path.join(runtimeDirectory, "xdg-state");
    fs.mkdirSync(tempDirectory, { recursive: true });
    fs.mkdirSync(xdgCacheDirectory, { recursive: true });
    fs.mkdirSync(xdgConfigDirectory, { recursive: true });
    fs.mkdirSync(xdgStateDirectory, { recursive: true });

    const baseEnv: Record<string, string> = {
      HOME: this.getHomeDirectory(),
      PATH: [this.getBinDirectory(), process.env.PATH ?? ""]
        .filter(Boolean)
        .join(path.delimiter),
      TMPDIR: tempDirectory,
      XDG_CACHE_HOME: xdgCacheDirectory,
      XDG_CONFIG_HOME: xdgConfigDirectory,
      XDG_STATE_HOME: xdgStateDirectory,
      OTEL_SDK_DISABLED: "true"
    };

    if (toolId === "codex") {
      return {
        ...baseEnv,
        ALL_PROXY: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NO_PROXY: "*"
      };
    }

    return {
      ...baseEnv,
      SANDBOX: "tasksaw-managed",
      GEMINI_SANDBOX: "false",
      GEMINI_FORCE_FILE_STORAGE: "true",
      GEMINI_TELEMETRY_ENABLED: "0",
      NODE_NO_WARNINGS: "1"
    };
  }

  async prepareWorkspaceContext(toolId: ManagedToolId, workspacePath?: string | null): Promise<void> {
    this.ensureBaseDirectories();
    this.syncManagedGlobalCodexInstructions();
    this.syncManagedGlobalGeminiInstructions();
    this.syncManagedGeminiSettings();

    if (toolId === "codex") {
      this.writeCodexWorkspaceInstructionsFile(workspacePath);
    }
  }

  getCodexWorkspaceConfigArgs(workspacePath?: string | null): string[] {
    const instructionFilePath = this.getCodexWorkspaceInstructionFilePath(workspacePath);
    if (!instructionFilePath || !fs.existsSync(instructionFilePath)) {
      return [];
    }

    return ["-c", `model_instructions_file=${JSON.stringify(instructionFilePath)}`];
  }

  async getAuthenticationStatus(
    toolId: ManagedToolId,
    workspacePath?: string | null
  ): Promise<ManagedToolAuthState> {
    await this.ensureInstalled(toolId);
    await this.prepareWorkspaceContext(toolId, workspacePath);

    if (toolId === "codex") {
      return this.getCodexAuthenticationStatus(workspacePath);
    }

    return this.getGeminiAuthenticationStatus();
  }

  async discoverModelCatalog(toolId: ManagedToolId, workspacePath?: string | null): Promise<ManagedToolModelCatalog> {
    const cacheKey = this.createModelCatalogCacheKey(toolId, workspacePath);
    const resolvedCatalog = this.resolvedModelCatalogs.get(cacheKey);
    if (resolvedCatalog) {
      return resolvedCatalog;
    }
    const inFlight = this.modelCatalogPromises.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const discoveryPromise = this.prepareWorkspaceContext(toolId, workspacePath)
      .then(() => this.discoverModelCatalogInternal(toolId, workspacePath))
      .catch((error) => {
        const cachedCatalog = this.resolvedModelCatalogs.get(cacheKey);
        if (cachedCatalog) {
          return cachedCatalog;
        }

        throw error;
      });
    this.modelCatalogPromises.set(cacheKey, discoveryPromise);

    try {
      const catalog = await discoveryPromise;
      this.resolvedModelCatalogs.set(cacheKey, catalog);
      return catalog;
    } finally {
      this.modelCatalogPromises.delete(cacheKey);
    }
  }

  async ensureInstalled(toolId: ManagedToolId): Promise<ManagedToolStatus> {
    const currentStatus = this.getInstalledStatus(toolId);
    if (currentStatus.installed) {
      this.ensureShim(toolId);
      return currentStatus;
    }

    return this.installLatest(toolId);
  }

  async updateAll(): Promise<ManagedToolStatus[]> {
    this.modelCatalogPromises.clear();
    this.resolvedModelCatalogs.clear();
    const statuses: ManagedToolStatus[] = [];

    for (const toolId of Object.keys(TOOL_DEFINITIONS) as ManagedToolId[]) {
      statuses.push(await this.installLatest(toolId));
    }

    return statuses;
  }

  resetPersistentState() {
    this.installPromises.clear();
    this.modelCatalogPromises.clear();
    this.resolvedModelCatalogs.clear();
    fs.rmSync(this.homeDirectory, { recursive: true, force: true });
    fs.rmSync(this.runtimeDirectory, { recursive: true, force: true });
    fs.rmSync(path.join(this.userDataDirectory, "sandbox-runtime"), { recursive: true, force: true });
    this.ensureBaseDirectories();
  }

  async resolveLaunchCommand(
    toolId: ManagedToolId
  ): Promise<ResolvedCommand> {
    await this.ensureInstalled(toolId);

    const launchCommand = this.resolveInstalledLaunchCommand(toolId);
    if (!launchCommand) {
      throw new Error(`Managed ${TOOL_DEFINITIONS[toolId].displayName} entry point was not found after install`);
    }

    return launchCommand;
  }

  getGeminiAcpModulePath(): string {
    return path.join(
      this.getInstallDirectory("gemini"),
      "node_modules",
      "@agentclientprotocol",
      "sdk",
      "dist",
      "acp.js"
    );
  }

  getGeminiModelsModulePath(): string {
    return path.join(
      this.getInstallDirectory("gemini"),
      "node_modules",
      "@google",
      "gemini-cli-core",
      "dist",
      "src",
      "config",
      "models.js"
    );
  }

  private syncManagedGlobalCodexInstructions() {
    const source = this.readInstructionSource(os.homedir(), CODEX_INSTRUCTION_CANDIDATES);
    this.syncManagedInstructionFile(path.join(this.homeDirectory, "AGENTS.md"), source);
  }

  private syncManagedGlobalGeminiInstructions() {
    const source = this.readInstructionSource(path.join(os.homedir(), ".gemini"), GEMINI_CONTEXT_FILE_CANDIDATES);
    this.syncManagedInstructionFile(path.join(this.homeDirectory, ".gemini", "GEMINI.md"), source);
  }

  private syncManagedGeminiSettings() {
    const settingsPath = path.join(this.homeDirectory, ".gemini", "settings.json");
    const nextSettings = this.withPatchedJsonFile(settingsPath, (current) => {
      const contextValue = current.context;
      const currentContext = this.isPlainObject(contextValue) ? { ...contextValue } : {};
      const currentFileNameValue = currentContext.fileName;
      const currentFileNames = Array.isArray(currentFileNameValue)
        ? currentFileNameValue.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : typeof currentFileNameValue === "string" && currentFileNameValue.trim().length > 0
          ? [currentFileNameValue]
          : [];

      return {
        ...current,
        context: {
          ...currentContext,
          fileName: this.mergeStringLists(GEMINI_CONTEXT_FILE_CANDIDATES, currentFileNames)
        }
      };
    });

    this.writeJsonIfChanged(settingsPath, nextSettings);
  }

  private writeCodexWorkspaceInstructionsFile(workspacePath?: string | null) {
    const instructionFilePath = this.getCodexWorkspaceInstructionFilePath(workspacePath);
    if (!instructionFilePath) {
      return;
    }

    const normalizedWorkspacePath = workspacePath?.trim();
    if (!normalizedWorkspacePath) {
      return;
    }

    const workspaceSource = this.readInstructionSource(normalizedWorkspacePath, CODEX_INSTRUCTION_CANDIDATES);
    const globalSource = this.readInstructionSource(os.homedir(), CODEX_INSTRUCTION_CANDIDATES);
    if (!workspaceSource && !globalSource) {
      fs.rmSync(instructionFilePath, { force: true });
      return;
    }

    const sections = [
      "# TaskSaw Codex Instructions",
      "",
      "Apply these instructions with the following precedence:",
      "1. Workspace instructions",
      "2. Global instructions",
      "",
      "If the workspace and global instructions conflict, the workspace instructions win.",
      ""
    ];

    if (workspaceSource) {
      sections.push(
        `## Workspace Instructions (${workspaceSource.path})`,
        workspaceSource.content.trim(),
        ""
      );
    }

    if (globalSource) {
      sections.push(
        `## Global Instructions (${globalSource.path})`,
        globalSource.content.trim(),
        ""
      );
    }

    const nextContent = `${sections.join("\n").trimEnd()}\n`;
    fs.mkdirSync(path.dirname(instructionFilePath), { recursive: true });

    const currentContent = fs.existsSync(instructionFilePath)
      ? fs.readFileSync(instructionFilePath, "utf8")
      : null;
    if (currentContent === nextContent) {
      return;
    }

    fs.writeFileSync(instructionFilePath, nextContent);
  }

  private getCodexWorkspaceInstructionFilePath(workspacePath?: string | null): string | null {
    const normalizedWorkspacePath = workspacePath?.trim();
    if (!normalizedWorkspacePath) {
      return null;
    }

    const workspaceHash = createHash("sha256").update(normalizedWorkspacePath).digest("hex").slice(0, 16);
    return path.join(this.runtimeDirectory, "codex-instructions", `${workspaceHash}.md`);
  }

  private readInstructionSource(baseDirectory: string, candidates: string[]): InstructionSource | null {
    for (const candidateName of candidates) {
      const candidatePath = path.join(baseDirectory, candidateName);
      if (!fs.existsSync(candidatePath)) {
        continue;
      }

      try {
        if (!fs.statSync(candidatePath).isFile()) {
          continue;
        }

        const content = fs.readFileSync(candidatePath, "utf8").trim();
        if (content.length === 0) {
          continue;
        }

        return {
          path: candidatePath,
          content
        };
      } catch {
        // Ignore unreadable instruction files and keep searching fallbacks.
      }
    }

    return null;
  }

  private syncManagedInstructionFile(destinationPath: string, source: InstructionSource | null) {
    if (!source) {
      fs.rmSync(destinationPath, { force: true });
      return;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    const nextContent = `${source.content.trim()}\n`;
    const currentContent = fs.existsSync(destinationPath)
      ? fs.readFileSync(destinationPath, "utf8")
      : null;
    if (currentContent === nextContent) {
      return;
    }

    fs.writeFileSync(destinationPath, nextContent);
  }

  private withPatchedJsonFile(
    filePath: string,
    patch: (current: Record<string, unknown>) => Record<string, unknown>
  ): Record<string, unknown> {
    const current = this.readJsonObject(filePath);
    return patch(current);
  }

  private readJsonObject(filePath: string): Record<string, unknown> {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      return this.isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeJsonIfChanged(filePath: string, value: Record<string, unknown>) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const nextContent = `${JSON.stringify(value, null, 2)}\n`;
    const currentContent = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf8")
      : null;
    if (currentContent === nextContent) {
      return;
    }

    fs.writeFileSync(filePath, nextContent);
  }

  private mergeStringLists(primary: string[], secondary: string[]): string[] {
    const values = new Set<string>();
    for (const value of [...primary, ...secondary]) {
      const trimmedValue = value.trim();
      if (trimmedValue.length === 0) {
        continue;
      }

      values.add(trimmedValue);
    }

    return [...values];
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private readNestedString(current: Record<string, unknown>, pathSegments: string[]): string | null {
    let value: unknown = current;

    for (const segment of pathSegments) {
      if (!this.isPlainObject(value)) {
        return null;
      }

      value = value[segment];
    }

    return typeof value === "string" && value.trim().length > 0
      ? value
      : null;
  }

  private createModelCatalogCacheKey(toolId: ManagedToolId, workspacePath?: string | null): string {
    const normalizedWorkspace = workspacePath?.trim() || "";
    return `${toolId}:${normalizedWorkspace}`;
  }

  private scoreManagedReasoningCapability(model: ManagedToolModelCatalog["models"][number]): number {
    if (model.supportedReasoningEfforts.includes("xhigh")) return 400;
    if (model.supportedReasoningEfforts.includes("high")) return 300;
    if (model.supportedReasoningEfforts.includes("medium")) return 200;
    if (model.supportedReasoningEfforts.includes("low")) return 100;

    if (model.defaultReasoningEffort === "xhigh") return 350;
    if (model.defaultReasoningEffort === "high") return 250;
    if (model.defaultReasoningEffort === "medium") return 150;
    if (model.defaultReasoningEffort === "low") return 50;
    return 0;
  }

  private pickBestCatalogModel(
    models: ManagedToolModelCatalog["models"],
    score: (model: ManagedToolModelCatalog["models"][number]) => number
  ): ManagedToolModelCatalog["models"][number] | undefined {
    return [...models]
      .sort((left, right) => score(right) - score(left))
      .find((model) => !model.hidden)
      ?? [...models].sort((left, right) => score(right) - score(left))[0];
  }

  private selectCodexRecommendedPlannerModelId(models: ManagedToolModelCatalog["models"]): string | null {
    const selectedModel = this.pickBestCatalogModel(models, (model) =>
      (model.hidden ? -1_000_000 : 0)
      + (this.scoreManagedReasoningCapability(model) * 10)
      + (model.isDefault ? 1 : 0)
    );
    return selectedModel?.id ?? null;
  }

  private selectCodexRecommendedWorkerModelId(
    models: ManagedToolModelCatalog["models"],
    currentModelId: string | null
  ): string | null {
    const visibleModels = models.filter((model) => !model.hidden);
    const selectableModels = visibleModels.length > 0 ? visibleModels : models;
    const preferredMiniModel = this.pickBestCatalogModel(
      selectableModels.filter((model) => this.isCodexMiniFamilyModel(model.model)),
      (model) =>
        (model.hidden ? -1_000_000 : 0)
        + (model.isDefault ? 10_000 : 0)
        - (this.scoreManagedReasoningCapability(model) * 10)
    );
    const currentModel = currentModelId
      ? selectableModels.find((model) => model.id === currentModelId || model.model === currentModelId)
      : undefined;
    if (currentModel && this.isCodexMiniFamilyModel(currentModel.model)) {
      return currentModel.id;
    }
    if (preferredMiniModel) {
      return preferredMiniModel.id;
    }
    if (currentModel) {
      return currentModel.id;
    }

    const selectedModel = this.pickBestCatalogModel(selectableModels, (model) =>
      (model.hidden ? -1_000_000 : 0)
      + (model.isDefault ? 10_000 : 0)
      - (this.scoreManagedReasoningCapability(model) * 10)
    );
    return selectedModel?.id ?? null;
  }

  private async discoverModelCatalogInternal(
    toolId: ManagedToolId,
    workspacePath?: string | null
  ): Promise<ManagedToolModelCatalog> {
    if (toolId === "codex") {
      return this.discoverCodexModelCatalog(workspacePath);
    }

    return this.discoverGeminiModelCatalog(workspacePath);
  }

  private isCodexMiniFamilyModel(model: string): boolean {
    return model.toLowerCase().includes("mini");
  }

  private async getCodexAuthenticationStatus(workspacePath?: string | null): Promise<ManagedToolAuthState> {
    const launchCommand = await this.resolveLaunchCommand("codex");
    const cwd = workspacePath?.trim() || process.cwd();
    const env = this.buildManagedCommandEnv("codex", launchCommand.env);

    return new Promise<ManagedToolAuthState>((resolve, reject) => {
      const child = spawn(launchCommand.command, [...launchCommand.args, "login", "status"], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let settled = false;
      let stdoutBuffer = "";
      let stderrBuffer = "";
      const timeout = setTimeout(() => {
        finish(new Error("Timed out while checking Codex login status"));
      }, 10_000);

      const finish = (error?: Error, result?: ManagedToolAuthState) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (!child.killed && child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
        }

        if (error) {
          reject(error);
          return;
        }

        resolve(result ?? {
          toolId: "codex",
          authenticated: false,
          message: "Codex login is required."
        });
      };

      child.stdout?.on("data", (chunk) => {
        stdoutBuffer += chunk.toString("utf8");
      });

      child.stderr?.on("data", (chunk) => {
        stderrBuffer += chunk.toString("utf8");
      });

      child.on("error", (error) => finish(error instanceof Error ? error : new Error(String(error))));
      child.on("close", (code, signal) => {
        if (settled) return;

        const combinedOutput = `${stdoutBuffer}\n${stderrBuffer}`.toLowerCase();
        if (code === 0) {
          finish(undefined, {
            toolId: "codex",
            authenticated: true,
            message: null
          });
          return;
        }

        if (this.looksLikeCodexLoginRequired(combinedOutput)) {
          finish(undefined, {
            toolId: "codex",
            authenticated: false,
            message: "Codex login is required."
          });
          return;
        }

        finish(new Error(`Failed to check Codex login status (code=${code ?? "null"}, signal=${signal ?? "null"}): ${combinedOutput.trim()}`));
      });
    });
  }

  private async getGeminiAuthenticationStatus(): Promise<ManagedToolAuthState> {
    const preflight = this.getManagedGeminiAuthenticationPreflight();
    if (!preflight.authenticated) {
      return {
        toolId: "gemini",
        authenticated: false,
        message: preflight.message
      };
    }

    return {
      toolId: "gemini",
      authenticated: true,
      message: null
    };
  }

  private async probeGeminiAuthenticationStatus(workspacePath?: string | null): Promise<ManagedToolAuthState> {
    const launchCommand = await this.resolveLaunchCommand("gemini");
    const cwd = workspacePath?.trim() || process.cwd();
    const env = this.buildManagedCommandEnv("gemini", launchCommand.env);
    const acpModule = await this.importManagedGeminiAcpModule();

    class GeminiAuthClient {
      async requestPermission() {
        return {
          outcome: {
            outcome: "cancelled"
          }
        };
      }

      async sessionUpdate() {
        return undefined;
      }

      async writeTextFile() {
        return {};
      }

      async readTextFile() {
        return { content: "" };
      }
    }

    const child = spawn(launchCommand.command, [...launchCommand.args, "--acp"], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stderrBuffer = "";
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
      if (stderrBuffer.length > 8_000) {
        stderrBuffer = stderrBuffer.slice(-8_000);
      }
    });

    try {
      const stdin = child.stdin;
      const stdout = child.stdout;
      if (!stdin || !stdout) {
        throw new Error("gemini --acp did not expose stdio handles");
      }

      const stream = acpModule.ndJsonStream(
        Writable.toWeb(stdin) as unknown as WritableStream<Uint8Array>,
        Readable.toWeb(stdout) as unknown as ReadableStream<Uint8Array>
      );
      const connection = new acpModule.ClientSideConnection(
        () => new GeminiAuthClient(),
        stream
      );

      await this.withTimeout(
        connection.initialize({
          protocolVersion: acpModule.PROTOCOL_VERSION,
          clientCapabilities: {}
        }),
        10_000,
        "Timed out while initializing Gemini ACP"
      );

      await this.withTimeout(
        connection.newSession({
          cwd,
          mcpServers: []
        }) as Promise<unknown>,
        15_000,
        "Timed out while checking Gemini login status"
      );

      return {
        toolId: "gemini",
        authenticated: true,
        message: null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.looksLikeGeminiLoginRequired(`${message}\n${stderrBuffer}`)) {
        return {
          toolId: "gemini",
          authenticated: false,
          message: "Gemini login is required."
        };
      }

      throw this.decorateDiscoveryError(
        "Gemini login status",
        error instanceof Error ? error : new Error(String(error)),
        stderrBuffer
      );
    } finally {
      await this.stopChildProcess(child);
    }
  }

  private getManagedGeminiAuthenticationPreflight(): ManagedGeminiAuthPreflight {
    const geminiDirectory = path.join(this.homeDirectory, ".gemini");
    const settings = this.readJsonObject(path.join(geminiDirectory, "settings.json"));
    const selectedType = this.readNestedString(settings, ["security", "auth", "selectedType"]);

    if (!selectedType) {
      if (this.hasConfiguredGeminiApiKey()) {
        return {
          authenticated: true,
          message: null
        };
      }

      return {
        authenticated: false,
        message: "Gemini login is required."
      };
    }

    if (selectedType === "oauth-personal" && !this.hasManagedGeminiOauthSession(geminiDirectory)) {
      return {
        authenticated: false,
        message: "Gemini login is required."
      };
    }

    return {
      authenticated: true,
      message: null
    };
  }

  private looksLikeCodexLoginRequired(output: string): boolean {
    return /(not logged in|login required|run codex login|re-run [`'"]?codex login|chatgpt account id not available|auth required)/i
      .test(output);
  }

  private looksLikeGeminiLoginRequired(output: string): boolean {
    return /(authentication required|auth required|authentication failed|gemini api key is missing|login required|credential)/i
      .test(output);
  }

  private hasConfiguredGeminiApiKey(): boolean {
    return [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]
      .some((value) => typeof value === "string" && value.trim().length > 0);
  }

  private hasManagedGeminiOauthSession(geminiDirectory: string): boolean {
    if (fs.existsSync(path.join(geminiDirectory, "oauth_creds.json"))) {
      return true;
    }

    const googleAccounts = this.readJsonObject(path.join(geminiDirectory, "google_accounts.json"));
    const activeAccount = googleAccounts.active;
    return typeof activeAccount === "string" && activeAccount.trim().length > 0;
  }

  private async discoverCodexModelCatalog(workspacePath?: string | null): Promise<ManagedToolModelCatalog> {
    const launchCommand = await this.resolveLaunchCommand("codex");
    const cwd = workspacePath?.trim() || process.cwd();
    const env = this.buildManagedCommandEnv("codex", launchCommand.env);

    type CodexModelResponse = {
      id: string;
      model: string;
      displayName: string;
      description: string;
      hidden: boolean;
      isDefault: boolean;
      defaultReasoningEffort: string;
      supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
    };

    type CodexModelListResult = {
      data?: CodexModelResponse[];
      nextCursor?: string | null;
    };

    const models = await new Promise<CodexModelResponse[]>((resolve, reject) => {
      const child = spawn(launchCommand.command, [...launchCommand.args, "app-server"], {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const stdin = child.stdin;
      const stdout = child.stdout;
      const stderr = child.stderr;
      if (!stdin || !stdout || !stderr) {
        reject(new Error("codex app-server did not expose stdio handles"));
        return;
      }

      let settled = false;
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let nextRequestId = 1;
      let collectedModels: CodexModelResponse[] = [];

      const timeout = setTimeout(() => {
        finish(new Error("Timed out while discovering Codex models via codex app-server"));
      }, 15_000);

      const finish = (error?: Error, result?: CodexModelResponse[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (!child.killed) {
          child.kill("SIGTERM");
        }

        if (error) {
          reject(this.decorateDiscoveryError("Codex", error, stderrBuffer));
          return;
        }

        resolve(result ?? []);
      };

      const sendRequest = (method: string, params: Record<string, unknown> | null) => {
        const payload = JSON.stringify({
          method,
          id: nextRequestId++,
          params
        });

        stdin.write(`${payload}\n`);
      };

      const requestNextPage = (cursor?: string | null) => {
        sendRequest("model/list", {
          includeHidden: true,
          limit: 100,
          cursor: cursor ?? null
        });
      };

      stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString("utf8");

        let newlineIndex = stdoutBuffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const rawLine = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

          if (rawLine.length > 0) {
            try {
              const message = JSON.parse(rawLine) as {
                id?: number;
                result?: CodexModelListResult;
                error?: { code?: number; message?: string };
              };

              if (message.error) {
                finish(new Error(message.error.message ?? "codex app-server returned an error"));
                return;
              }

              if (message.id === 1) {
                requestNextPage();
              } else if (typeof message.result === "object" && message.result !== null && Array.isArray(message.result.data)) {
                collectedModels = collectedModels.concat(message.result.data);
                if (message.result.nextCursor) {
                  requestNextPage(message.result.nextCursor);
                } else {
                  finish(undefined, collectedModels);
                  return;
                }
              }
            } catch (error) {
              finish(error instanceof Error ? error : new Error(String(error)));
              return;
            }
          }

          newlineIndex = stdoutBuffer.indexOf("\n");
        }
      });

      stderr.on("data", (chunk) => {
        stderrBuffer += chunk.toString("utf8");
        if (stderrBuffer.length > 8_000) {
          stderrBuffer = stderrBuffer.slice(-8_000);
        }
      });

      child.on("error", (error) => finish(error));
      child.on("close", (code, signal) => {
        if (settled) return;
        finish(new Error(`codex app-server exited before model discovery completed (code=${code ?? "null"}, signal=${signal ?? "null"})`));
      });

      sendRequest("initialize", {
        clientInfo: {
          name: "tasksaw-model-discovery",
          version: "0.1.0"
        },
        capabilities: null
      });
    });

    const mappedModels = models.map((model) => ({
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      description: model.description ?? null,
      hidden: model.hidden,
      isDefault: model.isDefault,
      defaultReasoningEffort: model.defaultReasoningEffort ?? null,
      supportedReasoningEfforts: model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort)
    }));
    const currentModelId = mappedModels.find((model) => model.isDefault)?.id ?? null;

    return {
      toolId: "codex",
      provider: "OpenAI",
      currentModelId,
      recommendedPlannerModelId: this.selectCodexRecommendedPlannerModelId(mappedModels),
      recommendedWorkerModelId: this.selectCodexRecommendedWorkerModelId(mappedModels, currentModelId),
      discoveredAt: new Date().toISOString(),
      models: mappedModels
    };
  }

  private async discoverGeminiModelCatalog(workspacePath?: string | null): Promise<ManagedToolModelCatalog> {
    void workspacePath;
    const modelsModule = await this.importManagedGeminiModelsModule();
    const configuredModelId = (process.env.GEMINI_MODEL?.trim() || this.getManagedGeminiConfiguredModel())
      ?? modelsModule.PREVIEW_GEMINI_MODEL_AUTO;
    const useGemini31 = this.shouldUseGemini31Routing(configuredModelId, modelsModule);
    const currentModelId = modelsModule.resolveModel(configuredModelId, useGemini31, false, true);
    const recommendedPlannerModelId = currentModelId;
    const recommendedWorkerModelId = this.isLightweightDiscoveredGeminiModel(currentModelId)
      ? currentModelId
      : modelsModule.resolveClassifierModel(currentModelId, "flash", useGemini31, false);
    const modelIds = this.mergeStringLists(
      this.listKnownGeminiModelIds(modelsModule),
      [currentModelId, recommendedPlannerModelId, recommendedWorkerModelId]
    );

    return {
      toolId: "gemini",
      provider: "Google",
      currentModelId,
      recommendedPlannerModelId,
      recommendedWorkerModelId,
      discoveredAt: new Date().toISOString(),
      models: modelIds.map((modelId) => this.createGeminiCatalogModel(modelId, currentModelId, modelsModule))
    };
  }

  private getManagedGeminiConfiguredModel(): string | null {
    const settingsPath = path.join(this.homeDirectory, ".gemini", "settings.json");
    const settings = this.readJsonObject(settingsPath);
    return this.readNestedString(settings, ["model", "name"]);
  }

  private shouldUseGemini31Routing(currentModelId: string, modelsModule: GeminiModelsModule): boolean {
    return currentModelId !== modelsModule.DEFAULT_GEMINI_MODEL_AUTO
      && currentModelId !== modelsModule.DEFAULT_GEMINI_MODEL
      && currentModelId !== modelsModule.DEFAULT_GEMINI_FLASH_MODEL
      && currentModelId !== modelsModule.DEFAULT_GEMINI_FLASH_LITE_MODEL;
  }

  private listKnownGeminiModelIds(modelsModule: GeminiModelsModule): string[] {
    return [
      modelsModule.PREVIEW_GEMINI_3_1_MODEL,
      modelsModule.PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL,
      modelsModule.PREVIEW_GEMINI_3_1_FLASH_LITE_MODEL,
      modelsModule.PREVIEW_GEMINI_MODEL,
      modelsModule.PREVIEW_GEMINI_FLASH_MODEL,
      modelsModule.DEFAULT_GEMINI_MODEL,
      modelsModule.DEFAULT_GEMINI_FLASH_MODEL,
      modelsModule.DEFAULT_GEMINI_FLASH_LITE_MODEL
    ];
  }

  private isLightweightDiscoveredGeminiModel(modelId: string): boolean {
    const normalizedModelId = modelId.toLowerCase();
    return normalizedModelId.includes("flash") || normalizedModelId.includes("lite");
  }

  private createGeminiCatalogModel(
    modelId: string,
    currentModelId: string,
    modelsModule: GeminiModelsModule
  ): ManagedToolModelCatalog["models"][number] {
    const displayName = this.getGeminiCatalogDisplayName(modelId, modelsModule);
    const isAlias = modelId === modelsModule.PREVIEW_GEMINI_MODEL_AUTO || modelId === modelsModule.DEFAULT_GEMINI_MODEL_AUTO;
    const isCustomToolsModel = modelId === modelsModule.PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL;

    return {
      id: modelId,
      model: modelId,
      displayName,
      description: isAlias
        ? "Gemini CLI router alias"
        : isCustomToolsModel
          ? "Gemini CLI custom-tools variant"
          : "Discovered from the installed Gemini CLI model catalog",
      hidden: isAlias || isCustomToolsModel,
      isDefault: modelId === currentModelId,
      defaultReasoningEffort: null,
      supportedReasoningEfforts: []
    };
  }

  private getGeminiCatalogDisplayName(modelId: string, modelsModule: GeminiModelsModule): string {
    if (modelId === modelsModule.PREVIEW_GEMINI_MODEL_AUTO) {
      return "Auto Gemini 3";
    }

    if (modelId === modelsModule.DEFAULT_GEMINI_MODEL_AUTO) {
      return "Auto Gemini 2.5";
    }

    return modelId
      .split("-")
      .map((segment) => {
        if (/^\d+(\.\d+)?$/.test(segment)) {
          return segment;
        }

        if (segment.length <= 3) {
          return segment.toUpperCase();
        }

        return `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`;
      })
      .join(" ");
  }

  private async importManagedGeminiModelsModule(): Promise<GeminiModelsModule> {
    const modulePath = this.getGeminiModelsModulePath();
    return dynamicImport(pathToFileURL(modulePath).href) as Promise<GeminiModelsModule>;
  }

  private async importManagedGeminiAcpModule(): Promise<{
    PROTOCOL_VERSION: number;
    ndJsonStream: (output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>) => unknown;
    ClientSideConnection: new (toClient: () => object, stream: unknown) => {
      initialize(params: Record<string, unknown>): Promise<unknown>;
      newSession(params: Record<string, unknown>): Promise<unknown>;
    };
  }> {
    const modulePath = path.join(
      this.getInstallDirectory("gemini"),
      "node_modules",
      "@agentclientprotocol",
      "sdk",
      "dist",
      "acp.js"
    );

    const imported = await dynamicImport(pathToFileURL(modulePath).href) as {
      PROTOCOL_VERSION: number;
      ndJsonStream: (output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>) => unknown;
      ClientSideConnection: new (toClient: () => object, stream: unknown) => {
        initialize(params: Record<string, unknown>): Promise<unknown>;
        newSession(params: Record<string, unknown>): Promise<unknown>;
      };
    };

    return imported;
  }

  private buildManagedCommandEnv(toolId: ManagedToolId, commandEnv: Record<string, string>): Record<string, string> {
    const inheritedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        inheritedEnv[key] = value;
      }
    }

    return {
      ...inheritedEnv,
      ...this.buildManagedExecutionEnvironment(toolId),
      ...commandEnv
    };
  }

  private decorateDiscoveryError(toolName: string, error: Error, stderrBuffer: string): Error {
    const stderrPreview = stderrBuffer.trim();
    const suffix = stderrPreview.length > 0
      ? `\n${stderrPreview.slice(-4_000)}`
      : "";
    return new Error(`Failed to discover ${toolName} models from the live CLI: ${error.message}${suffix}`);
  }

  private async stopChildProcess(child: ReturnType<typeof spawn>): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    child.kill("SIGTERM");
    try {
      await this.waitForExit(child, 1_000);
    } catch {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await this.waitForExit(child, 1_000).catch(() => undefined);
      }
    }
  }

  private waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while waiting for a child process to exit"));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        child.off("error", onError);
        child.off("exit", onExit);
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onExit = () => {
        cleanup();
        resolve();
      };

      child.once("error", onError);
      child.once("exit", onExit);
    });
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

  private async installLatest(toolId: ManagedToolId): Promise<ManagedToolStatus> {
    const inFlight = this.installPromises.get(toolId);
    if (inFlight) return inFlight;

    const installPromise = this.installLatestInternal(toolId);
    this.installPromises.set(toolId, installPromise);

    try {
      return await installPromise;
    } finally {
      this.installPromises.delete(toolId);
    }
  }

  private async installLatestInternal(toolId: ManagedToolId): Promise<ManagedToolStatus> {
    this.modelCatalogPromises.clear();
    const definition = TOOL_DEFINITIONS[toolId];
    const installDirectory = this.getInstallDirectory(toolId);
    fs.mkdirSync(installDirectory, { recursive: true });
    this.writeInstallerManifest(toolId);

    const npmCommand = this.resolveNpmCommand();
    const npmArgs = [
      ...npmCommand.args,
      "install",
      "--no-save",
      "--no-package-lock",
      "--omit=dev",
      "--prefix",
      installDirectory,
      `${definition.packageName}@latest`
    ];

    await this.runCommand(npmCommand.command, npmArgs, npmCommand.env);

    const status = await this.getStatus(toolId);
    if (!status.installed) {
      throw new Error(`${definition.displayName} install completed without producing an executable package`);
    }

    this.ensureShim(toolId);
    return status;
  }

  private ensureBaseDirectories() {
    fs.mkdirSync(this.installRoot, { recursive: true });
    fs.mkdirSync(this.binDirectory, { recursive: true });
    fs.mkdirSync(this.homeDirectory, { recursive: true });
    fs.mkdirSync(this.runtimeDirectory, { recursive: true });
    fs.mkdirSync(path.join(this.runtimeDirectory, "npm-cache"), { recursive: true });
    fs.mkdirSync(path.join(this.homeDirectory, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(this.homeDirectory, ".gemini"), { recursive: true });
    this.ensureBrowserHelpers();
  }

  private ensureBrowserHelpers() {
    const helperPath = path.join(this.binDirectory, "tasksaw-browser-open.js");
    const helperScript = [
      "#!/usr/bin/env node",
      'import http from "node:http";',
      'import https from "node:https";',
      'import { spawn } from "node:child_process";',
      'import process from "node:process";',
      'import { URL } from "node:url";',
      "",
      "const mode = process.argv[2] ?? \"browser-open\";",
      "const args = process.argv.slice(3);",
      "",
      "function findTargetUrl(values) {",
      "  return values.find((value) => /^https?:\\/\\//i.test(value));",
      "}",
      "",
      "function postToBridge(targetUrl) {",
      "  const bridgeUrl = process.env.TASKSAW_BROWSER_BRIDGE_URL;",
      "  const bridgeToken = process.env.TASKSAW_BROWSER_BRIDGE_TOKEN;",
      "",
      "  if (!bridgeUrl || !bridgeToken) {",
      "    return Promise.reject(new Error(\"TaskSaw browser bridge is unavailable\"));",
      "  }",
      "",
      "  const endpoint = new URL(bridgeUrl);",
      "  const body = JSON.stringify({ url: targetUrl });",
      "  const client = endpoint.protocol === \"https:\" ? https : http;",
      "",
      "  return new Promise((resolve, reject) => {",
      "    const request = client.request(",
      "      endpoint,",
      "      {",
      "        method: \"POST\",",
      "        headers: {",
      "          \"content-type\": \"application/json\",",
      "          \"content-length\": Buffer.byteLength(body).toString(),",
      "          \"x-tasksaw-token\": bridgeToken",
      "        }",
      "      },",
      "      (response) => {",
      "        const chunks = [];",
      "        response.on(\"data\", (chunk) => chunks.push(chunk));",
      "        response.on(\"end\", () => {",
      "          if ((response.statusCode ?? 500) >= 400) {",
      "            reject(new Error(Buffer.concat(chunks).toString(\"utf8\") || `Bridge request failed with status ${response.statusCode}`));",
      "            return;",
      "          }",
      "",
      "          resolve();",
      "        });",
      "      }",
      "    );",
      "",
      "    request.on(\"error\", reject);",
      "    request.end(body);",
      "  });",
      "}",
      "",
      "function runFallback() {",
      "  const fallbackCommand = process.env.TASKSAW_BROWSER_FALLBACK;",
      "",
      "  if (!fallbackCommand) {",
      "    return Promise.reject(new Error(`TaskSaw ${mode} helper could not find a browser URL to open`));",
      "  }",
      "",
      "  return new Promise((resolve, reject) => {",
      "    const child = spawn(fallbackCommand, args, { stdio: \"inherit\" });",
      "    child.on(\"error\", reject);",
      "    child.on(\"exit\", (exitCode) => {",
      "      if ((exitCode ?? 1) !== 0) {",
      "        reject(new Error(`${fallbackCommand} exited with code ${exitCode ?? 1}`));",
      "        return;",
      "      }",
      "",
      "      resolve();",
      "    });",
      "  });",
      "}",
      "",
      "async function main() {",
      "  const targetUrl = findTargetUrl(args);",
      "",
      "  if (targetUrl) {",
      "    await postToBridge(targetUrl);",
      "    return;",
      "  }",
      "",
      "  await runFallback();",
      "}",
      "",
      "void main().catch((error) => {",
      "  const message = error instanceof Error ? error.message : String(error);",
      "  process.stderr.write(`${message}\\n`);",
      "  process.exit(1);",
      "});",
      ""
    ].join("\n");

    fs.writeFileSync(helperPath, helperScript);
    fs.chmodSync(helperPath, 0o755);

    this.writeBrowserWrapper("browser-open", helperPath);
    this.writeBrowserWrapper("open", helperPath, "/usr/bin/open");
    this.writeBrowserWrapper("xdg-open", helperPath, "/usr/bin/xdg-open");
  }

  private writeBrowserWrapper(wrapperName: string, helperPath: string, fallbackCommand?: string) {
    const wrapperPath = path.join(this.binDirectory, wrapperName);
    const nodeRuntime = this.resolveNodeRuntime();
    const wrapperLines = [
      "#!/bin/sh",
      "set -eu"
    ];

    if (fallbackCommand) {
      wrapperLines.push(`export TASKSAW_BROWSER_FALLBACK=${this.shQuote(fallbackCommand)}`);
    }

    for (const [key, value] of Object.entries(nodeRuntime.env)) {
      wrapperLines.push(`export ${key}=${this.shQuote(value)}`);
    }

    wrapperLines.push(
      `exec ${this.shQuote(nodeRuntime.command)} ${this.shQuote(helperPath)} ${this.shQuote(wrapperName)} "$@"`,
      ""
    );

    fs.writeFileSync(wrapperPath, wrapperLines.join("\n"));
    fs.chmodSync(wrapperPath, 0o755);
  }

  private getInstallDirectory(toolId: ManagedToolId): string {
    return path.join(this.installRoot, toolId);
  }

  private writeInstallerManifest(toolId: ManagedToolId) {
    const manifestPath = path.join(this.getInstallDirectory(toolId), "package.json");
    const manifest = {
      name: `tasksaw-managed-${toolId}`,
      private: true
    };

    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    this.ensureBaseDirectories();
    fs.mkdirSync(path.dirname(this.getInstalledPackageJsonPath(toolId)), { recursive: true });
    fs.mkdirSync(path.join(this.getInstallDirectory(toolId), "node_modules"), { recursive: true });
  }

  private readInstalledPackageJson(toolId: ManagedToolId): { version?: string; bin?: string | Record<string, string> } | null {
    const packageJsonPath = this.getInstalledPackageJsonPath(toolId);
    if (!fs.existsSync(packageJsonPath)) return null;

    try {
      return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
        version?: string;
        bin?: string | Record<string, string>;
      };
    } catch {
      return null;
    }
  }

  private getInstalledPackageJsonPath(toolId: ManagedToolId): string {
    const definition = TOOL_DEFINITIONS[toolId];
    return path.join(this.getInstallDirectory(toolId), "node_modules", ...definition.packageName.split("/"), "package.json");
  }

  private getInstalledStatus(toolId: ManagedToolId): ManagedToolStatus {
    const definition = TOOL_DEFINITIONS[toolId];
    const packageJson = this.readInstalledPackageJson(toolId);

    return {
      id: definition.id,
      displayName: definition.displayName,
      installed: packageJson !== null,
      version: packageJson?.version ?? null,
      usage: null
    };
  }

  private resolveInstalledEntryPoint(toolId: ManagedToolId): string | null {
    const definition = TOOL_DEFINITIONS[toolId];
    const packageJson = this.readInstalledPackageJson(toolId);
    if (!packageJson?.bin) return null;

    const relativeEntry = typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin[definition.executableName];

    if (!relativeEntry) return null;

    return path.resolve(path.dirname(this.getInstalledPackageJsonPath(toolId)), relativeEntry);
  }

  private resolveInstalledLaunchCommand(toolId: ManagedToolId): ResolvedCommand | null {
    const entryPoint = this.resolveInstalledEntryPoint(toolId);
    if (!entryPoint) {
      return null;
    }

    const nodeRuntime = this.resolveNodeRuntime();
    return {
      command: nodeRuntime.command,
      args: [entryPoint],
      env: nodeRuntime.env
    };
  }

  private ensureShim(toolId: ManagedToolId) {
    const entryPoint = this.resolveInstalledEntryPoint(toolId);
    if (!entryPoint) return;

    const definition = TOOL_DEFINITIONS[toolId];
    const shimPath = path.join(this.binDirectory, definition.executableName);
    const nodeRuntime = this.resolveNodeRuntime();
    const shimScript = [
      "#!/bin/sh",
      "set -eu",
      ...Object.entries(nodeRuntime.env).map(([key, value]) => `export ${key}=${this.shQuote(value)}`),
      `exec ${this.shQuote(nodeRuntime.command)} ${this.shQuote(entryPoint)} "$@"`,
      ""
    ].join("\n");

    fs.writeFileSync(shimPath, shimScript);
    fs.chmodSync(shimPath, 0o755);
  }

  private shQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }

  private resolveNpmCommand(): ResolvedCommand {
    if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
      const nodeRuntime = this.resolveNodeRuntime();
      return {
        command: nodeRuntime.command,
        args: [process.env.npm_execpath],
        env: nodeRuntime.env
      };
    }

    for (const candidate of [
      "npm",
      "/opt/homebrew/bin/npm",
      "/usr/local/bin/npm",
      "/usr/bin/npm"
    ]) {
      const executablePath = this.resolveExecutable(candidate);
      if (!executablePath) continue;
      return { command: executablePath, args: [], env: {} };
    }

    throw new Error("npm was not found. TaskSaw currently needs npm once to install its managed Codex/Gemini CLIs.");
  }

  private resolveExecutable(command: string): string | null {
    if (path.isAbsolute(command)) {
      return fs.existsSync(command) ? command : null;
    }

    const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);

    for (const pathEntry of pathEntries) {
      const candidate = path.join(pathEntry, command);
      if (fs.existsSync(candidate)) return candidate;
    }

    return null;
  }

  private resolveNodeRuntime(): NodeRuntime {
    const resolvedNodePath = this.resolvePreferredNodeExecutable();
    if (resolvedNodePath) {
      return {
        command: resolvedNodePath,
        env: {}
      };
    }

    return {
      command: process.execPath,
      env: {
        ELECTRON_RUN_AS_NODE: "1"
      }
    };
  }

  private resolvePreferredNodeExecutable(): string | null {
    for (const candidate of [process.env.npm_node_execpath, process.env.NODE]) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }

    if (this.isNodeExecutable(process.execPath)) {
      return process.execPath;
    }

    for (const candidate of [
      "node",
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node"
    ]) {
      const executablePath = this.resolveExecutable(candidate);
      if (executablePath) return executablePath;
    }

    return null;
  }

  private isNodeExecutable(executablePath: string): boolean {
    const executableName = path.basename(executablePath).toLowerCase();
    return executableName === "node" || executableName === "node.exe";
  }

  private async runCommand(command: string, args: string[], commandEnv: Record<string, string>): Promise<void> {
    const env: Record<string, string> = {
      ...process.env,
      HOME: this.homeDirectory,
      PATH: process.env.PATH ?? "",
      npm_config_audit: "false",
      npm_config_cache: path.join(this.runtimeDirectory, "npm-cache"),
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
      ...commandEnv
    };

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let output = "";
      const append = (chunk: Buffer | string) => {
        output += chunk.toString();
        if (output.length > 16000) {
          output = output.slice(output.length - 16000);
        }
      };

      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        const trimmedOutput = output.trim();
        const suffix = trimmedOutput.length > 0 ? `\n${trimmedOutput}` : "";
        reject(new Error(`Command failed with exit code ${code}:${suffix}`));
      });
    });
  }
}
