import assert from "node:assert/strict";
import test from "node:test";
import { ModelAdapterRegistry } from "./adapter-registry";
import {
  OrchestratorRunCancelledError,
  OrchestratorRuntime
} from "./runtime";
import {
  AbstractPlanResult,
  ConcretePlanResult,
  ExecuteResult,
  GatherResult,
  ModelInvocationContext,
  OrchestratorCapability,
  OrchestratorModelAdapter,
  ReviewResult,
  VerifyResult
} from "./model-adapter";
import { EvidenceBundle, ModelRef, ProjectStructureSnapshot, RunSnapshot, WorkingMemorySnapshot } from "./types";

class MockAdapter implements OrchestratorModelAdapter {
  constructor(
    readonly model: ModelRef,
    private readonly capabilities: Set<OrchestratorCapability>,
    private readonly handlers: Partial<{
      abstractPlan: (context: ModelInvocationContext) => AbstractPlanResult | Promise<AbstractPlanResult>;
      gather: (context: ModelInvocationContext) => GatherResult | Promise<GatherResult>;
      concretePlan: (
        evidenceCount: number,
        factCount: number,
        context: ModelInvocationContext
      ) => ConcretePlanResult | Promise<ConcretePlanResult>;
      review: () => ReviewResult;
      execute: (context: ModelInvocationContext) => ExecuteResult | Promise<ExecuteResult>;
      verify: (context: ModelInvocationContext) => VerifyResult | Promise<VerifyResult>;
    }>,
    private readonly trace: string[]
  ) {}

  supports(capability: OrchestratorCapability): boolean {
    return this.capabilities.has(capability);
  }

  async abstractPlan(context: Parameters<NonNullable<OrchestratorModelAdapter["abstractPlan"]>>[0]) {
    this.trace.push(`abstract:${this.model.id}`);
    return await this.handlers.abstractPlan?.(context) ?? {
      summary: "Abstract plan ready",
      targetsToInspect: [],
      evidenceRequirements: []
    };
  }

  async gather(context: Parameters<NonNullable<OrchestratorModelAdapter["gather"]>>[0]) {
    this.trace.push(`gather:${this.model.id}`);
    return await this.handlers.gather?.(context) ?? {
      summary: "Gather done",
      evidenceBundles: []
    };
  }

  async concretePlan(context: Parameters<NonNullable<OrchestratorModelAdapter["concretePlan"]>>[0]) {
    this.trace.push(`concrete:${this.model.id}`);
    return await this.handlers.concretePlan?.(context.evidenceBundles.length, context.workingMemory.facts.length, context) ?? {
      summary: "Concrete plan ready",
      childTasks: [],
      executionNotes: []
    };
  }

  async review() {
    this.trace.push(`review:${this.model.id}`);
    return this.handlers.review?.() ?? {
      summary: "Review approved",
      approved: true,
      followUpQuestions: [],
      nextActions: []
    };
  }

  async execute(context: Parameters<NonNullable<OrchestratorModelAdapter["execute"]>>[0]) {
    this.trace.push(`execute:${this.model.id}`);
    return await this.handlers.execute?.(context) ?? {
      summary: "Execute complete",
      outputs: ["output"]
    };
  }

  async verify(context: Parameters<NonNullable<OrchestratorModelAdapter["verify"]>>[0]) {
    this.trace.push(`verify:${this.model.id}`);
    return await this.handlers.verify?.(context) ?? {
      summary: "Verification passed",
      passed: true,
      findings: []
    };
  }
}

test("runtime executes the minimal happy path and propagates evidence into planning", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const abstractPlanner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const concretePlanner: ModelRef = {
    id: "concrete-upper",
    provider: "mock",
    model: "concrete-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const verifier: ModelRef = {
    id: "verify-upper",
    provider: "mock",
    model: "verify-upper",
    tier: "upper",
    reasoningEffort: "high"
  };

  registry.register(
    new MockAdapter(
      abstractPlanner,
      new Set(["abstractPlan"]),
      {
        abstractPlan: () => ({
          summary: "Inspect orchestrator core boundaries first",
          targetsToInspect: ["src/orchestrator"],
          evidenceRequirements: ["Confirm evidence bundle schema"]
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: (context) => ({
          summary: "Gathered evidence for the orchestrator core",
          evidenceBundles: [
            {
              id: "bundle-a",
              summary: "Type definitions look stable",
              facts: [
                {
                  id: "fact-a",
                  statement: "Plan nodes already track phase and acceptance criteria",
                  confidence: "high",
                  referenceIds: []
                }
              ],
              hypotheses: [],
              unknowns: [],
              relevantTargets: [{ filePath: "src/orchestrator/types.ts" }],
              snippets: [],
              references: [],
              confidence: "high"
            },
            {
              id: "bundle-b",
              summary: "Engine transitions are implemented",
              facts: [
                {
                  id: "fact-b",
                  statement: "The engine already enforces valid phase transitions",
                  confidence: "high",
                  referenceIds: []
                }
              ],
              hypotheses: [],
              unknowns: [
                {
                  id: "unknown-a",
                  question: "How should real adapters stream partial output?",
                  impact: "medium",
                  referenceIds: []
                }
              ],
              relevantTargets: [{ filePath: "src/orchestrator/engine.ts" }],
              snippets: [],
              references: [],
              confidence: "medium"
            }
          ],
          projectStructure: context.node.depth === 0
            ? {
                summary: "The root task is centered on src/orchestrator",
                directories: [
                  {
                    path: "src/orchestrator",
                    summary: "Core orchestration code",
                    confidence: "high"
                  }
                ],
                keyFiles: [
                  {
                    path: "src/orchestrator/runtime.ts",
                    summary: "Main node execution loop",
                    confidence: "high"
                  }
                ],
                entryPoints: [],
                modules: [
                  {
                    name: "runtime",
                    summary: "Orchestrator runtime and phase loop",
                    relatedPaths: ["src/orchestrator/runtime.ts"],
                    confidence: "high"
                  }
                ],
                openQuestions: [],
                contradictions: []
              }
            : undefined
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      concretePlanner,
      new Set(["concretePlan"]),
      {
        concretePlan: (evidenceCount, factCount, context) => {
          assert.equal(evidenceCount, 2);
          assert.equal(factCount, 2);
          assert.equal(context.workflowStage, "task_orchestration");
          assert.equal(context.projectStructure.summary, "The root task is centered on src/orchestrator");
          assert.equal(context.projectStructure.keyFiles[0]?.path, "src/orchestrator/runtime.ts");
          return {
            summary: "Execute a single happy path runner before recursion",
            childTasks: [],
            executionNotes: ["Do not add DFS yet"]
          };
        }
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Happy path runner implemented",
          outputs: ["runtime.ts added", "adapter-registry.ts added"]
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      verifier,
      new Set(["verify"]),
      {
        verify: () => ({
          summary: "Happy path runtime validated",
          passed: true,
          findings: ["DFS scheduler is still pending"]
        })
      },
      trace
    )
  );

  let capturedSnapshot: RunSnapshot | undefined;
  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot(snapshot: RunSnapshot) {
        capturedSnapshot = snapshot;
      }
    } as never
  });
  const result = await runtime.executeHappyPath({
    goal: "Implement the minimal orchestrator happy path",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner,
      gatherer,
      concretePlanner,
      executor,
      verifier
    },
    acceptanceCriteria: {
      items: [
        {
          id: "happy-path-implemented",
          description: "The minimal happy path exists",
          required: true,
          status: "pending"
        }
      ]
    }
  });

  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:concrete-upper",
    "execute:execute-lower",
    "verify:verify-upper"
  ]);
  assert.equal(capturedSnapshot?.run.status, "done");
  assert.equal(result.snapshot.run.status, "done");
  assert.equal(result.rootNode.phase, "done");
  assert.equal(result.snapshot.nodes.filter((node) => node.role === "task").length, 2);
  assert.equal(result.snapshot.nodes.filter((node) => node.role === "stage").length, 6);
  assert.equal(result.snapshot.nodes.find((node) => node.parentId === null)?.kind, "planning");
  assert.equal(result.snapshot.nodes.find((node) => node.kind === "execution" && node.role === "task")?.kind, "execution");
  assert.equal(result.snapshot.evidenceBundles.length, 2);
  assert.equal(result.snapshot.workingMemory.facts.length, 2);
  assert.equal(result.snapshot.workingMemory.unknowns.length, 1);
  assert.equal(result.snapshot.workingMemory.openQuestions.length, 1);
  assert.equal(result.snapshot.projectStructure.summary, "The root task is centered on src/orchestrator");
  assert.equal(result.snapshot.projectStructure.directories[0]?.path, "src/orchestrator");
  assert.equal(result.snapshot.finalReport?.summary, "Happy path runtime validated");
  assert.equal(result.snapshot.nodes[0]?.acceptanceCriteria.items[0]?.status, "met");
  assert.deepEqual(result.finalReport.outcomes, ["runtime.ts added", "adapter-registry.ts added"]);
  assert.deepEqual(result.finalReport.unresolvedRisks, [
    "Confirm evidence bundle schema",
    "How should real adapters stream partial output?"
  ]);
});

test("runtime carries gathered bundles into concrete planning, execution, and phase results", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Inspect the gathered renderer evidence",
          targetsToInspect: ["src/renderer/app.ts"],
          evidenceRequirements: ["Confirm the renderer quota path"]
        }),
        concretePlan: (_evidenceCount, _factCount, context) => {
          assert.deepEqual(context.evidenceBundles.map((bundle) => bundle.id), ["gathered-renderer-evidence"]);
          assert.equal(context.evidenceBundles[0]?.snippets[0]?.content, "window.tasksaw.getQuota()");
          return {
            summary: "Execution can proceed with the gathered renderer evidence",
            childTasks: [],
            executionNotes: []
          };
        },
        verify: (context) => {
          assert.deepEqual(context.evidenceBundles.map((bundle) => bundle.id), ["gathered-renderer-evidence"]);
          return {
            summary: "Verification saw the gathered renderer evidence",
            passed: true,
            findings: []
          };
        }
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gathered renderer quota evidence",
          evidenceBundles: [
            {
              id: "gathered-renderer-evidence",
              summary: "Renderer quota evidence",
              facts: [
                {
                  id: "renderer-fact",
                  statement: "renderer/app.ts reads quota data through window.tasksaw.getQuota().",
                  confidence: "high",
                  referenceIds: []
                }
              ],
              hypotheses: [],
              unknowns: [],
              relevantTargets: [{ filePath: "src/renderer/app.ts" }],
              snippets: [
                {
                  id: "renderer-snippet",
                  kind: "code",
                  content: "window.tasksaw.getQuota()",
                  rationale: "Current renderer quota fetch path"
                }
              ],
              references: [
                {
                  id: "renderer-ref",
                  sourceType: "file",
                  note: "Renderer quota fetch call site"
                }
              ],
              confidence: "high"
            }
          ]
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: (context) => {
          assert.deepEqual(context.evidenceBundles.map((bundle) => bundle.id), ["gathered-renderer-evidence"]);
          return {
            summary: "Executed with gathered renderer evidence",
            outputs: ["renderer quota execution complete"]
          };
        }
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot() {
        // no-op
      }
    } as never
  });

  const result = await runtime.executeHappyPath({
    goal: "Preserve gathered renderer context through planning",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.deepEqual(result.phaseResults.evidenceBundles.map((bundle) => bundle.id), ["gathered-renderer-evidence"]);
  assert.equal(result.phaseResults.evidenceBundles[0]?.references[0]?.note, "Renderer quota fetch call site");
});

test("runtime keeps initial gather evidence during focused replan and avoids duplicate focused bundles", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  let abstractPlanCallCount = 0;
  let concretePlanCallCount = 0;
  let gatherCallCount = 0;

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: (context) => {
          abstractPlanCallCount += 1;
          if (abstractPlanCallCount === 1) {
            return {
              summary: "Inspect the initial quota blocker",
              targetsToInspect: ["src/main/tool-manager.ts"],
              evidenceRequirements: ["Confirm the initial quota blocker"]
            };
          }

          assert.deepEqual(context.evidenceBundles.map((bundle) => bundle.id), ["initial-bundle"]);
          return {
            summary: "Inspect the focused follow-up target",
            targetsToInspect: ["src/preload/preload.ts"],
            evidenceRequirements: ["Confirm the focused follow-up evidence"]
          };
        },
        concretePlan: (_evidenceCount, _factCount, context) => {
          concretePlanCallCount += 1;
          if (concretePlanCallCount === 1) {
            assert.deepEqual(context.evidenceBundles.map((bundle) => bundle.id), ["initial-bundle"]);
            return {
              summary: "Need one more focused gather pass",
              childTasks: [],
              executionNotes: [],
              needsAdditionalGather: true,
              additionalGatherObjectives: ["Inspect the preload bridge that carries the quota response"]
            };
          }

          assert.deepEqual(context.evidenceBundles.map((bundle) => bundle.id), ["initial-bundle", "focused-bundle"]);
          return {
            summary: "The combined evidence is ready for execution",
            childTasks: [],
            executionNotes: []
          };
        },
        verify: (context) => {
          assert.deepEqual(context.evidenceBundles.map((bundle) => bundle.id), ["initial-bundle", "focused-bundle"]);
          return {
            summary: "Focused evidence was preserved without duplication",
            passed: true,
            findings: []
          };
        }
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: (context) => {
          gatherCallCount += 1;
          if (gatherCallCount === 1) {
            return {
              summary: "Initial gather captured the quota blocker",
              evidenceBundles: [
                {
                  id: "initial-bundle",
                  summary: "Initial quota blocker evidence",
                  facts: [
                    {
                      id: "initial-fact",
                      statement: "tool-manager.ts still returns remainingPercent:null for the managed Gemini surface.",
                      confidence: "high",
                      referenceIds: []
                    }
                  ],
                  hypotheses: [],
                  unknowns: [],
                  relevantTargets: [{ filePath: "src/main/tool-manager.ts" }],
                  snippets: [],
                  references: [],
                  confidence: "high"
                }
              ]
            };
          }

          assert.deepEqual(context.evidenceBundles.map((bundle) => bundle.id), ["initial-bundle"]);
          return {
            summary: "Focused gather captured the preload bridge evidence",
            evidenceBundles: [
              {
                id: "focused-bundle",
                summary: "Focused preload evidence",
                facts: [
                  {
                    id: "focused-fact",
                    statement: "preload.ts forwards the quota payload without rewriting remainingPercent.",
                    confidence: "high",
                    referenceIds: []
                  }
                ],
                hypotheses: [],
                unknowns: [],
                relevantTargets: [{ filePath: "src/preload/preload.ts" }],
                snippets: [],
                references: [],
                confidence: "high"
              }
            ]
          };
        }
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: (context) => {
          assert.deepEqual(context.evidenceBundles.map((bundle) => bundle.id), ["initial-bundle", "focused-bundle"]);
          return {
            summary: "Executed with both initial and focused evidence",
            outputs: ["focused execution complete"]
          };
        }
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot() {
        // no-op
      }
    } as never
  });

  const result = await runtime.executeHappyPath({
    goal: "Carry initial gather evidence through focused replanning",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.deepEqual(result.phaseResults.evidenceBundles.map((bundle) => bundle.id), ["initial-bundle", "focused-bundle"]);
});

test("runtime persists terminal output events emitted by adapters", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const abstractPlanner: ModelRef = {
    id: "terminal-planner",
    provider: "mock",
    model: "terminal-planner",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "terminal-gatherer",
    provider: "mock",
    model: "terminal-gatherer",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const concretePlanner: ModelRef = {
    id: "terminal-concrete",
    provider: "mock",
    model: "terminal-concrete",
    tier: "upper",
    reasoningEffort: "high"
  };
  const executor: ModelRef = {
    id: "terminal-executor",
    provider: "mock",
    model: "terminal-executor",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const verifier: ModelRef = {
    id: "terminal-verifier",
    provider: "mock",
    model: "terminal-verifier",
    tier: "upper",
    reasoningEffort: "high"
  };

  registry.register(new MockAdapter(abstractPlanner, new Set(["abstractPlan"]), {}, trace));
  registry.register(new MockAdapter(gatherer, new Set(["gather"]), {}, trace));
  registry.register(new MockAdapter(concretePlanner, new Set(["concretePlan"]), {}, trace));
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: (context) => {
          context.reportTerminalEvent?.({
            stream: "system",
            text: "$ echo hello\n"
          });
          context.reportTerminalEvent?.({
            stream: "stdout",
            text: "hello\n"
          });
          return {
            summary: "Executed with terminal output",
            outputs: ["hello"]
          };
        }
      },
      trace
    )
  );
  registry.register(new MockAdapter(verifier, new Set(["verify"]), {}, trace));

  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot() {
        // no-op
      }
    } as never
  });

  const result = await runtime.executeHappyPath({
    goal: "Capture node terminal output",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner,
      gatherer,
      concretePlanner,
      executor,
      verifier
    },
    acceptanceCriteria: {
      items: [
        {
          id: "terminal-events-recorded",
          description: "Terminal output is persisted on the execution node",
          required: true,
          status: "pending"
        }
      ]
    }
  });

  const terminalEvents = result.snapshot.events.filter((event) => event.type === "terminal_output");
  assert.equal(terminalEvents.length, 2);
  assert.equal(terminalEvents[0]?.payload.stream, "system");
  assert.equal(terminalEvents[1]?.payload.stream, "stdout");
  assert.match(String(terminalEvents[1]?.payload.text ?? ""), /hello/);
  assert.equal(terminalEvents[0]?.nodeId, terminalEvents[1]?.nodeId);
  assert.equal(typeof terminalEvents[0]?.payload.sessionId, "string");
});

test("runtime routes interactive session requests through the handler and records the transcript", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const abstractPlanner: ModelRef = {
    id: "interactive-planner",
    provider: "mock",
    model: "interactive-planner",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "interactive-gatherer",
    provider: "mock",
    model: "interactive-gatherer",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const concretePlanner: ModelRef = {
    id: "interactive-concrete",
    provider: "mock",
    model: "interactive-concrete",
    tier: "upper",
    reasoningEffort: "high"
  };
  const executor: ModelRef = {
    id: "interactive-executor",
    provider: "mock",
    model: "interactive-executor",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const verifier: ModelRef = {
    id: "interactive-verifier",
    provider: "mock",
    model: "interactive-verifier",
    tier: "upper",
    reasoningEffort: "high"
  };

  registry.register(new MockAdapter(abstractPlanner, new Set(["abstractPlan"]), {}, trace));
  registry.register(new MockAdapter(gatherer, new Set(["gather"]), {}, trace));
  registry.register(new MockAdapter(concretePlanner, new Set(["concretePlan"]), {}, trace));
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: async (context) => {
          const response = await context.requestInteractiveSession?.({
            abortSignal: context.abortSignal,
            title: "Interactive Gemini stats probe",
            message: "Open a modal PTY for the Gemini stats command",
            commandText: "./managed-tools/bin/gemini -p \"/stats model\" -o json",
            cwd: "/workspace/demo"
          });

          return {
            summary: `Interactive session outcome: ${response?.outcome ?? "none"}`,
            outputs: [response?.transcript ?? ""]
          };
        }
      },
      trace
    )
  );
  registry.register(new MockAdapter(verifier, new Set(["verify"]), {}, trace));

  const interactiveRequests: string[] = [];
  const runtime = new OrchestratorRuntime(registry, {
    requestInteractiveSession: async (request) => {
      interactiveRequests.push(request.commandText);
      return {
        outcome: "terminated",
        sessionId: "interactive-session-1",
        exitCode: 130,
        signal: 15,
        transcript: "gemini interactive prompt\ncancelled by user\n"
      };
    }
  });

  const result = await runtime.executeHappyPath({
    goal: "Handle interactive CLI session handoff",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner,
      gatherer,
      concretePlanner,
      executor,
      verifier
    },
    acceptanceCriteria: {
      items: [
        {
          id: "interactive-session-recorded",
          description: "Interactive session handoff is recorded",
          required: true,
          status: "pending"
        }
      ]
    }
  });

  assert.deepEqual(interactiveRequests, ["./managed-tools/bin/gemini -p \"/stats model\" -o json"]);
  const requestEvent = result.snapshot.events.find((event) => event.type === "interactive_session_requested");
  const resolvedEvent = result.snapshot.events.find((event) => event.type === "interactive_session_resolved");
  assert.equal(requestEvent?.payload.commandText, "./managed-tools/bin/gemini -p \"/stats model\" -o json");
  assert.equal(resolvedEvent?.payload.outcome, "terminated");
  assert.equal(resolvedEvent?.payload.sessionId, "interactive-session-1");

  const terminalEvents = result.snapshot.events.filter((event) => event.type === "terminal_output");
  assert.equal(
    terminalEvents.some((event) => String(event.payload.text ?? "").includes("gemini interactive prompt")),
    true
  );
});

test("runtime runs a focused replan and regather loop when concrete planning requests narrower evidence", async () => {
  const trace: string[] = [];
  const gatherObjectives: string[] = [];
  const registry = new ModelAdapterRegistry();
  let abstractCallCount = 0;
  let concreteCallCount = 0;
  let gatherCallCount = 0;

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const verifier: ModelRef = {
    id: "verify-lower",
    provider: "mock",
    model: "verify-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan"]),
      {
        abstractPlan: (context) => {
          abstractCallCount += 1;
          trace.push(`abstract:${abstractCallCount}:${context.node.title}`);
          if (abstractCallCount === 1) {
            return {
              summary: "Inspect the existing Gemini quota entrypoint first",
              targetsToInspect: ["src/main/tool-manager.ts"],
              evidenceRequirements: ["Confirm which Gemini quota retrieval path currently exists"]
            };
          }

          return {
            summary: "Narrow the follow-up inspection to the concrete Gemini quota surface",
            targetsToInspect: ["src/main/gemini-quota.ts"],
            evidenceRequirements: ["Confirm the concrete quota API and returned fields"]
          };
        },
        concretePlan: () => {
          concreteCallCount += 1;
          trace.push(`concrete:${concreteCallCount}:Concrete Plan`);
          if (concreteCallCount === 1) {
            return {
              summary: "The evidence is still too broad; narrow the next gather pass before execution",
              childTasks: [],
              executionNotes: [],
              needsAdditionalGather: true,
              additionalGatherObjectives: ["Inspect the concrete Gemini quota function and its returned schema"]
            };
          }

          return {
            summary: "The quota integration path is now specific enough to execute",
            childTasks: [],
            executionNotes: ["Implement against the confirmed Gemini quota API"],
            needsAdditionalGather: false
          };
        }
      },
      trace
    )
  );

  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: (context) => {
          gatherCallCount += 1;
          gatherObjectives.push(context.node.objective);
          trace.push(`gather:${gatherCallCount}:${context.node.title}`);
          if (gatherCallCount === 1) {
            return {
              summary: "Initial gather found multiple possible Gemini quota codepaths",
              evidenceBundles: [
                {
                  id: "broad-quota-evidence",
                  summary: "Broad Gemini quota candidates",
                  facts: [],
                  hypotheses: [],
                  unknowns: [
                    {
                      id: "quota-surface",
                      question: "Which Gemini quota function is the real integration target?",
                      impact: "high",
                      referenceIds: []
                    }
                  ],
                  relevantTargets: [{ filePath: "src/main/tool-manager.ts" }],
                  snippets: [],
                  references: [],
                  confidence: "medium"
                }
              ]
            };
          }

          return {
            summary: "Focused gather confirmed the concrete Gemini quota module and schema",
            evidenceBundles: [
              {
                id: "focused-quota-evidence",
                summary: "Focused Gemini quota evidence",
                facts: [
                  {
                    id: "quota-api",
                    statement: "The Gemini quota integration should use src/main/gemini-quota.ts",
                    confidence: "high",
                    referenceIds: []
                  }
                ],
                hypotheses: [],
                unknowns: [],
                relevantTargets: [{ filePath: "src/main/gemini-quota.ts" }],
                snippets: [],
                references: [],
                confidence: "high"
              }
            ]
          };
        }
      },
      trace
    )
  );

  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution completed after focused regather",
          outputs: ["focused-regather-output"],
          completed: true
        })
      },
      trace
    )
  );

  registry.register(
    new MockAdapter(
      verifier,
      new Set(["verify"]),
      {
        verify: () => ({
          summary: "Focused regather output verified",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeHappyPath({
    goal: "Make Gemini quota gathering precise before execution",
    language: "en",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier
    },
    reviewPolicy: "none"
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "abstract:1:Abstract Plan",
    "gather:gather-lower",
    "gather:1:Gather",
    "concrete:planner-upper",
    "concrete:1:Concrete Plan",
    "abstract:planner-upper",
    "abstract:2:Focused Replan",
    "gather:gather-lower",
    "gather:2:Focused Gather",
    "concrete:planner-upper",
    "concrete:2:Concrete Plan",
    "execute:execute-lower",
    "verify:verify-lower"
  ]);
  assert.equal(gatherObjectives.length, 2);
  assert.match(gatherObjectives[0]!, /Current gather contract:/);
  assert.match(gatherObjectives[0]!, /Inspection targets from abstract plan: src\/main\/tool-manager\.ts/);
  assert.match(gatherObjectives[1]!, /Focused gather objectives from concrete plan: Inspect the concrete Gemini quota function and its returned schema/);
  assert.match(gatherObjectives[1]!, /Inspection targets from abstract plan: src\/main\/gemini-quota\.ts/);
});

test("runtime records non-zero interactive session exits as failed", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner",
    provider: "mock",
    model: "planner",
    tier: "upper",
    reasoningEffort: "high"
  };
  const worker: ModelRef = {
    id: "worker",
    provider: "mock",
    model: "worker",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(new MockAdapter(planner, new Set(["abstractPlan", "concretePlan", "verify"]), {}, trace));
  registry.register(
    new MockAdapter(
      worker,
      new Set(["gather", "execute"]),
      {
        execute: async (context) => {
          const response = await context.requestInteractiveSession?.({
            abortSignal: context.abortSignal,
            title: "Broken interactive probe",
            message: "Run the interactive probe",
            commandText: "./managed-tools/bin/gemini --help",
            cwd: "/workspace/demo"
          });

          return {
            summary: response?.outcome ?? "none",
            outputs: []
          };
        }
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry, {
    requestInteractiveSession: async () => ({
      outcome: "failed",
      sessionId: "interactive-session-failed",
      exitCode: 127,
      signal: 0,
      transcript: "zsh: command not found\n"
    })
  });

  const result = await runtime.executeHappyPath({
    goal: "Record failed interactive session exits",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer: worker,
      concretePlanner: planner,
      executor: worker,
      verifier: planner
    },
    acceptanceCriteria: {
      items: [
        {
          id: "interactive-session-failure-recorded",
          description: "The failed interactive session is recorded explicitly",
          required: true,
          status: "pending"
        }
      ]
    }
  });

  const resolvedEvent = result.snapshot.events.find((event) => event.type === "interactive_session_resolved");
  const failedStatusEvent = result.snapshot.events.find((event) =>
    event.type === "execution_status" && event.payload.state === "interactive_session_failed"
  );

  assert.equal(resolvedEvent?.payload.outcome, "failed");
  assert.equal(failedStatusEvent?.payload.message, "Interactive CLI session failed");
});

test("runtime forces a focused regather before accepting an exact-data fallback plan with weak blocker evidence", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();
  let abstractCallCount = 0;
  let concreteCallCount = 0;
  let gatherCallCount = 0;

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const verifier: ModelRef = {
    id: "verify-lower",
    provider: "mock",
    model: "verify-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan"]),
      {
        abstractPlan: () => {
          abstractCallCount += 1;
          trace.push(`abstract:${abstractCallCount}`);
          if (abstractCallCount === 1) {
            return {
              summary: "Inspect the current backend usage path first",
              targetsToInspect: ["src/main/tool-manager.ts"],
              evidenceRequirements: ["Confirm what Gemini usage data TaskSaw currently exposes"]
            };
          }

          return {
            summary: "Inspect the narrowest managed Gemini surface that could expose quota data",
            targetsToInspect: ["/Users/test/managed-tools/bin/gemini"],
            evidenceRequirements: ["Confirm whether the managed Gemini surface exposes or blocks quota data"]
          };
        },
        concretePlan: () => {
          concreteCallCount += 1;
          trace.push(`concrete:${concreteCallCount}`);
          if (concreteCallCount === 1) {
            return {
              summary: "Since exact Gemini quota is unavailable, switch the UI to n/a instead of --%",
              childTasks: [],
              executionNotes: ["Fallback to an n/a label for unavailable Gemini usage data"]
            };
          }

          return {
            summary: "Explicit blocker evidence confirms the exact quota source is unavailable, so the fallback UI change is now justified",
            childTasks: [],
            executionNotes: ["Use the evidence-backed n/a fallback because the requested exact quota source is unsupported"]
          };
        }
      },
      trace
    )
  );

  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => {
          gatherCallCount += 1;
          trace.push(`gather:${gatherCallCount}`);
          if (gatherCallCount === 1) {
            return {
              summary: "Initial gather only confirmed the current backend path returns null",
              evidenceBundles: [
                {
                  id: "initial-usage-evidence",
                  summary: "Current Gemini usage path",
                  facts: [
                    {
                      id: "tool-manager-null",
                      statement: "src/main/tool-manager.ts currently returns null remainingPercent for Gemini usage.",
                      confidence: "high",
                      referenceIds: []
                    }
                  ],
                  hypotheses: [],
                  unknowns: [],
                  relevantTargets: [{ filePath: "src/main/tool-manager.ts" }],
                  snippets: [],
                  references: [],
                  confidence: "medium"
                }
              ]
            };
          }

          return {
            summary: "Focused gather confirmed the managed Gemini surface does not expose quota data through the supported status path",
            evidenceBundles: [
              {
                id: "focused-blocker-evidence",
                summary: "Managed Gemini quota blocker evidence",
                facts: [
                  {
                    id: "managed-surface-blocked",
                    statement: "The managed-tools Gemini CLI surface does not expose quota data through the supported /stats model path.",
                    confidence: "high",
                    referenceIds: []
                  }
                ],
                hypotheses: [],
                unknowns: [],
                relevantTargets: [{ note: "managed-tools Gemini CLI /stats model surface" }],
                snippets: [
                  {
                    id: "terminal-proof",
                    kind: "terminal",
                    content: "gemini /stats model did not provide usable quota output",
                    rationale: "Direct blocker evidence"
                  }
                ],
                references: [
                  {
                    id: "managed-cli-surface",
                    sourceType: "terminal",
                    note: "Managed Gemini CLI capability check"
                  }
                ],
                confidence: "high"
              }
            ]
          };
        }
      },
      trace
    )
  );

  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Executed the evidence-backed fallback change",
          outputs: ["usage-label-fallback-updated"],
          completed: true
        })
      },
      trace
    )
  );

  registry.register(
    new MockAdapter(
      verifier,
      new Set(["verify"]),
      {
        verify: () => ({
          summary: "Fallback change verified after explicit blocker evidence",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeHappyPath({
    goal: "Gemini 사용량을 정확하게 보여주되 불가능하면 명확한 fallback만 허용하자",
    language: "ko",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier
    },
    reviewPolicy: "none"
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "abstract:1",
    "gather:gather-lower",
    "gather:1",
    "concrete:planner-upper",
    "concrete:1",
    "abstract:planner-upper",
    "abstract:2",
    "gather:gather-lower",
    "gather:2",
    "concrete:planner-upper",
    "concrete:2",
    "execute:execute-lower",
    "verify:verify-lower"
  ]);
  assert.equal(gatherCallCount, 2);
  assert.equal(concreteCallCount, 2);
  assert.ok(result.snapshot.finalReport);
  assert.match(
    result.snapshot.finalReport.summary,
    /Fallback change verified after explicit blocker evidence/
  );
});

test("runtime runs review after verify and does not let review reject execution", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "review", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Inspect the current top bar and tool state path",
          targetsToInspect: [],
          evidenceRequirements: []
        }),
        concretePlan: () => ({
          summary: "Execution ready",
          childTasks: [],
          executionNotes: []
        }),
        review: () => ({
          summary: "최종 리뷰: quota source 확인이 다음 단계입니다",
          approved: false,
          followUpQuestions: ["Codex와 Gemini의 quota source를 확정해야 합니다"],
          nextActions: [
            {
              title: "Quota source 확인",
              objective: "Codex와 Gemini의 quota source와 refresh semantics를 확정한다",
              rationale: "남은 사용량 퍼센트 UI를 정확하게 표시하려면 먼저 데이터 소스를 고정해야 합니다",
              priority: "high"
            }
          ],
          carryForward: {
            facts: ["topbar가 compact indicator 위치 후보다"],
            openQuestions: ["Codex와 Gemini의 quota source를 확정해야 합니다"],
            projectPaths: ["src/main/tool-manager.ts", "src/renderer/app.ts"],
            evidenceSummaries: ["현재 tool state에는 quota field가 없다"]
          }
        }),
        verify: () => ({
          summary: "Verification passed",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(new MockAdapter(gatherer, new Set(["gather"]), {}, trace));
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution complete",
          outputs: ["usage chip UI added"]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeHappyPath({
    goal: "Add a compact usage indicator",
    reviewPolicy: "light",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      reviewer: planner,
      executor,
      verifier: planner
    }
  });

  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "execute:execute-lower",
    "verify:planner-upper",
    "review:planner-upper"
  ]);
  assert.equal(result.snapshot.run.status, "done");
  assert.equal(result.finalReport.summary, "최종 리뷰: quota source 확인이 다음 단계입니다");
  assert.equal(result.finalReport.nextActions.length, 1);
  assert.deepEqual(result.finalReport.carryForward?.projectPaths, ["src/main/tool-manager.ts", "src/renderer/app.ts"]);
  assert.deepEqual(result.finalReport.unresolvedRisks, ["Codex와 Gemini의 quota source를 확정해야 합니다"]);
});

test("runtime tolerates malformed evidence referenceIds from gather responses", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Inspect the runtime only",
          targetsToInspect: [],
          evidenceRequirements: []
        }),
        concretePlan: () => ({
          summary: "Execute directly",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Verification passed",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gathered evidence with loose Gemini-style fields",
          evidenceBundles: [
            {
              id: "bundle-malformed-reference-ids",
              summary: "Collected evidence",
              facts: [
                {
                  id: "fact-invalid",
                  statement: "   " as string,
                  confidence: "mixed",
                  referenceIds: []
                },
                {
                  id: "fact-main-ipc",
                  statement: "The main process owns tool discovery",
                  confidence: "high",
                  referenceIds: "ref-main-ipc" as unknown as string[]
                }
              ],
              hypotheses: [],
              unknowns: [
                {
                  id: "unknown-invalid",
                  question: "",
                  impact: "medium",
                  referenceIds: []
                }
              ],
              relevantTargets: [],
              snippets: [],
              references: [],
              confidence: "mixed"
            }
          ]
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution complete",
          outputs: ["ok"]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry, {
    enableRootBootstrapSketch: true
  });
  const result = await runtime.executeScheduledRun({
    goal: "Handle loose gather evidence from Gemini",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.equal(result.snapshot.workingMemory.facts.length, 1);
  assert.equal(result.snapshot.workingMemory.unknowns.length, 0);
  assert.deepEqual(result.snapshot.workingMemory.facts[0]?.referenceIds, ["ref-main-ipc"]);
});

test("runtime runs a low-cost bootstrap sketch before root planning when no clues are seeded", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: (context) => {
          trace.push(`abstract-context:${context.projectStructure.summary}`);
          return {
            summary: "Plan with bootstrap clues",
            targetsToInspect: [],
            evidenceRequirements: []
          };
        },
        concretePlan: () => ({
          summary: "Execution-ready after bootstrap",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Verification passed",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: (context) => {
          trace.push(`gather-stage:${context.workflowStage}:${context.node.title}`);
          if (context.workflowStage === "bootstrap_sketch") {
            return {
              summary: "Bootstrap sketch complete",
              evidenceBundles: [
                {
                  id: "bootstrap-bundle",
                  summary: "Coarse repository clues",
                  facts: [
                    {
                      id: "bootstrap-fact",
                      statement: "src/main owns Electron and tool orchestration",
                      confidence: "medium",
                      referenceIds: []
                    }
                  ],
                  hypotheses: [],
                  unknowns: [],
                  relevantTargets: [],
                  snippets: [],
                  references: [],
                  confidence: "mixed"
                }
              ],
              projectStructure: {
                summary: "Coarse sketch: main, renderer, and orchestrator layers exist",
                directories: [
                  {
                    path: "src/main",
                    summary: "Electron main process",
                    confidence: "mixed",
                    referenceIds: []
                  }
                ],
                keyFiles: [],
                entryPoints: [],
                modules: [],
                openQuestions: [],
                contradictions: []
              }
            };
          }

          return {
            summary: "Focused gather complete",
            evidenceBundles: [],
            projectStructure: undefined
          };
        }
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution complete",
          outputs: ["ok"]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry, {
    enableRootBootstrapSketch: true
  });
  const result = await runtime.executeScheduledRun({
    goal: "Bootstrap the repository before planning",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.equal(result.snapshot.nodes.some((node) => node.title === "Bootstrap Sketch"), true);
  assert.equal(trace.includes("gather-stage:bootstrap_sketch:Bootstrap Sketch"), true);
  assert.equal(trace.includes("abstract-context:Coarse sketch: main, renderer, and orchestrator layers exist"), true);
  assert.ok(trace.indexOf("gather-stage:bootstrap_sketch:Bootstrap Sketch") < trace.indexOf("abstract:planner-upper"));
});

test("runtime seeds continuation snapshots into the next run", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: (context) => {
          assert.equal(context.run.continuedFromRunId, "previous-run");
          assert.equal(context.evidenceBundles.length, 1);
          assert.equal(context.evidenceBundles[0]?.summary, "Recovered crash evidence");
          assert.equal(context.projectStructure.summary, "Recovered repository structure");
          assert.equal(context.projectStructure.keyFiles[0]?.path, "src/orchestrator/runtime.ts");
          assert.equal(
            context.workingMemory.facts.some((fact) => fact.statement === "Previous root evidence was already collected"),
            true
          );
          assert.equal(
            context.workingMemory.openQuestions.every((question) => question.relatedNodeIds.includes(context.node.id)),
            true
          );

          return {
            summary: "Resume from the last persisted context",
            targetsToInspect: ["src/orchestrator/runtime.ts"],
            evidenceRequirements: ["Confirm the resumed run reuses previous evidence"]
          };
        },
        concretePlan: (_evidenceCount, factCount, context) => {
          assert.equal(context.evidenceBundles.length, 2);
          assert.equal(factCount >= 2, true);
          assert.equal(context.projectStructure.directories[0]?.path, "src/orchestrator");
          return {
            summary: "Proceed with the resumed evidence bundle",
            childTasks: [],
            executionNotes: []
          };
        },
        verify: () => ({
          summary: "Continuation seed verified",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: (context) => {
          assert.equal(context.evidenceBundles.length, 1);
          return {
            summary: "Gathered fresh evidence after the crash",
            evidenceBundles: [
              {
                id: "bundle-resumed",
                summary: "Fresh resume evidence",
                facts: [
                  {
                    id: "fact-resumed",
                    statement: "The resumed run added fresh evidence after seeding prior work",
                    confidence: "high",
                    referenceIds: []
                  }
                ],
                hypotheses: [],
                unknowns: [],
                relevantTargets: [{ filePath: "src/main/orchestrator-service.ts" }],
                snippets: [],
                references: [],
                confidence: "high"
              }
            ]
          };
        }
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Resumed execution completed",
          outputs: ["resumed-output"]
        })
      },
      trace
    )
  );

  const seededWorkingMemory: WorkingMemorySnapshot = {
    runId: "previous-run",
    facts: [
      {
        id: "seed-fact",
        statement: "Previous root evidence was already collected",
        confidence: "high",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ],
    openQuestions: [
      {
        id: "seed-question",
        question: "Need a stable resume path",
        status: "open",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ],
    unknowns: [],
    conflicts: [],
    decisions: [
      {
        id: "seed-decision",
        summary: "Previous run failed",
        rationale: "The server stopped before the orchestrator could finish.",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ],
    updatedAt: "2026-03-19T09:00:00.000Z"
  };

  const seededEvidence: EvidenceBundle = {
    id: "seed-bundle",
    runId: "previous-run",
    nodeId: "old-node",
    summary: "Recovered crash evidence",
    facts: [
      {
        id: "seed-bundle-fact",
        statement: "Previous root evidence was already collected",
        confidence: "high",
        referenceIds: []
      }
    ],
    hypotheses: [],
    unknowns: [],
    relevantTargets: [{ filePath: "src/renderer/app.ts" }],
    snippets: [],
    references: [],
    confidence: "high",
    createdAt: "2026-03-19T09:00:00.000Z",
    updatedAt: "2026-03-19T09:00:00.000Z"
  };

  const seededProjectStructure: ProjectStructureSnapshot = {
    runId: "previous-run",
    summary: "Recovered repository structure",
    directories: [
      {
        id: "seed-directory",
        path: "src/orchestrator",
        summary: "Core orchestration directory",
        confidence: "high",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ],
    keyFiles: [
      {
        id: "seed-key-file",
        path: "src/orchestrator/runtime.ts",
        summary: "Main runtime flow",
        confidence: "high",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ],
    entryPoints: [],
    modules: [],
    openQuestions: [],
    contradictions: [],
    updatedAt: "2026-03-19T09:00:00.000Z"
  };

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeHappyPath({
    goal: "Continue the last orchestrator run after a sudden server stop",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    },
    continuation: {
      sourceRunId: "previous-run",
      evidenceBundles: [seededEvidence],
      workingMemory: seededWorkingMemory,
      projectStructure: seededProjectStructure
    }
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.equal(result.snapshot.run.continuedFromRunId, "previous-run");
  assert.equal(result.snapshot.evidenceBundles.length, 2);
  assert.equal(
    result.snapshot.events.some((event) =>
      event.type === "scheduler_progress"
      && event.payload.message === "Seeded run from previous snapshot"
      && event.payload.sourceRunId === "previous-run"
    ),
    true
  );
  assert.equal(
    result.snapshot.workingMemory.facts.some((fact) => fact.statement === "Previous root evidence was already collected"),
    true
  );
  assert.equal(result.snapshot.projectStructure.summary, "Recovered repository structure");
  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "execute:execute-lower",
    "verify:planner-upper"
  ]);
});

test("runtime reruns root concrete planning after project structure inspection updates the structure memory", async () => {
  const trace: string[] = [];
  const workflowTrace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "gather", "concretePlan", "verify"]),
      {
        abstractPlan: (context) => {
          workflowTrace.push(`abstract:${context.workflowStage}:${context.node.depth}`);
          return {
            summary: context.workflowStage === "project_structure_inspection"
              ? "Inspect the suspected entrypoint mismatch"
              : "Plan the initial repository discovery",
            targetsToInspect: ["src/main/orchestrator-service.ts"],
            evidenceRequirements: ["Confirm the actual runtime entrypoint"]
          };
        },
        concretePlan: (_evidenceCount, _factCount, context) => {
          workflowTrace.push(`concrete:${context.workflowStage}:${context.node.depth}:${context.projectStructure.summary}`);
          if (context.workflowStage === "project_structure_inspection") {
            return {
              summary: "Inspection confirmed the real entrypoint",
              childTasks: [],
              executionNotes: ["Structure memory refreshed"]
            };
          }

          if (context.node.depth === 0 && context.projectStructure.summary === "Initial structure summary points to the wrong entrypoint") {
            return {
              summary: "The current structure summary is contradictory, inspect the real entrypoint first",
              childTasks: [],
              executionNotes: [],
              needsProjectStructureInspection: true,
              inspectionObjectives: ["Inspect the real app/service entrypoint"],
              projectStructureContradictions: ["Initial structure summary points to the wrong entrypoint"]
            };
          }

          return {
            summary: "Project structure is now consistent, continue execution",
            childTasks: [],
            executionNotes: ["Proceed with the corrected structure memory"]
          };
        },
        gather: (context) => {
          workflowTrace.push(`gather:${context.workflowStage}:${context.node.depth}`);
          return {
            summary: "Inspection gathered the correct entrypoint with the upper-tier model",
            evidenceBundles: [
              {
                id: "inspection-bundle",
                summary: "Inspection evidence",
                facts: [],
                hypotheses: [],
                unknowns: [],
                relevantTargets: [{ filePath: "src/main/orchestrator-service.ts" }],
                snippets: [],
                references: [],
                confidence: "high"
              }
            ],
            projectStructure: {
              summary: "Inspection confirmed the actual entrypoint",
              directories: [
                {
                  path: "src/main",
                  summary: "Electron main-process services",
                  confidence: "high"
                }
              ],
              keyFiles: [
                {
                  path: "src/main/orchestrator-service.ts",
                  summary: "The service launches orchestrator runs",
                  confidence: "high"
                }
              ],
              entryPoints: [
                {
                  path: "src/main/orchestrator-service.ts",
                  role: "service entrypoint",
                  summary: "Actual entrypoint for managed orchestration",
                  confidence: "high"
                }
              ],
              modules: [],
              openQuestions: [],
              contradictions: []
            }
          };
        },
        verify: () => ({
          summary: "Inspection loop verified",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: (context) => {
          workflowTrace.push(`gather:${context.workflowStage}:${context.node.depth}`);
          if (context.workflowStage === "project_structure_inspection") {
            return {
              summary: "Inspection gathered the correct entrypoint with the lightweight model",
              evidenceBundles: [
                {
                  id: "inspection-bundle",
                  summary: "Inspection evidence",
                  facts: [],
                  hypotheses: [],
                  unknowns: [],
                  relevantTargets: [{ filePath: "src/main/orchestrator-service.ts" }],
                  snippets: [],
                  references: [],
                  confidence: "high"
                }
              ],
              projectStructure: {
                summary: "Inspection confirmed the actual entrypoint",
                directories: [
                  {
                    path: "src/main",
                    summary: "Electron main-process services",
                    confidence: "high"
                  }
                ],
                keyFiles: [
                  {
                    path: "src/main/orchestrator-service.ts",
                    summary: "The service launches orchestrator runs",
                    confidence: "high"
                  }
                ],
                entryPoints: [
                  {
                    path: "src/main/orchestrator-service.ts",
                    role: "service entrypoint",
                    summary: "Actual entrypoint for managed orchestration",
                    confidence: "high"
                  }
                ],
                modules: [],
                openQuestions: [],
                contradictions: []
              }
            };
          }

          return {
            summary: "Gathered the initial repository structure",
            evidenceBundles: [
              {
                id: "root-bundle",
                summary: "Root structure evidence",
                facts: [],
                hypotheses: [],
                unknowns: [],
                relevantTargets: [{ filePath: "src/main/orchestrator-service.ts" }],
                snippets: [],
                references: [],
                confidence: "medium"
              }
            ],
            projectStructure: {
              summary: "Initial structure summary points to the wrong entrypoint",
              directories: [
                {
                  path: "src/renderer",
                  summary: "Renderer UI files",
                  confidence: "medium"
                }
              ],
              keyFiles: [
                {
                  path: "src/renderer/app.ts",
                  summary: "UI entry candidate",
                  confidence: "medium"
                }
              ],
              entryPoints: [
                {
                  path: "src/renderer/app.ts",
                  role: "suspected entrypoint",
                  summary: "Initial guess from broad discovery",
                  confidence: "low"
                }
              ],
              modules: [],
              openQuestions: ["Need to confirm the actual service entrypoint"],
              contradictions: ["Initial structure summary points to the wrong entrypoint"]
            }
          };
        }
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution completed after inspection",
          outputs: ["inspection-output"]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeHappyPath({
    goal: "Recover from an incorrect initial project structure summary",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.equal(
    result.snapshot.nodes.some((node) => node.title.includes("inspection-1")),
    true
  );
  assert.equal(result.snapshot.projectStructure.summary, "Inspection confirmed the actual entrypoint");
  assert.equal(
    result.snapshot.projectStructure.entryPoints.some((entryPoint) => entryPoint.path === "src/main/orchestrator-service.ts"),
    true
  );
  assert.equal(
    result.snapshot.projectStructure.openQuestions.filter((question) => question.status === "open").length,
    0
  );
  assert.equal(
    result.snapshot.projectStructure.contradictions.filter((contradiction) => contradiction.status === "open").length,
    0
  );
  assert.equal(
    result.snapshot.events.some((event) =>
      event.type === "scheduler_progress"
      && event.payload.message === "Project structure inspection requested"
    ),
    true
  );
  assert.deepEqual(workflowTrace, [
    "abstract:task_orchestration:0",
    "gather:task_orchestration:0",
    "concrete:task_orchestration:0:Initial structure summary points to the wrong entrypoint",
    "abstract:project_structure_inspection:1",
    "gather:project_structure_inspection:1",
    "concrete:project_structure_inspection:1:Inspection confirmed the actual entrypoint",
    "concrete:task_orchestration:0:Inspection confirmed the actual entrypoint"
  ]);
  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "concrete:planner-upper",
    "execute:execute-lower",
    "verify:planner-upper"
  ]);
});

test("runtime stops decomposing at maxDepth and executes the deepest node as a leaf", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        concretePlan: (_evidenceCount, _factCount, context) => ({
          summary: `Plan at depth ${context.node.depth}`,
          childTasks: [
            {
              title: `${context.node.title} / child`,
              objective: `Nested objective at depth ${context.node.depth + 1}`,
              importance: "high",
              assignedModels: {
                abstractPlanner: planner,
                gatherer,
                concretePlanner: planner,
                executor,
                verifier: planner
              }
            }
          ],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Verification passed",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gather complete",
          evidenceBundles: [
            {
              id: "bundle-depth-check",
              summary: "Depth evidence",
              facts: [],
              hypotheses: [],
              unknowns: [],
              relevantTargets: [],
              snippets: [],
              references: [],
              confidence: "medium"
            }
          ]
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Leaf execute complete",
          outputs: ["leaf-output"]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeScheduledRun({
    goal: "Respect the global maxDepth limit during recursive decomposition",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    },
    reviewPolicy: "none"
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.equal(Math.max(...result.snapshot.nodes.map((node) => node.depth)), 2);
  assert.equal(result.snapshot.nodes.filter((node) => node.role === "task").length, 4);
  assert.equal(result.snapshot.nodes.filter((node) => node.kind === "execution" && node.role === "task").length, 1);
  assert.equal(
    result.snapshot.events.some((event) =>
      event.type === "scheduler_progress"
      && event.payload.message === "Skipping decomposition because max depth was reached"
      && event.payload.nodeDepth === 2
      && event.payload.maxDepth === 2
    ),
    true
  );
});

test("runtime keeps execution local when the concrete plan says more planning is not needed", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        concretePlan: () => ({
          summary: "This node is execution-ready and does not need more planning",
          childTasks: [
            {
              title: "Potential split that should stay local",
              objective: "Keep this as an execution step, not a planning child",
              importance: "medium",
              assignedModels: {
                abstractPlanner: planner,
                gatherer,
                concretePlanner: planner,
                executor,
                verifier: planner
              }
            }
          ],
          executionNotes: ["Carry the plan straight into execution"],
          needsMorePlanning: false
        }),
        verify: () => ({
          summary: "Verification passed",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gather complete",
          evidenceBundles: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Executed without extra planning split",
          outputs: ["execution-ready-output"]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeScheduledRun({
    goal: "Do the work without mechanically decomposing the current node",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    },
    reviewPolicy: "none"
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.equal(result.snapshot.nodes.filter((node) => node.role === "task" && node.kind === "planning").length, 1);
  assert.equal(result.snapshot.nodes.some((node) => node.title === "Potential split that should stay local"), false);
  assert.equal(
    result.snapshot.events.some((event) =>
      event.type === "scheduler_progress"
      && event.payload.message === "Skipping decomposition because the current node already has enough execution detail"
      && event.payload.proposedChildCount === 1
    ),
    true
  );
});

test("runtime fails fast when execute reports that work was not completed", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        concretePlan: () => ({
          summary: "Execution should happen directly",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Verify should not run",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gather complete",
          evidenceBundles: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution was denied by policy and has not been completed",
          outputs: [],
          completed: false,
          blockedReason: "policy denied file modification"
        })
      },
      trace
    )
  );

  let capturedSnapshot: RunSnapshot | undefined;
  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot(snapshot: RunSnapshot) {
        capturedSnapshot = snapshot;
      }
    } as never
  });

  await assert.rejects(
    runtime.executeScheduledRun({
      goal: "Fail if execution was denied",
      assignedModels: {
        abstractPlanner: planner,
        gatherer,
        concretePlanner: planner,
        executor,
        verifier: planner
      },
      reviewPolicy: "none"
    }),
    /Execution did not complete/
  );

  assert.ok(capturedSnapshot);
  const snapshot = capturedSnapshot as RunSnapshot;
  assert.equal(snapshot.run.status, "escalated");
  assert.equal(trace.includes(`verify:${planner.id}`), false);
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "run_failed"
      && String(event.payload.error).includes("Execution did not complete")
    ),
    true
  );
});

test("runtime rejects claimed verification success when model output still contains unresolved blocker signals", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        concretePlan: () => ({
          summary: "Execution is ready",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Verification passed, but the requested behavior still relies on placeholder/no-data fallback.",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gather complete",
          evidenceBundles: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execute complete",
          outputs: ["Updated the relevant UI"],
          completed: true
        })
      },
      trace
    )
  );

  let capturedSnapshot: RunSnapshot | undefined;
  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot(snapshot: RunSnapshot) {
        capturedSnapshot = snapshot;
      }
    } as never
  });

  await assert.rejects(
    runtime.executeScheduledRun({
      goal: "Reject unresolved placeholder-style verification success",
      assignedModels: {
        abstractPlanner: planner,
        gatherer,
        concretePlanner: planner,
        executor,
        verifier: planner
      },
      reviewPolicy: "none"
    }),
    /unresolved blocker signal/
  );

  assert.ok(capturedSnapshot);
  const snapshot = capturedSnapshot as RunSnapshot;
  assert.equal(snapshot.run.status, "escalated");
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "run_failed"
      && String(event.payload.error).includes("unresolved blocker signal")
    ),
    true
  );
});

test("runtime filters repeated logging workarounds out of abstract-planning memory cues for exact-data requests", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: (context) => {
          assert.doesNotMatch(context.node.objective, /gemini_debug\.log/i);
          assert.match(
            context.node.objective,
            /Do not repeat prior internal logging or instrumentation attempts/
          );
          return {
            summary: "Inspect the real managed Gemini surface instead of the old logging workaround",
            targetsToInspect: ["/Users/test/managed-tools/bin/gemini", "src/main/tool-manager.ts"],
            evidenceRequirements: ["Confirm the real Gemini surface or blocker evidence directly"]
          };
        },
        concretePlan: () => ({
          summary: "Execution is ready",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Verification passed",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(new MockAdapter(gatherer, new Set(["gather"]), {}, trace));
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execute complete",
          outputs: ["ok"],
          completed: true
        })
      },
      trace
    )
  );

  const seededWorkingMemory: WorkingMemorySnapshot = {
    runId: "previous-run",
    facts: [],
    openQuestions: [],
    unknowns: [],
    conflicts: [],
    decisions: [
      {
        id: "seed-decision-1",
        summary: "Execution completed",
        rationale: "Instrumented runJsonCommand to write gemini_debug.log, but it did not resolve the real Gemini usage result.",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z"
      },
      {
        id: "seed-decision-2",
        summary: "External evidence required before implementation",
        rationale:
          "Managed-tools Gemini path access failed with Operation not permitted, so external-path approval or one raw Gemini CLI payload/stderr sample is required.",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-22T00:01:00.000Z",
        updatedAt: "2026-03-22T00:01:00.000Z"
      }
    ],
    updatedAt: "2026-03-22T00:01:00.000Z"
  };

  const seededEvidence: EvidenceBundle = {
    id: "seed-blocker-evidence",
    runId: "previous-run",
    nodeId: "old-node",
    summary: "Managed Gemini external blocker evidence",
    facts: [
      {
        id: "seed-fact-1",
        statement:
          "The managed-tools Gemini CLI path is blocked by Operation not permitted, so a raw payload sample or approval is still required.",
        confidence: "high",
        referenceIds: []
      }
    ],
    hypotheses: [],
    unknowns: [],
    relevantTargets: [{ note: "managed-tools Gemini CLI /stats model surface" }],
    snippets: [
      {
        id: "seed-snippet-1",
        kind: "terminal",
        content: "ls \"$HOME/Library/Application Support/TaskSaw/managed-tools/packages/gemini\": Operation not permitted",
        rationale: "Direct blocker evidence"
      }
    ],
    references: [
      {
        id: "seed-ref-1",
        sourceType: "terminal",
        note: "Managed Gemini CLI capability check failed"
      }
    ],
    confidence: "high",
    createdAt: "2026-03-22T00:01:00.000Z",
    updatedAt: "2026-03-22T00:01:00.000Z"
  };

  const seededProjectStructure: ProjectStructureSnapshot = {
    runId: "previous-run",
    summary: "Recovered repository structure",
    directories: [],
    keyFiles: [],
    entryPoints: [],
    modules: [],
    openQuestions: [],
    contradictions: [],
    updatedAt: "2026-03-22T00:01:00.000Z"
  };

  let capturedSnapshot: RunSnapshot | undefined;
  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot(snapshot: RunSnapshot) {
        capturedSnapshot = snapshot;
      }
    } as never
  });

  const result = await runtime.executeScheduledRun({
    goal: "아직도 gemini의 사용량이 n/a라서 실제 값을 보여줘",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    },
    reviewPolicy: "none",
    continuation: {
      sourceRunId: "previous-run",
      evidenceBundles: [seededEvidence],
      workingMemory: seededWorkingMemory,
      projectStructure: seededProjectStructure
    }
  });

  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "execute:execute-lower",
    "verify:planner-upper"
  ]);
  assert.ok(capturedSnapshot);
  const snapshot = capturedSnapshot as RunSnapshot;
  assert.equal(snapshot.run.status, "done");
  assert.equal(result.snapshot.run.status, "done");
  assert.equal(
    snapshot.events.some((event) => event.type === "run_completed"),
    true
  );
});

test("runtime redirects diagnostic instrumentation plans into an approval-backed focused gather", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();
  let abstractCallCount = 0;
  let gatherCallCount = 0;
  let concreteCallCount = 0;

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: (context) => {
          abstractCallCount += 1;
          if (abstractCallCount === 1) {
            return {
              summary: "Inspect the narrowest Gemini usage path",
              targetsToInspect: ["src/main/tool-manager.ts", "/Users/test/managed-tools/bin/gemini"],
              evidenceRequirements: ["Confirm why Gemini remainingPercent is still null"]
            };
          }

          assert.match(
            context.node.objective,
            /Request approval for the narrowest direct read or Gemini CLI capability check/
          );
          return {
            summary: "Use the approved managed Gemini surface directly",
            targetsToInspect: ["/Users/test/managed-tools/bin/gemini"],
            evidenceRequirements: ["Capture one raw stdout/stderr/exit sample from the actual Gemini surface"]
          };
        },
        concretePlan: () => {
          concreteCallCount += 1;
          if (concreteCallCount === 1) {
            return {
              summary: "Instrument runJsonCommand and append stdout/stderr to gemini_debug.log",
              childTasks: [],
              executionNotes: [
                "Add diagnostic logging inside runJsonCommand so future Gemini CLI calls dump raw stdout and stderr."
              ]
            };
          }

          return {
            summary: "Approval-backed external evidence is ready, so execution can continue",
            childTasks: [],
            executionNotes: []
          };
        },
        verify: () => ({
          summary: "Verification passed with approval-backed external evidence",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: async (context) => {
          gatherCallCount += 1;
          if (gatherCallCount === 1) {
            return {
              summary: "Managed Gemini surface is blocked and still needs direct external evidence",
              evidenceBundles: [
                {
                  id: "gemini-external-blocker",
                  summary: "External blocker evidence",
                  facts: [
                    {
                      id: "remaining-null",
                      statement: "Gemini usage still reaches remainingPercent:null in src/main/tool-manager.ts.",
                      confidence: "high",
                      referenceIds: []
                    },
                    {
                      id: "permission-blocked",
                      statement:
                        "Direct reads of managed-tools Gemini paths failed with Operation not permitted, so external-path approval or one raw payload/stderr sample is still required.",
                      confidence: "high",
                      referenceIds: []
                    }
                  ],
                  hypotheses: [],
                  unknowns: [],
                  relevantTargets: [
                    { filePath: "src/main/tool-manager.ts" },
                    { note: "managed-tools Gemini CLI /stats model surface" }
                  ],
                  snippets: [
                    {
                      id: "permission-terminal",
                      kind: "terminal",
                      content: "ls \"$HOME/Library/Application Support/TaskSaw/managed-tools/packages/gemini\": Operation not permitted",
                      rationale: "Direct permission blocker"
                    }
                  ],
                  references: [
                    {
                      id: "managed-cli-proof",
                      sourceType: "terminal",
                      note: "Managed Gemini CLI capability check failed with Operation not permitted"
                    }
                  ],
                  confidence: "high"
                }
              ]
            };
          }

          assert.match(
            context.node.objective,
            /Request approval for the narrowest direct read or Gemini CLI capability check/
          );
          const decision = await context.requestUserApproval?.({
            message: "Allow reading the managed Gemini surface to collect one raw stdout/stderr sample?",
            details: "Need one direct Gemini CLI stdout/stderr/exit sample from the real managed surface.",
            kind: "execute",
            locations: ["/Users/test/managed-tools/bin/gemini"],
            abortSignal: context.abortSignal,
            options: [
              { optionId: "allow", kind: "allow_once", label: "Allow once" },
              { optionId: "deny", kind: "reject_once", label: "Reject" }
            ]
          });
          assert.equal(decision?.outcome, "selected");
          return {
            summary: "Focused gather captured one approval-backed external sample",
            evidenceBundles: [
              {
                id: "gemini-approved-sample",
                summary: "Approval-backed external Gemini sample",
                facts: [
                  {
                    id: "approved-sample-fact",
                    statement: "An approval-backed direct Gemini capability check returned one raw stdout/stderr/exit sample.",
                    confidence: "high",
                    referenceIds: []
                  }
                ],
                hypotheses: [],
                unknowns: [],
                relevantTargets: [{ note: "managed-tools Gemini CLI /stats model surface" }],
                snippets: [
                  {
                    id: "approved-sample-snippet",
                    kind: "terminal",
                    content: "stdout: {\"remainingPercent\":42}\nstderr:\nexit:0",
                    rationale: "Raw external sample after approval"
                  }
                ],
                references: [
                  {
                    id: "approved-sample-ref",
                    sourceType: "terminal",
                    note: "Managed Gemini CLI raw sample after approval"
                  }
                ],
                confidence: "high"
              }
            ]
          };
        }
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution complete with approval-backed evidence",
          outputs: ["gemini-usage-path-updated"],
          completed: true
        })
      },
      trace
    )
  );

  let capturedSnapshot: RunSnapshot | undefined;
  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot(snapshot: RunSnapshot) {
        capturedSnapshot = snapshot;
      }
    } as never
  });

  const result = await runtime.executeScheduledRun({
    goal: "Gemini 사용량이 아직도 n/a라서 실제 값을 보여줘",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    },
    reviewPolicy: "none"
  });

  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "execute:execute-lower",
    "verify:planner-upper"
  ]);
  assert.equal(abstractCallCount, 2);
  assert.equal(gatherCallCount, 2);
  assert.equal(concreteCallCount, 2);
  assert.ok(capturedSnapshot);
  const snapshot = capturedSnapshot as RunSnapshot;
  assert.equal(snapshot.run.status, "done");
  assert.equal(result.snapshot.run.status, "done");
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "scheduler_progress"
      && String(event.payload.message).includes("Redirecting diagnostic workaround into approval-backed external gather")
    ),
    true
  );
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "approval_requested"
      && String(event.payload.message).includes("Allow reading the managed Gemini surface")
    ),
    true
  );
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "approval_resolved"
      && event.payload.approved === true
    ),
    true
  );
});

test("runtime rejects verification success when only diagnostic instrumentation was added and no real evidence was produced", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Inspect the Gemini usage path",
          targetsToInspect: ["src/main/tool-manager.ts"],
          evidenceRequirements: ["Confirm why Gemini usage still shows n/a"]
        }),
        concretePlan: () => ({
          summary: "Execution is ready",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary:
            "Verified the instrumentation wiring, but gemini_debug.log has not been generated yet because we are still awaiting a real CLI call.",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gather complete",
          evidenceBundles: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Added diagnostic logging to runJsonCommand and gemini_debug.log output.",
          outputs: ["instrumented-gemini-debug-log"],
          completed: true
        })
      },
      trace
    )
  );

  let capturedSnapshot: RunSnapshot | undefined;
  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot(snapshot: RunSnapshot) {
        capturedSnapshot = snapshot;
      }
    } as never
  });

  await assert.rejects(
    runtime.executeScheduledRun({
      goal: "Gemini 사용량이 n/a 대신 실제 값으로 보여야 한다",
      assignedModels: {
        abstractPlanner: planner,
        gatherer,
        concretePlanner: planner,
        executor,
        verifier: planner
      },
      reviewPolicy: "none"
    }),
    /diagnostic instrumentation that is still awaiting future evidence/
  );

  assert.ok(capturedSnapshot);
  const snapshot = capturedSnapshot as RunSnapshot;
  assert.equal(snapshot.run.status, "escalated");
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "run_failed"
      && String(event.payload.error).includes("diagnostic instrumentation that is still awaiting future evidence")
    ),
    true
  );
});

test("runtime records internally blocked approvals separately from user denials", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(planner, new Set(["abstractPlan", "concretePlan", "verify"]), {}, trace)
  );
  registry.register(
    new MockAdapter(gatherer, new Set(["gather"]), {}, trace)
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: async (context) => {
          const decision = await context.requestUserApproval?.({
            abortSignal: context.abortSignal,
            title: "Guardrail override approval",
            message: "No approval options are available for this action.",
            options: []
          });
          return {
            summary: `Approval outcome: ${decision?.outcome ?? "none"}`,
            outputs: [],
            completed: true
          };
        }
      },
      trace
    )
  );

  let capturedSnapshot: RunSnapshot | undefined;
  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot(snapshot: RunSnapshot) {
        capturedSnapshot = snapshot;
      }
    } as never
  });

  const result = await runtime.executeScheduledRun({
    goal: "승인 결과가 내부 차단인지 사용자 거절인지 구분해줘",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    },
    reviewPolicy: "none"
  });

  const snapshot = capturedSnapshot ?? result.snapshot;
  assert.equal(snapshot.run.status, "done");
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "approval_resolved"
      && event.payload.outcome === "internally_cancelled"
      && event.payload.approved === false
    ),
    true
  );
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "execution_status"
      && event.payload.state === "approval_blocked"
    ),
    true
  );
});

test("runtime does not fail successful verification just because raw execute output mentions placeholder text", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        concretePlan: () => ({
          summary: "Execution is ready",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Verification passed with real Gemini percentage output wired to the UI.",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gather complete",
          evidenceBundles: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execute complete",
          outputs: [
            "Test fixture note: the legacy placeholder/no-data fallback string still exists in an old test snapshot."
          ],
          completed: true
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeScheduledRun({
    goal: "Ignore raw placeholder text in execute logs when verification passes",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    },
    reviewPolicy: "none"
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.equal(
    result.snapshot.events.some((event) =>
      event.type === "run_failed"
      && String(event.payload.error).includes("unresolved blocker signal")
    ),
    false
  );
});

test("runtime records failure events when a node invocation throws", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const abstractPlanner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      abstractPlanner,
      new Set(["abstractPlan"]),
      {},
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => {
          throw new Error("Gemini CLI exited without writing any JSON to stdout");
        }
      },
      trace
    )
  );

  let capturedSnapshot: RunSnapshot | undefined;
  const runtime = new OrchestratorRuntime(registry, {
    persistence: {
      saveSnapshot(snapshot: RunSnapshot) {
        capturedSnapshot = snapshot;
      }
    } as never
  });

  await assert.rejects(
    runtime.executeScheduledRun({
      goal: "Capture failure details for managed orchestrator runs",
      assignedModels: {
        abstractPlanner,
        gatherer
      },
      reviewPolicy: "none"
    }),
    /Gemini CLI exited without writing any JSON to stdout/
  );

  assert.ok(capturedSnapshot);
  const snapshot = capturedSnapshot as RunSnapshot;
  assert.equal(snapshot.run.status, "escalated");
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "node_failed"
      && String(event.payload.error).includes("Gemini CLI exited without writing any JSON to stdout")
    ),
    true
  );
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "run_failed"
      && String(event.payload.error).includes("Gemini CLI exited without writing any JSON to stdout")
    ),
    true
  );
});

test("runtime materializes missing child task routing from the parent node model routing set", async () => {
  const trace: string[] = [];
  const events: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "executor-lower",
    provider: "mock",
    model: "executor-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Decompose the task into a child node",
          targetsToInspect: [],
          evidenceRequirements: []
        }),
        concretePlan: (_evidenceCount, _factCount, context) => context.node.depth === 0
          ? {
              summary: "A child planner is required here",
              childTasks: [
                {
                  title: "Child without routing",
                  objective: "This child should inherit no hidden state and be materialized explicitly"
                }
              ],
              executionNotes: []
            }
          : {
              summary: "Leaf planning complete",
              childTasks: [],
              executionNotes: []
            },
        verify: () => ({
          summary: "Verification passed",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => {
          return {
            summary: "Gather complete",
            evidenceBundles: []
          };
        }
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution complete",
          outputs: ["ok"]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry, {
    onEvent: (event) => {
      if (event.type === "scheduler_progress") {
        events.push(String(event.payload.message));
      }
    }
  });
  const result = await runtime.executeScheduledRun({
    goal: "Repair child routing when the planner omits explicit model assignments",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "execute:executor-lower",
    "verify:planner-upper"
  ]);
  assert.equal(result.run.status, "done");
  assert.equal(
    events.includes("Materialized missing child task routing from nodeModelRouting"),
    true
  );
});

test("runtime falls back to the parent role routing when a child task references an unregistered model", async () => {
  const trace: string[] = [];
  const events: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "executor-lower",
    provider: "mock",
    model: "executor-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Decompose once",
          targetsToInspect: [],
          evidenceRequirements: []
        }),
        concretePlan: (_evidenceCount, _factCount, context) => context.node.depth === 0
          ? {
              summary: "Child returned an out-of-routing gatherer model",
              childTasks: [
                {
                  title: "Child with invalid gatherer",
                  objective: "Use parent gatherer instead of an unregistered model",
                  assignedModels: {
                    abstractPlanner: planner,
                    gatherer: {
                      id: "gemini-2.5-pro",
                      provider: "Google",
                      model: "gemini-2.5-pro",
                      tier: "lower"
                    },
                    concretePlanner: planner,
                    executor,
                    verifier: planner
                  }
                }
              ],
              executionNotes: [],
              needsMorePlanning: true
            }
          : {
              summary: "Leaf planning complete",
              childTasks: [],
              executionNotes: []
            },
        verify: () => ({
          summary: "Verification passed",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gather complete",
          evidenceBundles: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution complete",
          outputs: ["ok"]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry, {
    onEvent: (event) => {
      if (event.type === "scheduler_progress") {
        events.push(String(event.payload.message));
      }
    }
  });
  const result = await runtime.executeScheduledRun({
    goal: "Repair child routing when the planner picks an unregistered model",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.equal(result.run.status, "done");
  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper",
    "execute:executor-lower",
    "verify:planner-upper"
  ]);
  assert.equal(
    events.includes("Materialized missing child task routing from nodeModelRouting"),
    true
  );
});

test("runtime invokes only the exact routed model without cross-model fallback", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const failingExecutor: ModelRef = {
    id: "gemini-primary",
    provider: "Google",
    model: "gemini-3.1-pro-preview",
    tier: "lower",
    reasoningEffort: "high"
  };
  const fallbackExecutor: ModelRef = {
    id: "codex-fallback",
    provider: "OpenAI",
    model: "gpt-5.4",
    tier: "upper",
    reasoningEffort: "xhigh"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "gather", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Plan a single execution leaf",
          targetsToInspect: [],
          evidenceRequirements: []
        }),
        gather: () => ({
          summary: "Gather complete",
          evidenceBundles: []
        }),
        concretePlan: () => ({
          summary: "Execute directly after planning",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "This verifier should not run after a failed execute",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      failingExecutor,
      new Set(["execute"]),
      {
        execute: () => {
          throw new Error("Primary routed executor failed");
        }
      },
      trace
    )
  );
  registry.register(new MockAdapter(fallbackExecutor, new Set(["execute"]), {}, trace));

  const runtime = new OrchestratorRuntime(registry);
  await assert.rejects(
    runtime.executeHappyPath({
      goal: "Never switch away from the routed execution model",
      reviewPolicy: "none",
      assignedModels: {
        abstractPlanner: planner,
        gatherer: planner,
        concretePlanner: planner,
        executor: failingExecutor,
        verifier: planner
      }
    }),
    /Primary routed executor failed/
  );

  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "gather:planner-upper",
    "concrete:planner-upper",
    "execute:gemini-primary"
  ]);
});

test("runtime deduplicates repeated working-memory entries and final report outputs", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Keep the run minimal",
          targetsToInspect: [],
          evidenceRequirements: [
            "`executionBudget.maxDepth` 값 확인",
            "executionBudget.maxDepth 값 확인"
          ]
        }),
        concretePlan: () => ({
          summary: "Do not decompose further",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Duplicate-free report verified",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gather duplicate evidence once",
          evidenceBundles: [
            {
              id: "bundle-duplicate-a",
              summary: "First duplicate evidence",
              facts: [
                {
                  id: "fact-duplicate-a",
                  statement: "executionBudget.maxDepth is 2",
                  confidence: "high",
                  referenceIds: ["ref-a"]
                }
              ],
              hypotheses: [],
              unknowns: [
                {
                  id: "unknown-duplicate-a",
                  question: "`acceptanceCriteria`가 비어 있는지 확인",
                  impact: "low",
                  referenceIds: ["ref-a"]
                }
              ],
              relevantTargets: [],
              snippets: [],
              references: [],
              confidence: "medium"
            },
            {
              id: "bundle-duplicate-b",
              summary: "Second duplicate evidence",
              facts: [
                {
                  id: "fact-duplicate-b",
                  statement: "executionBudget.maxDepth is 2",
                  confidence: "medium",
                  referenceIds: ["ref-b"]
                }
              ],
              hypotheses: [],
              unknowns: [
                {
                  id: "unknown-duplicate-b",
                  question: "acceptanceCriteria가 비어 있는지 확인",
                  impact: "medium",
                  referenceIds: ["ref-b"]
                }
              ],
              relevantTargets: [],
              snippets: [],
              references: [],
              confidence: "medium"
            }
          ]
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Emit duplicate outputs once",
          outputs: [
            "`executionBudget.maxDepth` 값 확인",
            "executionBudget.maxDepth 값 확인",
            "acceptanceCriteria 상태 점검"
          ]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeHappyPath({
    goal: "Keep duplicate reporting under control",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.equal(result.snapshot.workingMemory.openQuestions.length, 1);
  assert.equal(result.snapshot.workingMemory.openQuestions[0]?.status, "resolved");
  assert.equal(result.snapshot.workingMemory.facts.length, 1);
  assert.equal(result.snapshot.workingMemory.unknowns.length, 1);
  assert.deepEqual(result.finalReport.outcomes, [
    "`executionBudget.maxDepth` 값 확인",
    "acceptanceCriteria 상태 점검"
  ]);
  assert.deepEqual(result.finalReport.unresolvedRisks, [
    "`acceptanceCriteria`가 비어 있는지 확인"
  ]);
});

test("runtime skips decomposition for short test tree goals", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Respect the short test-tree constraint",
          targetsToInspect: [],
          evidenceRequirements: []
        }),
        concretePlan: () => ({
          summary: "Normally this would decompose into children",
          childTasks: [
            {
              title: "First child",
              objective: "This child should be skipped",
              importance: "medium",
              assignedModels: {
                abstractPlanner: planner,
                gatherer,
                concretePlanner: planner,
                executor,
                verifier: planner
              }
            },
            {
              title: "Second child",
              objective: "This child should also be skipped",
              importance: "medium",
              assignedModels: {
                abstractPlanner: planner,
                gatherer,
                concretePlanner: planner,
                executor,
                verifier: planner
              }
            }
          ],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Short test tree completed at the root node",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gather completed",
          evidenceBundles: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Executed without recursive decomposition",
          outputs: ["root-only-output"]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeScheduledRun({
    goal: "테스트 작업이어서 실제로 긴 작업을 수행하지 말고 짧은 트리 작업만 수행해줘",
    objective: "테스트 작업이어서 실제로 긴 작업을 수행하지 말고 짧은 트리 작업만 수행해줘",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.equal(result.snapshot.nodes.filter((node) => node.role === "task").length, 2);
  assert.equal(result.snapshot.run.status, "done");
  assert.equal(result.snapshot.nodes.filter((node) => node.kind === "execution" && node.role === "task").length, 1);
  assert.equal(
    result.snapshot.events.some((event) =>
      event.type === "scheduler_progress"
      && event.payload.message === "Skipping decomposition because the goal requested a short test tree"
      && event.payload.nodeDepth === 0
      && event.payload.proposedChildCount === 2
    ),
    true
  );
});

test("runtime resolves open questions when later evidence and outputs cover them", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Keep the run short and verifiable",
          targetsToInspect: [],
          evidenceRequirements: [
            "Confirm maxDepth is 2 and plan does not exceed that depth",
            "Confirm the plan remains lightweight and sufficient to satisfy the acceptance criteria"
          ]
        }),
        concretePlan: () => ({
          summary: "Execute the root node directly",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Verification passed. The lightweight execution satisfies the acceptance criteria and stays within depth 2.",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "Gathered enough evidence to confirm depth 2 and a lightweight plan.",
          evidenceBundles: [
            {
              id: "bundle-runtime-resolution",
              summary: "Evidence confirms the depth cap and lightweight scope",
              facts: [
                {
                  id: "fact-runtime-resolution",
                  statement: "executionBudget.maxDepth is 2 and the plan remains lightweight",
                  confidence: "high",
                  referenceIds: []
                }
              ],
              hypotheses: [],
              unknowns: [],
              relevantTargets: [],
              snippets: [],
              references: [],
              confidence: "high"
            }
          ]
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Executed a lightweight plan within depth 2",
          outputs: [
            "executionBudget.maxDepth가 2로 유지된다고 확인했다.",
            "acceptanceCriteria를 만족할 만큼 경량 계획으로 충분하다고 확인했다."
          ]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeHappyPath({
    goal: "Verify that covered working-memory questions are resolved before final reporting",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.deepEqual(
    result.snapshot.workingMemory.openQuestions.map((question) => question.status),
    ["resolved", "resolved"]
  );
  assert.deepEqual(result.finalReport.unresolvedRisks, []);
});

test("runtime resolves Korean max-depth evidence questions from structured run context", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "짧은 테스트 실행으로 제한한다.",
          targetsToInspect: [],
          evidenceRequirements: ["최대 깊이 2로 제한된 짧은 실행 계획이라는 근거"]
        }),
        concretePlan: () => ({
          summary: "추가 분해 없이 루트 실행으로 충분하다.",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "검증 완료. 짧은 실행과 제한된 깊이 조건이 충족된다.",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: () => ({
          summary: "테스트 실행이라는 점만 확인했다.",
          evidenceBundles: []
        })
      },
      trace
    )
  );
  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "짧은 실행으로 마무리했다.",
          outputs: ["긴 작업 없이 최소 범위로 실행했다."]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeHappyPath({
    goal: "테스트 작업이어서 실제로 긴 작업을 수행하지 말고 짧은 트리 작업만 수행해줘",
    reviewPolicy: "none",
    executionBudget: {
      maxDepth: 2
    },
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.deepEqual(result.finalReport.unresolvedRisks, []);
  assert.equal(result.snapshot.workingMemory.openQuestions[0]?.status, "resolved");
});

test("runtime pauses the run when cancellation is requested mid-invocation", async () => {
  const registry = new ModelAdapterRegistry();
  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };

  class BlockingAdapter implements OrchestratorModelAdapter {
    constructor(readonly model: ModelRef) {}

    supports(capability: OrchestratorCapability): boolean {
      return capability === "abstractPlan";
    }

    async abstractPlan(context: ModelInvocationContext): Promise<AbstractPlanResult> {
      return new Promise<AbstractPlanResult>((_resolve, reject) => {
        context.abortSignal.addEventListener("abort", () => {
          reject(new Error("aborted by test"));
        }, { once: true });
      });
    }
  }

  registry.register(new BlockingAdapter(planner));
  const runtime = new OrchestratorRuntime(registry);

  const execution = runtime.executeScheduledRun({
    goal: "Cancel the orchestrator while the first planner call is still running",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  runtime.cancel("Cancelled by the test harness");

  await assert.rejects(
    execution,
    (error: unknown) => {
      assert.equal(error instanceof OrchestratorRunCancelledError, true);
      assert.equal(error instanceof OrchestratorRunCancelledError && error.snapshot?.run.status, "paused");
      assert.equal(
        error instanceof OrchestratorRunCancelledError
          && error.snapshot?.events.some((event) => event.type === "run_paused"),
        true
      );
      return true;
    }
  );
});

test("runtime stops repeating project structure inspection when the structure memory does not change", async () => {
  const registry = new ModelAdapterRegistry();
  const workflowTrace: string[] = [];
  let runId: string | null = null;

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "gather", "concretePlan"]),
      {
        abstractPlan: (context) => {
          workflowTrace.push(`abstract:${context.workflowStage}:${context.node.depth}`);
          return {
            summary: "Inspect the repository structure just enough to move forward",
            targetsToInspect: ["./"],
            evidenceRequirements: ["Recover the missing project structure baseline"]
          };
        },
        concretePlan: (_evidenceCount, _factCount, context) => {
          workflowTrace.push(`concrete:${context.workflowStage}:${context.node.depth}:${context.projectStructure.summary}`);
          if (context.workflowStage === "project_structure_inspection") {
            return {
              summary: "Inspection still could not recover any project structure facts",
              childTasks: [],
              executionNotes: []
            };
          }

          return {
            summary: "Project structure is still missing and must be inspected",
            childTasks: [],
            executionNotes: [],
            needsProjectStructureInspection: true,
            inspectionObjectives: [
              "Recover the top-level directory inventory",
              "Identify the primary manifest and package manager"
            ],
            projectStructureContradictions: ["projectStructure is still empty"]
          };
        },
        gather: (context) => {
          workflowTrace.push(`gather:${context.workflowStage}:${context.node.depth}`);
          return {
            summary: "Inspection gathered no new structure facts",
            evidenceBundles: []
          };
        }
      },
      []
    )
  );
  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: (context) => {
          workflowTrace.push(`gather:${context.workflowStage}:${context.node.depth}`);
          return {
            summary: "Initial discovery gathered no structure facts",
            evidenceBundles: []
          };
        }
      },
      []
    )
  );

  const runtime = new OrchestratorRuntime(registry, {
    onEvent: (event) => {
      runId ??= event.runId;
    }
  });

  await assert.rejects(
    runtime.executeScheduledRun({
      goal: "Prevent repeated structure inspections when no new facts are found",
      reviewPolicy: "none",
      assignedModels: {
        abstractPlanner: planner,
        gatherer,
        concretePlanner: planner
      }
    }),
    /did not change the structure memory/
  );

  assert.notEqual(runId, null);
  const snapshot = runtime.getSnapshot(runId!);
  assert.equal(snapshot.run.status, "escalated");
  assert.equal(snapshot.nodes.filter((node) => node.title.includes("/ inspection-1")).length, 1);
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "scheduler_progress"
      && event.payload.message === "Stopping repeated project structure inspection because the structure memory did not change"
    ),
    true
  );
  assert.deepEqual(workflowTrace, [
    "abstract:task_orchestration:0",
    "gather:task_orchestration:0",
    "concrete:task_orchestration:0:",
    "abstract:project_structure_inspection:1",
    "gather:project_structure_inspection:1",
    "concrete:project_structure_inspection:1:",
    "concrete:task_orchestration:0:"
  ]);
});

test("runtime ignores summary-only structure churn after inspection and does not reopen resolved structure issues", async () => {
  const registry = new ModelAdapterRegistry();
  let runId: string | null = null;
  let inspectionGatherCount = 0;

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan"]),
      {
        abstractPlan: () => ({
          summary: "Inspect the actual main-process source entrypoint",
          targetsToInspect: ["src/main/main.ts"],
          evidenceRequirements: ["Confirm the source entrypoint and clear stale entrypoint assumptions"]
        }),
        concretePlan: (_evidenceCount, _factCount, context) => {
          if (context.workflowStage === "project_structure_inspection") {
            return {
              summary: "Inspection finished",
              childTasks: [],
              executionNotes: ["Inspection findings were merged into project structure memory"]
            };
          }

          if (context.projectStructure.entryPoints.some((entry) => entry.path === "src/main/main.ts")) {
            return {
              summary: "The planner still suspects stale entrypoint memory",
              childTasks: [],
              executionNotes: [],
              needsProjectStructureInspection: true,
              inspectionObjectives: ["Reconfirm the actual Electron main source entrypoint"],
              projectStructureContradictions: ["The structure summary may still describe the wrong main source entrypoint"]
            };
          }

          return {
            summary: "The initial entrypoint memory is contradictory",
            childTasks: [],
            executionNotes: [],
            needsProjectStructureInspection: true,
            inspectionObjectives: ["Confirm the actual Electron main source entrypoint"],
            projectStructureContradictions: ["The initial structure summary points to the wrong main source entrypoint"]
          };
        }
      },
      []
    )
  );

  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: (context) => {
          if (context.workflowStage === "project_structure_inspection") {
            inspectionGatherCount += 1;
            return {
              summary: inspectionGatherCount === 1
                ? "Inspection confirmed src/main/main.ts as the real source entrypoint"
                : "Inspection rephrased the same src/main/main.ts finding",
              evidenceBundles: [],
              projectStructure: {
                summary: inspectionGatherCount === 1
                  ? "Inspection confirmed the source entrypoint"
                  : "Inspection reconfirmed the source entrypoint with different wording",
                directories: [
                  {
                    path: "src/main",
                    summary: "Electron main-process source files",
                    confidence: "high"
                  }
                ],
                keyFiles: [
                  {
                    path: "src/main/main.ts",
                    summary: "Main-process source entrypoint",
                    confidence: "high"
                  }
                ],
                entryPoints: [
                  {
                    path: "src/main/main.ts",
                    role: "main source entrypoint",
                    summary: "Actual Electron source entrypoint",
                    confidence: "high"
                  }
                ],
                modules: [],
                openQuestions: [],
                contradictions: []
              }
            };
          }

          return {
            summary: "Initial discovery guessed the wrong source entrypoint",
            evidenceBundles: [],
            projectStructure: {
              summary: "Initial structure summary points to the wrong entrypoint",
              directories: [
                {
                  path: "src/main",
                  summary: "Electron main-process source files",
                  confidence: "medium"
                }
              ],
              keyFiles: [
                {
                  path: "src/main/main.js",
                  summary: "Stale source entrypoint guess",
                  confidence: "low"
                }
              ],
              entryPoints: [
                {
                  path: "src/main/main.js",
                  role: "suspected source entrypoint",
                  summary: "Initial stale guess",
                  confidence: "low"
                }
              ],
              modules: [],
              openQuestions: ["Need to confirm the actual main source entrypoint"],
              contradictions: ["Initial structure summary points to the wrong entrypoint"]
            }
          };
        }
      },
      []
    )
  );

  const runtime = new OrchestratorRuntime(registry, {
    onEvent: (event) => {
      runId ??= event.runId;
    }
  });

  await assert.rejects(
    runtime.executeScheduledRun({
      goal: "Stop repeated inspection after the actual source entrypoint has already been confirmed",
      reviewPolicy: "none",
      assignedModels: {
        abstractPlanner: planner,
        gatherer,
        concretePlanner: planner
      }
    }),
    /did not change the structure memory/
  );

  assert.notEqual(runId, null);
  const snapshot = runtime.getSnapshot(runId!);
  assert.equal(snapshot.run.status, "escalated");
  assert.equal(snapshot.nodes.filter((node) => node.title.includes("/ inspection-1")).length, 1);
  assert.equal(snapshot.nodes.filter((node) => node.title.includes("/ inspection-2")).length, 1);
  assert.equal(
    snapshot.projectStructure.openQuestions.filter((question) => question.status === "open").length,
    0
  );
  assert.equal(
    snapshot.projectStructure.contradictions.filter((contradiction) => contradiction.status === "open").length,
    0
  );
  assert.equal(
    snapshot.events.some((event) =>
      event.type === "scheduler_progress"
      && event.payload.message === "Stopping repeated project structure inspection because the structure memory did not change"
      && event.payload.attempt === 2
    ),
    true
  );
});

test("runtime injects working-memory cues into task-orchestration abstract and gather objectives", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();
  let abstractObjective = "";
  let gatherObjective = "";

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: (context) => {
          abstractObjective = context.node.objective;
          return {
            summary: "Inspect the main tool status path first",
            targetsToInspect: ["src/main/tool-manager.ts"],
            evidenceRequirements: ["Confirm whether ToolManager already exposes quota fields"]
          };
        },
        concretePlan: () => ({
          summary: "Execution ready",
          childTasks: [],
          executionNotes: []
        }),
        verify: () => ({
          summary: "Verification passed",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );

  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: (context) => {
          gatherObjective = context.node.objective;
          return {
            summary: "Gather confirmed the next inspection target is already narrow",
            evidenceBundles: []
          };
        }
      },
      trace
    )
  );

  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution complete",
          outputs: ["noop"]
        })
      },
      trace
    )
  );

  const seededWorkingMemory: WorkingMemorySnapshot = {
    runId: "previous-run",
    facts: [],
    openQuestions: [
      {
        id: "seed-question",
        question: "Confirm whether ToolManager already exposes quota fields",
        status: "open",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ],
    unknowns: [],
    conflicts: [],
    decisions: [
      {
        id: "seed-decision",
        summary: "Previous finding",
        rationale: "The topbar is the likely compact indicator slot.",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ],
    updatedAt: "2026-03-19T09:00:00.000Z"
  };

  const seededEvidence: EvidenceBundle = {
    id: "seed-bundle",
    runId: "previous-run",
    nodeId: "old-node",
    summary: "Current tool state has no quota field",
    facts: [],
    hypotheses: [],
    unknowns: [],
    relevantTargets: [{ filePath: "src/main/tool-manager.ts" }],
    snippets: [],
    references: [],
    confidence: "high",
    createdAt: "2026-03-19T09:00:00.000Z",
    updatedAt: "2026-03-19T09:00:00.000Z"
  };

  const seededProjectStructure: ProjectStructureSnapshot = {
    runId: "previous-run",
    summary: "Quota UI likely spans the main and renderer layers",
    directories: [
      {
        id: "seed-directory",
        path: "src/main",
        summary: "Electron main-process files",
        confidence: "high",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ],
    keyFiles: [
      {
        id: "seed-key-file",
        path: "src/main/tool-manager.ts",
        summary: "Managed tool state source",
        confidence: "high",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ],
    entryPoints: [
      {
        id: "seed-entrypoint",
        path: "src/renderer/app.ts",
        role: "renderer entrypoint",
        summary: "UI entrypoint",
        confidence: "medium",
        referenceIds: [],
        relatedNodeIds: ["old-node"],
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ],
    modules: [],
    openQuestions: [],
    contradictions: [],
    updatedAt: "2026-03-19T09:00:00.000Z"
  };

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeHappyPath({
    goal: "Add a compact quota indicator",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    },
    continuation: {
      sourceRunId: "previous-run",
      evidenceBundles: [seededEvidence],
      workingMemory: seededWorkingMemory,
      projectStructure: seededProjectStructure
    }
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.match(abstractObjective, /Priority memory cues:/);
  assert.match(abstractObjective, /Confirm whether ToolManager already exposes quota fields/);
  assert.match(abstractObjective, /src\/main\/tool-manager\.ts/);
  assert.match(gatherObjective, /Priority memory cues:/);
  assert.match(gatherObjective, /Inspection target identified: src\/main\/tool-manager\.ts/);
  assert.match(gatherObjective, /Current tool state has no quota field/);
});

test("runtime resolves project-structure issues recorded inside the inspection subtree", async () => {
  const trace: string[] = [];
  const registry = new ModelAdapterRegistry();

  const planner: ModelRef = {
    id: "planner-upper",
    provider: "mock",
    model: "planner-upper",
    tier: "upper",
    reasoningEffort: "high"
  };
  const gatherer: ModelRef = {
    id: "gather-lower",
    provider: "mock",
    model: "gather-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };
  const executor: ModelRef = {
    id: "execute-lower",
    provider: "mock",
    model: "execute-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan", "verify"]),
      {
        abstractPlan: () => ({
          summary: "Inspect the actual main source entrypoint",
          targetsToInspect: ["src/main/main.ts"],
          evidenceRequirements: ["Confirm the actual source entrypoint and close stale entrypoint questions"]
        }),
        concretePlan: (_evidenceCount, _factCount, context) => {
          if (context.workflowStage === "project_structure_inspection") {
            return {
              summary: "Inspection finished",
              childTasks: [],
              executionNotes: []
            };
          }

          if (!context.projectStructure.entryPoints.some((entry) => entry.path === "src/main/main.ts")) {
            return {
              summary: "Need a structure re-read",
              childTasks: [],
              executionNotes: [],
              needsProjectStructureInspection: true,
              inspectionObjectives: ["Confirm the actual Electron main source entrypoint"],
              projectStructureContradictions: ["The initial source entrypoint guess may be stale"]
            };
          }

          return {
            summary: "Execution ready",
            childTasks: [],
            executionNotes: []
          };
        },
        verify: () => ({
          summary: "Verification passed",
          passed: true,
          findings: []
        })
      },
      trace
    )
  );

  registry.register(
    new MockAdapter(
      gatherer,
      new Set(["gather"]),
      {
        gather: (context) => {
          if (context.workflowStage === "project_structure_inspection") {
            return {
              summary: "Inspection confirmed the main source entrypoint",
              evidenceBundles: [],
              projectStructure: {
                summary: "Inspection normalized the main source entrypoint",
                directories: [
                  {
                    path: "src/main",
                    summary: "Electron main-process source files",
                    confidence: "high"
                  }
                ],
                keyFiles: [
                  {
                    path: "src/main/main.ts",
                    summary: "Actual main source entrypoint",
                    confidence: "high"
                  }
                ],
                entryPoints: [
                  {
                    path: "src/main/main.ts",
                    role: "main source entrypoint",
                    summary: "Actual Electron source entrypoint",
                    confidence: "high"
                  }
                ],
                modules: [],
                openQuestions: ["Need to clear the stale src/main/main.js source-entrypoint memory"],
                contradictions: ["The initial source entrypoint guess may be stale"]
              }
            };
          }

          return {
            summary: "Initial discovery guessed the wrong source entrypoint",
            evidenceBundles: [],
            projectStructure: {
              summary: "Initial structure summary points to the wrong entrypoint",
              directories: [
                {
                  path: "src/main",
                  summary: "Electron main-process source files",
                  confidence: "medium"
                }
              ],
              keyFiles: [],
              entryPoints: [
                {
                  path: "src/main/main.js",
                  role: "suspected source entrypoint",
                  summary: "Initial stale guess",
                  confidence: "low"
                }
              ],
              modules: [],
              openQuestions: ["Need to confirm the actual main source entrypoint"],
              contradictions: ["The initial source entrypoint guess may be stale"]
            }
          };
        }
      },
      trace
    )
  );

  registry.register(
    new MockAdapter(
      executor,
      new Set(["execute"]),
      {
        execute: () => ({
          summary: "Execution complete",
          outputs: ["ok"]
        })
      },
      trace
    )
  );

  const runtime = new OrchestratorRuntime(registry);
  const result = await runtime.executeHappyPath({
    goal: "Normalize the entrypoint memory before planning quota UI work",
    reviewPolicy: "none",
    assignedModels: {
      abstractPlanner: planner,
      gatherer,
      concretePlanner: planner,
      executor,
      verifier: planner
    }
  });

  assert.equal(result.snapshot.run.status, "done");
  assert.equal(
    result.snapshot.projectStructure.openQuestions.filter((entry) => entry.status === "open").length,
    0
  );
  assert.equal(
    result.snapshot.projectStructure.contradictions.filter((entry) => entry.status === "open").length,
    0
  );
  assert.deepEqual(
    result.snapshot.projectStructure.entryPoints.map((entry) => entry.path),
    ["src/main/main.ts"]
  );
});
