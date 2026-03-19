import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceStore } from "./evidence-store";

test("creates and lists node evidence bundles", () => {
  const store = new EvidenceStore();
  const bundle = store.createBundle({
    runId: "run-1",
    nodeId: "node-1",
    summary: "Collected entry point evidence",
    facts: [
      {
        statement: "The orchestrator should be headless first",
        confidence: "high",
        referenceIds: []
      }
    ],
    unknowns: [
      {
        question: "Which CLI entrypoint should own inspect mode?",
        impact: "medium",
        referenceIds: []
      }
    ]
  });

  assert.equal(store.getBundle(bundle.id)?.summary, "Collected entry point evidence");
  assert.equal(store.listNodeBundles("node-1").length, 1);
  assert.equal(store.listRunBundles("run-1").length, 1);
});

test("merges bundles and deduplicates repeated evidence", () => {
  const store = new EvidenceStore();
  const first = store.createBundle({
    id: "bundle-a",
    runId: "run-1",
    nodeId: "node-1",
    summary: "First gather",
    facts: [
      {
        statement: "Use CLI before Electron",
        confidence: "high",
        referenceIds: ["ref-1"]
      }
    ]
  });
  const second = store.createBundle({
    id: "bundle-b",
    runId: "run-1",
    nodeId: "node-1",
    summary: "Second gather",
    facts: [
      {
        statement: "Use CLI before Electron",
        confidence: "high",
        referenceIds: ["ref-1"]
      }
    ],
    hypotheses: [
      {
        statement: "Model adapters should stay capability-based",
        confidence: "medium",
        referenceIds: []
      }
    ]
  });

  const merged = store.mergeBundles({
    runId: "run-1",
    nodeId: "node-1",
    bundleIds: [first.id, second.id],
    summary: "Merged evidence"
  });

  assert.equal(merged.facts.length, 1);
  assert.equal(merged.hypotheses.length, 1);
  assert.equal(store.listNodeBundles("node-1").length, 3);
});
