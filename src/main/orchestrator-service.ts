import fs from "node:fs";
import path from "node:path";
import {
  CliModelAdapter,
  ContinuationSeed,
  createGeminiAcpInvoker,
  ModelAssignment,
  ModelAdapterRegistry,
  ModelRef,
  OrchestratorCapability,
  OrchestratorEvent,
  OrchestratorPersistence,
  OrchestratorRuntime,
  RunSnapshot
} from "../orchestrator";
import { ToolManager } from "./tool-manager";
import {
  ManagedToolId,
  ManagedToolModelCatalog,
  OrchestratorMode,
  OrchestratorRunSummary,
  RunOrchestratorInput
} from "./types";

const ORCHESTRATOR_CAPABILITIES: OrchestratorCapability[] = [
  "abstractPlan",
  "gather",
  "concretePlan",
  "review",
  "execute",
  "verify"
];

const ORCHESTRATOR_MODE_CONFIG: Record<
  OrchestratorMode,
  {
    title: string;
    requiredTools: ManagedToolId[];
    acceptanceCriterionId: string;
    acceptanceCriterionDescription: string;
  }
> = {
  gemini_only: {
    title: "Gemini Orchestrator Run",
    requiredTools: ["gemini"],
    acceptanceCriterionId: "gemini-run-completed",
    acceptanceCriterionDescription: "The Gemini-only orchestration completes successfully"
  },
  codex_only: {
    title: "Codex Orchestrator Run",
    requiredTools: ["codex"],
    acceptanceCriterionId: "codex-run-completed",
    acceptanceCriterionDescription: "The Codex-only orchestration completes successfully"
  },
  cross_review: {
    title: "Cross-Review Orchestrator Run",
    requiredTools: ["codex", "gemini"],
    acceptanceCriterionId: "cross-review-run-completed",
    acceptanceCriterionDescription: "The Gemini and Codex cross-review orchestration completes successfully"
  }
};

type ResolvedModeConfig = {
  title: string;
  assignedModels: ModelAssignment;
  toolModels: Partial<Record<ManagedToolId, ModelRef[]>>;
  acceptanceCriterionId: string;
  acceptanceCriterionDescription: string;
};

export class OrchestratorService {
  private readonly runsRootDirectory: string;
  private readonly persistence: OrchestratorPersistence;
  private readonly activeRuns = new Map<string, OrchestratorRuntime>();

  constructor(
    private readonly appRootPath: string,
    private readonly userDataDirectory: string,
    private readonly toolManager: ToolManager
  ) {
    this.runsRootDirectory = path.join(this.userDataDirectory, "orchestrator-runs");
    this.persistence = new OrchestratorPersistence(this.runsRootDirectory);
  }

  async runOrchestrator(
    input: RunOrchestratorInput,
    onEvent?: (event: OrchestratorEvent) => void
  ): Promise<RunSnapshot> {
    const workspacePath = input.workspacePath?.trim();
    if (!workspacePath) {
      throw new Error("A workspace path is required to run the orchestrator");
    }

    const modeConfig = await this.resolveModeConfig(input.mode, workspacePath);
    const continuation = this.loadContinuationSeed(input.continueFromRunId);
    let activeRunId: string | null = null;
    const runtime = new OrchestratorRuntime(await this.createRegistry(workspacePath, modeConfig.toolModels), {
      persistence: this.persistence,
      onEvent: (event) => {
        if (!activeRunId) {
          activeRunId = event.runId;
          this.activeRuns.set(activeRunId, runtime);
        }

        onEvent?.(event);
      }
    });

    try {
      const result = await runtime.executeScheduledRun({
        goal: input.goal,
        title: modeConfig.title,
        objective: input.goal,
        reviewPolicy: "light",
        continuation,
        assignedModels: modeConfig.assignedModels,
        acceptanceCriteria: {
          items: [
            {
              id: modeConfig.acceptanceCriterionId,
              description: modeConfig.acceptanceCriterionDescription,
              required: true,
              status: "pending"
            }
          ]
        }
      });

      return result.snapshot;
    } finally {
      if (activeRunId) {
        this.activeRuns.delete(activeRunId);
      }
    }
  }

  cancelRun(runId: string): boolean {
    const runtime = this.activeRuns.get(runId);
    if (!runtime) {
      return false;
    }

    runtime.cancel("Orchestrator run cancelled by user");
    return true;
  }
  listRuns(): OrchestratorRunSummary[] {
    if (!fs.existsSync(this.runsRootDirectory)) return [];

    const summaries: OrchestratorRunSummary[] = [];
    for (const entry of fs.readdirSync(this.runsRootDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      try {
        const snapshot = this.persistence.loadSnapshot(entry.name);
        summaries.push({
          id: snapshot.run.id,
          goal: snapshot.run.goal,
          status: snapshot.run.status,
          createdAt: snapshot.run.createdAt,
          updatedAt: snapshot.run.updatedAt,
          completedAt: snapshot.run.completedAt,
          finalSummary: snapshot.finalReport?.summary ?? null
        });
      } catch {
        // Ignore corrupt or partial run directories.
      }
    }

    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getRun(runId: string): RunSnapshot {
    return this.persistence.loadSnapshot(runId);
  }

  resetAllRuns() {
    fs.rmSync(this.runsRootDirectory, { recursive: true, force: true });
    fs.mkdirSync(this.runsRootDirectory, { recursive: true });
  }

  getRequiredTools(mode: OrchestratorMode): ManagedToolId[] {
    return [...ORCHESTRATOR_MODE_CONFIG[mode].requiredTools];
  }

  private loadContinuationSeed(runId: string | null | undefined): ContinuationSeed | undefined {
    const trimmedRunId = runId?.trim();
    if (!trimmedRunId) {
      return undefined;
    }

    const snapshot = this.persistence.loadSnapshot(trimmedRunId);
    return {
      sourceRunId: snapshot.run.id,
      evidenceBundles: snapshot.evidenceBundles,
      workingMemory: snapshot.workingMemory,
      projectStructure: snapshot.projectStructure
    };
  }

  private async resolveModeConfig(mode: OrchestratorMode, workspacePath: string): Promise<ResolvedModeConfig> {
    const baseConfig = ORCHESTRATOR_MODE_CONFIG[mode];
    await Promise.all(
      this.getRequiredTools(mode).map((toolId) => this.toolManager.prepareWorkspaceContext(toolId, workspacePath))
    );
    const discoveredCatalogs = await Promise.all(
      baseConfig.requiredTools.map((toolId) => this.toolManager.discoverModelCatalog(toolId, workspacePath))
    );
    const catalogsByTool = new Map(discoveredCatalogs.map((catalog) => [catalog.toolId, catalog] as const));

    const codexPlanningModel = catalogsByTool.has("codex")
      ? this.selectCodexPlanningModel(catalogsByTool.get("codex")!)
      : undefined;
    const codexWorkerModel = catalogsByTool.has("codex")
      ? this.selectCodexWorkerModel(catalogsByTool.get("codex")!, codexPlanningModel)
      : undefined;
    const geminiPlanningModel = catalogsByTool.has("gemini")
      ? this.selectGeminiPlanningModel(catalogsByTool.get("gemini")!)
      : undefined;
    const geminiWorkerModel = catalogsByTool.has("gemini")
      ? this.selectGeminiWorkerModel(catalogsByTool.get("gemini")!, geminiPlanningModel)
      : undefined;

    if (mode === "gemini_only") {
      if (!geminiPlanningModel) {
        throw new Error("Gemini mode requires a discovered Gemini model");
      }
      const workerModel = geminiWorkerModel ?? geminiPlanningModel;

      return {
        title: baseConfig.title,
        assignedModels: {
          abstractPlanner: geminiPlanningModel,
          gatherer: workerModel,
          concretePlanner: geminiPlanningModel,
          reviewer: geminiPlanningModel,
          executor: workerModel,
          verifier: geminiPlanningModel
        },
        toolModels: {
          gemini: this.uniqueModels([geminiPlanningModel, workerModel])
        },
        acceptanceCriterionId: baseConfig.acceptanceCriterionId,
        acceptanceCriterionDescription: baseConfig.acceptanceCriterionDescription
      };
    }

    if (mode === "codex_only") {
      if (!codexPlanningModel) {
        throw new Error("Codex mode requires a discovered Codex model");
      }
      const workerModel = codexWorkerModel ?? codexPlanningModel;

      return {
        title: baseConfig.title,
        assignedModels: {
          abstractPlanner: codexPlanningModel,
          gatherer: workerModel,
          concretePlanner: codexPlanningModel,
          reviewer: codexPlanningModel,
          executor: workerModel,
          verifier: codexPlanningModel
        },
        toolModels: {
          codex: this.uniqueModels([codexPlanningModel, workerModel])
        },
        acceptanceCriterionId: baseConfig.acceptanceCriterionId,
        acceptanceCriterionDescription: baseConfig.acceptanceCriterionDescription
      };
    }

    if (!codexPlanningModel || !geminiPlanningModel) {
      throw new Error("Cross-review mode requires discovered Codex and Gemini models");
    }
    const geminiWorker = geminiWorkerModel ?? geminiPlanningModel;
    const codexWorker = codexWorkerModel ?? codexPlanningModel;

    return {
      title: baseConfig.title,
      assignedModels: {
        abstractPlanner: codexPlanningModel,
        gatherer: geminiWorker,
        concretePlanner: codexPlanningModel,
        reviewer: geminiPlanningModel,
        executor: codexWorker,
        verifier: codexPlanningModel
      },
      toolModels: {
        codex: this.uniqueModels([codexPlanningModel, codexWorker]),
        gemini: this.uniqueModels([geminiPlanningModel, geminiWorker])
      },
      acceptanceCriterionId: baseConfig.acceptanceCriterionId,
      acceptanceCriterionDescription: baseConfig.acceptanceCriterionDescription
    };
  }

  private selectCodexPlanningModel(catalog: ManagedToolModelCatalog): ModelRef {
    const selectedModel = this.pickBestModel(catalog, (model) => this.scoreCodexPlanningModel(model));
    if (!selectedModel) {
      throw new Error("Codex CLI did not report any available models");
    }

    return this.toModelRef("OpenAI", selectedModel, "upper");
  }

  private selectCodexWorkerModel(catalog: ManagedToolModelCatalog, planningModel: ModelRef | undefined): ModelRef | undefined {
    const selectedModel = catalog.models.find((model) => model.isDefault && !model.hidden)
      ?? catalog.models.find((model) => model.isDefault)
      ?? this.pickBestModel(catalog, (model) => this.scoreCodexWorkerModel(model));

    if (!selectedModel) {
      return planningModel;
    }

    return this.toModelRef("OpenAI", selectedModel, "lower");
  }

  private selectGeminiPlanningModel(catalog: ManagedToolModelCatalog): ModelRef {
    const selectedModel = this.pickBestModel(catalog, (model) => this.scoreGeminiPlanningModel(model, catalog.currentModelId));
    if (!selectedModel) {
      throw new Error("Gemini CLI did not report any available models");
    }

    return this.toModelRef("Google", selectedModel, "upper");
  }

  private selectGeminiWorkerModel(catalog: ManagedToolModelCatalog, planningModel: ModelRef | undefined): ModelRef | undefined {
    const currentStableConcreteModel = catalog.models.find(
      (model) => model.id === catalog.currentModelId && this.isStableGeminiModel(model.model)
    );
    const preferredStableConcreteModel = catalog.models.find((model) => this.isStableGeminiModel(model.model));
    const currentConcreteModel = catalog.models.find(
      (model) => model.id === catalog.currentModelId && this.isConcreteGeminiModel(model.model)
    );
    const preferredConcreteModel = catalog.models.find((model) => this.isConcreteGeminiModel(model.model));
    const currentModel = catalog.models.find((model) => model.id === catalog.currentModelId);
    const selectedModel = currentStableConcreteModel
      ?? preferredStableConcreteModel
      ?? currentConcreteModel
      ?? preferredConcreteModel
      ?? currentModel
      ?? catalog.models[0];

    if (!selectedModel) {
      return planningModel;
    }

    return this.toModelRef("Google", selectedModel, "lower");
  }

  private isStableGeminiModel(model: string): boolean {
    return this.isConcreteGeminiModel(model) && !model.includes("preview") && !model.includes("exp");
  }

  private isConcreteGeminiModel(model: string): boolean {
    return model.startsWith("gemini-") && !model.startsWith("auto-") && !model.includes("customtools");
  }

  private normalizeReasoningEffort(value: string | null | undefined): ModelRef["reasoningEffort"] {
    if (value === "low" || value === "medium" || value === "high" || value === "xhigh") {
      return value;
    }

    return undefined;
  }

  private async createRegistry(
    workspacePath: string,
    toolModels: Partial<Record<ManagedToolId, ModelRef[]>>
  ): Promise<ModelAdapterRegistry> {
    const registry = new ModelAdapterRegistry();
    const cliRunnerPath = path.join(this.appRootPath, "dist", "main", "node-cli-runner.js");
    const codexModels = toolModels.codex ?? [];
    const geminiModels = toolModels.gemini ?? [];

    if (codexModels.length > 0) {
      await this.toolManager.prepareWorkspaceContext("codex", workspacePath);
      const codexCommand = await this.toolManager.resolveLaunchCommand("codex");
      const codexEntryPath = this.requireManagedEntryPath(codexCommand.args, "codex");
      const codexEnv = this.toolManager.buildManagedExecutionEnvironment("codex");
      const codexConfigArgs = this.toolManager.getCodexWorkspaceConfigArgs(workspacePath);

      for (const codexModel of this.uniqueModels(codexModels)) {
        registry.register(
          new CliModelAdapter({
            model: codexModel,
            flavor: "codex",
            executablePath: codexCommand.command,
            cwd: workspacePath,
            env: {
              ...codexEnv,
              ...codexCommand.env
            },
            buildInvocationArgs: (capability, prompt, context) => [
              cliRunnerPath,
              codexEntryPath,
              ...codexConfigArgs,
              "exec",
              "--json",
              "--skip-git-repo-check",
              "--ephemeral",
              "-C",
              workspacePath,
              "-s",
              capability === "execute" ? "workspace-write" : "read-only",
              "-m",
              context.assignedModel.model,
              prompt
            ],
            supportedCapabilities: ORCHESTRATOR_CAPABILITIES
          })
        );
      }
    }

    if (geminiModels.length > 0) {
      await this.toolManager.prepareWorkspaceContext("gemini", workspacePath);
      const geminiCommand = await this.toolManager.resolveLaunchCommand("gemini");
      const geminiEnv = this.toolManager.buildManagedExecutionEnvironment("gemini");
      const geminiAcpModulePath = this.toolManager.getGeminiAcpModulePath();

      for (const geminiModel of this.uniqueModels(geminiModels)) {
        registry.register(
          new CliModelAdapter({
            model: geminiModel,
            flavor: "gemini",
            executablePath: geminiCommand.command,
            cwd: workspacePath,
            env: {
              ...geminiEnv,
              ...geminiCommand.env
            },
            customInvoke: createGeminiAcpInvoker({
              executablePath: geminiCommand.command,
              executableArgs: [cliRunnerPath, ...geminiCommand.args],
              acpModulePath: geminiAcpModulePath,
              cwd: workspacePath,
              env: {
                ...geminiEnv,
                ...geminiCommand.env
              }
            }),
            supportedCapabilities: ORCHESTRATOR_CAPABILITIES
          })
        );
      }
    }

    return registry;
  }

  private pickBestModel(
    catalog: ManagedToolModelCatalog,
    score: (model: ManagedToolModelCatalog["models"][number]) => number
  ): ManagedToolModelCatalog["models"][number] | undefined {
    return [...catalog.models]
      .sort((left, right) => score(right) - score(left))
      .find((model) => !model.hidden)
      ?? [...catalog.models].sort((left, right) => score(right) - score(left))[0];
  }

  private scoreCodexPlanningModel(model: ManagedToolModelCatalog["models"][number]): number {
    return (this.isMiniModel(model.model) ? -20_000 : 0)
      + (model.model.includes("codex") ? 3_000 : 0)
      + (model.hidden ? -10_000 : 0)
      + (model.isDefault ? 250 : 0)
      + (this.scoreReasoningCapability(model) * 100)
      + (this.scoreVersion(model.model, "gpt-") * 10);
  }

  private scoreCodexWorkerModel(model: ManagedToolModelCatalog["models"][number]): number {
    return (model.isDefault ? 200 : 0)
      + (model.hidden ? -1_000 : 0)
      + (this.isMiniModel(model.model) ? 20 : 0)
      + this.scoreVersion(model.model, "gpt-");
  }

  private scoreGeminiPlanningModel(
    model: ManagedToolModelCatalog["models"][number],
    currentModelId: string | null
  ): number {
    const normalizedModelName = model.model.toLowerCase();
    const familyScore = normalizedModelName.includes("ultra")
      ? 25_000
      : normalizedModelName.includes("pro")
        ? 20_000
        : normalizedModelName.includes("flash")
          ? 5_000
          : 10_000;

    return (this.isConcreteGeminiModel(model.model) ? 0 : -50_000)
      + familyScore
      + (normalizedModelName.includes("preview") ? 250 : 0)
      + (normalizedModelName.includes("exp") ? -250 : 0)
      + (model.id === currentModelId ? 50 : 0)
      + (model.hidden ? -10_000 : 0)
      + (this.scoreVersion(model.model, "gemini-") * 10);
  }

  private scoreReasoningCapability(model: ManagedToolModelCatalog["models"][number]): number {
    if (model.supportedReasoningEfforts.includes("xhigh")) return 400;
    if (model.supportedReasoningEfforts.includes("high")) return 300;
    if (model.supportedReasoningEfforts.includes("medium")) return 200;
    if (model.supportedReasoningEfforts.includes("low")) return 100;

    const normalizedDefaultReasoning = this.normalizeReasoningEffort(model.defaultReasoningEffort);
    if (normalizedDefaultReasoning === "xhigh") return 350;
    if (normalizedDefaultReasoning === "high") return 250;
    if (normalizedDefaultReasoning === "medium") return 150;
    if (normalizedDefaultReasoning === "low") return 50;
    return 0;
  }

  private scoreVersion(model: string, prefix: string): number {
    const match = model.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)(?:\\.(\\d+))?`));
    if (!match) {
      return 0;
    }

    const major = Number.parseInt(match[1] ?? "0", 10);
    const minor = Number.parseInt(match[2] ?? "0", 10);
    return (major * 100) + minor;
  }

  private isMiniModel(model: string): boolean {
    return /\bmini\b/i.test(model) || /\bnano\b/i.test(model);
  }

  private toModelRef(
    provider: string,
    selectedModel: ManagedToolModelCatalog["models"][number],
    tier: ModelRef["tier"]
  ): ModelRef {
    return {
      id: selectedModel.id,
      provider,
      model: selectedModel.model,
      tier,
      reasoningEffort: selectedModel.supportedReasoningEfforts.includes("xhigh")
        ? "xhigh"
        : selectedModel.supportedReasoningEfforts.includes("high")
          ? "high"
          : this.normalizeReasoningEffort(selectedModel.defaultReasoningEffort)
    };
  }

  private uniqueModels(models: Array<ModelRef | undefined>): ModelRef[] {
    const seen = new Set<string>();
    const unique: ModelRef[] = [];

    for (const model of models) {
      if (!model || seen.has(model.id)) {
        continue;
      }

      seen.add(model.id);
      unique.push(model);
    }

    return unique;
  }

  private requireManagedEntryPath(args: string[], toolId: ManagedToolId): string {
    const entryPath = args[0];
    if (!entryPath) {
      throw new Error(`Managed ${toolId} launch command did not expose an entry path`);
    }

    return entryPath;
  }
}
