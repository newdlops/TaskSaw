import { execFile } from "node:child_process";
import { buildCliPrompt } from "./cli-prompt";
import { findUnresolvedSuccessSignal } from "./execution-guardrails";
import {
  AbstractPlanResult,
  ConcretePlanResult,
  ExecuteResult,
  GatherResult,
  ModelInvocationContext,
  OrchestratorCapability,
  OrchestratorModelAdapter,
  RehydrateResult,
  ReviewResult,
  VerifyResult
} from "./model-adapter";
import {
  ConfidenceLevel,
  EvidenceBundleDraft,
  ModelExecutionDebugInfo,
  ModelRef,
  OrchestratorChildTask,
  ProjectStructureReport
} from "./types";

type CliFlavor = "codex" | "gemini";

type CliModelAdapterOptions = {
  model: ModelRef;
  flavor: CliFlavor;
  executablePath: string;
  executableArgs?: string[];
  customInvoke?: (
    capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext
  ) => Promise<{
    stdout: string;
    stderr: string;
    command?: string[];
  }>;
  buildInvocationArgs?: (
    capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext
  ) => string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  supportedCapabilities: OrchestratorCapability[];
};

export class CliModelAdapter implements OrchestratorModelAdapter {
  readonly model: ModelRef;

  private readonly supportedCapabilities: Set<OrchestratorCapability>;
  private readonly flavor: CliFlavor;
  private readonly executablePath: string;
  private readonly executableArgs: string[];
  private readonly customInvoke?: (
    capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext
  ) => Promise<{
    stdout: string;
    stderr: string;
    command?: string[];
  }>;
  private readonly buildInvocationArgs?: (
    capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext
  ) => string[];
  private readonly env: Record<string, string>;
  private readonly cwd: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: CliModelAdapterOptions) {
    this.model = options.model;
    this.supportedCapabilities = new Set(options.supportedCapabilities);
    this.flavor = options.flavor;
    this.executablePath = options.executablePath;
    this.executableArgs = options.executableArgs ?? [];
    this.customInvoke = options.customInvoke;
    this.buildInvocationArgs = options.buildInvocationArgs;
    this.env = options.env ?? {};
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  supports(capability: OrchestratorCapability): boolean {
    return this.supportedCapabilities.has(capability);
  }

  async abstractPlan(context: ModelInvocationContext): Promise<AbstractPlanResult> {
    return this.invoke("abstractPlan", context);
  }

  async gather(context: ModelInvocationContext): Promise<GatherResult> {
    return this.invoke("gather", context);
  }

  async concretePlan(context: ModelInvocationContext): Promise<ConcretePlanResult> {
    return this.invoke("concretePlan", context);
  }

  async review(context: ModelInvocationContext): Promise<ReviewResult> {
    return this.invoke("review", context);
  }

  async execute(context: ModelInvocationContext): Promise<ExecuteResult> {
    return this.invoke("execute", context);
  }

  async verify(context: ModelInvocationContext): Promise<VerifyResult> {
    return this.invoke("verify", context);
  }

  async rehydrate(context: ModelInvocationContext): Promise<RehydrateResult> {
    return this.invoke("rehydrate", context);
  }

  private async invoke<TResult extends { debug?: ModelExecutionDebugInfo }>(
    capability: OrchestratorCapability,
    context: ModelInvocationContext
  ): Promise<TResult> {
    const prompt = buildCliPrompt(capability, context);
    let activePrompt = prompt;
    let stdout = "";
    let stderr = "";
    let command = [this.executablePath];
    let didRetryForJsonRepair = false;

    let parsed: TResult;
    while (true) {
      const result = await this.invokeRaw(capability, activePrompt, context);
      stdout = result.stdout;
      stderr = result.stderr;
      command = result.command;

      try {
        parsed = this.normalizeResult(capability, this.parseOutput(stdout)) as TResult;
        break;
      } catch (error) {
        if (!didRetryForJsonRepair && this.shouldRetryGeminiJsonRepair(error)) {
          didRetryForJsonRepair = true;
          context.reportProgress?.("Gemini returned non-JSON output; requesting a JSON-only repair", {
            capability,
            model: context.assignedModel.model
          });
          activePrompt = this.buildGeminiJsonRepairPrompt(capability, prompt, stdout);
          continue;
        }

        throw this.buildParseError(capability, error, stdout, stderr, command);
      }
    }

    parsed.debug = {
      executable: this.executablePath,
      command,
      prompt: activePrompt,
      rawStdout: stdout,
      rawStderr: stderr
    };
    return parsed;
  }

  private async invokeRaw(
    capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext
  ): Promise<{
    stdout: string;
    stderr: string;
    command: string[];
  }> {
    if (this.customInvoke) {
      const result = await this.customInvoke(capability, prompt, context);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        command: result.command ?? [this.executablePath]
      };
    }

    const { args, env } = this.buildCommand(capability, prompt, context);
    const command = [this.executablePath, ...args];
    const result = await execFileWithSignal(this.executablePath, args, {
      cwd: this.cwd,
      env: {
        ...process.env,
        ...env
      },
      signal: context.abortSignal,
      timeout: this.timeoutMs,
      maxBuffer: 1024 * 1024 * 8
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      command
    };
  }

  private buildParseError(
    capability: OrchestratorCapability,
    error: unknown,
    stdout: string,
    stderr: string,
    command: string[]
  ): Error {
    const message = error instanceof Error ? error.message : String(error);
    const stdoutPreview = stdout.trim().slice(0, 4_000);
    const stderrPreview = stderr.trim().slice(0, 2_000);
    const outputSummary = stdoutPreview.length > 0
      ? `stdout preview:\n${stdoutPreview}`
      : "stdout preview:\n<empty>";
    return new Error(
      [
        `Failed to parse ${this.flavor} output for ${capability}: ${message}`,
        `command:\n${command.join(" ")}`,
        outputSummary,
        stderrPreview.length > 0 ? `stderr preview:\n${stderrPreview}` : null
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  }

  private shouldRetryGeminiJsonRepair(error: unknown): boolean {
    if (this.flavor !== "gemini") {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error);
    return message.includes("No valid JSON object was found in CLI output")
      || message.includes("Gemini CLI exited without writing any JSON to stdout");
  }

  private buildGeminiJsonRepairPrompt(
    capability: OrchestratorCapability,
    originalPrompt: string,
    invalidOutput: string
  ): string {
    return [
      "Your previous response for this TaskSaw turn was invalid because it was not a single JSON object.",
      "Return exactly one JSON object and nothing else.",
      "Do not wrap the JSON in markdown fences.",
      "Do not explain the JSON before or after the object.",
      "Do not call tools or edit files. This is a formatting repair only.",
      `Capability: ${capability}`,
      "Use the same schema and instructions from the original prompt below.",
      "Original prompt:",
      originalPrompt,
      "Previous invalid output:",
      invalidOutput.trim().slice(0, 6_000)
    ].join("\n\n");
  }

  private buildCommand(
    capability: OrchestratorCapability,
    prompt: string,
    context: ModelInvocationContext
  ): { args: string[]; env: Record<string, string> } {
    if (this.buildInvocationArgs) {
      return {
        args: this.buildInvocationArgs(capability, prompt, context),
        env: this.env
      };
    }

    if (this.flavor === "codex") {
      return {
        args: [...this.executableArgs, "exec", "--json", "--skip-git-repo-check", prompt],
        env: this.env
      };
    }

    return {
      args: [...this.executableArgs, "-p", prompt, "-o", "json"],
      env: this.env
    };
  }

  private parseOutput(stdout: string): unknown {
    if (this.flavor === "codex") {
      return this.parseCodexOutput(stdout);
    }

    return this.parseGeminiOutput(stdout);
  }

  private parseCodexOutput(stdout: string): unknown {
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      try {
        const parsed = JSON.parse(line) as {
          type?: string;
          content?: string | Record<string, unknown>;
          item?: {
            type?: string;
            text?: string;
            content?: string | Record<string, unknown>;
          };
          result?: unknown;
        };

        if (parsed.type?.includes("assistant") && parsed.content) {
          return typeof parsed.content === "string"
            ? this.parseJsonLikePayload(parsed.content)
            : parsed.content;
        }

        if (parsed.item?.type?.includes("message")) {
          if (typeof parsed.item.text === "string" && parsed.item.text.trim().length > 0) {
            return this.parseJsonLikePayload(parsed.item.text);
          }

          if (parsed.item.content) {
            return typeof parsed.item.content === "string"
              ? this.parseJsonLikePayload(parsed.item.content)
              : parsed.item.content;
          }
        }

        if (parsed.result) {
          return parsed.result;
        }
      } catch {
        // Ignore malformed JSONL lines and continue scanning backwards.
      }
    }

    return this.parseJsonLikePayload(stdout);
  }

  private parseGeminiOutput(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
      throw new Error("Gemini CLI exited without writing any JSON to stdout");
    }

    return this.unwrapGeminiPayload(this.parseJsonLikePayload(trimmed));
  }

  private parseJsonLikePayload(rawText: string): unknown {
    const direct = this.tryParseJson(rawText.trim());
    if (direct !== null) return direct;

    const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      const fenced = this.tryParseJson(fencedMatch[1].trim());
      if (fenced !== null) return fenced;
    }

    const embeddedJson = this.extractEmbeddedJson(rawText);
    if (embeddedJson) {
      const embedded = this.tryParseJson(embeddedJson);
      if (embedded !== null) return embedded;
    }

    throw new Error("No valid JSON object was found in CLI output");
  }

  private unwrapGeminiPayload(payload: unknown): unknown {
    const record = this.asRecord(payload);
    if (Object.keys(record).length === 0) {
      return payload;
    }

    const errorRecord = this.asOptionalRecord(record.error);
    if (errorRecord) {
      const errorMessage = this.readString(errorRecord.message, "Gemini CLI returned an unknown error");
      throw new Error(errorMessage);
    }

    const response = record.response;
    if (typeof response === "string") {
      const parsedResponse = this.parseJsonLikePayload(response);
      return parsedResponse;
    }

    if (response && typeof response === "object") {
      return response;
    }

    return payload;
  }

  private tryParseJson(value: string): unknown | null {
    if (!value) return null;

    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private extractEmbeddedJson(rawText: string): string | null {
    const objectIndex = rawText.indexOf("{");
    const arrayIndex = rawText.indexOf("[");

    let startIndex = -1;
    if (objectIndex === -1) {
      startIndex = arrayIndex;
    } else if (arrayIndex === -1) {
      startIndex = objectIndex;
    } else {
      startIndex = Math.min(objectIndex, arrayIndex);
    }

    if (startIndex === -1) return null;

    const openingChar = rawText[startIndex];
    const closingChar = openingChar === "[" ? "]" : "}";
    let depth = 0;
    let isEscaped = false;
    let inString = false;

    for (let index = startIndex; index < rawText.length; index += 1) {
      const character = rawText[index];

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
          continue;
        }

        if (character === "\\") {
          isEscaped = true;
          continue;
        }

        if (character === "\"") {
          inString = false;
        }

        continue;
      }

      if (character === "\"") {
        inString = true;
        continue;
      }

      if (character === openingChar) {
        depth += 1;
        continue;
      }

      if (character === closingChar) {
        depth -= 1;
        if (depth === 0) {
          return rawText.slice(startIndex, index + 1);
        }
      }
    }

    return null;
  }

  private normalizeResult(capability: OrchestratorCapability, payload: unknown): unknown {
    const record = this.asRecord(payload);

    switch (capability) {
      case "abstractPlan":
        return {
          summary: this.readString(record.summary, "No abstract plan summary returned"),
          targetsToInspect: this.normalizeStringArray(record.targetsToInspect ?? record.targets ?? record.filesToInspect),
          evidenceRequirements: this.normalizeStringArray(
            record.evidenceRequirements ?? record.questions ?? record.openQuestions
          )
        } satisfies AbstractPlanResult;

      case "gather":
        return {
          summary: this.readString(record.summary, "No gather summary returned"),
          evidenceBundles: this.normalizeEvidenceBundles(record),
          projectStructure: this.normalizeProjectStructure(
            record.projectStructure ?? record.structure ?? record.repositoryStructure
          )
        } satisfies GatherResult;

      case "concretePlan":
        return {
          summary: this.readString(record.summary, "No concrete plan summary returned"),
          childTasks: this.normalizeChildTasks(record.childTasks ?? record.steps),
          executionNotes: this.normalizeStringArray(record.executionNotes ?? record.notes),
          needsMorePlanning: this.readBoolean(
            record.needsMorePlanning ?? record.requiresMorePlanning ?? record.shouldDecompose ?? record.needsDecomposition,
            false
          ),
          needsAdditionalGather: this.readBoolean(
            record.needsAdditionalGather ?? record.requiresAdditionalGather ?? record.needsRefinedGather,
            false
          ),
          additionalGatherObjectives: this.normalizeStringArray(
            record.additionalGatherObjectives ?? record.followUpGatherObjectives ?? record.refinedGatherObjectives
          ),
          needsProjectStructureInspection: this.readBoolean(
            record.needsProjectStructureInspection ?? record.needsInspection,
            false
          ),
          inspectionObjectives: this.normalizeStringArray(
            record.inspectionObjectives ?? record.structureInspectionObjectives ?? record.followUpInspections
          ),
          projectStructureContradictions: this.normalizeStringArray(
            record.projectStructureContradictions ?? record.structureContradictions ?? record.contradictions
          )
        } satisfies ConcretePlanResult;

      case "review": {
        const followUpQuestions = this.normalizeStringArray(record.followUpQuestions ?? record.questions);
        return {
          summary: this.readString(record.summary, "No review summary returned"),
          approved: this.readBoolean(record.approved, followUpQuestions.length === 0),
          followUpQuestions,
          nextActions: this.normalizeReviewNextActions(record.nextActions ?? record.followUpTasks ?? record.nextSteps),
          carryForward: this.normalizeReviewCarryForward(record.carryForward ?? record.handoff ?? record.seedContext)
        } satisfies ReviewResult;
      }

      case "execute": {
        const summary = this.readString(record.summary, "No execution summary returned");
        const outputs = this.normalizeStringArray(record.outputs ?? record.results);
        const completed = this.inferExecuteCompleted(record, summary, outputs);
        const blockedReason = this.readOptionalString(record.blockedReason ?? record.failureReason ?? record.reason);
        return {
          summary,
          outputs: outputs.length > 0 ? outputs : (completed ? [summary] : []),
          completed,
          blockedReason
        } satisfies ExecuteResult;
      }

      case "verify": {
        const findings = this.normalizeStringArray(record.findings ?? record.issues);
        return {
          summary: this.readString(record.summary, "No verification summary returned"),
          passed: this.inferVerifyPassed(record, findings),
          findings
        } satisfies VerifyResult;
      }

      case "rehydrate":
        return {
          summary: this.readString(record.summary, "No rehydration summary returned"),
          evidenceBundles: this.normalizeEvidenceBundles(record)
        } satisfies RehydrateResult;

      default:
        return payload;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private readString(value: unknown, fallback: string): string {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    return fallback;
  }

  private readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
  }

  private readOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === "string" ? item.trim() : this.coerceString(item)))
        .filter((item): item is string => item.length > 0);
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? [trimmed] : [];
    }

    return [];
  }

  private normalizeChildTasks(value: unknown): OrchestratorChildTask[] {
    if (!Array.isArray(value)) return [];

    const childTasks: OrchestratorChildTask[] = [];

    for (const [index, item] of value.entries()) {
      if (typeof item === "string") {
        const title = item.trim();
        if (!title) continue;

        childTasks.push({
          title,
          objective: title
        });
        continue;
      }

      const record = this.asRecord(item);
      const title = this.readString(record.title ?? record.name, `Child Task ${index + 1}`);
      const objective = this.readString(record.objective ?? record.summary ?? record.description, title);

      childTasks.push({
        title,
        objective,
        importance: this.normalizeChildTaskImportance(record.importance ?? record.priority),
        assignedModels: this.asOptionalRecord(record.assignedModels) as OrchestratorChildTask["assignedModels"],
        reviewPolicy: this.normalizeReviewPolicy(record.reviewPolicy),
        acceptanceCriteria: this.asOptionalRecord(record.acceptanceCriteria) as OrchestratorChildTask["acceptanceCriteria"],
        executionBudget: this.asOptionalRecord(record.executionBudget) as OrchestratorChildTask["executionBudget"]
      });
    }

    return childTasks;
  }

  private inferExecuteCompleted(record: Record<string, unknown>, summary: string, outputs: string[]): boolean {
    const explicitCompleted = typeof record.completed === "boolean"
      ? record.completed
      : typeof record.executed === "boolean"
        ? record.executed
        : undefined;

    if (findUnresolvedSuccessSignal([summary, ...outputs])) {
      return false;
    }

    return explicitCompleted ?? true;
  }

  private inferVerifyPassed(record: Record<string, unknown>, findings: string[]): boolean {
    const summary = this.readString(record.summary, "No verification summary returned");
    if (findUnresolvedSuccessSignal([summary, ...findings])) {
      return false;
    }

    return this.readBoolean(record.passed, findings.length === 0);
  }

  private normalizeEvidenceBundles(record: Record<string, unknown>): EvidenceBundleDraft[] {
    const rawBundles = Array.isArray(record.evidenceBundles)
      ? record.evidenceBundles
      : this.looksLikeEvidenceBundle(record)
        ? [record]
        : [];

    return rawBundles
      .map((bundle, index) => {
        const bundleRecord = this.asRecord(bundle);
        return {
          id: this.readString(bundleRecord.id, `bundle-${index + 1}`),
          summary: this.readString(bundleRecord.summary, "Collected evidence"),
          facts: (Array.isArray(bundleRecord.facts) ? bundleRecord.facts : []) as EvidenceBundleDraft["facts"],
          hypotheses: (Array.isArray(bundleRecord.hypotheses)
            ? bundleRecord.hypotheses
            : []) as EvidenceBundleDraft["hypotheses"],
          unknowns: (Array.isArray(bundleRecord.unknowns)
            ? bundleRecord.unknowns
            : []) as EvidenceBundleDraft["unknowns"],
          relevantTargets: (Array.isArray(bundleRecord.relevantTargets)
            ? bundleRecord.relevantTargets
            : []) as EvidenceBundleDraft["relevantTargets"],
          snippets: (Array.isArray(bundleRecord.snippets)
            ? bundleRecord.snippets
            : []) as EvidenceBundleDraft["snippets"],
          references: (Array.isArray(bundleRecord.references)
            ? bundleRecord.references
            : []) as EvidenceBundleDraft["references"],
          confidence: this.normalizeConfidence(bundleRecord.confidence)
        } satisfies EvidenceBundleDraft;
      });
  }

  private normalizeProjectStructure(value: unknown): ProjectStructureReport | undefined {
    const record = this.asOptionalRecord(value);
    if (!record) {
      return undefined;
    }

    return {
      summary: this.readString(record.summary ?? record.overview, "Project structure gathered"),
      directories: this.normalizePathReports(record.directories ?? record.folders),
      keyFiles: this.normalizePathReports(record.keyFiles ?? record.files),
      entryPoints: this.normalizeEntryPointReports(record.entryPoints ?? record.entrypoints),
      modules: this.normalizeModuleReports(record.modules ?? record.components),
      openQuestions: this.normalizeStringArray(record.openQuestions ?? record.questions),
      contradictions: this.normalizeStringArray(record.contradictions ?? record.conflicts)
    };
  }

  private looksLikeEvidenceBundle(record: Record<string, unknown>): boolean {
    return "facts" in record
      || "hypotheses" in record
      || "unknowns" in record
      || "relevantTargets" in record
      || "snippets" in record
      || "references" in record;
  }

  private coerceString(value: unknown): string {
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    return "";
  }

  private asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }

  private normalizeReviewPolicy(value: unknown): OrchestratorChildTask["reviewPolicy"] {
    if (value === "none" || value === "light" || value === "risk_based" || value === "mandatory") {
      return value;
    }

    return undefined;
  }

  private normalizeChildTaskImportance(value: unknown): OrchestratorChildTask["importance"] {
    if (value === "critical" || value === "high" || value === "medium" || value === "low") {
      return value;
    }

    return undefined;
  }

  private normalizeReviewNextActions(value: unknown): ReviewResult["nextActions"] {
    if (!Array.isArray(value)) {
      return [];
    }

    const nextActions: ReviewResult["nextActions"] = [];
    for (const item of value) {
      const record = this.asOptionalRecord(item);
      if (!record) {
        continue;
      }

      const title = this.readString(record.title ?? record.name, "");
      const objective = this.readString(record.objective ?? record.goal ?? record.description, "");
      if (!title || !objective) {
        continue;
      }

      nextActions.push({
        title,
        objective,
        rationale: this.readString(record.rationale ?? record.why ?? record.note, objective),
        priority: this.normalizeChildTaskImportance(record.priority ?? record.importance) ?? "medium"
      });
    }

    return nextActions;
  }

  private normalizeReviewCarryForward(value: unknown): ReviewResult["carryForward"] {
    const record = this.asOptionalRecord(value);
    if (!record) {
      return undefined;
    }

    const carryForward = {
      facts: this.normalizeStringArray(record.facts ?? record.factStatements),
      openQuestions: this.normalizeStringArray(record.openQuestions ?? record.questions),
      projectPaths: this.normalizeStringArray(record.projectPaths ?? record.paths),
      evidenceSummaries: this.normalizeStringArray(record.evidenceSummaries ?? record.evidence)
    } satisfies NonNullable<ReviewResult["carryForward"]>;

    return carryForward.facts.length > 0
      || carryForward.openQuestions.length > 0
      || carryForward.projectPaths.length > 0
      || carryForward.evidenceSummaries.length > 0
      ? carryForward
      : undefined;
  }

  private normalizeConfidence(value: unknown): ConfidenceLevel {
    if (value === "low" || value === "medium" || value === "high" || value === "mixed") {
      return value;
    }

    return "mixed";
  }

  private normalizePathReports(value: unknown): ProjectStructureReport["directories"] {
    if (!Array.isArray(value)) return [];

    const reports: ProjectStructureReport["directories"] = [];
    for (const item of value) {
      const record = this.asRecord(item);
      const path = this.readString(record.path ?? record.filePath, "");
      if (!path) continue;
      reports.push({
        path,
        summary: this.readString(record.summary ?? record.note ?? record.description, path),
        confidence: this.normalizeConfidence(record.confidence),
        referenceIds: this.normalizeStringArray(record.referenceIds)
      });
    }

    return reports;
  }

  private normalizeEntryPointReports(value: unknown): ProjectStructureReport["entryPoints"] {
    if (!Array.isArray(value)) return [];

    const reports: ProjectStructureReport["entryPoints"] = [];
    for (const item of value) {
      const record = this.asRecord(item);
      const path = this.readString(record.path ?? record.filePath, "");
      if (!path) continue;
      reports.push({
        path,
        role: this.readString(record.role ?? record.kind, "entrypoint"),
        summary: this.readString(record.summary ?? record.note ?? record.description, path),
        confidence: this.normalizeConfidence(record.confidence),
        referenceIds: this.normalizeStringArray(record.referenceIds)
      });
    }

    return reports;
  }

  private normalizeModuleReports(value: unknown): ProjectStructureReport["modules"] {
    if (!Array.isArray(value)) return [];

    const reports: ProjectStructureReport["modules"] = [];
    for (const item of value) {
      const record = this.asRecord(item);
      const name = this.readString(record.name ?? record.title, "");
      if (!name) continue;
      reports.push({
        name,
        summary: this.readString(record.summary ?? record.note ?? record.description, name),
        relatedPaths: this.normalizeStringArray(record.relatedPaths ?? record.paths),
        confidence: this.normalizeConfidence(record.confidence),
        referenceIds: this.normalizeStringArray(record.referenceIds)
      });
    }

    return reports;
  }
}

function execFileWithSignal(
  executablePath: string,
  args: string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    signal: AbortSignal;
    timeout: number;
    maxBuffer: number;
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(executablePath, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        stdout,
        stderr
      });
    });

    if (options.signal.aborted) {
      child.kill("SIGTERM");
    }
  });
}
