import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CliModelAdapter } from "./cli-model-adapter";
import { createGeminiAcpInvoker } from "./gemini-acp-invoker";
import { ModelInvocationContext } from "./model-adapter";
import { ModelRef } from "./types";

const TEST_MODEL: ModelRef = {
  id: "gemini-2.5-pro",
  provider: "Google",
  model: "gemini-2.5-pro",
  tier: "upper"
};

function createContext(model: ModelRef): ModelInvocationContext {
  return {
    run: {
      id: "run-test",
      goal: "Validate Gemini ACP invocation",
      status: "running",
      rootNodeId: "node-root",
      config: {
        maxDepth: 2,
        reviewPolicy: "light",
        plannerBias: "balanced",
        carefulnessMode: "balanced",
        defaultBudget: {
          maxDepth: 2,
          evidenceBudget: 8,
          rereadBudget: 4,
          upperModelCallBudget: 6,
          reviewBudget: 2
        }
      },
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      completedAt: null
    },
    node: {
      id: "node-root",
      runId: "run-test",
      parentId: null,
      childIds: [],
      kind: "planning",
      role: "task",
      stagePhase: null,
      title: "Root Task",
      objective: "Validate Gemini ACP invocation",
      depth: 0,
      phase: "gather",
      assignedModels: {
        gatherer: model
      },
      reviewPolicy: "light",
      acceptanceCriteria: {
        items: []
      },
      executionBudget: {
        maxDepth: 2,
        evidenceBudget: 8,
        rereadBudget: 4,
        upperModelCallBudget: 6,
        reviewBudget: 2
      },
      evidenceBundleIds: [],
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      completedAt: null
    },
    config: {
      maxDepth: 2,
      reviewPolicy: "light",
      plannerBias: "balanced",
      carefulnessMode: "balanced",
      defaultBudget: {
        maxDepth: 2,
        evidenceBudget: 8,
        rereadBudget: 4,
        upperModelCallBudget: 6,
        reviewBudget: 2
      }
    },
    assignedModel: model,
    outputLanguage: "en",
    abortSignal: new AbortController().signal,
    workflowStage: "task_orchestration",
    reviewPolicy: "light",
    executionBudget: {
      maxDepth: 2,
      evidenceBudget: 8,
      rereadBudget: 4,
      upperModelCallBudget: 6,
      reviewBudget: 2
    },
    workingMemory: {
      runId: "run-test",
      facts: [],
      openQuestions: [],
      unknowns: [],
      conflicts: [],
      decisions: [],
      updatedAt: "2026-03-19T00:00:00.000Z"
    },
    projectStructure: {
      runId: "run-test",
      summary: "Repository structure unknown",
      directories: [],
      keyFiles: [],
      entryPoints: [],
      modules: [],
      openQuestions: [],
      contradictions: [],
      updatedAt: "2026-03-19T00:00:00.000Z"
    },
    evidenceBundles: []
  };
}

class FakeChildProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  override once(event: "error" | "exit", listener: (...args: unknown[]) => void): this {
    return super.once(event, listener);
  }

  override off(event: "error" | "exit", listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.exitCode = 0;
    this.signalCode = signal ?? null;
    this.emit("exit", 0, signal ?? null);
    return true;
  }
}

test("gemini ACP invoker does not switch the session mode by default", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const fakeChild = new FakeChildProcess();

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            private readonly client;

            constructor(toClient: () => object) {
              this.client = toClient() as {
                sessionUpdate(params: {
                  update?: {
                    sessionUpdate?: string;
                    content?: {
                      type?: string;
                      text?: string;
                    };
                  };
                }): Promise<void>;
              };
            }

            async initialize() {
              return {
                protocolVersion: 1
              };
            }

            async newSession() {
              return {
                sessionId: "session-1",
                modes: {
                  availableModes: [{ id: "plan" }]
                }
              };
            }

            async setSessionMode(params: Record<string, unknown>) {
              calls.push({
                method: "setSessionMode",
                params
              });
              return {};
            }

            async unstable_setSessionModel(params: Record<string, unknown>) {
              calls.push({
                method: "unstable_setSessionModel",
                params
              });
              return {};
            }

            async prompt(params: Record<string, unknown>) {
              calls.push({
                method: "prompt",
                params
              });
              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Gathered through ACP",
                      evidenceBundles: []
                    })
                  }
                }
              });
              return {
                stopReason: "end_turn"
              };
            }
          }
        }),
        spawnProcess: () => fakeChild
      }
    }),
    supportedCapabilities: ["gather"]
  });

  const result = await adapter.gather!(createContext(TEST_MODEL));

  assert.equal(result.summary, "Gathered through ACP");
  assert.deepEqual(
    calls.map((entry) => entry.method),
    ["unstable_setSessionModel", "prompt"]
  );
  assert.deepEqual(calls[0]?.params, {
    sessionId: "session-1",
    modelId: "gemini-2.5-pro"
  });
});

test("gemini ACP invoker switches the session mode only when explicitly requested", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const fakeChild = new FakeChildProcess();

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      modeId: "plan",
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            private readonly client;

            constructor(toClient: () => object) {
              this.client = toClient() as {
                sessionUpdate(params: {
                  update?: {
                    sessionUpdate?: string;
                    content?: {
                      type?: string;
                      text?: string;
                    };
                  };
                }): Promise<void>;
              };
            }

            async initialize() {
              return {
                protocolVersion: 1
              };
            }

            async newSession() {
              return {
                sessionId: "session-1",
                modes: {
                  availableModes: [{ id: "plan" }]
                }
              };
            }

            async setSessionMode(params: Record<string, unknown>) {
              calls.push({
                method: "setSessionMode",
                params
              });
              return {};
            }

            async unstable_setSessionModel(params: Record<string, unknown>) {
              calls.push({
                method: "unstable_setSessionModel",
                params
              });
              return {};
            }

            async prompt(params: Record<string, unknown>) {
              calls.push({
                method: "prompt",
                params
              });
              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Gathered through ACP",
                      evidenceBundles: []
                    })
                  }
                }
              });
              return {
                stopReason: "end_turn"
              };
            }
          }
        }),
        spawnProcess: () => fakeChild
      }
    }),
    supportedCapabilities: ["gather"]
  });

  const result = await adapter.gather!(createContext(TEST_MODEL));

  assert.equal(result.summary, "Gathered through ACP");
  assert.deepEqual(
    calls.map((entry) => entry.method),
    ["setSessionMode", "unstable_setSessionModel", "prompt"]
  );
  assert.deepEqual(calls[0]?.params, {
    sessionId: "session-1",
    modeId: "plan"
  });
  assert.deepEqual(calls[1]?.params, {
    sessionId: "session-1",
    modelId: "gemini-2.5-pro"
  });
});

test("gemini ACP invoker waits for prompt completion instead of timing out", async () => {
  const fakeChild = new FakeChildProcess();

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      timeoutMs: 10,
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            private readonly client;

            constructor(toClient: () => object) {
              this.client = toClient() as {
                sessionUpdate(params: {
                  update?: {
                    sessionUpdate?: string;
                    content?: {
                      type?: string;
                      text?: string;
                    };
                  };
                }): Promise<void>;
              };
            }

            async initialize() {
              return {
                protocolVersion: 1
              };
            }

            async newSession() {
              return {
                sessionId: "session-1",
                modes: {
                  availableModes: [{ id: "plan" }]
                }
              };
            }

            async setSessionMode() {
              return {};
            }

            async unstable_setSessionModel() {
              return {};
            }

            async prompt() {
              await new Promise((resolve) => setTimeout(resolve, 25));
              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Abstract plan through ACP",
                      targetsToInspect: [],
                      evidenceRequirements: []
                    })
                  }
                }
              });
              return {
                stopReason: "end_turn"
              };
            }
          }
        }),
        spawnProcess: () => fakeChild
      }
    }),
    supportedCapabilities: ["abstractPlan"]
  });

  const result = await adapter.abstractPlan!(createContext({
    ...TEST_MODEL,
    reasoningEffort: "high"
  }));

  assert.equal(result.summary, "Abstract plan through ACP");
});

test("gemini ACP invoker aborts an in-flight prompt only when cancellation is requested", async () => {
  const fakeChild = new FakeChildProcess();
  const abortController = new AbortController();

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      timeoutMs: 10,
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            constructor(_toClient: () => object) {}

            async initialize() {
              return {
                protocolVersion: 1
              };
            }

            async newSession() {
              return {
                sessionId: "session-1",
                modes: {
                  availableModes: [{ id: "plan" }]
                }
              };
            }

            async setSessionMode() {
              return {};
            }

            async unstable_setSessionModel() {
              return {};
            }

            async prompt() {
              return new Promise<never>(() => undefined);
            }
          }
        }),
        spawnProcess: () => fakeChild
      }
    }),
    supportedCapabilities: ["gather"]
  });

  const pendingGather = adapter.gather!({
    ...createContext(TEST_MODEL),
    abortSignal: abortController.signal
  });

  setTimeout(() => abortController.abort(), 20);

  await assert.rejects(
    pendingGather,
    /Gemini ACP prompt was aborted/
  );
});

test("gemini ACP invoker times out when the prompt stays inactive", async () => {
  const fakeChild = new FakeChildProcess();

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      promptInactivityTimeoutMs: 10,
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            constructor(_toClient: () => object) {}

            async initialize() {
              return {
                protocolVersion: 1
              };
            }

            async newSession() {
              return {
                sessionId: "session-1",
                modes: {
                  availableModes: [{ id: "plan" }]
                }
              };
            }

            async setSessionMode() {
              return {};
            }

            async unstable_setSessionModel() {
              return {};
            }

            async prompt() {
              return new Promise<never>(() => undefined);
            }
          }
        }),
        spawnProcess: () => fakeChild
      }
    }),
    supportedCapabilities: ["gather"]
  });

  await assert.rejects(
    adapter.gather!(createContext(TEST_MODEL)),
    /Timed out while waiting for Gemini ACP prompt activity/
  );
});

test("gemini ACP invoker pauses inactivity timeout while awaiting approval and reports tool-call progress", async () => {
  const fakeChild = new FakeChildProcess();
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      promptInactivityTimeoutMs: 10,
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            private readonly client;

            constructor(toClient: () => object) {
              this.client = toClient() as {
                requestPermission(params: {
                  options?: Array<{
                    optionId?: string;
                    kind?: string;
                  }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<unknown>;
                sessionUpdate(params: {
                  update?: {
                    sessionUpdate?: string;
                    content?: {
                      type?: string;
                      text?: string;
                    };
                  };
                }): Promise<void>;
              };
            }

            async initialize() {
              return {
                protocolVersion: 1
              };
            }

            async newSession() {
              return {
                sessionId: "session-1",
                modes: {
                  availableModes: [{ id: "plan" }]
                }
              };
            }

            async setSessionMode() {
              return {};
            }

            async unstable_setSessionModel() {
              return {};
            }

            async prompt() {
              await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "gemini --status",
                  kind: "execute"
                }
              });
              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Gathered through approval",
                      evidenceBundles: []
                    })
                  }
                }
              });
              return {
                stopReason: "end_turn"
              };
            }
          }
        }),
        spawnProcess: () => fakeChild
      }
    }),
    supportedCapabilities: ["gather"]
  });

  const result = await adapter.gather!({
    ...createContext(TEST_MODEL),
    requestUserApproval: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Gathered through approval");
  assert.equal(
    progressMessages.some((entry) => entry.message === "Waiting for Gemini ACP prompt completion"),
    true
  );
  assert.equal(
    progressMessages.some((entry) =>
      entry.message === "Gemini tool call approved and waiting for result"
      && entry.details?.toolCall === "gemini --status"
    ),
    true
  );
});

test("gemini ACP invoker retries invalid streams and falls back to another Gemini model", async () => {
  const sessionModelIds: string[] = [];
  let currentModelId = "";
  let promptAttemptCount = 0;

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      fallbackModelIds: [TEST_MODEL.model, "gemini-2.5-flash"],
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            private readonly client;

            constructor(toClient: () => object) {
              this.client = toClient() as {
                sessionUpdate(params: {
                  update?: {
                    sessionUpdate?: string;
                    content?: {
                      type?: string;
                      text?: string;
                    };
                  };
                }): Promise<void>;
              };
            }

            async initialize() {
              return {
                protocolVersion: 1
              };
            }

            async newSession() {
              return {
                sessionId: "session-1",
                modes: {
                  availableModes: [{ id: "plan" }]
                }
              };
            }

            async setSessionMode() {
              return {};
            }

            async unstable_setSessionModel(params: Record<string, unknown>) {
              currentModelId = String(params.modelId ?? "");
              sessionModelIds.push(currentModelId);
              return {};
            }

            async prompt() {
              promptAttemptCount += 1;
              if (currentModelId !== "gemini-2.5-flash") {
                throw new Error("Model stream ended with empty response text.");
              }

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Recovered after Gemini fallback",
                      evidenceBundles: []
                    })
                  }
                }
              });

              return {
                stopReason: "end_turn"
              };
            }
          }
        }),
        spawnProcess: () => new FakeChildProcess()
      }
    }),
    supportedCapabilities: ["gather"]
  });

  const result = await adapter.gather!(createContext(TEST_MODEL));

  assert.equal(result.summary, "Recovered after Gemini fallback");
  assert.equal(promptAttemptCount, 3);
  assert.deepEqual(sessionModelIds, [
    "gemini-2.5-pro",
    "gemini-2.5-pro",
    "gemini-2.5-flash"
  ]);
});

test("gemini ACP invoker advertises filesystem capabilities and serves workspace file reads", async () => {
  const fakeChild = new FakeChildProcess();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasksaw-gemini-acp-"));
  const sampleFilePath = path.join(workspaceRoot, "README.md");
  fs.writeFileSync(sampleFilePath, "workspace-read-ok\n", "utf8");

  const initializeCalls: Array<Record<string, unknown>> = [];

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      cwd: workspaceRoot,
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            private readonly client;

            constructor(toClient: () => object) {
              this.client = toClient() as {
                readTextFile(params: { path?: string }): Promise<{ content: string }>;
              };
            }

            async initialize(params: Record<string, unknown>) {
              initializeCalls.push(params);
              return {
                protocolVersion: 1
              };
            }

            async newSession() {
              return {
                sessionId: "session-1",
                modes: {
                  availableModes: [{ id: "plan" }]
                }
              };
            }

            async setSessionMode() {
              return {};
            }

            async unstable_setSessionModel() {
              return {};
            }

            async prompt() {
              const file = await this.client.readTextFile({ path: "README.md" });
              return {
                stopReason: file.content.includes("workspace-read-ok") ? "end_turn" : "failed"
              };
            }
          }
        }),
        spawnProcess: () => fakeChild
      }
    }),
    supportedCapabilities: ["gather"]
  });

  await assert.rejects(
    adapter.gather!(createContext(TEST_MODEL)),
    /without any text output/
  );

  assert.deepEqual(initializeCalls[0]?.clientCapabilities, {
    fs: {
      readTextFile: true,
      writeTextFile: true
    }
  });
});

test("gemini ACP invoker serializes structured object errors", async () => {
  const fakeChild = new FakeChildProcess();

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            constructor(_toClient: () => object) {}

            async initialize() {
              return {
                protocolVersion: 1
              };
            }

            async newSession() {
              return {
                sessionId: "session-1",
                modes: {
                  availableModes: [{ id: "plan" }]
                }
              };
            }

            async setSessionMode() {
              return {};
            }

            async unstable_setSessionModel() {
              return {};
            }

            async prompt() {
              throw {
                code: -32000,
                message: "Structured Gemini ACP failure",
                data: {
                  detail: "file read denied"
                }
              };
            }
          }
        }),
        spawnProcess: () => fakeChild
      }
    }),
    supportedCapabilities: ["gather"]
  });

  await assert.rejects(
    adapter.gather!(createContext(TEST_MODEL)),
    /Structured Gemini ACP failure/
  );
});
