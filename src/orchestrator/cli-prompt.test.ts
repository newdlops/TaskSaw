import assert from "node:assert/strict";
import test from "node:test";
import { buildCliPrompt, extractCliPromptEnvelope } from "./cli-prompt";
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
      goal: "Add a compact quota indicator",
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
      objective: "Add a compact quota indicator",
      depth: 0,
      phase: "abstract_plan",
      assignedModels: {
        abstractPlanner: model,
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
      summary: "Quota UI work touches the main and renderer layers",
      directories: [],
      keyFiles: [],
      entryPoints: [],
      modules: [],
      openQuestions: [],
      contradictions: [],
      updatedAt: "2026-03-19T00:00:00.000Z"
    },
    evidenceBundles: [],
    sessionScopeHint: {
      ownerTaskId: "node-root",
      ownerTaskTitle: "Root Task",
      ownerTaskObjective: "Add a compact quota indicator",
      ownerTaskLineage: ["Root Task: Add a compact quota indicator"]
    }
  };
}

test("task orchestration abstract plan prompt prioritizes existing memory before new search", () => {
  const prompt = buildCliPrompt("abstractPlan", createContext(TEST_MODEL));

  assert.match(
    prompt,
    /Start from the provided evidence, workingMemory, and projectStructure before doing any new search\./
  );
  assert.match(
    prompt,
    /Turn the existing open questions, contradictions, keyFiles, entryPoints, relevantTargets, and recent memory decisions into 1-3 concrete inspection targets\./
  );
  assert.match(
    prompt,
    /Inspection targets must be explicit file paths, modules, entrypoints, symbols, managed-tool locations, or clearly named external surfaces\./
  );
  assert.match(
    prompt,
    /If the current memory already names a concrete external surface such as a CLI command, API route, or managed-tool capability check, inspect that surface before pivoting to local caches, log files, temp files, or home-directory state\./
  );
  assert.match(
    prompt,
    /If the user explicitly asked for exact or actual data, keep the plan centered on the concrete data source or blocker evidence first\./
  );
});

test("task orchestration gather prompt forbids broad search before checking memory-derived targets", () => {
  const prompt = buildCliPrompt("gather", createContext(TEST_MODEL));

  assert.match(
    prompt,
    /Start from the provided evidence, workingMemory, and projectStructure before doing any new search\./
  );
  assert.match(
    prompt,
    /Prefer confirming or disproving the current memory's open questions at the named files, entrypoints, modules, relevantTargets, or managed tool locations before running broader searches\./
  );
  assert.match(
    prompt,
    /Do not search outside the workspace or managed tool installation paths unless the current node explicitly requires it\./
  );
  assert.match(
    prompt,
    /Do not ask the user for permission to continue planning, escape plan mode, or work around internal tool\/runtime errors\./
  );
  assert.match(
    prompt,
    /Treat the abstract plan's inspection targets and evidence requirements as the current gather contract\./
  );
  assert.match(
    prompt,
    /Stay within that contract unless each named target has been exhausted and you can justify widening the search in the returned evidence\./
  );
  assert.match(
    prompt,
    /If the user asked for exact or actual data, do not treat a UI fallback label as sufficient\./
  );
  assert.match(
    prompt,
    /When probing an external CLI surface, prefer one documented help\/usage check and one direct capability check\./
  );
  assert.match(
    prompt,
    /Do not pivot from a named external surface to local cache, log, temp, or home-directory files until one direct capability check against that named surface has failed or returned explicit blocker evidence\./
  );
  assert.match(
    prompt,
    /In a focused follow-up gather pass, inspect named files, symbols, or managed-tool surfaces directly instead of rediscovering whether they exist\./
  );
  assert.match(
    prompt,
    /Do not spend focused gather budget on existence-only commands such as find-by-name sweeps, plain ls path checks, recursive ls listings, or broad \*\.md\/settings\.json searches/
  );
  assert.match(
    prompt,
    /include the exact excerpt in snippets with file\/source location and connect it through references\./
  );
  assert.match(
    prompt,
    /each materially relevant file or symbol target should usually contribute at least one anchored snippet\/reference pair\./
  );
  assert.match(
    prompt,
    /"snippets"\?: Array</
  );
  assert.match(
    prompt,
    /"references"\?: Array</
  );
});

test("task orchestration execute prompt prefers build-first dist tests over raw source TypeScript tests", () => {
  const prompt = buildCliPrompt("execute", createContext(TEST_MODEL));

  assert.match(
    prompt,
    /When execution needs tests in this TypeScript workspace, prefer the project's documented scripts or a build-first path such as npm run build followed by built dist tests over raw node --test src\/\*\*\/\*\.ts entrypoints\./
  );
});

test("bootstrap sketch gather prompt stays at seed level and defers deep probing", () => {
  const prompt = buildCliPrompt("gather", {
    ...createContext(TEST_MODEL),
    workflowStage: "bootstrap_sketch"
  });

  assert.match(
    prompt,
    /Stay at seed level only: capture clues and open questions, then defer any detailed inspection to the later planning and gather stages\./
  );
  assert.match(
    prompt,
    /Do not probe external CLIs, managed-tool installations, package internals, auth state, quota surfaces, or home-directory files during bootstrap sketch\./
  );
  assert.match(
    prompt,
    /If deeper exploration seems necessary, record that it is needed instead of performing it now\./
  );
});

test("task orchestration concrete plan prompt distinguishes structural gaps from missing external capabilities", () => {
  const prompt = buildCliPrompt("concretePlan", createContext(TEST_MODEL));

  assert.match(
    prompt,
    /Set needsProjectStructureInspection=true only for repository-structure gaps: contradictory file paths, entrypoints, modules, runtime boundaries, IPC\/preload wiring, or renderer DOM locations that must be re-read from the workspace\./
  );
  assert.match(
    prompt,
    /Do not request projectStructure inspection for non-structural gaps such as unsupported product capabilities, missing external quota APIs, absent managed-tool features, auth limitations, or implementation tradeoffs\./
  );
  assert.match(
    prompt,
    /If the key blocker is a missing or unsupported data source rather than ambiguous repository structure, keep needsProjectStructureInspection=false and explain the blocker or fallback in executionNotes or childTasks\./
  );
  assert.match(
    prompt,
    /Do not downgrade an exact-data request into a UI fallback, placeholder label, or 'n\/a' plan unless the gathered evidence already contains explicit blocker facts/
  );
  assert.match(
    prompt,
    /If the user asked for exact, actual, precise, or real data and that blocker evidence is still weak, set needsAdditionalGather=true/
  );
  assert.match(
    prompt,
    /If blocker evidence already shows that external-path approval or one raw payload\/stderr sample is required, do not convert that into an instrumentation, diagnostic logging, temp log file, or gemini_debug\.log plan\./
  );
  assert.match(
    prompt,
    /If the current evidence is still too broad for execution but one more focused plan\/gather pass would materially narrow the scope, set needsAdditionalGather=true, keep childTasks empty when possible, and return 1-3 explicit additionalGatherObjectives\./
  );
  assert.match(
    prompt,
    /Use needsAdditionalGather only for narrow follow-up evidence collection\. Do not punt broad discovery back to gather\./
  );
  assert.match(
    prompt,
    /Do not call tools, create temp files, or run shell commands during concrete planning\./
  );
});

test("task orchestration concrete plan prompt includes a lossless evidence ledger", () => {
  const prompt = buildCliPrompt("concretePlan", {
    ...createContext(TEST_MODEL),
    evidenceBundles: [
      {
        id: "bundle-1",
        runId: "run-test",
        nodeId: "node-root",
        summary: "Renderer quota wiring evidence",
        facts: [
          {
            id: "fact-1",
            statement: "renderer/app.ts reads quota data from the preload bridge response.",
            confidence: "high",
            referenceIds: ["ref-1"]
          }
        ],
        hypotheses: [
          {
            id: "hyp-1",
            statement: "The renderer badge can be updated without changing the IPC contract.",
            confidence: "medium",
            referenceIds: ["ref-1"]
          }
        ],
        unknowns: [
          {
            id: "unknown-1",
            question: "Which response field carries the remaining percentage?",
            impact: "high",
            referenceIds: ["ref-1"]
          }
        ],
        relevantTargets: [
          { filePath: "src/renderer/app.ts" },
          { symbol: "renderQuotaBadge" }
        ],
        snippets: [
          {
            id: "snippet-1",
            kind: "code",
            content: "const quota = await window.tasksaw.getQuota();",
            location: {
              filePath: "src/renderer/app.ts",
              line: 42,
              column: 7
            },
            referenceId: "ref-1",
            rationale: "Current renderer quota read path"
          }
        ],
        references: [
          {
            id: "ref-1",
            sourceType: "file",
            location: {
              filePath: "src/renderer/app.ts",
              line: 42,
              column: 7
            },
            note: "Renderer quota lookup call site"
          }
        ],
        confidence: "high",
        createdAt: "2026-03-19T00:00:00.000Z",
        updatedAt: "2026-03-19T00:00:00.000Z"
      }
    ]
  });

  const envelope = extractCliPromptEnvelope(prompt);
  assert.equal(envelope.evidenceBundles[0]?.summary, "Renderer quota wiring evidence");
  assert.equal(envelope.evidenceBundles[0]?.facts[0], "renderer/app.ts reads quota data from the preload bridge response.");
  assert.equal(envelope.evidenceBundles[0]?.snippetCount, 1);
  assert.equal(envelope.evidenceBundles[0]?.referenceCount, 1);
  assert.equal(envelope.evidenceBundles[0]?.snippetTargets?.[0], "src/renderer/app.ts");
  assert.equal(envelope.evidenceLedger?.[0]?.id, "bundle-1");
  assert.equal(envelope.evidenceLedger?.[0]?.facts[0]?.referenceIds[0], "ref-1");
  assert.equal(envelope.evidenceLedger?.[0]?.snippets[0]?.content, "const quota = await window.tasksaw.getQuota();");
  assert.equal(envelope.evidenceLedger?.[0]?.references[0]?.location?.filePath, "src/renderer/app.ts");
  assert.match(
    prompt,
    /Use evidenceLedger as the canonical, lossless gather-to-plan handoff\./
  );
  assert.match(
    prompt,
    /Check evidenceBundles\.snippetCount and snippetTargets first to see whether exact file or payload excerpts were actually gathered/
  );
  assert.match(
    prompt,
    /If execution depends on exact file structure, DOM markup, config keys, selectors, API payloads, command output, or error text and evidenceLedger lacks the relevant anchored snippets or raw excerpts, set needsAdditionalGather=true/
  );
});

test("task orchestration concrete plan prompt tolerates malformed referenceIds in evidence bundles", () => {
  const prompt = buildCliPrompt("concretePlan", {
    ...createContext(TEST_MODEL),
    evidenceBundles: [
      {
        id: "bundle-malformed",
        runId: "run-test",
        nodeId: "node-root",
        summary: "Loose gather output",
        facts: [
          {
            id: "fact-1",
            statement: "renderer/app.ts contains the run button listener",
            confidence: "high",
            referenceIds: "ref-run" as unknown as string[]
          }
        ],
        hypotheses: [],
        unknowns: [],
        relevantTargets: [{ filePath: "src/renderer/app.ts" }],
        snippets: [],
        references: [],
        confidence: "high",
        createdAt: "2026-03-19T00:00:00.000Z",
        updatedAt: "2026-03-19T00:00:00.000Z"
      }
    ] as ModelInvocationContext["evidenceBundles"]
  });

  const envelope = extractCliPromptEnvelope(prompt);
  assert.deepEqual(envelope.evidenceLedger?.[0]?.facts[0]?.referenceIds, ["ref-run"]);
});

test("gather prompt separates the read-only stage objective from downstream task intent", () => {
  const baseContext = createContext(TEST_MODEL);
  const prompt = buildCliPrompt("gather", {
    ...baseContext,
    run: {
      ...baseContext.run,
      goal: "Before refactoring src/renderer/app.ts, write tests from src/renderer/app_test_plan.md, install Jest if missing, and create 300 standalone tests."
    },
    node: {
      ...baseContext.node,
      id: "node-gather",
      parentId: "node-root",
      role: "stage",
      title: "Gather",
      objective: "Collect only the file, symbol, and evidence findings needed before the next concrete plan for the current task."
    },
    sessionScopeHint: {
      ownerTaskId: "node-root",
      ownerTaskTitle: "Root Task",
      ownerTaskObjective: "Before refactoring src/renderer/app.ts, write tests from src/renderer/app_test_plan.md, install Jest if missing, and create 300 standalone tests.",
      ownerTaskLineage: [
        "Root Task: Before refactoring src/renderer/app.ts, write tests from src/renderer/app_test_plan.md, install Jest if missing, and create 300 standalone tests."
      ]
    }
  });

  const envelope = extractCliPromptEnvelope(prompt);
  assert.equal(
    envelope.objective,
    "Collect only the file, symbol, and evidence findings needed before the next concrete plan for the current task."
  );
  assert.equal(
    envelope.taskScope?.objective,
    "Before refactoring src/renderer/app.ts, write tests from src/renderer/app_test_plan.md, install Jest if missing, and create 300 standalone tests."
  );
  assert.match(prompt, /Treat taskScope\.objective as downstream task intent only\./);
  assert.match(prompt, /return it in nextObjectives\.concretePlan\./);
});

test("task orchestration abstract plan prompt asks for snippet-level evidence when structure matters", () => {
  const prompt = buildCliPrompt("abstractPlan", createContext(TEST_MODEL));

  assert.match(
    prompt,
    /If downstream planning will depend on exact code, DOM, config, selector, payload, or error text, say so explicitly in evidenceRequirements and ask gather for a line-anchored snippet or raw excerpt instead of a summary\./
  );
});

test("task orchestration abstract plan prompt avoids repeating failed logging workarounds", () => {
  const prompt = buildCliPrompt("abstractPlan", createContext(TEST_MODEL));

  assert.match(
    prompt,
    /If workingMemory already records a failed or deferred instrumentation, logging, or gemini_debug\.log attempt for this exact-data request, do not propose that approach again\./
  );
  assert.match(
    prompt,
    /Move directly to the external approval or raw payload blocker instead\./
  );
  assert.match(
    prompt,
    /If the next narrow step is a direct managed-tool read or CLI capability check outside the workspace, target that exact surface so gather can request approval for it\./
  );
});

test("task orchestration verify prompt rejects placeholder successes and follow-up fixes", () => {
  const prompt = buildCliPrompt("verify", createContext(TEST_MODEL));

  assert.match(
    prompt,
    /Verify the requested user-visible behavior and system state, not just the presence of code changes, strings, or build success\./
  );
  assert.match(
    prompt,
    /A generic success claim or a simple 'grep' for modified text is insufficient\./
  );
  assert.match(
    prompt,
    /Set passed=false if any requested behavior still relies on placeholder, fallback, no-data, or unsupported upstream sources instead of the requested real result\./
  );
  assert.match(
    prompt,
    /Set passed=false if the implementation is technically present but logically disconnected/
  );
  assert.match(
    prompt,
    /When additional tests are necessary in this TypeScript workspace, prefer the project's documented scripts or built dist tests after a build\./
  );
  assert.match(
    prompt,
    /Do not modify files, create temp scripts, or attempt follow-up fixes during verify\./
  );
});

test("task orchestration gather prompt rejects logging-workaround pivots for missing external evidence", () => {
  const prompt = buildCliPrompt("gather", createContext(TEST_MODEL));

  assert.match(
    prompt,
    /Do not turn missing external evidence into a workspace logging or instrumentation plan\./
  );
  assert.match(
    prompt,
    /If the next required step is external-path approval or one raw payload\/stderr sample, return that blocker directly in the gathered evidence\./
  );
  assert.match(
    prompt,
    /If workingMemory already shows that instrumentation, logging, or gemini_debug\.log was tried for this request, do not gather around that workaround again\./
  );
  assert.match(
    prompt,
    /When the current contract requires a named external path or CLI capability check outside the workspace, it is acceptable to request approval for that narrow direct read or command and use the result as evidence\./
  );
});
