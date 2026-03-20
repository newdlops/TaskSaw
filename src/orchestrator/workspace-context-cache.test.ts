import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RunSnapshot } from "./types";
import { WorkspaceContextCache } from "./workspace-context-cache";

function createSnapshot(runId: string): RunSnapshot {
  return {
    run: {
      id: runId,
      goal: "Cache project clues",
      language: "ko",
      status: "done",
      rootNodeId: "root-node",
      continuedFromRunId: null,
      config: {
        maxDepth: 2,
        reviewPolicy: "light",
        plannerBias: "balanced",
        carefulnessMode: "balanced",
        defaultBudget: {
          maxDepth: 2,
          evidenceBudget: 12,
          rereadBudget: 4,
          upperModelCallBudget: 6,
          reviewBudget: 2
        }
      },
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:05:00.000Z",
      completedAt: "2026-03-20T00:05:00.000Z"
    },
    nodes: [],
    evidenceBundles: [],
    workingMemory: {
      runId,
      facts: [
        {
          id: "fact-1",
          statement: "src/main owns tool installation and auth",
          confidence: "high",
          referenceIds: [],
          relatedNodeIds: ["root-node"],
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:05:00.000Z"
        }
      ],
      openQuestions: [],
      unknowns: [],
      conflicts: [],
      decisions: [
        {
          id: "decision-1",
          summary: "Start from src/main and src/renderer",
          rationale: "Those are the main integration layers",
          referenceIds: [],
          relatedNodeIds: ["root-node"],
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:05:00.000Z"
        }
      ],
      updatedAt: "2026-03-20T00:05:00.000Z"
    },
    projectStructure: {
      runId,
      summary: "Electron app split across main, renderer, and orchestrator",
      directories: [
        {
          id: "dir-1",
          path: "src/main",
          summary: "Electron main process",
          confidence: "high",
          referenceIds: [],
          relatedNodeIds: ["root-node"],
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:05:00.000Z"
        }
      ],
      keyFiles: [
        {
          id: "file-1",
          path: "src/main/tool-manager.ts",
          summary: "Managed tool discovery and auth",
          confidence: "high",
          referenceIds: [],
          relatedNodeIds: ["root-node"],
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:05:00.000Z"
        }
      ],
      entryPoints: [],
      modules: [],
      openQuestions: [],
      contradictions: [],
      updatedAt: "2026-03-20T00:05:00.000Z"
    },
    events: [],
    finalReport: undefined
  };
}

test("workspace context cache saves, loads, and resets .tasksaw clues", () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "tasksaw-workspace-cache-"));
  const cache = new WorkspaceContextCache(workspacePath);

  const snapshot = createSnapshot("run-cache-1");
  snapshot.run.workspacePath = workspacePath;
  cache.saveSnapshot(snapshot);

  const seed = cache.loadSeed();
  assert.ok(seed);
  assert.equal(seed?.workingMemory.facts[0]?.statement, "src/main owns tool installation and auth");
  assert.equal(seed?.projectStructure.summary, "Electron app split across main, renderer, and orchestrator");
  assert.equal(fs.existsSync(path.join(workspacePath, ".tasksaw", "context.json")), true);
  assert.equal(fs.existsSync(path.join(workspacePath, ".tasksaw", "README.md")), true);
  assert.equal(
    fs.existsSync(path.join(workspacePath, ".tasksaw", "src", "main", ".tasksaw.md")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(workspacePath, ".tasksaw", "src", "main", "tool-manager.ts.tasksaw.md")),
    true
  );

  cache.clear();
  assert.equal(fs.existsSync(path.join(workspacePath, ".tasksaw")), false);
});
