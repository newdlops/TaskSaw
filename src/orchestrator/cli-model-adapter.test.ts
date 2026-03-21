import assert from "node:assert/strict";
import test from "node:test";
import { CliModelAdapter } from "./cli-model-adapter";
import { ModelInvocationContext } from "./model-adapter";
import { ModelRef } from "./types";

const TEST_MODEL: ModelRef = {
  id: "test-model",
  provider: "tasksaw-test",
  model: "test-model",
  tier: "upper",
  reasoningEffort: "medium"
};

function createContext(model: ModelRef): ModelInvocationContext {
  return {
    run: {
      id: "run-test",
      goal: "Validate CLI adapter parsing",
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
      objective: "Validate CLI adapter parsing",
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

test("gemini adapter parses fenced JSON output", async () => {
  const payload = {
    summary: "gathered evidence",
    evidenceBundles: []
  };
  const script = `process.stdout.write("header\\n\\\`\\\`\\\`json\\n${JSON.stringify(payload).replace(/"/g, '\\"')}\\n\\\`\\\`\\\`\\n");`;
  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["gather"]
  });

  const result = await adapter.gather!(createContext(TEST_MODEL));
  assert.equal(result.summary, payload.summary);
  assert.deepEqual(result.evidenceBundles, payload.evidenceBundles);
});

test("gemini adapter unwraps json formatter response payloads", async () => {
  const payload = {
    summary: "gathered evidence from wrapped response",
    evidenceBundles: []
  };
  const script = `process.stdout.write(${JSON.stringify(JSON.stringify({ response: JSON.stringify(payload) }))});`;
  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["gather"]
  });

  const result = await adapter.gather!(createContext(TEST_MODEL));
  assert.equal(result.summary, payload.summary);
  assert.deepEqual(result.evidenceBundles, payload.evidenceBundles);
});

test("gemini adapter retries once with a JSON-only repair prompt after prose output", async () => {
  const payload = {
    summary: "gathered evidence after repair",
    evidenceBundles: []
  };
  const prompts: string[] = [];
  let invocationCount = 0;

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    customInvoke: async (_capability, prompt) => {
      prompts.push(prompt);
      invocationCount += 1;

      if (invocationCount === 1) {
        return {
          stdout: [
            "핵심 파일을 먼저 점검하겠습니다.",
            "이제 사용량 조회 가능성을 확인하겠습니다."
          ].join("\n\n"),
          stderr: "",
          command: ["gemini", "--acp"]
        };
      }

      return {
        stdout: JSON.stringify(payload),
        stderr: "",
        command: ["gemini", "--acp"]
      };
    },
    supportedCapabilities: ["gather"]
  });

  const result = await adapter.gather!(createContext(TEST_MODEL));
  assert.equal(result.summary, payload.summary);
  assert.deepEqual(result.evidenceBundles, payload.evidenceBundles);
  assert.equal(invocationCount, 2);
  assert.match(prompts[1] ?? "", /Return exactly one JSON object and nothing else\./);
  assert.match(prompts[1] ?? "", /Do not call tools or edit files\./);
});

test("default CLI invocation streams stdout and stderr into terminal events", async () => {
  const payload = {
    summary: "streamed gather",
    evidenceBundles: []
  };
  const script = [
    "process.stderr.write('booting...\\n');",
    `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`
  ].join(" ");
  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["gather"]
  });
  const terminalEvents: Array<{ stream?: string; text: string }> = [];
  const context = createContext(TEST_MODEL);
  context.reportTerminalEvent = (event) => {
    terminalEvents.push({
      stream: event.stream,
      text: event.text
    });
  };

  const result = await adapter.gather!(context);

  assert.equal(result.summary, payload.summary);
  assert(terminalEvents.some((event) => event.stream === "system" && event.text.includes(process.execPath)));
  assert(terminalEvents.some((event) => event.stream === "stderr" && event.text.includes("booting...")));
  assert(terminalEvents.some((event) => event.stream === "stdout" && event.text.includes("\"summary\":\"streamed gather\"")));
});

test("codex adapter parses fenced JSON inside assistant message output", async () => {
  const payload = {
    summary: "concrete plan ready",
    childTasks: [],
    executionNotes: ["stay ordered"],
    needsMorePlanning: false
  };
  const assistantContent = `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  const script = [
    "const event = { type: 'assistant.message', content: process.env.TASKSAW_TEST_CONTENT };",
    "process.stdout.write(JSON.stringify({ type: 'session.started' }) + '\\n');",
    "process.stdout.write(JSON.stringify(event) + '\\n');"
  ].join(" ");

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "codex",
    executablePath: process.execPath,
    env: {
      TASKSAW_TEST_CONTENT: assistantContent
    },
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["concretePlan"]
  });

  const result = await adapter.concretePlan!(createContext(TEST_MODEL));
  assert.equal(result.summary, payload.summary);
  assert.deepEqual(result.childTasks, payload.childTasks);
  assert.deepEqual(result.executionNotes, payload.executionNotes);
  assert.equal(result.needsMorePlanning, false);
});

test("execute adapter marks blocked executions as incomplete", async () => {
  const payload = {
    summary: "Execution was denied by policy and has not been completed",
    outputs: [],
    completed: false,
    blockedReason: "policy denied file modification"
  };
  const assistantContent = `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  const script = [
    "const event = { type: 'assistant.message', content: process.env.TASKSAW_TEST_CONTENT };",
    "process.stdout.write(JSON.stringify({ type: 'session.started' }) + '\\n');",
    "process.stdout.write(JSON.stringify(event) + '\\n');"
  ].join(" ");

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "codex",
    executablePath: process.execPath,
    env: {
      TASKSAW_TEST_CONTENT: assistantContent
    },
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["execute"]
  });

  const result = await adapter.execute!(createContext(TEST_MODEL));
  assert.equal(result.completed, false);
  assert.equal(result.blockedReason, "policy denied file modification");
  assert.deepEqual(result.outputs, []);
});

test("execute adapter rejects claimed success when unresolved blocker language remains", async () => {
  const payload = {
    summary: "Execution completed, but the requested behavior still relies on placeholder/no-data fallback.",
    outputs: ["UI wiring updated"],
    completed: true
  };
  const script = `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`;
  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["execute"]
  });

  const result = await adapter.execute!(createContext(TEST_MODEL));
  assert.equal(result.completed, false);
});

test("execute adapter marks missing execution summaries as incomplete", async () => {
  const payload = {
    outputs: ["Patched renderer label"]
  };
  const script = `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`;
  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["execute"]
  });

  const result = await adapter.execute!(createContext(TEST_MODEL));
  assert.equal(result.summary, "No execution summary returned");
  assert.equal(result.completed, false);
  assert.equal(result.blockedReason, "Executor did not return the required execution summary.");
});

test("verify adapter rejects claimed success when unresolved blocker language remains", async () => {
  const payload = {
    summary: "Verification passed, but the requested behavior still relies on placeholder/no-data fallback.",
    passed: true,
    findings: []
  };
  const script = `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`;
  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["verify"]
  });

  const result = await adapter.verify!(createContext(TEST_MODEL));
  assert.equal(result.passed, false);
});

test("codex adapter parses item.completed agent_message output", async () => {
  const payload = {
    summary: "abstract plan ready",
    targetsToInspect: ["src/main/orchestrator-service.ts"],
    evidenceRequirements: ["Confirm the concrete planning schema"]
  };
  const script = [
    "const event = {",
    "  type: 'item.completed',",
    "  item: { type: 'agent_message', text: process.env.TASKSAW_TEST_CONTENT }",
    "};",
    "process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 't1' }) + '\\n');",
    "process.stdout.write(JSON.stringify({ type: 'turn.started' }) + '\\n');",
    "process.stdout.write(JSON.stringify(event) + '\\n');"
  ].join(" ");

  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "codex",
    executablePath: process.execPath,
    env: {
      TASKSAW_TEST_CONTENT: JSON.stringify(payload)
    },
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["abstractPlan"]
  });

  const result = await adapter.abstractPlan!(createContext(TEST_MODEL));
  assert.equal(result.summary, payload.summary);
  assert.deepEqual(result.targetsToInspect, payload.targetsToInspect);
  assert.deepEqual(result.evidenceRequirements, payload.evidenceRequirements);
});

test("abstract plan response defaults missing array fields", async () => {
  const payload = {
    summary: "inspect the repository entrypoints first"
  };
  const script = `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`;
  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["abstractPlan"]
  });

  const result = await adapter.abstractPlan!(createContext(TEST_MODEL));
  assert.equal(result.summary, payload.summary);
  assert.deepEqual(result.targetsToInspect, []);
  assert.deepEqual(result.evidenceRequirements, []);
});

test("gather response parses project structure reports", async () => {
  const payload = {
    summary: "gathered structure",
    evidenceBundles: [],
    projectStructure: {
      summary: "Repository structure mapped",
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
          summary: "Runtime entry",
          confidence: "high"
        }
      ],
      entryPoints: [
        {
          path: "src/main/orchestrator-service.ts",
          role: "service entrypoint",
          summary: "Starts runs",
          confidence: "medium"
        }
      ],
      modules: [
        {
          name: "runtime",
          summary: "Node execution and planning loop",
          relatedPaths: ["src/orchestrator/runtime.ts"],
          confidence: "high"
        }
      ],
      openQuestions: ["Need to confirm workspace root detection"],
      contradictions: []
    }
  };
  const script = `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`;
  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["gather"]
  });

  const result = await adapter.gather!(createContext(TEST_MODEL));
  assert.equal(result.projectStructure?.summary, payload.projectStructure.summary);
  assert.deepEqual(result.projectStructure?.directories, [
    {
      ...payload.projectStructure.directories[0],
      referenceIds: []
    }
  ]);
  assert.deepEqual(result.projectStructure?.openQuestions, payload.projectStructure.openQuestions);
});

test("concrete plan response parses project structure inspection requests", async () => {
  const payload = {
    summary: "Need to inspect the repository shape again",
    childTasks: [],
    executionNotes: ["structure mismatch detected"],
    needsProjectStructureInspection: true,
    inspectionObjectives: ["Confirm the real app entrypoint"],
    projectStructureContradictions: ["The current summary points to the wrong entrypoint"]
  };
  const script = `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`;
  const adapter = new CliModelAdapter({
    model: TEST_MODEL,
    flavor: "gemini",
    executablePath: process.execPath,
    buildInvocationArgs: () => ["-e", script],
    supportedCapabilities: ["concretePlan"]
  });

  const result = await adapter.concretePlan!(createContext(TEST_MODEL));
  assert.equal(result.needsProjectStructureInspection, true);
  assert.deepEqual(result.inspectionObjectives, payload.inspectionObjectives);
  assert.deepEqual(result.projectStructureContradictions, payload.projectStructureContradictions);
});
