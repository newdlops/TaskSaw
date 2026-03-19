import assert from "node:assert/strict";
import test from "node:test";
import { InvalidNodePhaseTransitionError, OrchestratorEngine } from "./engine";

test("creates a run and moves the root node through valid phases", () => {
  const engine = new OrchestratorEngine();
  const { run, rootNode } = engine.createRun({
    goal: "Build orchestrator foundation",
    acceptanceCriteria: {
      items: [
        {
          id: "entry-points-identified",
          description: "Relevant entry points are identified",
          required: true,
          status: "pending"
        }
      ]
    }
  });

  assert.equal(run.status, "pending");
  assert.equal(rootNode.phase, "init");

  const abstractPlanned = engine.transitionNode(rootNode.id, "abstract_plan");
  const gathered = engine.transitionNode(rootNode.id, "gather");
  const consolidated = engine.transitionNode(rootNode.id, "evidence_consolidation");
  const planned = engine.transitionNode(rootNode.id, "concrete_plan");
  const executed = engine.transitionNode(rootNode.id, "execute");
  const verified = engine.transitionNode(rootNode.id, "verify");
  const completed = engine.transitionNode(rootNode.id, "done");

  assert.equal(abstractPlanned.phase, "abstract_plan");
  assert.equal(gathered.phase, "gather");
  assert.equal(consolidated.phase, "evidence_consolidation");
  assert.equal(planned.phase, "concrete_plan");
  assert.equal(executed.phase, "execute");
  assert.equal(verified.phase, "verify");
  assert.equal(completed.phase, "done");
  assert.equal(engine.getRun(run.id)?.status, "done");
});

test("rejects invalid phase transitions", () => {
  const engine = new OrchestratorEngine();
  const { rootNode } = engine.createRun({
    goal: "Reject invalid transitions"
  });

  assert.throws(
    () => engine.transitionNode(rootNode.id, "execute"),
    (error: unknown) => error instanceof InvalidNodePhaseTransitionError
  );
});

test("creates child nodes within configured depth", () => {
  const engine = new OrchestratorEngine();
  const { run, rootNode } = engine.createRun({
    goal: "Allow one child",
    config: {
      maxDepth: 1
    }
  });

  const { parentNode, childNode } = engine.createChildNode(rootNode.id, {
    title: "Inspect adapters",
    objective: "Inspect adapter boundaries"
  });

  assert.equal(parentNode.childIds.length, 1);
  assert.equal(childNode.parentId, rootNode.id);
  assert.equal(childNode.depth, 1);

  assert.throws(
    () =>
      engine.createChildNode(childNode.id, {
        title: "Too deep",
        objective: "Should exceed max depth"
      }),
    /maxDepth/
  );

  assert.equal(engine.listRunNodes(run.id).length, 2);
});

test("emits live events to subscribers", () => {
  const engine = new OrchestratorEngine();
  const events: string[] = [];
  engine.subscribe((event) => {
    events.push(event.type);
  });

  const { rootNode } = engine.createRun({
    goal: "Stream live orchestrator events"
  });

  engine.transitionNode(rootNode.id, "abstract_plan");

  assert.deepEqual(events, ["run_created", "node_created", "phase_transition"]);
});

test("pauses a running run without changing the active node phase", () => {
  const engine = new OrchestratorEngine();
  const { run, rootNode } = engine.createRun({
    goal: "Pause the active orchestrator run"
  });

  engine.transitionNode(rootNode.id, "abstract_plan");
  const pausedRun = engine.pauseRun(run.id, rootNode.id, "Cancelled by the user");

  assert.equal(pausedRun.status, "paused");
  assert.equal(engine.getRun(run.id)?.status, "paused");
  assert.equal(engine.getNode(rootNode.id)?.phase, "abstract_plan");
  assert.equal(engine.listEvents(run.id).at(-1)?.type, "run_paused");
});

test("allows decomposition nodes to complete directly from concrete planning", () => {
  const engine = new OrchestratorEngine();
  const { rootNode } = engine.createRun({
    goal: "Allow decomposition completion"
  });

  engine.transitionNode(rootNode.id, "abstract_plan");
  engine.transitionNode(rootNode.id, "gather");
  engine.transitionNode(rootNode.id, "evidence_consolidation");
  const planned = engine.transitionNode(rootNode.id, "concrete_plan");
  const completed = engine.transitionNode(rootNode.id, "done");

  assert.equal(planned.phase, "concrete_plan");
  assert.equal(completed.phase, "done");
});
