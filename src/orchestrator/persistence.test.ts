import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OrchestratorPersistence } from "./persistence";
import { RunSnapshot } from "./types";
import { WorkspaceContextCache } from "./workspace-context-cache";

function createSnapshot(
  runId: string,
  workspacePath: string,
  status: RunSnapshot["run"]["status"],
  options: {
    updatedAt?: string;
    finalReport?: RunSnapshot["finalReport"];
  } = {}
): RunSnapshot {
  const updatedAt = options.updatedAt ?? "2026-03-20T00:05:00.000Z";

  return {
    run: {
      id: runId,
      goal: "Track workspace continuation clues",
      workspacePath,
      language: "ko",
      status,
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
      updatedAt,
      completedAt: status === "done" ? updatedAt : null
    },
    nodes: [],
    evidenceBundles: [],
    workingMemory: {
      runId,
      facts: [
        {
          id: `fact-${runId}`,
          statement: `${runId} fact`,
          confidence: "high",
          referenceIds: [],
          relatedNodeIds: ["root-node"],
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt
        }
      ],
      openQuestions: [],
      unknowns: [],
      conflicts: [],
      decisions: [],
      updatedAt
    },
    projectStructure: {
      runId,
      summary: `${runId} project structure`,
      directories: [],
      keyFiles: [],
      entryPoints: [],
      modules: [],
      openQuestions: [],
      contradictions: [],
      updatedAt
    },
    events: [],
    finalReport: options.finalReport
  };
}

test("persistence saves workspace cache only for completed runs with a final report", () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "tasksaw-persistence-workspace-"));
  const runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasksaw-persistence-root-"));
  const persistence = new OrchestratorPersistence(runsRoot);
  const cache = new WorkspaceContextCache(workspacePath);

  const pausedSnapshot = createSnapshot("run-paused", workspacePath, "paused");
  persistence.saveSnapshot(pausedSnapshot);
  assert.equal(cache.loadSeed(), undefined);

  const completedSnapshot = createSnapshot("run-done", workspacePath, "done", {
    updatedAt: "2026-03-20T00:10:00.000Z",
    finalReport: {
      runId: "run-done",
      summary: "Completed successfully",
      outcomes: ["done"],
      unresolvedRisks: [],
      nextActions: [],
      createdAt: "2026-03-20T00:10:00.000Z"
    }
  });
  persistence.saveSnapshot(completedSnapshot);
  assert.equal(cache.loadSeed()?.sourceRunId, "run-done");

  const escalatedSnapshot = createSnapshot("run-escalated", workspacePath, "escalated", {
    updatedAt: "2026-03-20T00:15:00.000Z"
  });
  persistence.saveSnapshot(escalatedSnapshot);
  assert.equal(cache.loadSeed()?.sourceRunId, "run-done");
});
