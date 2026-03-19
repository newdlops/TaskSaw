# Orchestrator Requirements

## 1. Goal

Build an orchestrator that minimizes **high-end model token usage** while preserving task quality.

The system should use:
- **Upper-tier models** (for example: Codex xhigh, Gemini 3.1 Pro Preview) for high-value planning, review, and critical decision-making.
- **Lower-tier models** (for example: Gemini Flash) for evidence gathering, summarization, and mechanical execution.

The primary optimization target is **reducing expensive upper-model token consumption**, not necessarily minimizing total token usage.

---

## 2. Core Product Direction

The orchestrator is not just a multi-agent tool. It is a **recursive planning and execution runtime** with explicit model delegation.

It should support:
- hierarchical planning
- recursive sub-plans
- explicit model assignment per task
- bounded recursion depth
- quality-preserving evidence compression
- sequential subtree execution

---

## 3. High-Level Workflow

The desired workflow has multiple planning layers.

### 3.1 Abstract Planning Phase

The top-level planner creates only a **high-level abstract plan**.

This plan should define:
- what ranges/scope to search
- what files/modules/symbols/areas to inspect
- what related keywords or concepts matter
- how information should be read
- how findings should be summarized
- what evidence is required before concrete planning can begin

This phase should avoid deep implementation planning.

### 3.2 Gather Phase

A lower-cost model performs the actual retrieval/gathering work.

This phase may include:
- reading target files
- searching symbols/keywords
- extracting relevant snippets
- summarizing findings in a constrained format
- identifying candidate risk areas

### 3.3 Concrete Planning Phase

After evidence is gathered, an upper-tier model reviews the gathered evidence and creates a **concrete execution plan**.

This concrete plan should define:
- exact task decomposition
- execution order
- sub-plan structure
- which model performs which task
- whether review is required
- test and verification expectations

The concrete plan may itself create nested sub-plans.

---

## 4. Recursive Planning Requirements

The system should support recursive planning.

Each node may:
- decide it is atomic and executable
- or generate child plans

The user must be able to constrain recursion depth.

Required controls:
- `maxDepth`
- review policy
- planner bias / executor bias
- budget or carefulness mode

The system should not recurse indefinitely.

---

## 5. Execution Ordering Semantics

The user wants ordered subtree execution with sibling barriers.

If the plan tree is conceptually:
- A(a, b, c)
- B(d, e, f)
- C(g, h, i)

Then all work under **A** must complete before any work under **B** starts, and all work under **B** must complete before **C** starts.

In practice, this behaves like:
- ordered depth-first execution
- sibling barrier between major branches

This is closer to:
- **DFS with subtree completion before next sibling**
than to naive parallel tree execution.

---

## 6. Model Delegation Requirements

The plan itself must explicitly assign which model does which work.

### 6.1 Upper-Tier Models

Use upper-tier models for:
- abstract planning
- concrete planning
- risk judgment
- design trade-offs
- review of gathered evidence
- critical re-planning

Candidate models:
- Codex with high/xhigh reasoning effort
- Gemini 3.1 Pro Preview

### 6.2 Lower-Tier Models

Use lower-tier models for:
- searching
- file inspection
- evidence gathering
- constrained summarization
- straightforward modifications
- mechanical implementation work
- simple test additions

Candidate models:
- Gemini Flash

### 6.3 Reviewer Models

Reviewer should often be a different model family from the planner.

Examples:
- planner = Codex xhigh, reviewer = Gemini Pro
- planner = Gemini Pro, reviewer = Codex high/xhigh

---

## 7. Token Optimization Strategy

The purpose of this architecture is to **save upper-model tokens** while maintaining quality.

### 7.1 Optimization Goal

Primary goal:
- minimize upper-model token usage

Secondary goal:
- keep work quality high

Non-goal:
- minimizing total global token usage at all costs

### 7.2 Principle

Upper models should not read all raw material directly.
Instead:
- lower models gather and compress evidence
- upper models receive compact, structured evidence bundles
- upper models may request targeted re-reads only when necessary

### 7.3 Anti-Patterns to Avoid

Avoid:
- repeatedly sending full files to upper models
- recursive over-fragmentation
- summary-of-summary-of-summary chains
- letting lower-tier models perform large unbounded reasoning
- forcing the upper model to re-read everything due to poor summaries

---

## 8. Quality Preservation Requirements

Saving upper-model tokens must not significantly degrade task quality.

To preserve quality:
- lower-tier summaries must be evidence-based, not vague prose
- uncertainty must be surfaced explicitly
- contradictions between gathered results must be detectable
- upper models must be able to request targeted rehydration of detail
- verification and testing must exist as explicit phases

---

## 9. Evidence-Centric Design

Upper nodes should not depend on fragile plain-language summaries alone.

The system needs structured evidence bundles.

Each evidence bundle should support at least:
- concise summary
- confirmed facts
- hypotheses / interpretations
- unknowns / unresolved questions
- relevant files/symbols
- targeted snippets
- provenance/reference to original source locations
- confidence or uncertainty signals

This helps prevent the “blind people touching an elephant” problem.

---

## 10. Working Memory Requirement

A plain execution tree is not enough.

The system should maintain a shared **working memory / evidence store**.

This should track:
- confirmed facts
- unresolved unknowns
- open questions
- evidence references
- prior decisions
- conflicts between findings
- decision rationale

Upper planners should use this memory rather than trying to directly “remember everything.”

---

## 11. Rehydration Requirement

Upper-tier models must be able to request detail on demand.

This means the system should support **targeted re-read / rehydration**.

Examples:
- fetch this function body again
- show the exact snippet supporting this claim
- inspect a suspected contradiction
- retrieve more detail for one branch before finalizing a decision

This is required to keep upper-model input small **without making it blind**.

---

## 12. Required Runtime Phases

Each node should conceptually move through phases like:
- init
- abstract plan
- gather
- evidence consolidation
- concrete plan
- optional review
- decompose or execute
- verify
- done / replan / escalate

Not every node must use every phase, but the runtime should support them.

---

## 13. Review Policy Requirements

Review should be policy-driven, not always-on.

Possible review modes:
- none
- light
- risk-based
- mandatory

Review should be more likely for:
- architecture changes
- transactions / concurrency / consistency-sensitive tasks
- security/auth changes
- wide-scope refactors
- high-risk code paths

---

## 14. Acceptance Criteria Requirement

Every plan or node should define explicit completion conditions.

Examples:
- relevant entry points identified
- evidence gathered for all critical branches
- target behavior implemented
- tests pass
- no known unresolved critical conflicts remain

This keeps lower-tier execution constrained and measurable.

---

## 15. Suggested Initial Architecture Direction

The user considered two directions:
1. start with an Electron UI and embedded terminals
2. start with scripts / CLI runtime

Current conclusion:
- it is faster and safer to build the **core orchestrator as scripts/CLI first**
- Electron UI can come later as a shell around the orchestrator

Reason:
- the hard part is the recursive orchestration runtime, not the terminal UI itself
- UI-first increases complexity too early

### 15.1 Recommended Build Order

1. headless orchestrator core
2. CLI wrapper
3. logs / persistence / inspect tools
4. optional Electron desktop shell later

---

## 16. Possible Product Form

A future Electron desktop app is still desired.

Potential UI concept:
- prompt input panel
- plan tree view
- node detail panel
- run log panel
- terminal tabs for Codex CLI / Gemini CLI login and manual inspection

But this UI should sit on top of a reusable orchestration core.

---

## 17. Persistence Requirements

The system should store run artifacts so execution can be inspected and resumed.

Useful persisted artifacts include:
- run metadata
- plan tree JSON
- node states
- evidence bundles
- event logs
- final summary report

---

## 18. Initial Constraints / Practical Guidance

The first version should be conservative.

Recommended early constraints:
- shallow recursion by default (`maxDepth` around 2)
- upper-model calls only at major decision gates
- lower-tier models limited to gather/compress/execute roles
- explicit evidence budget
- explicit re-read budget
- explicit review triggers

---

## 19. Summary of the User’s Intent

The user wants an orchestrator that:
- saves expensive upper-model tokens
- preserves output quality
- separates abstract planning from concrete planning
- uses lower models to gather and compress evidence
- uses upper models for important decisions
- supports recursive sub-plans
- executes branches in strict ordered-subtree sequence
- explicitly assigns work to different models
- allows the user to limit depth and review intensity
- may later be wrapped in an Electron desktop interface

