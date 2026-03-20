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
