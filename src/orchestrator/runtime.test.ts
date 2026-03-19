import assert from "node:assert/strict";
import test from "node:test";
import { ModelAdapterRegistry } from "./adapter-registry";
import {
  MissingChildTaskModelAssignmentError,
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
      abstractPlan: (context: ModelInvocationContext) => AbstractPlanResult;
      gather: (context: ModelInvocationContext) => GatherResult;
      concretePlan: (evidenceCount: number, factCount: number, context: ModelInvocationContext) => ConcretePlanResult;
      review: () => ReviewResult;
      execute: () => ExecuteResult;
      verify: () => VerifyResult;
    }>,
    private readonly trace: string[]
  ) {}

  supports(capability: OrchestratorCapability): boolean {
    return this.capabilities.has(capability);
  }

  async abstractPlan(context: Parameters<NonNullable<OrchestratorModelAdapter["abstractPlan"]>>[0]) {
    this.trace.push(`abstract:${this.model.id}`);
    return this.handlers.abstractPlan?.(context) ?? {
      summary: "Abstract plan ready",
      targetsToInspect: [],
      evidenceRequirements: []
    };
  }

  async gather(context: Parameters<NonNullable<OrchestratorModelAdapter["gather"]>>[0]) {
    this.trace.push(`gather:${this.model.id}`);
    return this.handlers.gather?.(context) ?? {
      summary: "Gather done",
      evidenceBundles: []
    };
  }

  async concretePlan(context: Parameters<NonNullable<OrchestratorModelAdapter["concretePlan"]>>[0]) {
    this.trace.push(`concrete:${this.model.id}`);
    return this.handlers.concretePlan?.(context.evidenceBundles.length, context.workingMemory.facts.length, context) ?? {
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
      followUpQuestions: []
    };
  }

  async execute() {
    this.trace.push(`execute:${this.model.id}`);
    return this.handlers.execute?.() ?? {
      summary: "Execute complete",
      outputs: ["output"]
    };
  }

  async verify() {
    this.trace.push(`verify:${this.model.id}`);
    return this.handlers.verify?.() ?? {
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
          projectStructure: context.workflowStage === "project_structure_discovery"
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
          assert.equal(evidenceCount, 1);
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
  assert.equal(result.snapshot.run.status, "done");
  assert.equal(result.rootNode.phase, "done");
  assert.equal(result.snapshot.nodes.length, 2);
  assert.equal(result.snapshot.nodes[0]?.kind, "planning");
  assert.equal(result.snapshot.nodes[1]?.kind, "execution");
  assert.equal(result.snapshot.evidenceBundles.length, 3);
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
          assert.equal(context.evidenceBundles.length, 1);
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
  assert.equal(result.snapshot.evidenceBundles.length, 3);
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
    "abstract:project_structure_discovery:0",
    "gather:project_structure_discovery:0",
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
  assert.equal(result.snapshot.nodes.length, 4);
  assert.equal(result.snapshot.nodes.at(-1)?.kind, "execution");
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

test("runtime rejects decomposed child tasks that omit explicit routed models", async () => {
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
    id: "executor-lower",
    provider: "mock",
    model: "executor-lower",
    tier: "lower",
    reasoningEffort: "medium"
  };

  registry.register(
    new MockAdapter(
      planner,
      new Set(["abstractPlan", "concretePlan"]),
      {
        abstractPlan: () => ({
          summary: "Decompose the task into a child node",
          targetsToInspect: [],
          evidenceRequirements: []
        }),
        concretePlan: () => ({
          summary: "A child planner is required here",
          childTasks: [
            {
              title: "Child without routing",
              objective: "This child should fail before execution"
            }
          ],
          executionNotes: []
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
  registry.register(new MockAdapter(executor, new Set(["execute"]), {}, trace));

  const runtime = new OrchestratorRuntime(registry);
  await assert.rejects(
    runtime.executeScheduledRun({
      goal: "Fail when the planner omits explicit child model routing",
      reviewPolicy: "none",
      assignedModels: {
        abstractPlanner: planner,
        gatherer,
        concretePlanner: planner,
        executor,
        verifier: planner
      }
    }),
    (error: unknown) => error instanceof MissingChildTaskModelAssignmentError
  );

  assert.deepEqual(trace, [
    "abstract:planner-upper",
    "gather:gather-lower",
    "concrete:planner-upper"
  ]);
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

  assert.equal(result.snapshot.nodes.length, 2);
  assert.equal(result.snapshot.run.status, "done");
  assert.equal(result.snapshot.nodes[1]?.kind, "execution");
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
    "abstract:project_structure_discovery:0",
    "gather:project_structure_discovery:0",
    "concrete:task_orchestration:0:",
    "abstract:project_structure_inspection:1",
    "gather:project_structure_inspection:1",
    "concrete:project_structure_inspection:1:",
    "concrete:task_orchestration:0:"
  ]);
});
