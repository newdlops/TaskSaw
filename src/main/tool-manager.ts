import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ManagedToolId, ManagedToolStatus } from "./types";

type ToolDefinition = {
  id: ManagedToolId;
  displayName: string;
  packageName: string;
  executableName: string;
};

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

  constructor(private userDataDirectory: string) {
    this.toolingRoot = path.join(userDataDirectory, "managed-tools");
    this.installRoot = path.join(this.toolingRoot, "packages");
    this.binDirectory = path.join(this.toolingRoot, "bin");
    this.homeDirectory = path.join(this.toolingRoot, "home");
    this.runtimeDirectory = path.join(this.toolingRoot, "runtime");
    this.ensureBaseDirectories();
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

  getStatus(toolId: ManagedToolId): ManagedToolStatus {
    const definition = TOOL_DEFINITIONS[toolId];
    const packageJson = this.readInstalledPackageJson(toolId);

    return {
      id: definition.id,
      displayName: definition.displayName,
      installed: packageJson !== null,
      version: packageJson?.version ?? null
    };
  }

  getAllStatuses(): ManagedToolStatus[] {
    return (Object.keys(TOOL_DEFINITIONS) as ManagedToolId[]).map((toolId) => this.getStatus(toolId));
  }

  async ensureInstalled(toolId: ManagedToolId): Promise<ManagedToolStatus> {
    const currentStatus = this.getStatus(toolId);
    if (currentStatus.installed) {
      this.ensureShim(toolId);
      return currentStatus;
    }

    return this.installLatest(toolId);
  }

  async updateAll(): Promise<ManagedToolStatus[]> {
    const statuses: ManagedToolStatus[] = [];

    for (const toolId of Object.keys(TOOL_DEFINITIONS) as ManagedToolId[]) {
      statuses.push(await this.installLatest(toolId));
    }

    return statuses;
  }

  async resolveLaunchCommand(
    toolId: ManagedToolId
  ): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
    await this.ensureInstalled(toolId);

    const entryPath = this.resolveInstalledEntryPoint(toolId);
    if (!entryPath) {
      throw new Error(`Managed ${TOOL_DEFINITIONS[toolId].displayName} entry point was not found after install`);
    }

    return {
      command: process.execPath,
      args: [entryPath],
      env: { ELECTRON_RUN_AS_NODE: "1" }
    };
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

    await this.runCommand(npmCommand.command, npmArgs, npmCommand.command === process.execPath);

    const status = this.getStatus(toolId);
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
    const wrapperLines = [
      "#!/bin/sh",
      "set -eu",
      "export ELECTRON_RUN_AS_NODE=1"
    ];

    if (fallbackCommand) {
      wrapperLines.push(`export TASKSAW_BROWSER_FALLBACK=${this.shQuote(fallbackCommand)}`);
    }

    wrapperLines.push(
      `exec ${this.shQuote(process.execPath)} ${this.shQuote(helperPath)} ${this.shQuote(wrapperName)} "$@"`,
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

  private ensureShim(toolId: ManagedToolId) {
    const entryPoint = this.resolveInstalledEntryPoint(toolId);
    if (!entryPoint) return;

    const definition = TOOL_DEFINITIONS[toolId];
    const shimPath = path.join(this.binDirectory, definition.executableName);
    const shimScript = [
      "#!/bin/sh",
      "set -eu",
      "export ELECTRON_RUN_AS_NODE=1",
      `exec ${this.shQuote(process.execPath)} ${this.shQuote(entryPoint)} "$@"`,
      ""
    ].join("\n");

    fs.writeFileSync(shimPath, shimScript);
    fs.chmodSync(shimPath, 0o755);
  }

  private shQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }

  private resolveNpmCommand(): { command: string; args: string[] } {
    if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
      return {
        command: process.execPath,
        args: [process.env.npm_execpath]
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
      return { command: executablePath, args: [] };
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

  private async runCommand(command: string, args: string[], runAsNode: boolean): Promise<void> {
    const env: Record<string, string> = {
      ...process.env,
      HOME: this.homeDirectory,
      PATH: process.env.PATH ?? "",
      npm_config_audit: "false",
      npm_config_cache: path.join(this.runtimeDirectory, "npm-cache"),
      npm_config_fund: "false",
      npm_config_update_notifier: "false"
    };

    if (runAsNode) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }

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
