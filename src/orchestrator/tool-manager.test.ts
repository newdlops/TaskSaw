import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ToolManager } from "../main/tool-manager";

type ToolManagerTestDouble = {
  ensureInstalled: () => Promise<{
    id: "gemini";
    displayName: string;
    installed: boolean;
    version: string;
  }>;
  probeGeminiAuthenticationStatus: () => Promise<{
    toolId: "gemini";
    authenticated: boolean;
    message: string | null;
  }>;
  prepareWorkspaceContext: (toolId: "gemini" | "codex", workspacePath?: string | null) => Promise<void>;
  importManagedGeminiModelsModule: () => Promise<{
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
  }>;
};

type MutableToolManagerInternals = {
  prepareWorkspaceContext: (toolId: "gemini" | "codex", workspacePath?: string | null) => Promise<void>;
  importManagedGeminiModelsModule: ToolManagerTestDouble["importManagedGeminiModelsModule"];
};

function createTempDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("tool manager syncs global instruction files into the managed home and configures Gemini context filename variants", async () => {
  const originalHome = process.env.HOME;
  const userHome = createTempDirectory("tasksaw-home-");
  const userData = createTempDirectory("tasksaw-user-data-");
  const workspace = createTempDirectory("tasksaw-workspace-");

  process.env.HOME = userHome;

  try {
    fs.mkdirSync(path.join(userHome, ".gemini"), { recursive: true });
    fs.writeFileSync(path.join(userHome, "AGENTS.MD"), "global codex instructions\n");
    fs.writeFileSync(path.join(userHome, ".gemini", "GEMINI.MD"), "global gemini instructions\n");

    const manager = new ToolManager(userData);
    const managedSettingsPath = path.join(userData, "managed-tools", "home", ".gemini", "settings.json");
    fs.mkdirSync(path.dirname(managedSettingsPath), { recursive: true });
    fs.writeFileSync(
      managedSettingsPath,
      JSON.stringify({ context: { fileName: ["CUSTOM.md"] }, theme: "light" }, null, 2)
    );
    await manager.prepareWorkspaceContext("gemini", workspace);

    const managedHome = path.join(userData, "managed-tools", "home");
    const managedCodexPath = path.join(managedHome, "AGENTS.md");
    const managedGeminiPath = path.join(managedHome, ".gemini", "GEMINI.md");

    assert.equal(fs.readFileSync(managedCodexPath, "utf8"), "global codex instructions\n");
    assert.equal(fs.readFileSync(managedGeminiPath, "utf8"), "global gemini instructions\n");

    const managedSettings = JSON.parse(fs.readFileSync(managedSettingsPath, "utf8")) as {
      context?: { fileName?: string[] };
      theme?: string;
    };
    assert.deepEqual(managedSettings.context?.fileName, [
      "GEMINI.MD",
      "GEMINI.md",
      "gemini.md",
      "gemini.MD",
      "Gemini.md",
      "CUSTOM.md"
    ]);
    assert.equal(managedSettings.theme, "light");
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    fs.rmSync(userHome, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("tool manager builds a Codex instruction file where workspace instructions override global instructions", async () => {
  const originalHome = process.env.HOME;
  const userHome = createTempDirectory("tasksaw-home-");
  const userData = createTempDirectory("tasksaw-user-data-");
  const workspace = createTempDirectory("tasksaw-workspace-");

  process.env.HOME = userHome;

  try {
    fs.writeFileSync(path.join(userHome, "AGENTS.MD"), "global rule\n");
    fs.writeFileSync(path.join(workspace, "AGENTS.MD"), "workspace rule\n");

    const manager = new ToolManager(userData);
    await manager.prepareWorkspaceContext("codex", workspace);

    const configArgs = manager.getCodexWorkspaceConfigArgs(workspace);
    assert.equal(configArgs[0], "-c");
    assert.match(configArgs[1] ?? "", /^model_instructions_file=/);

    const instructionFilePath = JSON.parse((configArgs[1] ?? "").slice("model_instructions_file=".length)) as string;
    const instructionFile = fs.readFileSync(instructionFilePath, "utf8");

    assert.match(instructionFile, /Workspace Instructions/);
    assert.match(instructionFile, /Global Instructions/);
    assert.ok(instructionFile.indexOf("workspace rule") < instructionFile.indexOf("global rule"));
    assert.match(instructionFile, /workspace instructions win/i);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    fs.rmSync(userHome, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("tool manager treats Gemini as logged out when no managed auth type is configured", async () => {
  const originalHome = process.env.HOME;
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;
  const originalGoogleApiKey = process.env.GOOGLE_API_KEY;
  const userHome = createTempDirectory("tasksaw-home-");
  const userData = createTempDirectory("tasksaw-user-data-");
  const workspace = createTempDirectory("tasksaw-workspace-");

  process.env.HOME = userHome;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;

  try {
    const manager = new ToolManager(userData);
    const managerStub = manager as unknown as ToolManagerTestDouble;
    let probeCalled = false;

    managerStub.ensureInstalled = async () => ({
      id: "gemini",
      displayName: "Gemini",
      installed: true,
      version: "test"
    });
    managerStub.probeGeminiAuthenticationStatus = async () => {
      probeCalled = true;
      return {
        toolId: "gemini",
        authenticated: true,
        message: null
      };
    };

    const authState = await manager.getAuthenticationStatus("gemini", workspace);
    assert.deepEqual(authState, {
      toolId: "gemini",
      authenticated: false,
      message: "Gemini login is required."
    });
    assert.equal(probeCalled, false);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }

    if (originalGoogleApiKey === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = originalGoogleApiKey;
    }

    fs.rmSync(userHome, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("tool manager treats Gemini oauth login as logged out when managed credentials are missing", async () => {
  const originalHome = process.env.HOME;
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;
  const originalGoogleApiKey = process.env.GOOGLE_API_KEY;
  const userHome = createTempDirectory("tasksaw-home-");
  const userData = createTempDirectory("tasksaw-user-data-");
  const workspace = createTempDirectory("tasksaw-workspace-");

  process.env.HOME = userHome;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;

  try {
    const manager = new ToolManager(userData);
    const managerStub = manager as unknown as ToolManagerTestDouble;
    let probeCalled = false;
    const managedSettingsPath = path.join(userData, "managed-tools", "home", ".gemini", "settings.json");

    fs.mkdirSync(path.dirname(managedSettingsPath), { recursive: true });
    fs.writeFileSync(
      managedSettingsPath,
      JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } }, null, 2)
    );

    managerStub.ensureInstalled = async () => ({
      id: "gemini",
      displayName: "Gemini",
      installed: true,
      version: "test"
    });
    managerStub.probeGeminiAuthenticationStatus = async () => {
      probeCalled = true;
      return {
        toolId: "gemini",
        authenticated: true,
        message: null
      };
    };

    const authState = await manager.getAuthenticationStatus("gemini", workspace);
    assert.deepEqual(authState, {
      toolId: "gemini",
      authenticated: false,
      message: "Gemini login is required."
    });
    assert.equal(probeCalled, false);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }

    if (originalGoogleApiKey === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = originalGoogleApiKey;
    }

    fs.rmSync(userHome, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("tool manager resolves Gemini auto aliases to concrete catalog models before routing", async () => {
  const originalGeminiModel = process.env.GEMINI_MODEL;
  const userData = createTempDirectory("tasksaw-user-data-");

  process.env.GEMINI_MODEL = "auto-gemini-3";

  try {
    const manager = new ToolManager(userData);
    const managerStub = manager as unknown as MutableToolManagerInternals;

    managerStub.prepareWorkspaceContext = async () => undefined;
    managerStub.importManagedGeminiModelsModule = async () => ({
      PREVIEW_GEMINI_MODEL: "gemini-3-pro-preview",
      PREVIEW_GEMINI_3_1_MODEL: "gemini-3.1-pro-preview",
      PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL: "gemini-3.1-pro-preview-customtools",
      PREVIEW_GEMINI_FLASH_MODEL: "gemini-3-flash-preview",
      PREVIEW_GEMINI_3_1_FLASH_LITE_MODEL: "gemini-3.1-flash-lite-preview",
      DEFAULT_GEMINI_MODEL: "gemini-2.5-pro",
      DEFAULT_GEMINI_FLASH_MODEL: "gemini-2.5-flash",
      DEFAULT_GEMINI_FLASH_LITE_MODEL: "gemini-2.5-flash-lite",
      PREVIEW_GEMINI_MODEL_AUTO: "auto-gemini-3",
      DEFAULT_GEMINI_MODEL_AUTO: "auto-gemini-2.5",
      VALID_GEMINI_MODELS: new Set([
        "gemini-3-pro-preview",
        "gemini-3.1-pro-preview",
        "gemini-3.1-pro-preview-customtools",
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite-preview",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite"
      ]),
      resolveModel: (requestedModel: string, useGemini3_1?: boolean) => {
        if (requestedModel === "auto-gemini-3") {
          return useGemini3_1 ? "gemini-3.1-pro-preview" : "gemini-3-pro-preview";
        }

        if (requestedModel === "auto-gemini-2.5") {
          return "gemini-2.5-pro";
        }

        return requestedModel;
      },
      resolveClassifierModel: (requestedModel: string, modelAlias: string, useGemini3_1?: boolean) => {
        if (modelAlias !== "flash") {
          return requestedModel;
        }

        return useGemini3_1 ? "gemini-3.1-flash-lite-preview" : "gemini-3-flash-preview";
      }
    });

    const catalog = await manager.discoverModelCatalog("gemini");

    assert.equal(catalog.currentModelId, "gemini-3.1-pro-preview");
    assert.equal(catalog.recommendedPlannerModelId, "gemini-3.1-pro-preview");
    assert.equal(catalog.recommendedWorkerModelId, "gemini-3.1-flash-lite-preview");
    assert.ok(catalog.models.every((model) => !model.model.startsWith("auto-")));
  } finally {
    if (originalGeminiModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = originalGeminiModel;
    }

    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("tool manager maps Gemini /stats model remaining percent onto the selected model", async () => {
  const userData = createTempDirectory("tasksaw-user-data-");

  try {
    const manager = new ToolManager(userData);
    const managerStub = manager as unknown as {
      discoverModelCatalog: (toolId: "gemini") => Promise<{
        currentModelId: string;
        models: Array<{ id: string; displayName: string; hidden: boolean }>;
      }>;
      queryGeminiModelUsageStats: () => Promise<unknown>;
      getGeminiUsage: () => Promise<{
        remainingPercent: number | null;
        statusMessage: string | null;
        gemini: {
          models: Array<{ modelId: string; displayName: string; remainingPercent: number | null }>;
        };
      } | null>;
    };

    managerStub.discoverModelCatalog = async () => ({
      currentModelId: "gemini-2.5-pro",
      models: [
        { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", hidden: false },
        { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", hidden: false }
      ]
    });
    managerStub.queryGeminiModelUsageStats = async () => ({
      models: [
        { model: "gemini-2.5-pro", remainingPercent: 62.4 },
        { model: "gemini-2.5-flash", remainingPercent: 15 }
      ]
    });

    const usage = await managerStub.getGeminiUsage();

    assert.deepEqual(usage, {
      remainingPercent: 62,
      statusMessage: null,
      gemini: {
        models: [
          { modelId: "gemini-2.5-pro", displayName: "2.5 Pro", remainingPercent: 62 },
          { modelId: "gemini-2.5-flash", displayName: "2.5 Flash", remainingPercent: 15 }
        ]
      }
    });
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("tool manager prefers a Codex mini-family model for worker recommendations even when the default model is full size", () => {
  const userData = createTempDirectory("tasksaw-user-data-");

  try {
    const manager = new ToolManager(userData);
    const selectRecommendedWorkerModelId = (
      manager as unknown as {
        selectCodexRecommendedWorkerModelId: (
          models: Array<{
            id: string;
            model: string;
            hidden: boolean;
            isDefault: boolean;
            defaultReasoningEffort: string | null;
            supportedReasoningEfforts: string[];
          }>,
          currentModelId: string | null
        ) => string | null;
      }
    ).selectCodexRecommendedWorkerModelId.bind(manager);

    const recommendedWorkerModelId = selectRecommendedWorkerModelId(
      [
        {
          id: "gpt-5.4",
          model: "gpt-5.4",
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: ["medium", "high", "xhigh"]
        },
        {
          id: "gpt-5.4-mini",
          model: "gpt-5.4-mini",
          hidden: false,
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high"]
        }
      ],
      "gpt-5.4"
    );

    assert.equal(recommendedWorkerModelId, "gpt-5.4-mini");
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("tool manager computes Gemini remaining percent from quota and usage fields", async () => {
  const userData = createTempDirectory("tasksaw-user-data-");

  try {
    const manager = new ToolManager(userData);
    const managerStub = manager as unknown as {
      discoverModelCatalog: (toolId: "gemini") => Promise<{
        currentModelId: string;
        models: Array<{ id: string; displayName: string; hidden: boolean }>;
      }>;
      queryGeminiModelUsageStats: () => Promise<unknown>;
      getGeminiUsage: () => Promise<{
        remainingPercent: number | null;
        statusMessage: string | null;
        gemini: {
          models: Array<{ modelId: string; displayName: string; remainingPercent: number | null }>;
        };
      } | null>;
    };

    managerStub.discoverModelCatalog = async () => ({
      currentModelId: "gemini-2.5-pro",
      models: [
        { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", hidden: false },
        { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", hidden: false }
      ]
    });
    managerStub.queryGeminiModelUsageStats = async () => ({
      stats: [
        { modelId: "models/gemini-2.5-pro", quota: 1000, used: 420 },
        { modelId: "models/gemini-2.5-flash", quota: 200, used: 20 }
      ]
    });

    const usage = await managerStub.getGeminiUsage();

    assert.deepEqual(usage, {
      remainingPercent: 58,
      statusMessage: null,
      gemini: {
        models: [
          { modelId: "gemini-2.5-pro", displayName: "2.5 Pro", remainingPercent: 58 },
          { modelId: "gemini-2.5-flash", displayName: "2.5 Flash", remainingPercent: 90 }
        ]
      }
    });
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("tool manager falls back to generic usage when model-specific data is missing", async () => {
  const userData = createTempDirectory("tasksaw-user-data-");

  try {
    const manager = new ToolManager(userData);
    const managerStub = manager as unknown as {
      discoverModelCatalog: (toolId: "gemini") => Promise<{
        currentModelId: string;
        models: Array<{ id: string; displayName: string; hidden: boolean }>;
      }>;
      queryGeminiModelUsageStats: () => Promise<unknown>;
      getGeminiUsage: () => Promise<{
        remainingPercent: number | null;
        statusMessage: string | null;
        gemini: {
          models: Array<{ modelId: string; displayName: string; remainingPercent: number | null }>;
        };
      } | null>;
    };

    managerStub.discoverModelCatalog = async () => ({
      currentModelId: "gemini-2.5-pro",
      models: [
        { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", hidden: false }
      ]
    });
    managerStub.queryGeminiModelUsageStats = async () => ({
      quota: 100,
      used: 25
    });

    const usage = await managerStub.getGeminiUsage();

    assert.deepEqual(usage, {
      remainingPercent: 75,
      statusMessage: null,
      gemini: {
        models: [
          { modelId: "gemini-2.5-pro", displayName: "2.5 Pro", remainingPercent: 75 }
        ]
      }
    });
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
