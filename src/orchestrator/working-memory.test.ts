import assert from "node:assert/strict";
import test from "node:test";
import { WorkingMemoryStore } from "./working-memory";

test("working memory deduplicates repeated entries and merges metadata", () => {
  const workingMemory = new WorkingMemoryStore("run-1", () => "2026-03-19T00:00:00.000Z");

  workingMemory.recordFact({
    statement: "executionBudget.maxDepth is 2",
    confidence: "medium",
    referenceIds: ["ref-a"],
    relatedNodeIds: ["node-a"]
  });
  workingMemory.recordFact({
    statement: "executionBudget.maxDepth is 2",
    confidence: "high",
    referenceIds: ["ref-b"],
    relatedNodeIds: ["node-b"]
  });

  workingMemory.recordQuestion({
    question: "`acceptanceCriteria` 상태 확인",
    relatedNodeIds: ["node-a"]
  });
  workingMemory.recordQuestion({
    question: "acceptanceCriteria 상태 확인",
    relatedNodeIds: ["node-b"]
  });

  workingMemory.recordUnknown({
    description: "`evidenceBundles` 초기 상태 확인",
    impact: "low",
    relatedNodeIds: ["node-a"]
  });
  workingMemory.recordUnknown({
    description: "evidenceBundles 초기 상태 확인",
    impact: "high",
    relatedNodeIds: ["node-b"]
  });

  const snapshot = workingMemory.getSnapshot();
  assert.equal(snapshot.facts.length, 1);
  assert.equal(snapshot.openQuestions.length, 1);
  assert.equal(snapshot.unknowns.length, 1);
  assert.equal(snapshot.facts[0]?.confidence, "high");
  assert.deepEqual(snapshot.facts[0]?.referenceIds, ["ref-a", "ref-b"]);
  assert.deepEqual(snapshot.facts[0]?.relatedNodeIds, ["node-a", "node-b"]);
  assert.deepEqual(snapshot.openQuestions[0]?.relatedNodeIds, ["node-a", "node-b"]);
  assert.equal(snapshot.unknowns[0]?.impact, "high");
  assert.deepEqual(snapshot.unknowns[0]?.relatedNodeIds, ["node-a", "node-b"]);
});
