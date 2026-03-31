import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CliModelAdapter } from "./cli-model-adapter";
import { createCodexAppServerInvoker, createCodexAppServerSessionPool } from "./codex-app-server-invoker";
import { ModelInvocationContext } from "./model-adapter";
import { ModelRef } from "./types";

const TEST_MODEL: ModelRef = {
  id: "gpt-5.4",
  provider: "OpenAI",
  model: "gpt-5.4",
  tier: "upper",
  reasoningEffort: "high"
};

function createContext(model: ModelRef): ModelInvocationContext {
  return {
    run: {
      id: "run-test",
      goal: "Validate Codex app-server invocation",
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
      objective: "Validate Codex app-server invocation",
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
    role: "orchestrator",
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

function createSessionScopeHint(ownerTaskId = "task-root") {
  return {
    ownerTaskId,
    ownerTaskTitle: "Root Task",
    ownerTaskObjective: "Validate Codex app-server invocation",
    ownerTaskLineage: ["Root Task: Validate Codex app-server invocation"]
  };
}

class FakeCodexAppServerProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  private stdinCarryover = "";

  constructor(
    private readonly onRequest: (request: Record<string, unknown>, process: FakeCodexAppServerProcess) => void
  ) {
    super();

    this.stdin.on("data", (chunk: Buffer | string) => {
      this.stdinCarryover += chunk.toString();
      let newlineIndex = this.stdinCarryover.indexOf("\n");

      while (newlineIndex !== -1) {
        const line = this.stdinCarryover.slice(0, newlineIndex).trim();
        this.stdinCarryover = this.stdinCarryover.slice(newlineIndex + 1);
        if (line.length > 0) {
          this.onRequest(JSON.parse(line) as Record<string, unknown>, this);
        }
        newlineIndex = this.stdinCarryover.indexOf("\n");
      }
    });
  }

  override once(event: "error" | "exit", listener: (...args: unknown[]) => void): this {
    return super.once(event, listener);
  }

  override off(event: "error" | "exit", listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }

  respond(id: unknown, result: unknown) {
    this.stdout.write(`${JSON.stringify({ id, result })}\n`);
  }

  notify(method: string, params: Record<string, unknown>) {
    this.stdout.write(`${JSON.stringify({ method, params })}\n`);
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.exitCode = 0;
    this.signalCode = signal ?? null;
    this.emit("exit", 0, signal ?? null);
    return true;
  }
}

test("codex app-server invoker reuses scoped threads across runs and prepends an explicit replay prelude", async () => {
  const threadStartCalls: Array<Record<string, unknown>> = [];
  const turnStartCalls: Array<Record<string, unknown>> = [];
  let spawnCount = 0;

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "codex",
    executablePath: process.execPath,
    customInvoke: createCodexAppServerInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-codex-entry.js"],
      cwd: "/workspace/test",
      sessionPool: createCodexAppServerSessionPool(),
      dependencies: {
        spawnProcess: () => {
          spawnCount += 1;
          return new FakeCodexAppServerProcess((request, processRef) => {
            const id = request.id;
            const method = request.method;
            const params = (request.params ?? {}) as Record<string, unknown>;

            if (method === "initialize") {
              processRef.respond(id, { protocolVersion: 1 });
              return;
            }

            if (method === "thread/start") {
              threadStartCalls.push(params);
              processRef.respond(id, {
                thread: {
                  id: "thread-1"
                }
              });
              return;
            }

            if (method === "turn/start") {
              turnStartCalls.push(params);
              const turnId = `turn-${turnStartCalls.length}`;
              processRef.respond(id, {
                turn: {
                  id: turnId
                }
              });
              processRef.notify("turn/started", {
                turn: {
                  id: turnId
                }
              });
              processRef.notify("item/agentMessage/delta", {
                delta: turnStartCalls.length === 1
                  ? JSON.stringify({
                      summary: "Gathered via Codex",
                      evidenceBundles: []
                    })
                  : JSON.stringify({
                      summary: "Planned via Codex",
                      childTasks: [],
                      executionNotes: []
                    })
              });
              processRef.notify("turn/completed", {
                turn: {
                  id: turnId
                }
              });
            }
          });
        }
      }
    }),
    supportedCapabilities: ["gather", "concretePlan"]
  });

  const gatherContext = createContext(TEST_MODEL);
  gatherContext.run = {
    ...gatherContext.run,
    id: "run-1",
    goal: "Investigate the same task thread"
  };
  gatherContext.node = {
    ...gatherContext.node,
    id: "stage-gather-1",
    runId: "run-1"
  };
  gatherContext.sessionScopeHint = createSessionScopeHint("task-shared");

  const planContext = createContext(TEST_MODEL);
  planContext.run = {
    ...planContext.run,
    id: "run-2",
    goal: "Investigate the same task thread"
  };
  planContext.node = {
    ...planContext.node,
    id: "stage-plan-2",
    runId: "run-2",
    title: "Concrete Plan",
    objective: "Turn gathered evidence into a plan",
    phase: "concrete_plan",
    assignedModels: {
      concretePlanner: TEST_MODEL
    }
  };
  planContext.sessionScopeHint = createSessionScopeHint("task-shared");

  const gatherResult = await adapter.gather!(gatherContext);
  const planResult = await adapter.concretePlan!(planContext);

  const firstTurnInput = (((turnStartCalls[0]?.input as Array<Record<string, unknown>> | undefined) ?? [])[0]?.text ?? "") as string;
  const secondTurnInput = (((turnStartCalls[1]?.input as Array<Record<string, unknown>> | undefined) ?? [])[0]?.text ?? "") as string;

  assert.equal(gatherResult.summary, "Gathered via Codex");
  assert.equal(planResult.summary, "Planned via Codex");
  assert.equal(spawnCount, 1);
  assert.equal(threadStartCalls.length, 1);
  assert.equal(threadStartCalls[0]?.ephemeral, false);
  assert.equal(threadStartCalls[0]?.persistExtendedHistory, true);
  assert.equal(turnStartCalls.length, 2);
  assert.equal(turnStartCalls[0]?.threadId, "thread-1");
  assert.equal(turnStartCalls[1]?.threadId, "thread-1");
  assert.equal(firstTurnInput.includes("TASKSAW SESSION REUSE PRELUDE"), false);
  assert.equal(secondTurnInput.includes("TASKSAW SESSION REUSE PRELUDE"), true);
  assert.match(secondTurnInput, /response=Gathered via Codex/);
});

test("codex app-server invoker isolates thread reuse by task scope", async () => {
  const threadStartCalls: Array<Record<string, unknown>> = [];
  const turnStartCalls: Array<Record<string, unknown>> = [];
  let spawnCount = 0;

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "codex",
    executablePath: process.execPath,
    customInvoke: createCodexAppServerInvoker({
      executablePath: process.execPath,
      executableArgs: ["fake-codex-entry.js"],
      cwd: "/workspace/test",
      sessionPool: createCodexAppServerSessionPool(),
      dependencies: {
        spawnProcess: () => {
          spawnCount += 1;
          return new FakeCodexAppServerProcess((request, processRef) => {
            const id = request.id;
            const method = request.method;
            const params = (request.params ?? {}) as Record<string, unknown>;

            if (method === "initialize") {
              processRef.respond(id, { protocolVersion: 1 });
              return;
            }

            if (method === "thread/start") {
              threadStartCalls.push(params);
              processRef.respond(id, {
                thread: {
                  id: `thread-${threadStartCalls.length}`
                }
              });
              return;
            }

            if (method === "turn/start") {
              turnStartCalls.push(params);
              const turnId = `turn-${turnStartCalls.length}`;
              processRef.respond(id, {
                turn: {
                  id: turnId
                }
              });
              processRef.notify("turn/started", {
                turn: {
                  id: turnId
                }
              });
              processRef.notify("item/agentMessage/delta", {
                delta: JSON.stringify({
                  summary: "Gathered via Codex",
                  evidenceBundles: []
                })
              });
              processRef.notify("turn/completed", {
                turn: {
                  id: turnId
                }
              });
            }
          });
        }
      }
    }),
    supportedCapabilities: ["gather"]
  });

  const firstContext = createContext(TEST_MODEL);
  firstContext.run = {
    ...firstContext.run,
    id: "run-a",
    goal: "Investigate task A"
  };
  firstContext.node = {
    ...firstContext.node,
    id: "stage-a",
    runId: "run-a"
  };
  firstContext.sessionScopeHint = createSessionScopeHint("task-a");

  const secondContext = createContext(TEST_MODEL);
  secondContext.run = {
    ...secondContext.run,
    id: "run-b",
    goal: "Investigate task B"
  };
  secondContext.node = {
    ...secondContext.node,
    id: "stage-b",
    runId: "run-b",
    title: "Sibling Task",
    objective: "Inspect a different task scope"
  };
  secondContext.sessionScopeHint = {
    ownerTaskId: "task-b",
    ownerTaskTitle: "Sibling Task",
    ownerTaskObjective: "Inspect a different task scope",
    ownerTaskLineage: ["Sibling Task: Inspect a different task scope"]
  };

  await adapter.gather!(firstContext);
  await adapter.gather!(secondContext);

  const secondTurnInput = (((turnStartCalls[1]?.input as Array<Record<string, unknown>> | undefined) ?? [])[0]?.text ?? "") as string;

  assert.equal(spawnCount, 2);
  assert.equal(threadStartCalls.length, 2);
  assert.equal(turnStartCalls.length, 2);
  assert.equal(secondTurnInput.includes("TASKSAW SESSION REUSE PRELUDE"), false);
});
