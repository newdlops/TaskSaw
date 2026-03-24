import { ModelInvocationContext, OrchestratorCapability } from "./model-adapter";

export const TASKSAW_PROMPT_MARKER = "TASKSAW_PROMPT_ENVELOPE_JSON";

export type CliPromptEnvelope = {
  phase: OrchestratorCapability;
  workflowStage: ModelInvocationContext["workflowStage"];
  runId: string;
  nodeId: string;
  parentId: string | null;
  depth: number;
  nodeKind: string;
  nodeTitle: string;
  objective: string;
  goal: string;
  outputLanguage: ModelInvocationContext["outputLanguage"];
  assignedModel: {
    id: string;
    provider: string;
    model: string;
    tier: string;
      reasoningEffort?: string;
  };
  nodeModelRouting: {
    abstractPlanner?: {
      id: string;
      provider: string;
      model: string;
      tier: string;
      reasoningEffort?: string;
    };
    gatherer?: {
      id: string;
      provider: string;
      model: string;
      tier: string;
      reasoningEffort?: string;
    };
    concretePlanner?: {
      id: string;
      provider: string;
      model: string;
      tier: string;
      reasoningEffort?: string;
    };
    reviewer?: {
      id: string;
      provider: string;
      model: string;
      tier: string;
      reasoningEffort?: string;
    };
    executor?: {
      id: string;
      provider: string;
      model: string;
      tier: string;
      reasoningEffort?: string;
    };
    verifier?: {
      id: string;
      provider: string;
      model: string;
      tier: string;
      reasoningEffort?: string;
    };
  };
  executionBudget: ModelInvocationContext["executionBudget"];
  reviewPolicy: ModelInvocationContext["reviewPolicy"];
  acceptanceCriteria: string[];
  evidenceBundles: Array<{
    summary: string;
    facts: string[];
    unknowns: string[];
    relevantTargets: string[];
  }>;
  workingMemory: {
    facts: string[];
    openQuestions: string[];
    unknowns: string[];
    conflicts: string[];
    decisions: string[];
  };
  projectStructure: {
    summary: string;
    directories: Array<{
      path: string;
      summary: string;
      confidence: string;
    }>;
    keyFiles: Array<{
      path: string;
      summary: string;
      confidence: string;
    }>;
    entryPoints: Array<{
      path: string;
      role: string;
      summary: string;
      confidence: string;
    }>;
    modules: Array<{
      name: string;
      summary: string;
      relatedPaths: string[];
      confidence: string;
    }>;
    openQuestions: string[];
    contradictions: string[];
  };
};

const PHASE_RESPONSE_SCHEMAS: Record<OrchestratorCapability, string> = {
  abstractPlan: '{"summary": string, "targetsToInspect": string[], "evidenceRequirements": string[]}',
  gather:
    '{"summary": string, "evidenceBundles": EvidenceBundleDraft[], "projectStructure"?: ProjectStructureReport}',
  concretePlan:
    '{"summary": string, "childTasks": Array<{"title": string, "objective": string, "importance": "critical" | "high" | "medium" | "low", "assignedModels": ModelAssignment, "reviewPolicy"?: ReviewPolicy, "acceptanceCriteria"?: AcceptanceCriteria, "executionBudget"?: Partial<ExecutionBudget>}>, "executionNotes": string[], "needsMorePlanning"?: boolean, "needsAdditionalGather"?: boolean, "additionalGatherObjectives"?: string[], "needsProjectStructureInspection"?: boolean, "inspectionObjectives"?: string[], "projectStructureContradictions"?: string[]}',
  review:
    '{"summary": string, "followUpQuestions": string[], "approved"?: boolean, "nextActions"?: Array<{"title": string, "objective": string, "rationale": string, "priority": "critical" | "high" | "medium" | "low"}>, "carryForward"?: {"facts": string[], "openQuestions": string[], "projectPaths": string[], "evidenceSummaries": string[]}}',
  execute:
    '{"summary": string, "outputs": string[], "completed"?: boolean, "blockedReason"?: string}',
  verify:
    '{"summary": string, "passed": boolean, "findings": string[]}',
  rehydrate:
    '{"summary": string, "evidenceBundles": EvidenceBundleDraft[]}'
};

export function buildCliPrompt(capability: OrchestratorCapability, context: ModelInvocationContext): string {
  const envelope: CliPromptEnvelope = {
    phase: capability,
    workflowStage: context.workflowStage,
    runId: context.run.id,
    nodeId: context.node.id,
    parentId: context.node.parentId,
    depth: context.node.depth,
    nodeKind: context.node.kind,
    nodeTitle: context.node.title,
    objective: context.node.objective,
    goal: context.run.goal,
    outputLanguage: context.outputLanguage,
    assignedModel: {
      id: context.assignedModel.id,
      provider: context.assignedModel.provider,
      model: context.assignedModel.model,
      tier: context.assignedModel.tier,
      reasoningEffort: context.assignedModel.reasoningEffort
    },
    nodeModelRouting: serializeModelAssignment(context.node.assignedModels),
    executionBudget: context.executionBudget,
    reviewPolicy: context.reviewPolicy,
    acceptanceCriteria: context.node.acceptanceCriteria.items.map((item) => item.description),
    evidenceBundles: buildPhaseEvidenceBundles(capability, context),
    workingMemory: buildPhaseWorkingMemory(capability, context),
    projectStructure: buildPhaseProjectStructure(capability, context)
  };

  const stageInstructions = buildStageInstructions(capability, context);

  return [
    "You are the TaskSaw orchestration model adapter.",
    "Return exactly one JSON object and nothing else.",
    "Do not wrap the JSON in markdown fences.",
    "Do not explain the JSON before or after the object.",
    "If you are uncertain, still return the best possible JSON object that matches the schema.",
    `Phase: ${capability}`,
    `Workflow stage: ${context.workflowStage}`,
    `Response schema: ${PHASE_RESPONSE_SCHEMAS[capability]}`,
    stageInstructions,
    TASKSAW_PROMPT_MARKER,
    JSON.stringify(envelope, null, 2)
  ].join("\n\n");
}

export function extractCliPromptEnvelope(prompt: string): CliPromptEnvelope {
  const markerIndex = prompt.indexOf(TASKSAW_PROMPT_MARKER);
  if (markerIndex === -1) {
    throw new Error("TaskSaw prompt marker was not found");
  }

  const jsonStart = prompt.indexOf("{", markerIndex);
  if (jsonStart === -1) {
    throw new Error("TaskSaw prompt JSON envelope start was not found");
  }

  return JSON.parse(prompt.slice(jsonStart)) as CliPromptEnvelope;
}

function buildStageInstructions(
  capability: OrchestratorCapability,
  context: ModelInvocationContext
): string {
  const workflowStage = context.workflowStage;

  if (workflowStage === "bootstrap_sketch" && capability === "gather") {
    return [
      "Produce a low-cost, approximate sketch of the repository before deeper planning starts.",
      "Limit yourself to top-level structure, likely entrypoints, main runtime boundaries, and a few anchor files or directories.",
      "Stay at seed level only: capture clues and open questions, then defer any detailed inspection to the later planning and gather stages.",
      "Do not probe external CLIs, managed-tool installations, package internals, auth state, quota surfaces, or home-directory files during bootstrap sketch.",
      "If deeper exploration seems necessary, record that it is needed instead of performing it now.",
      "Do not over-explore or speculate in detail.",
      "Return only compact clues that reduce future search cost.",
      "When using grep or search tools to look for literal strings that contain special regex characters (such as {, }, (, ), +, *, or ?), you MUST escape them (e.g., \\{) to prevent regex parsing errors."
    ].join(" ");
  }

  if (workflowStage === "project_structure_discovery") {
    if (capability === "abstractPlan") {
      return [
        "The repository structure is not known yet.",
        "Plan only the exploration work needed to map the project structure.",
        "Do not propose implementation child tasks at this stage."
      ].join(" ");
    }

    if (capability === "gather") {
      return [
        "Collect repository structure evidence.",
        "Populate projectStructure with directories, keyFiles, entryPoints, modules, and any open questions or contradictions."
      ].join(" ");
    }
  }

  if (workflowStage === "project_structure_inspection") {
    if (capability === "abstractPlan") {
      return [
        "A contradiction or gap was detected in the current project structure memory.",
        "Plan a narrow inspection that resolves the listed structure issues."
      ].join(" ");
    }

    if (capability === "gather") {
      return [
        "Gather only the evidence needed to resolve the current project structure contradictions or gaps.",
        "Return an updated projectStructure summary.",
        "When using grep or search tools to look for literal strings that contain special regex characters (such as {, }, (, ), +, *, or ?), you MUST escape them (e.g., \\{) to prevent regex parsing errors."
      ].join(" ");
    }

    if (capability === "concretePlan") {
      return [
        "Summarize the inspection outcome using the refreshed project structure.",
        "Do not create implementation child tasks unless inspection itself must split."
      ].join(" ");
    }
  }

  if (workflowStage === "task_orchestration" && capability === "concretePlan") {
    return [
      "Plan execution using the current projectStructure memory.",
      "Set needsProjectStructureInspection=true only for repository-structure gaps: contradictory file paths, entrypoints, modules, runtime boundaries, IPC/preload wiring, or renderer DOM locations that must be re-read from the workspace.",
      "Do not request projectStructure inspection for non-structural gaps such as unsupported product capabilities, missing external quota APIs, absent managed-tool features, auth limitations, or implementation tradeoffs. Treat those as execution-planning facts instead.",
      "If the key blocker is a missing or unsupported data source rather than ambiguous repository structure, keep needsProjectStructureInspection=false and explain the blocker or fallback in executionNotes or childTasks.",
      "Do not downgrade an exact-data request into a UI fallback, placeholder label, or 'n/a' plan unless the gathered evidence already contains explicit blocker facts about the missing or unsupported data source.",
      "If the user asked for exact, actual, precise, or real data and that blocker evidence is still weak, set needsAdditionalGather=true and ask for the narrowest follow-up proof instead of declaring the fallback ready.",
      "If blocker evidence already shows that external-path approval or one raw payload/stderr sample is required, do not convert that into an instrumentation, diagnostic logging, temp log file, or gemini_debug.log plan. Surface the blocker directly instead.",
      "Do not call tools, create temp files, or run shell commands during concrete planning. Use only the provided memory and gathered evidence.",
      "If the current evidence is still too broad for execution but one more focused plan/gather pass would materially narrow the scope, set needsAdditionalGather=true, keep childTasks empty when possible, and return 1-3 explicit additionalGatherObjectives.",
      "Use needsAdditionalGather only for narrow follow-up evidence collection. Do not punt broad discovery back to gather.",
      "Decide only at the current node level whether more planning is needed.",
      "Set needsMorePlanning=true only if this node must split into separately planned subproblems.",
      "If the current node is already execution-ready, set needsMorePlanning=false, keep childTasks empty when possible, and put the actionable execution detail into executionNotes.",
      "Child tasks created here are planning nodes only. Do not merge execution into the planning node.",
      "Each child task must include an importance field and explicit assignedModels chosen from nodeModelRouting.",
      "There is no model inheritance. The orchestrator will execute child nodes only with the exact assignedModels you return.",
      "If a different model should handle a different part of the work, split that work into a separate child task node with its own assignedModels.",
      "Do not switch model responsibility inside a single child task."
    ].join(" ");
  }

  if (workflowStage === "task_orchestration" && capability === "abstractPlan") {
    return [
      "Start from the provided evidence, workingMemory, and projectStructure before doing any new search.",
      "Turn the existing open questions, contradictions, keyFiles, entryPoints, relevantTargets, and recent memory decisions into 1-3 concrete inspection targets.",
      "Inspection targets must be explicit file paths, modules, entrypoints, symbols, managed-tool locations, or clearly named external surfaces. Avoid generic targets like repository, codebase, current implementation, or relevant files.",
      "If the current memory is too weak to name a narrow target, identify the single most useful clue to gather next instead of delegating a broad search.",
      "If the current memory already names likely files, modules, entrypoints, or managed tool locations, inspect those first instead of widening the search.",
      "If the current memory already names a concrete external surface such as a CLI command, API route, or managed-tool capability check, inspect that surface before pivoting to local caches, log files, temp files, or home-directory state.",
      "If the user explicitly asked for exact or actual data, keep the plan centered on the concrete data source or blocker evidence first. Do not jump straight to a UI fallback or copy change.",
      "If workingMemory already records a failed or deferred instrumentation, logging, or gemini_debug.log attempt for this exact-data request, do not propose that approach again. Move directly to the external approval or raw payload blocker instead.",
      "If the next narrow step is a direct managed-tool read or CLI capability check outside the workspace, target that exact surface so gather can request approval for it.",
      "Do not edit files, call tools, create temp files, run builds, or execute shell commands during planning.",
      "Do not ask for broad repository or external tool exploration unless the current memory is insufficient to name a concrete next target."
    ].join(" ");
  }

  if (workflowStage === "task_orchestration" && capability === "gather") {
    return [
      "Start from the provided evidence, workingMemory, and projectStructure before doing any new search.",
      "Gather only the minimum evidence needed to unblock the next concrete plan or execution step.",
      "Treat the abstract plan's inspection targets and evidence requirements as the current gather contract.",
      "Stay within that contract unless each named target has been exhausted and you can justify widening the search in the returned evidence.",
      "Prefer confirming or disproving the current memory's open questions at the named files, entrypoints, modules, relevantTargets, or managed tool locations before running broader searches.",
      "If the current memory already suggests a likely absence or integration gap, confirm that directly and return compact evidence instead of expanding the search surface.",
      "If an external CLI/API surface already appears absent or unsupported, stop after enough evidence to establish that fact. Do not keep probing undocumented alternative commands, slash commands, or ad hoc flags.",
      "Do not guess and test CLI arguments by repeatedly running execution tools. If a CLI command fails or returns unexpected results (like an interactive prompt), stop executing it. Use read-only tools to statically analyze its source code or help manuals to find the correct usage.",
      "To prevent process hangs during gather, any shell command you execute MUST include `< /dev/null` or a `--non-interactive` flag if it might ask for user input. Do not let commands block indefinitely on interactive prompts.",
      "Do not pivot from a named external surface to local cache, log, temp, or home-directory files until one direct capability check against that named surface has failed or returned explicit blocker evidence.",
      "If the user asked for exact or actual data, do not treat a UI fallback label as sufficient. Gather one direct proof about the narrowest missing or unsupported data source before recommending that fallback.",
      "Do not turn missing external evidence into a workspace logging or instrumentation plan. If the next required step is external-path approval or one raw payload/stderr sample, return that blocker directly in the gathered evidence.",
      "If workingMemory already shows that instrumentation, logging, or gemini_debug.log was tried for this request, do not gather around that workaround again.",
      "When the current contract requires a named external path or CLI capability check outside the workspace, it is acceptable to request approval for that narrow direct read or command and use the result as evidence.",
      "When probing an external CLI surface, prefer one documented help/usage check and one direct capability check. Do not spend gather budget on multiple synonymous command variants that test the same hypothesis.",
      "In a focused follow-up gather pass, inspect named files, symbols, or managed-tool surfaces directly instead of rediscovering whether they exist.",
      "Do not spend focused gather budget on existence-only commands such as find-by-name sweeps, plain ls path checks, recursive ls listings, or broad *.md/settings.json searches when the target path is already named in memory.",
      "Do not ask the user for permission to continue planning, escape plan mode, or work around internal tool/runtime errors. Report those blockers directly in the JSON response instead.",
      "Do not edit files, run builds, or execute other mutating commands in gather. This phase is read-only evidence collection.",
      "CRITICAL: Do NOT attempt to enter 'plan mode', generate plan files (e.g., in a 'plans/' directory), or use tools like `write_file`, `exit_plan_mode`, or `ask_user`. You are NOT the planner. You must ONLY explore the codebase using read-only terminal commands, gather the requested evidence, and then immediately return your GatherResult JSON.",
      "Update projectStructure only for the files, directories, or entrypoints that are directly relevant to the current node.",
      "Do not search outside the workspace or managed tool installation paths unless the current node explicitly requires it.",
      "When using grep or search tools to look for literal strings that contain special regex characters (such as {, }, (, ), +, *, or ?), you MUST escape them (e.g., \\{) to prevent regex parsing errors."
    ].join(" ");
  }

  if (workflowStage === "task_orchestration" && capability === "execute") {
    return [
      "Carry out the requested implementation work instead of restating the plan.",
      "Do not invent undocumented CLI flags, slash commands, APIs, or data sources.",
      "When execution needs tests in this TypeScript workspace, prefer the project's documented scripts or a build-first path such as npm run build followed by built dist tests over raw node --test src/**/*.ts entrypoints.",
      "If a required user-visible behavior still depends on placeholder/no-data fallback because the upstream source is missing or unsupported, set completed=false and explain the blocker instead of claiming success.",
      "Set completed=true only if the execution actually changed or completed the intended work.",
      "If execution was blocked, denied, or intentionally not performed, set completed=false and explain the concrete reason in blockedReason."
    ].join(" ");
  }

  if (capability === "verify") {
    return [
      "Verify the requested user-visible behavior, not just the presence of code changes or lint/build success.",
      "A generic success claim is insufficient. State the concrete observed behavior or the concrete blocker that justifies the verdict.",
      "Set passed=false if any requested behavior still relies on placeholder, fallback, no-data, or unsupported upstream sources instead of the requested real result.",
      "Set passed=false if the run only added diagnostic logging or instrumentation and the promised log, payload, or external evidence has not actually been produced yet.",
      "When additional tests are necessary in this TypeScript workspace, prefer the project's documented scripts or built dist tests after a build instead of raw node --test src/**/*.ts entrypoints.",
      "Do not modify files, create temp scripts or temp files, run builds, or attempt follow-up fixes during verify.",
      "Use already captured evidence first and keep any additional inspection strictly read-only and minimal."
    ].join(" ");
  }

  if (capability === "review") {
    return [
      "This review happens after execution and verification.",
      "Do not approve, reject, or block work in this phase.",
      "Do not call tools, run commands, or modify files in review.",
      "Use the review only to summarize the completed work, the verification outcome, and any remaining follow-up questions.",
      "Propose 0-3 concrete nextActions only when there is a meaningful follow-up task.",
      "Each nextAction should be execution-ready enough to become the next run goal.",
      "Use carryForward to list only the facts, openQuestions, projectPaths, and evidenceSummaries that should seed the next action.",
      context.outputLanguage === "ko"
        ? "Write the review summary, followUpQuestions, nextActions, and carryForward text in Korean."
        : "Write the review summary, followUpQuestions, nextActions, and carryForward text in English."
    ].join(" ");
  }

  return "Use the provided evidence, working memory, and projectStructure to produce the best possible JSON response.";
}

function serializeModelAssignment(contextAssignment: ModelInvocationContext["node"]["assignedModels"]): CliPromptEnvelope["nodeModelRouting"] {
  const serializeModel = (model: ModelInvocationContext["node"]["assignedModels"][keyof ModelInvocationContext["node"]["assignedModels"]]) =>
    model
      ? {
          id: model.id,
          provider: model.provider,
          model: model.model,
          tier: model.tier,
          reasoningEffort: model.reasoningEffort
        }
      : undefined;

  return {
    abstractPlanner: serializeModel(contextAssignment.abstractPlanner),
    gatherer: serializeModel(contextAssignment.gatherer),
    concretePlanner: serializeModel(contextAssignment.concretePlanner),
    reviewer: serializeModel(contextAssignment.reviewer),
    executor: serializeModel(contextAssignment.executor),
    verifier: serializeModel(contextAssignment.verifier)
  };
}

// ── Token efficiency: phase-aware payload helpers ──────────────────────────

const MAX_EVIDENCE_FACTS = 10;
const MAX_EVIDENCE_UNKNOWNS = 5;
const MAX_EVIDENCE_TARGETS = 8;

function isFullContextPhase(capability: OrchestratorCapability): boolean {
  return capability === "abstractPlan" || capability === "concretePlan";
}

function truncateArray<T>(items: T[], limit: number): T[] {
  return items.length <= limit ? items : items.slice(0, limit);
}

/**
 * Build evidence bundles with phase-appropriate detail level.
 * - Planning phases: full facts, unknowns, targets (with per-bundle caps)
 * - Gather: full facts and targets, unknowns capped
 * - Execute/verify/review: summary + top facts only
 */
function buildPhaseEvidenceBundles(
  capability: OrchestratorCapability,
  context: ModelInvocationContext
): CliPromptEnvelope["evidenceBundles"] {
  if (capability === "review") {
    return context.evidenceBundles.map((bundle) => ({
      summary: bundle.summary,
      facts: [],
      unknowns: [],
      relevantTargets: []
    }));
  }

  const summaryOnlyPhase = capability === "execute" || capability === "verify";

  return context.evidenceBundles.map((bundle) => ({
    summary: bundle.summary,
    facts: truncateArray(
      bundle.facts.map((fact) => fact.statement),
      summaryOnlyPhase ? 5 : MAX_EVIDENCE_FACTS
    ),
    unknowns: summaryOnlyPhase
      ? []
      : truncateArray(
          bundle.unknowns.map((unknown) => unknown.question),
          MAX_EVIDENCE_UNKNOWNS
        ),
    relevantTargets: summaryOnlyPhase
      ? []
      : truncateArray(
          bundle.relevantTargets.map((target) => target.filePath ?? target.symbol ?? target.note ?? "unknown"),
          MAX_EVIDENCE_TARGETS
        )
  }));
}

/**
 * Build working memory with phase-appropriate detail level.
 * - Planning phases: full memory (facts, questions, unknowns, conflicts, decisions)
 * - Gather: openQuestions only (to focus evidence collection)
 * - Execute: decisions only (to guide implementation)
 * - Verify/review: empty/minimal (verification is evidence-driven)
 */
function buildPhaseWorkingMemory(
  capability: OrchestratorCapability,
  context: ModelInvocationContext
): CliPromptEnvelope["workingMemory"] {
  const emptyMemory: CliPromptEnvelope["workingMemory"] = {
    facts: [],
    openQuestions: [],
    unknowns: [],
    conflicts: [],
    decisions: []
  };

  if (isFullContextPhase(capability)) {
    return {
      facts: context.workingMemory.facts.map((fact) => fact.statement),
      openQuestions: context.workingMemory.openQuestions
        .filter((question) => question.status === "open")
        .map((question) => question.question),
      unknowns: context.workingMemory.unknowns
        .filter((unknown) => unknown.status === "open")
        .map((unknown) => unknown.description),
      conflicts: context.workingMemory.conflicts
        .filter((conflict) => conflict.status === "open")
        .map((conflict) => conflict.summary),
      decisions: context.workingMemory.decisions.map((decision) => `${decision.summary}: ${decision.rationale}`)
    };
  }

  if (capability === "gather") {
    return {
      ...emptyMemory,
      openQuestions: context.workingMemory.openQuestions
        .filter((question) => question.status === "open")
        .map((question) => question.question),
      facts: context.workingMemory.facts.map((fact) => fact.statement)
    };
  }

  if (capability === "execute") {
    return {
      ...emptyMemory,
      decisions: context.workingMemory.decisions.map((decision) => `${decision.summary}: ${decision.rationale}`)
    };
  }

  // verify, review: minimal working memory
  return emptyMemory;
}

/**
 * Build project structure with phase-appropriate detail level.
 * - Planning phases: full structure (all directories, files, entrypoints, modules, questions)
 * - Gather: summary + keyFiles only (to direct evidence collection)
 * - Execute/verify/review: summary only
 */
function buildPhaseProjectStructure(
  capability: OrchestratorCapability,
  context: ModelInvocationContext
): CliPromptEnvelope["projectStructure"] {
  const summaryOnly: CliPromptEnvelope["projectStructure"] = {
    summary: context.projectStructure.summary,
    directories: [],
    keyFiles: [],
    entryPoints: [],
    modules: [],
    openQuestions: [],
    contradictions: []
  };

  if (isFullContextPhase(capability)) {
    return {
      summary: context.projectStructure.summary,
      directories: context.projectStructure.directories.map((entry) => ({
        path: entry.path,
        summary: entry.summary,
        confidence: entry.confidence
      })),
      keyFiles: context.projectStructure.keyFiles.map((entry) => ({
        path: entry.path,
        summary: entry.summary,
        confidence: entry.confidence
      })),
      entryPoints: context.projectStructure.entryPoints.map((entry) => ({
        path: entry.path,
        role: entry.role,
        summary: entry.summary,
        confidence: entry.confidence
      })),
      modules: context.projectStructure.modules.map((entry) => ({
        name: entry.name,
        summary: entry.summary,
        relatedPaths: entry.relatedPaths,
        confidence: entry.confidence
      })),
      openQuestions: context.projectStructure.openQuestions
        .filter((question) => question.status === "open")
        .map((question) => question.question),
      contradictions: context.projectStructure.contradictions
        .filter((contradiction) => contradiction.status === "open")
        .map((contradiction) => contradiction.summary)
    };
  }

  if (capability === "gather") {
    return {
      ...summaryOnly,
      keyFiles: context.projectStructure.keyFiles.map((entry) => ({
        path: entry.path,
        summary: entry.summary,
        confidence: entry.confidence
      })),
      openQuestions: context.projectStructure.openQuestions
        .filter((question) => question.status === "open")
        .map((question) => question.question)
    };
  }

  // execute, verify, review: summary only
  return summaryOnly;
}
