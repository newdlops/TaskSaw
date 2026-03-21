import assert from "node:assert/strict";
import test from "node:test";
import { buildCliPrompt } from "./cli-prompt";
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
    evidenceBundles: []
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

test("task orchestration verify prompt rejects placeholder successes and follow-up fixes", () => {
  const prompt = buildCliPrompt("verify", createContext(TEST_MODEL));

  assert.match(
    prompt,
    /Verify the requested user-visible behavior, not just the presence of code changes or lint\/build success\./
  );
  assert.match(
    prompt,
    /A generic success claim is insufficient\. State the concrete observed behavior or the concrete blocker that justifies the verdict\./
  );
  assert.match(
    prompt,
    /Set passed=false if any requested behavior still relies on placeholder, fallback, no-data, or unsupported upstream sources instead of the requested real result\./
  );
  assert.match(
    prompt,
    /Do not modify files, create temp scripts or temp files, run builds, or attempt follow-up fixes during verify\./
  );
});
