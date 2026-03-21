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
    evidenceBundles: [
      {
        id: "bundle-1",
        runId,
        nodeId: "root-node",
        summary: "tool-manager.ts handles managed tool discovery",
        facts: [
          {
            id: "evidence-fact-1",
            statement: "Managed tool discovery starts in src/main/tool-manager.ts",
            confidence: "high",
            referenceIds: []
          }
        ],
        hypotheses: [],
        unknowns: [],
        relevantTargets: [
          {
            filePath: "src/main/tool-manager.ts",
            note: "Primary managed tool integration point"
          }
        ],
        snippets: [],
        references: [],
        confidence: "high",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:05:00.000Z"
      }
    ],
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
  assert.equal(seed?.evidenceBundles[0]?.summary, "tool-manager.ts handles managed tool discovery");
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

test("workspace context cache actively merges README and mirrored hint files into the loaded seed", () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "tasksaw-workspace-hint-merge-"));
  const cache = new WorkspaceContextCache(workspacePath);

  const snapshot = createSnapshot("run-cache-merge");
  snapshot.run.workspacePath = workspacePath;
  cache.saveSnapshot(snapshot);

  fs.appendFileSync(
    path.join(workspacePath, ".tasksaw", "README.md"),
    "\n## Cached Facts\n\n- Manual hint fact from README\n",
    "utf8"
  );

  const mirroredHintPath = path.join(workspacePath, ".tasksaw", "src", "renderer", "app.ts.tasksaw.md");
  fs.mkdirSync(path.dirname(mirroredHintPath), { recursive: true });
  fs.writeFileSync(
    mirroredHintPath,
    [
      "# TaskSaw Hint",
      "",
      "Source path: src/renderer/app.ts",
      "Reference only. Real workspace files win on conflict.",
      "",
      "## Key File",
      "Summary: Renderer usage indicator and logbar rendering",
      "Confidence: medium",
      "",
      "## Module",
      "Name: renderer-status-ui",
      "Summary: Status bar and usage UI rendering",
      "Confidence: medium",
      ""
    ].join("\n"),
    "utf8"
  );

  const seed = cache.loadSeed();
  assert.ok(seed);
  assert.equal(seed?.workingMemory.facts.some((fact) => fact.statement === "Manual hint fact from README"), true);
  assert.equal(seed?.projectStructure.keyFiles.some((entry) => entry.path === "src/renderer/app.ts"), true);
  assert.equal(seed?.projectStructure.modules.some((entry) => entry.name === "renderer-status-ui"), true);
});

test("workspace context cache can rebuild a seed from hint files when context.json is missing", () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "tasksaw-workspace-hint-fallback-"));
  const cacheRoot = path.join(workspacePath, ".tasksaw");
  fs.mkdirSync(path.join(cacheRoot, "src", "main"), { recursive: true });

  fs.writeFileSync(
    path.join(cacheRoot, "README.md"),
    [
      "# TaskSaw Workspace Cache",
      "",
      "Updated at: 2026-03-20T00:05:00.000Z",
      "Source run: run-from-hints",
      "",
      "## Project Summary",
      "",
      "Workspace reconstructed from markdown hints.",
      "",
      "## Cached Facts",
      "",
      "- Hint-only fact",
      "",
      "## Key Files",
      "",
      "- src/main/tool-manager.ts: Managed tool integration",
      ""
    ].join("\n"),
    "utf8"
  );

  fs.writeFileSync(
    path.join(cacheRoot, "src", "main", "tool-manager.ts.tasksaw.md"),
    [
      "# TaskSaw Hint",
      "",
      "Source path: src/main/tool-manager.ts",
      "Reference only. Real workspace files win on conflict.",
      "",
      "## Key File",
      "Summary: Managed tool status collection",
      "Confidence: high",
      ""
    ].join("\n"),
    "utf8"
  );

  const cache = new WorkspaceContextCache(workspacePath);
  const seed = cache.loadSeed();

  assert.ok(seed);
  assert.equal(seed?.projectStructure.summary, "Workspace reconstructed from markdown hints.");
  assert.equal(seed?.workingMemory.facts.some((fact) => fact.statement === "Hint-only fact"), true);
  assert.equal(seed?.projectStructure.keyFiles.some((entry) => entry.path === "src/main/tool-manager.ts"), true);
});
