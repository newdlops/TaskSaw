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

test("gemini ACP invoker switches execute sessions to default approval mode and surfaces edit approvals", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];
  const fakeChild = new FakeChildProcess();
  let approvalRequestCount = 0;
  let editOutcome = "";

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
                requestPermission(params: {
                  options?: Array<{
                    optionId?: string;
                    kind?: string;
                  }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
                  availableModes: [{ id: "plan" }, { id: "default" }]
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
              const permissionDecision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "src/main/tool-manager.ts: old => new",
                  kind: "edit"
                }
              });
              editOutcome = permissionDecision.outcome.outcome;

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Execute completed after approval",
                      outputs: [],
                      completed: true
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
    supportedCapabilities: ["execute"]
  });

  const result = await adapter.execute!({
    ...createContext(TEST_MODEL),
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Execute completed after approval");
  assert.equal(result.completed, true);
  assert.equal(editOutcome, "selected");
  assert.equal(approvalRequestCount, 1);
  assert.deepEqual(
    calls.map((entry) => entry.method),
    ["setSessionMode", "unstable_setSessionModel", "prompt"]
  );
  assert.deepEqual(calls[0]?.params, {
    sessionId: "session-1",
    modeId: "default"
  });
  assert.equal(
    progressMessages.some((entry) =>
      entry.message === "Gemini tool call approved and waiting for result"
      && entry.details?.toolCall === "src/main/tool-manager.ts: old => new"
    ),
    true
  );
});

test("gemini ACP invoker routes generic approval requests through explicit guardrail override approval", async () => {
  const fakeChild = new FakeChildProcess();
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];
  let approvalRequestCount = 0;
  let otherOutcome = "";

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
                requestPermission(params: {
                  options?: Array<{
                    optionId?: string;
                    kind?: string;
                  }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
                  availableModes: [{ id: "plan" }, { id: "default" }]
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
              const permissionDecision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "Need help deciding the planning strategy",
                  kind: "other"
                }
              });
              otherOutcome = permissionDecision.outcome.outcome;

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Gather completed without generic approvals",
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
    workflowStage: "project_structure_discovery",
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Gather completed without generic approvals");
  assert.equal(otherOutcome, "selected");
  assert.equal(approvalRequestCount, 1);
  assert.equal(
    progressMessages.some(
      (entry) => entry.details?.guardrailReason === "Rejected Gemini tool call because generic approval requests are not supported"
    ),
    true
  );
});

test("gemini ACP invoker requests approval before overriding repeated read-only execute dedupe guardrails", async () => {
  const fakeChild = new FakeChildProcess();
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];
  let approvalRequestCount = 0;
  let firstOutcome = "";
  let secondOutcome = "";

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const firstDecision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "gemini --help",
                  kind: "execute"
                }
              });
              firstOutcome = firstDecision.outcome.outcome;

              const secondDecision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "gemini --help",
                  kind: "execute"
                }
              });
              secondOutcome = secondDecision.outcome.outcome;

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Gather completed with dedupe",
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
    workflowStage: "project_structure_discovery",
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Gather completed with dedupe");
  assert.equal(firstOutcome, "selected");
  assert.equal(secondOutcome, "cancelled");
  assert.equal(approvalRequestCount, 1);
  assert.equal(
    progressMessages.some(
      (entry) => entry.details?.guardrailReason === "Rejected Gemini tool call because this command was already attempted in this phase"
    ),
    true
  );
});

test("gemini ACP invoker requests approval before overriding bootstrap sketch probing guardrails", async () => {
  const fakeChild = new FakeChildProcess();
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];
  let approvalRequestCount = 0;
  let outcome = "";

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const decision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "gemini --help",
                  kind: "execute"
                }
              });
              outcome = decision.outcome.outcome;

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Bootstrap sketch stayed shallow",
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
    workflowStage: "bootstrap_sketch",
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Bootstrap sketch stayed shallow");
  assert.equal(outcome, "selected");
  assert.equal(approvalRequestCount, 1);
  assert.equal(
    progressMessages.some(
      (entry) => entry.details?.guardrailReason === "Rejected Gemini tool call because bootstrap sketch must stay workspace-local and low-cost"
    ),
    true
  );
});

test("gemini ACP invoker requests approval before overriding repeated read-only probing on the same external investigation thread", async () => {
  const fakeChild = new FakeChildProcess();
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];
  let approvalRequestCount = 0;
  const outcomes: string[] = [];

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const commands = [
                "cat \"/tmp/probe/node_modules/@google/gemini-cli-core/dist/src/a.js\"",
                "grep -r \"quota\" \"/tmp/probe/node_modules/@google/gemini-cli-core/dist/src/\"",
                "ls \"/tmp/probe/node_modules/@google/gemini-cli-core/dist/src/\"",
                "find \"/tmp/probe/node_modules/@google/gemini-cli-core/dist/src/\" -name \"*.js\"",
                "cat \"/tmp/probe/node_modules/@google/gemini-cli-core/dist/src/b.js\"",
                "grep -r \"billing\" \"/tmp/probe/node_modules/@google/gemini-cli-core/dist/src/\""
              ];

              for (const title of commands) {
                const decision = await this.client.requestPermission({
                  options: [{ optionId: "allow_once", kind: "allow_once" }],
                  toolCall: {
                    title,
                    kind: "execute"
                  }
                });
                outcomes.push(decision.outcome.outcome);
              }

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Bootstrap sketch completed with cutoff",
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
    workflowStage: "project_structure_discovery",
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Bootstrap sketch completed with cutoff");
  assert.deepEqual(outcomes, ["selected", "selected", "selected", "selected", "selected", "selected"]);
  assert.equal(approvalRequestCount, 6);
  assert.equal(
    progressMessages.filter((entry) => entry.message === "Gemini guardrail override approved and waiting for result").length,
    2
  );
  assert.equal(
    progressMessages.some(
      (entry) => entry.details?.guardrailReason === "Rejected Gemini tool call because repeated probing hit the cutoff for this investigation thread"
    ),
    true
  );
});

test("gemini ACP invoker requests approval before overriding repeated managed CLI surface probing", async () => {
  const fakeChild = new FakeChildProcess();
  const outcomes: string[] = [];
  let approvalRequestCount = 0;
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const commands = [
                "\"/Users/test/managed-tools/bin/gemini\" --help",
                "\"/Users/test/managed-tools/bin/gemini\" /stats model --json",
                "\"/Users/test/managed-tools/bin/gemini\" /stats model cache --json",
                "\"/Users/test/managed-tools/bin/gemini\" --version",
                "\"/Users/test/managed-tools/bin/gemini\" login status"
              ];

              for (const title of commands) {
                const decision = await this.client.requestPermission({
                  options: [{ optionId: "allow_once", kind: "allow_once" }],
                  toolCall: {
                    title,
                    kind: "execute"
                  }
                });
                outcomes.push(decision.outcome.outcome);
              }

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Task orchestration gather stopped after CLI surface cutoff",
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
    workflowStage: "task_orchestration",
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Task orchestration gather stopped after CLI surface cutoff");
  assert.deepEqual(outcomes, ["selected", "selected", "selected", "selected", "selected"]);
  assert.equal(approvalRequestCount, 5);
  assert.equal(
    progressMessages.filter((entry) => entry.message === "Gemini guardrail override approved and waiting for result").length,
    1
  );
  assert.equal(
    progressMessages.some(
      (entry) => entry.details?.guardrailReason === "Rejected Gemini tool call because repeated probing hit the cutoff for this investigation thread"
    ),
    true
  );
});

test("gemini ACP invoker hands prompt-driven managed CLI commands off to a modal session instead of approving them", async () => {
  const fakeChild = new FakeChildProcess();
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];
  let approvalRequestCount = 0;
  let interactiveSessionCount = 0;
  let outcome = "";
  let handedOffCommand = "";

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const decision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "/Users/Test/TaskSaw/managed-tools/bin/gemini -p \"/stats model\" -o json [current working directory /Users/Test/TaskSaw] (Gemini CLI quota output 확인)",
                  kind: "execute"
                }
              });
              outcome = decision.outcome.outcome;

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Interactive CLI was handed off",
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
    supportedCapabilities: ["execute"]
  });

  const result = await adapter.execute!({
    ...createContext(TEST_MODEL),
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    requestInteractiveSession: async (request) => {
      interactiveSessionCount += 1;
      handedOffCommand = request.commandText;
      assert.match(request.commandText, /\/stats model/);
      return {
        outcome: "terminated",
        sessionId: "interactive-session-1",
        exitCode: 130,
        signal: 15,
        transcript: "interactive gemini session\n"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Interactive CLI was handed off");
  assert.equal(outcome, "cancelled");
  assert.equal(approvalRequestCount, 0);
  assert.equal(interactiveSessionCount, 1);
  assert.equal(handedOffCommand, "/Users/Test/TaskSaw/managed-tools/bin/gemini -p \"/stats model\" -o json");
  assert.equal(
    progressMessages.some((entry) => entry.message === "Opening modal interactive session for CLI tool call"),
    true
  );
});

test("gemini ACP invoker keeps plain managed CLI help probes on the normal approval path", async () => {
  const fakeChild = new FakeChildProcess();
  let approvalRequestCount = 0;
  let interactiveSessionCount = 0;
  let outcome = "";

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const decision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "/Users/Test/TaskSaw/managed-tools/bin/gemini --help [current working directory /Users/Test/TaskSaw]",
                  kind: "execute"
                }
              });
              outcome = decision.outcome.outcome;

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Managed CLI help stayed on approval path",
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
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    requestInteractiveSession: async () => {
      interactiveSessionCount += 1;
      return {
        outcome: "cancelled"
      };
    }
  });

  assert.equal(result.summary, "Managed CLI help stayed on approval path");
  assert.equal(outcome, "selected");
  assert.equal(approvalRequestCount, 1);
  assert.equal(interactiveSessionCount, 0);
});

test("gemini ACP invoker keeps bare slash-command probes on the normal approval path when no prompt flag is present", async () => {
  const fakeChild = new FakeChildProcess();
  let approvalRequestCount = 0;
  let interactiveSessionCount = 0;
  let outcome = "";

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const decision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "\"/Users/Test/TaskSaw/managed-tools/bin/gemini\" /stats model --json [current working directory /Users/Test/TaskSaw]",
                  kind: "execute"
                }
              });
              outcome = decision.outcome.outcome;

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Bare slash command stayed on approval path",
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
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    requestInteractiveSession: async () => {
      interactiveSessionCount += 1;
      return {
        outcome: "cancelled"
      };
    }
  });

  assert.equal(result.summary, "Bare slash command stayed on approval path");
  assert.equal(outcome, "selected");
  assert.equal(approvalRequestCount, 1);
  assert.equal(interactiveSessionCount, 0);
});

test("gemini ACP invoker lets focused gather inspect named external targets without low-signal override", async () => {
  const fakeChild = new FakeChildProcess();
  const outcomes: string[] = [];
  let approvalRequestCount = 0;
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const commands = [
                "ls -la \"/Users/test/managed-tools/bin/gemini\"",
                "find . -name \"gemini\" -type f -perm +111",
                "sed -n '1,40p' src/main/tool-manager.ts"
              ];

              for (const title of commands) {
                const decision = await this.client.requestPermission({
                  options: [{ optionId: "allow_once", kind: "allow_once" }],
                  toolCall: {
                    title,
                    kind: "execute"
                  }
                });
                outcomes.push(decision.outcome.outcome);
              }

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Focused gather stayed on named target inspection",
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

  const baseContext = createContext(TEST_MODEL);
  const result = await adapter.gather!({
    ...baseContext,
    node: {
      ...baseContext.node,
      title: "Focused Gather"
    },
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Focused gather stayed on named target inspection");
  assert.deepEqual(outcomes, ["selected", "selected", "selected"]);
  assert.equal(approvalRequestCount, 3);
  assert.equal(
    progressMessages.filter((entry) => entry.message === "Gemini guardrail override approved and waiting for result").length,
    1
  );
  assert.equal(
    progressMessages.some((entry) => entry.details?.guardrailReason === "Rejected Gemini tool call because focused gather must inspect named targets directly instead of rediscovering files or paths"),
    true
  );
});

test("gemini ACP invoker lets root gather inspect named external targets without low-signal override", async () => {
  const fakeChild = new FakeChildProcess();
  const outcomes: string[] = [];
  let approvalRequestCount = 0;
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const commands = [
                "ls -R \"/Users/test/managed-tools/home/.gemini\"",
                "find . -name \"gemini\" -type f -perm +111",
                "sed -n '1,40p' src/main/tool-manager.ts"
              ];

              for (const title of commands) {
                const decision = await this.client.requestPermission({
                  options: [{ optionId: "allow_once", kind: "allow_once" }],
                  toolCall: {
                    title,
                    kind: "execute"
                  }
                });
                outcomes.push(decision.outcome.outcome);
              }

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Root gather stayed on concrete target inspection",
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
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Root gather stayed on concrete target inspection");
  assert.deepEqual(outcomes, ["selected", "selected", "selected"]);
  assert.equal(approvalRequestCount, 3);
  assert.equal(
    progressMessages.filter((entry) => entry.message === "Gemini guardrail override approved and waiting for result").length,
    1
  );
  assert.equal(
    progressMessages.some(
      (entry) => entry.details?.guardrailReason === "Rejected Gemini tool call because task-orchestration gather must inspect concrete targets directly instead of rediscovering paths or directory contents"
    ),
    true
  );
});

test("gemini ACP invoker flags focused-gather internal log re-mining before rediscovery heuristics", async () => {
  const fakeChild = new FakeChildProcess();
  const outcomes: string[] = [];
  let approvalRequestCount = 0;
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const commands = [
                "grep -B 5 -A 5 \"Exit Code: 0\" gemini_debug.log | tail -n 100",
                "sed -n '1,40p' src/main/tool-manager.ts"
              ];

              for (const title of commands) {
                const decision = await this.client.requestPermission({
                  options: [{ optionId: "allow_once", kind: "allow_once" }],
                  toolCall: {
                    title,
                    kind: "execute"
                  }
                });
                outcomes.push(decision.outcome.outcome);
              }

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Focused gather blocked internal log re-mining early",
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

  const baseContext = createContext(TEST_MODEL);
  const result = await adapter.gather!({
    ...baseContext,
    node: {
      ...baseContext.node,
      title: "Focused Gather"
    },
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Focused gather blocked internal log re-mining early");
  assert.deepEqual(outcomes, ["cancelled", "selected"]);
  assert.equal(approvalRequestCount, 1);
  assert.equal(
    progressMessages.filter((entry) => entry.message === "Gemini guardrail override approved and waiting for result").length,
    0
  );
  assert.equal(
    progressMessages.some(
      (entry) => entry.details?.guardrailReason === "Rejected Gemini tool call because focused gather should not re-mine workspace-local debug logs or caches when named external targets are still pending"
    ),
    true
  );
});

test("gemini ACP invoker requests approval before overriding interactive transcript blockers on the same investigation thread", async () => {
  const fakeChild = new FakeChildProcess();
  const outcomes: string[] = [];
  let approvalRequestCount = 0;
  let interactiveSessionCount = 0;
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              const commands = [
                "\"/Users/Test/TaskSaw/managed-tools/bin/gemini\" -p \"/stats model\" -o json [current working directory /Users/Test/TaskSaw]",
                "\"/Users/Test/TaskSaw/managed-tools/bin/gemini\" /stats model --json [current working directory /Users/Test/TaskSaw]",
                "sed -n '1,20p' src/main/tool-manager.ts"
              ];

              for (const title of commands) {
                const decision = await this.client.requestPermission({
                  options: [{ optionId: "allow_once", kind: "allow_once" }],
                  toolCall: {
                    title,
                    kind: "execute"
                  }
                });
                outcomes.push(decision.outcome.outcome);
              }

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Interactive transcript blocker was reused",
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
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    requestInteractiveSession: async () => {
      interactiveSessionCount += 1;
      return {
        outcome: "terminated",
        sessionId: "interactive-session-1",
        exitCode: 0,
        signal: 0,
        transcript: "Loaded cached credentials.\n[LocalAgentExecutor] Blocked call: Unauthorized tool call: 'get_internal_docs' is not available to this agent.\n"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Interactive transcript blocker was reused");
  assert.deepEqual(outcomes, ["cancelled", "selected", "selected"]);
  assert.equal(approvalRequestCount, 2);
  assert.equal(interactiveSessionCount, 0);
  assert.equal(
    progressMessages.some((entry) => String(entry.message).includes("Auto-rejected interactive session during gather:")),
    true
  );
});

test("gemini ACP invoker closes stale permission callbacks after probe-loop abort", async () => {
  const fakeChild = new FakeChildProcess();
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];
  const outcomes: string[] = [];
  let approvalRequestCount = 0;
  let caughtAbortMessage = "";

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              return { protocolVersion: 1 };
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
              try {
                for (const title of [
                  "find . -name \"managed-tools\" -type d",
                  "pwd",
                  "which gemini"
                ]) {
                  const decision = await this.client.requestPermission({
                    options: [{ optionId: "allow_once", kind: "allow_once" }],
                    toolCall: {
                      title,
                      kind: "execute"
                    }
                  });
                  outcomes.push(decision.outcome.outcome);
                }
              } catch (error) {
                caughtAbortMessage = error instanceof Error ? error.message : String(error);
              }

              const staleDecision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "grep -r \"stats\" \"/Users/test/managed-tools/packages/gemini\" | head -n 20",
                  kind: "execute"
                }
              });
              outcomes.push(staleDecision.outcome.outcome);

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Abort latch ignored stale permission callback",
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
      approvalRequestCount += 1;
      return {
        outcome: "rejected"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Abort latch ignored stale permission callback");
  assert.equal(caughtAbortMessage, "Aborting Gemini ACP prompt after repeated rejected probing to preserve budget");
  assert.deepEqual(outcomes, ["cancelled", "cancelled", "cancelled"]);
  assert.equal(approvalRequestCount, 3);
  assert.equal(
    progressMessages.some((entry) => entry.message === "Aborting Gemini ACP prompt after repeated rejected probing to preserve budget"),
    true
  );
});

test("gemini ACP invoker aborts a gather prompt after repeated cutoff rejections to preserve budget", async () => {
  const fakeChild = new FakeChildProcess();
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];
  const outcomes: string[] = [];
  let approvalRequestCount = 0;

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
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
              };
            }

            async initialize() {
              return { protocolVersion: 1 };
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
              const commands = [
                "\"/Users/test/managed-tools/bin/gemini\" --help",
                "\"/Users/test/managed-tools/bin/gemini\" /stats model --json",
                "\"/Users/test/managed-tools/bin/gemini\" /stats model cache --json",
                "\"/Users/test/managed-tools/bin/gemini\" --version",
                "\"/Users/test/managed-tools/bin/gemini\" login status",
                "\"/Users/test/managed-tools/bin/gemini\" --help",
                "\"/Users/test/managed-tools/bin/gemini\" --version"
              ];

              for (const title of commands) {
                const decision = await this.client.requestPermission({
                  options: [{ optionId: "allow_once", kind: "allow_once" }],
                  toolCall: {
                    title,
                    kind: "execute"
                  }
                });
                outcomes.push(decision.outcome.outcome);
              }

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
    workflowStage: "task_orchestration",
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      if (approvalRequestCount > 4) {
        return {
          outcome: "rejected"
        };
      }
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(
    result.summary,
    "Gather stopped early after repeated external CLI probing hit the cutoff. Continue planning from the workspace-local evidence collected so far."
  );
  assert.deepEqual(outcomes, ["selected", "selected", "selected", "selected", "cancelled", "cancelled"]);
  assert.equal(approvalRequestCount, 5);
  assert.equal(
    progressMessages.some((entry) => entry.message === "Aborting Gemini ACP prompt after repeated rejected probing to preserve budget"),
    true
  );
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

test("gemini ACP invoker hard rejects read-only gather edit attempts", async () => {
  const fakeChild = new FakeChildProcess();
  const progressMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];
  let approvalRequestCount = 0;
  let editOutcome = "";
  let buildOutcome = "";
  let heredocOutcome = "";

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      cwd: process.cwd(),
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            private readonly client;

            constructor(toClient: () => object) {
              this.client = toClient() as {
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              const editDecision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "src/main/tool-manager.ts: old => new",
                  kind: "edit"
                }
              });
              editOutcome = editDecision.outcome.outcome;

              const buildDecision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "npm run build",
                  kind: "execute"
                }
              });
              buildOutcome = buildDecision.outcome.outcome;

              const heredocDecision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "cat << 'EOF' > plan.json",
                  kind: "execute"
                }
              });
              heredocOutcome = heredocDecision.outcome.outcome;

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Gather stayed read-only",
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
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    },
    reportProgress: (message, details) => {
      progressMessages.push({ message, details });
    }
  });

  assert.equal(result.summary, "Gather stayed read-only");
  assert.equal(editOutcome, "cancelled");
  assert.equal(buildOutcome, "selected");
  assert.equal(heredocOutcome, "selected");
  assert.equal(approvalRequestCount, 2);
  assert.equal(
    progressMessages.filter((entry) => entry.message === "Gemini guardrail override approved and waiting for result")
      .length,
    2
  );
  assert.equal(
    progressMessages.every((entry) =>
      entry.message !== "Gemini guardrail override approved and waiting for result"
      || entry.details?.guardrailReason === "Rejected Gemini tool call because this phase is read-only"
    ),
    true
  );
});

test("gemini ACP invoker routes concrete-plan execute tool calls through explicit guardrail override approval", async () => {
  const fakeChild = new FakeChildProcess();
  let approvalRequestCount = 0;
  let executeOutcome = "";

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      cwd: process.cwd(),
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            private readonly client;

            constructor(toClient: () => object) {
              this.client = toClient() as {
                requestPermission(params: {
                  options?: Array<{ optionId?: string; kind?: string }>;
                  toolCall?: {
                    title?: string;
                    kind?: string;
                  };
                }): Promise<{ outcome: { outcome: string } }>;
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
              const executeDecision = await this.client.requestPermission({
                options: [{ optionId: "allow_once", kind: "allow_once" }],
                toolCall: {
                  title: "cat plan.json",
                  kind: "execute"
                }
              });
              executeOutcome = executeDecision.outcome.outcome;

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Concrete plan stayed tool-free",
                      childTasks: [],
                      executionNotes: [],
                      needsMorePlanning: false
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
    supportedCapabilities: ["concretePlan"]
  });

  const result = await adapter.concretePlan!({
    ...createContext(TEST_MODEL),
    requestUserApproval: async () => {
      approvalRequestCount += 1;
      return {
        outcome: "selected",
        optionId: "allow_once"
      };
    }
  });

  assert.equal(result.summary, "Concrete plan stayed tool-free");
  assert.equal(executeOutcome, "selected");
  assert.equal(approvalRequestCount, 1);
});

test("gemini ACP invoker blocks direct file writes outside execute", async () => {
  const fakeChild = new FakeChildProcess();
  let writeError = "";

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: createGeminiAcpInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-gemini-entry.js"],
      acpModulePath: "/tmp/fake-gemini-acp.js",
      cwd: process.cwd(),
      dependencies: {
        loadAcpModule: async () => ({
          PROTOCOL_VERSION: 1,
          ndJsonStream: () => ({}),
          ClientSideConnection: class {
            private readonly client;

            constructor(toClient: () => object) {
              this.client = toClient() as {
                writeTextFile(params: { path?: string; content?: string }): Promise<void>;
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
              try {
                await this.client.writeTextFile({
                  path: "tmp/should-not-write.txt",
                  content: "blocked"
                });
              } catch (error) {
                writeError = error instanceof Error ? error.message : String(error);
              }

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Direct write blocked",
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

  assert.equal(result.summary, "Direct write blocked");
  assert.match(writeError, /only allowed during execute/);
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

test("gemini ACP invoker falls back to another Gemini model when the assigned model has no capacity", async () => {
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
      invalidStreamRetryCount: 0,
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
                throw new Error("No capacity available for model gemini-2.5-pro on the server");
              }

              await this.client.sessionUpdate({
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: JSON.stringify({
                      summary: "Recovered after Gemini capacity fallback",
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

  assert.equal(result.summary, "Recovered after Gemini capacity fallback");
  assert.equal(promptAttemptCount, 2);
  assert.deepEqual(sessionModelIds, [
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
