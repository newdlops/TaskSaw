import assert from "node:assert/strict";
import test from "node:test";
import { ProjectStructureMemoryStore } from "./project-structure-memory";

test("project structure memory prefers newer summaries when the same path is re-observed", () => {
  const store = new ProjectStructureMemoryStore("run-1", () => "2026-03-20T00:00:00.000Z");

  store.mergeReport("node-cache", {
    summary: "Cached repository sketch",
    directories: [],
    keyFiles: [
      {
        path: "src/main/tool-manager.ts",
        summary: "Legacy cached summary that is longer but stale",
        confidence: "medium",
        referenceIds: []
      }
    ],
    entryPoints: [],
    modules: [],
    openQuestions: [],
    contradictions: []
  });

  store.mergeReport("node-live", {
    summary: "Observed repository sketch",
    directories: [],
    keyFiles: [
      {
        path: "src/main/tool-manager.ts",
        summary: "Managed tool discovery and auth",
        confidence: "medium",
        referenceIds: []
      }
    ],
    entryPoints: [],
    modules: [],
    openQuestions: [],
    contradictions: []
  });

  assert.equal(store.getSnapshot().keyFiles[0]?.summary, "Managed tool discovery and auth");
});

test("project structure memory replaces tentative entrypoints when a stronger canonical entrypoint is observed", () => {
  const store = new ProjectStructureMemoryStore("run-1", () => "2026-03-20T00:00:00.000Z");

  store.mergeReport("node-initial", {
    summary: "Initial repository sketch",
    directories: [],
    keyFiles: [],
    entryPoints: [
      {
        path: "src/main/main.js",
        role: "suspected source entrypoint",
        summary: "Initial stale guess",
        confidence: "low",
        referenceIds: []
      }
    ],
    modules: [],
    openQuestions: [],
    contradictions: []
  });

  store.mergeReport("node-confirmed", {
    summary: "Inspection confirmed the actual entrypoint",
    directories: [],
    keyFiles: [],
    entryPoints: [
      {
        path: "src/main/main.ts",
        role: "main source entrypoint",
        summary: "Actual Electron source entrypoint",
        confidence: "high",
        referenceIds: []
      }
    ],
    modules: [],
    openQuestions: [],
    contradictions: []
  });

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.entryPoints.length, 1);
  assert.equal(snapshot.entryPoints[0]?.path, "src/main/main.ts");
  assert.equal(snapshot.entryPoints[0]?.role, "main source entrypoint");
  assert.equal(snapshot.entryPoints[0]?.confidence, "high");
});
