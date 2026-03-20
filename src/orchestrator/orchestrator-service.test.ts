import assert from "node:assert/strict";
import test from "node:test";
import { OrchestratorService } from "../main/orchestrator-service";
import { ManagedToolModelCatalog } from "../main/types";

function createCodexCatalog(overrides: Partial<ManagedToolModelCatalog> = {}): ManagedToolModelCatalog {
  return {
    toolId: "codex",
    provider: "OpenAI",
    currentModelId: "gpt-5.4-mini",
    recommendedPlannerModelId: "gpt-5.4",
    recommendedWorkerModelId: "gpt-5.4-mini",
    discoveredAt: "2026-03-19T00:00:00.000Z",
    models: [
      {
        id: "gpt-5.4-mini",
        model: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        description: null,
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["medium", "high"]
      },
      {
        id: "gpt-5.4",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["medium", "high", "xhigh"]
      },
      {
        id: "gpt-5.3-codex",
        model: "gpt-5.3-codex",
        displayName: "GPT-5.3 Codex",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["medium", "high", "xhigh"]
      }
    ],
    ...overrides
  };
}

function createGeminiCatalog(overrides: Partial<ManagedToolModelCatalog> = {}): ManagedToolModelCatalog {
  return {
    toolId: "gemini",
    provider: "Google",
    currentModelId: "gemini-3.1-pro-preview",
    recommendedPlannerModelId: "gemini-3.1-pro-preview",
    recommendedWorkerModelId: "gemini-3-flash-preview",
    discoveredAt: "2026-03-19T00:00:00.000Z",
    models: [
      {
        id: "gemini-3-flash-preview",
        model: "gemini-3-flash-preview",
        displayName: "Gemini 3 Flash Preview",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      },
      {
        id: "gemini-2.5-flash",
        model: "gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      },
      {
        id: "gemini-2.5-pro",
        model: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      },
      {
        id: "gemini-3.1-pro-preview",
        model: "gemini-3.1-pro-preview",
        displayName: "Gemini 3.1 Pro Preview",
        description: null,
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      },
      {
        id: "gemini-3-pro-preview",
        model: "gemini-3-pro-preview",
        displayName: "Gemini 3 Pro Preview",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      }
    ],
    ...overrides
  };
}

test("orchestrator service assigns the latest frontier Gemini model to planning while preferring a lightweight Gemini model for worker roles", async () => {
  const catalog = createGeminiCatalog();
  const toolManager = {
    prepareWorkspaceContext: async () => undefined,
    discoverModelCatalog: async () => catalog
  };
  const service = new OrchestratorService("/tmp/tasksaw-app", "/tmp/tasksaw-user-data", toolManager as never);

  const modeConfig = await (service as unknown as { resolveModeConfig(mode: string, workspacePath: string): Promise<unknown> })
    .resolveModeConfig("gemini_only", "/tmp/tasksaw-workspace") as {
      assignedModels: {
        abstractPlanner: { model: string };
        gatherer: { model: string };
      };
      toolModels: {
        gemini: Array<{ model: string }>;
      };
    };

  assert.equal(modeConfig.assignedModels.abstractPlanner.model, "gemini-3.1-pro-preview");
  assert.equal(modeConfig.assignedModels.gatherer.model, "gemini-3-flash-preview");
  assert.deepEqual(modeConfig.toolModels.gemini.map((model) => model.model), [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview"
  ]);
});

test("orchestrator service prefers a newer 3.x Gemini flash model for worker roles when available", async () => {
  const catalog = createGeminiCatalog({
    recommendedWorkerModelId: "gemini-3-flash-preview",
    models: [
      {
        id: "gemini-2.5-flash",
        model: "gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      },
      {
        id: "gemini-3-flash-preview",
        model: "gemini-3-flash-preview",
        displayName: "Gemini 3 Flash Preview",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      },
      {
        id: "gemini-3.1-pro-preview",
        model: "gemini-3.1-pro-preview",
        displayName: "Gemini 3.1 Pro Preview",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      }
    ]
  });
  const toolManager = {
    prepareWorkspaceContext: async () => undefined,
    discoverModelCatalog: async () => catalog
  };
  const service = new OrchestratorService("/tmp/tasksaw-app", "/tmp/tasksaw-user-data", toolManager as never);

  const modeConfig = await (service as unknown as { resolveModeConfig(mode: string, workspacePath: string): Promise<unknown> })
    .resolveModeConfig("gemini_only", "/tmp/tasksaw-workspace") as {
      assignedModels: {
        abstractPlanner: { model: string };
        gatherer: { model: string };
        executor: { model: string };
      };
    };

  assert.equal(modeConfig.assignedModels.abstractPlanner.model, "gemini-3.1-pro-preview");
  assert.equal(modeConfig.assignedModels.gatherer.model, "gemini-3-flash-preview");
  assert.equal(modeConfig.assignedModels.executor.model, "gemini-3-flash-preview");
});

test("orchestrator service falls back to a concrete Gemini model when currentModelId is unavailable", async () => {
  const catalog = createGeminiCatalog({
    currentModelId: null,
    recommendedPlannerModelId: null,
    recommendedWorkerModelId: null,
    models: [
      {
        id: "gemini-2.5-pro",
        model: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      }
    ]
  });
  const toolManager = {
    prepareWorkspaceContext: async () => undefined,
    discoverModelCatalog: async () => catalog
  };
  const service = new OrchestratorService("/tmp/tasksaw-app", "/tmp/tasksaw-user-data", toolManager as never);

  const modeConfig = await (service as unknown as { resolveModeConfig(mode: string, workspacePath: string): Promise<unknown> })
    .resolveModeConfig("gemini_only", "/tmp/tasksaw-workspace") as {
      assignedModels: {
        abstractPlanner: { model: string };
      };
    };

  assert.equal(modeConfig.assignedModels.abstractPlanner.model, "gemini-2.5-pro");
});

test("orchestrator service falls back to the latest concrete Gemini model for worker roles when no lightweight Gemini model exists", async () => {
  const catalog = createGeminiCatalog({
    recommendedWorkerModelId: null,
    models: [
      {
        id: "gemini-2.5-pro",
        model: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      },
      {
        id: "gemini-3.1-pro-preview",
        model: "gemini-3.1-pro-preview",
        displayName: "Gemini 3.1 Pro Preview",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: []
      }
    ]
  });
  const toolManager = {
    prepareWorkspaceContext: async () => undefined,
    discoverModelCatalog: async () => catalog
  };
  const service = new OrchestratorService("/tmp/tasksaw-app", "/tmp/tasksaw-user-data", toolManager as never);

  const modeConfig = await (service as unknown as { resolveModeConfig(mode: string, workspacePath: string): Promise<unknown> })
    .resolveModeConfig("gemini_only", "/tmp/tasksaw-workspace") as {
      assignedModels: {
        abstractPlanner: { model: string };
        gatherer: { model: string };
      };
    };

  assert.equal(modeConfig.assignedModels.abstractPlanner.model, "gemini-3.1-pro-preview");
  assert.equal(modeConfig.assignedModels.gatherer.model, "gemini-3.1-pro-preview");
});

test("orchestrator service assigns the strongest non-mini Codex model to planning while keeping the default model for worker roles", async () => {
  const catalog = createCodexCatalog();
  const toolManager = {
    prepareWorkspaceContext: async () => undefined,
    discoverModelCatalog: async () => catalog
  };
  const service = new OrchestratorService("/tmp/tasksaw-app", "/tmp/tasksaw-user-data", toolManager as never);

  const modeConfig = await (service as unknown as { resolveModeConfig(mode: string, workspacePath: string): Promise<unknown> })
    .resolveModeConfig("codex_only", "/tmp/tasksaw-workspace") as {
      assignedModels: {
        abstractPlanner: { model: string };
        gatherer: { model: string };
      };
      toolModels: {
        codex: Array<{ model: string }>;
      };
    };

  assert.equal(modeConfig.assignedModels.abstractPlanner.model, "gpt-5.4");
  assert.equal(modeConfig.assignedModels.gatherer.model, "gpt-5.4-mini");
  assert.deepEqual(modeConfig.toolModels.codex.map((model) => model.model), [
    "gpt-5.4",
    "gpt-5.4-mini"
  ]);
});

test("orchestrator service honors catalog-recommended Codex models even when names do not match legacy family rules", async () => {
  const catalog = createCodexCatalog({
    currentModelId: "router-worker",
    recommendedPlannerModelId: "router-planner",
    recommendedWorkerModelId: "router-worker",
    models: [
      {
        id: "router-worker",
        model: "router-worker",
        displayName: "Router Worker",
        description: null,
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: ["low", "medium"]
      },
      {
        id: "router-planner",
        model: "router-planner",
        displayName: "Router Planner",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["medium", "high", "xhigh"]
      }
    ]
  });
  const toolManager = {
    prepareWorkspaceContext: async () => undefined,
    discoverModelCatalog: async () => catalog
  };
  const service = new OrchestratorService("/tmp/tasksaw-app", "/tmp/tasksaw-user-data", toolManager as never);

  const modeConfig = await (service as unknown as { resolveModeConfig(mode: string, workspacePath: string): Promise<unknown> })
    .resolveModeConfig("codex_only", "/tmp/tasksaw-workspace") as {
      assignedModels: {
        abstractPlanner: { model: string };
        gatherer: { model: string };
        executor: { model: string };
      };
    };

  assert.equal(modeConfig.assignedModels.abstractPlanner.model, "router-planner");
  assert.equal(modeConfig.assignedModels.gatherer.model, "router-worker");
  assert.equal(modeConfig.assignedModels.executor.model, "router-worker");
});

test("orchestrator service keeps higher reasoning for Codex planners and lighter reasoning for Codex workers", async () => {
  const catalog = createCodexCatalog({
    models: [
      {
        id: "gpt-5.4-mini",
        model: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        description: null,
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
      },
      {
        id: "gpt-5.4",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        description: null,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["medium", "high", "xhigh"]
      }
    ]
  });
  const toolManager = {
    prepareWorkspaceContext: async () => undefined,
    discoverModelCatalog: async () => catalog
  };
  const service = new OrchestratorService("/tmp/tasksaw-app", "/tmp/tasksaw-user-data", toolManager as never);

  const modeConfig = await (service as unknown as { resolveModeConfig(mode: string, workspacePath: string): Promise<unknown> })
    .resolveModeConfig("codex_only", "/tmp/tasksaw-workspace") as {
      assignedModels: {
        abstractPlanner: { model: string; reasoningEffort?: string };
        gatherer: { model: string; reasoningEffort?: string };
        executor: { model: string; reasoningEffort?: string };
      };
    };

  assert.equal(modeConfig.assignedModels.abstractPlanner.model, "gpt-5.4");
  assert.equal(modeConfig.assignedModels.abstractPlanner.reasoningEffort, "xhigh");
  assert.equal(modeConfig.assignedModels.gatherer.model, "gpt-5.4-mini");
  assert.equal(modeConfig.assignedModels.gatherer.reasoningEffort, "low");
  assert.equal(modeConfig.assignedModels.executor.model, "gpt-5.4-mini");
  assert.equal(modeConfig.assignedModels.executor.reasoningEffort, "low");
});
