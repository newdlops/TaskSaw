# TaskSaw Orchestrator Building Plan

## Goal

Build a reusable CLI orchestrator core that minimizes upper-tier model token usage without materially degrading task quality.

The orchestrator should:
- separate abstract planning from concrete planning
- use lower-tier models for gather/compress/execute work
- use upper-tier models only at important decision gates
- support bounded recursive decomposition
- execute branches in ordered depth-first sequence with sibling barriers
- persist artifacts for inspection and resume

## Product Direction

Build order should follow this sequence:
1. Headless orchestrator core
2. CLI wrapper
3. Logs, persistence, and inspect tools
4. Electron integration later

This repository already has terminal and managed-tool runtime code under `src/main/`.
That code should be treated as an adapter layer, not as the orchestrator core itself.

## Architecture Decision

The orchestrator should be implemented as a separate core module, for example:

```text
src/orchestrator/
  types.ts
  engine.ts
  scheduler.ts
  evidence-store.ts
  working-memory.ts
  model-adapter.ts
  persistence.ts
  cli/
```

The current `src/main/pty-manager.ts` and `src/main/tool-manager.ts` should remain focused on launching and managing CLI sessions.
The orchestrator should call them through adapters later, instead of embedding orchestration logic directly into Electron IPC.

## Build Phases

### Phase 1. Core Domain Model and Runtime State Machine

Implement the minimum orchestrator domain types and node lifecycle first.

Deliverables:
- `Run`
- `PlanNode`
- `NodePhase`
- `ModelAssignment`
- `ReviewPolicy`
- `AcceptanceCriteria`
- `ExecutionBudget`
- `OrchestratorConfig`

Minimum node phases:
- `init`
- `abstract_plan`
- `gather`
- `evidence_consolidation`
- `concrete_plan`
- `review`
- `execute`
- `verify`
- `done`
- `replan`
- `escalated`

Why first:
- recursion, evidence flow, review policy, and persistence all depend on this shape
- without a stable lifecycle, later features will become ad hoc

Done criteria:
- a node can move through a valid phase transition path
- invalid transitions are rejected
- each node records assigned model, parent/child relationship, and completion criteria

### Phase 2. Evidence Bundle and Working Memory

Build the evidence system before any real model orchestration.

Evidence bundle should support:
- summary
- confirmed facts
- hypotheses
- unknowns
- relevant files and symbols
- supporting snippets
- provenance
- confidence

Working memory should track:
- confirmed facts
- open questions
- unresolved unknowns
- conflicts
- decisions
- decision rationale

Why second:
- upper-tier token savings only work if planners consume structured evidence instead of raw material

Done criteria:
- evidence can be created, appended, merged, and referenced by node id
- working memory can be read by planners without re-reading the full raw source

### Phase 3. Model Adapter Interface

Define a capability-based adapter layer before wiring real tools.

Initial capabilities:
- `abstractPlan`
- `gather`
- `concretePlan`
- `review`
- `execute`
- `verify`
- `rehydrate`

The core should depend on this interface only.
Real Codex and Gemini integration should be implemented later as adapters.

Why third:
- it prevents the engine from being coupled to Electron, PTY behavior, or one specific CLI

Done criteria:
- the engine can run against a mock adapter without any terminal dependency

### Phase 4. Minimal End-to-End Happy Path

Implement a conservative non-ambitious first execution path:

`abstract plan -> gather -> evidence consolidation -> concrete plan -> execute -> verify`

Initial constraints:
- `maxDepth <= 2`
- single-threaded execution
- no broad parallel subtree execution
- review optional and shallow
- explicit evidence budget
- explicit re-read budget

Why fourth:
- this proves the runtime shape before adding recursive complexity

Done criteria:
- one root task can complete end to end with mocked or simplified adapters
- each phase emits events
- evidence produced in gather is consumed by concrete planning

### Phase 5. Ordered DFS Scheduler

After the happy path works, implement subtree ordering semantics.

Required behavior:
- complete subtree A before subtree B starts
- complete subtree B before subtree C starts
- no sibling interleaving across major branches

Why fifth:
- this is the required execution contract from the requirements document
- it should be implemented explicitly, not emerge accidentally from current control flow

Done criteria:
- scheduler enforces ordered depth-first execution with sibling barriers
- tests prove branch ordering

### Phase 6. Persistence

Persist orchestrator artifacts once the runtime can actually execute useful work.

Persisted artifacts:
- run metadata
- plan tree JSON
- node state snapshots
- evidence bundles
- event logs
- final report

Why sixth:
- debugging and resume are not optional for a recursive runtime

Done criteria:
- a run can be inspected after completion
- a failed or paused run has enough state to diagnose what happened

### Phase 7. CLI Wrapper

Expose the headless orchestrator through a CLI entry point.

Candidate commands:
- `tasksaw orchestrate run`
- `tasksaw orchestrate inspect`
- `tasksaw orchestrate resume`

Why seventh:
- the CLI is the fastest way to validate the runtime before committing to UI work

Done criteria:
- a task can be launched and inspected without Electron

### Phase 8. Electron Shell

Only after the core and CLI are stable should Electron integration begin.

Possible future UI areas:
- prompt input panel
- run tree
- node detail view
- evidence view
- event log view
- terminal tabs for Codex and Gemini

Done criteria:
- Electron acts as a shell over the orchestrator, not as the orchestrator itself

## First Implementation Target

The first PR should only establish the orchestrator foundation.

Recommended scope:
- create `src/orchestrator/types.ts`
- create `src/orchestrator/engine.ts`
- create `src/orchestrator/evidence-store.ts`
- create `src/orchestrator/working-memory.ts`
- create `src/orchestrator/model-adapter.ts`
- create `src/orchestrator/persistence.ts`
- add unit tests for phase transitions and evidence storage

The first PR should not include:
- Electron UI
- deep recursion
- real Codex/Gemini execution
- broad concurrency
- automatic review matrices

## Suggested First PR Acceptance Criteria

- orchestrator run and node types are defined
- node lifecycle transitions are implemented and tested
- evidence bundle schema is implemented
- working memory schema is implemented
- a mock adapter can run the minimal happy path
- ordered DFS is documented as the next step, even if not fully implemented yet

## Non-Goals for V1

Do not start with:
- Electron-first orchestration
- unrestricted recursive decomposition
- upper-tier models reading large raw files directly
- summary-of-summary chains without provenance
- always-on review for every node

## Immediate Next Step

Start with Phase 1 and Phase 2 together in a narrow PR:
- define the orchestrator types
- define the node phase state machine
- define evidence bundle and working memory schemas

If that shape is wrong, every later layer will need to be rewritten.
