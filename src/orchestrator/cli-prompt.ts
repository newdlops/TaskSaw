import { ModelInvocationContext, OrchestratorCapability } from "./model-adapter";

export const TASKSAW_PROMPT_MARKER = "TASKSAW_PROMPT_ENVELOPE_JSON";

type CliPromptEvidenceLocation = {
  filePath?: string;
  symbol?: string;
  line?: number;
  column?: number;
  uri?: string;
  label?: string;
};

type CliPromptEvidenceLedgerBundle = {
  id: string;
  summary: string;
  confidence: string;
  facts: Array<{
    id: string;
    statement: string;
    confidence: string;
    referenceIds: string[];
  }>;
  hypotheses: Array<{
    id: string;
    statement: string;
    confidence: string;
    referenceIds: string[];
  }>;
  unknowns: Array<{
    id: string;
    question: string;
    impact: string;
    referenceIds: string[];
  }>;
  relevantTargets: Array<{
    filePath?: string;
    symbol?: string;
    note?: string;
  }>;
  snippets: Array<{
    id: string;
    kind: string;
    content: string;
    location?: CliPromptEvidenceLocation;
    referenceId?: string;
    rationale?: string;
  }>;
  references: Array<{
    id: string;
    sourceType: string;
    location?: CliPromptEvidenceLocation;
    note?: string;
  }>;
};

type CliPromptEvidenceBundleSummary = {
  summary: string;
  facts: string[];
  unknowns: string[];
  relevantTargets: string[];
  snippetCount?: number;
  referenceCount?: number;
  snippetTargets?: string[];
};

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
  taskScope?: {
    title: string;
    objective: string;
  };
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
  evidenceBundles: CliPromptEvidenceBundleSummary[];
  evidenceLedger?: CliPromptEvidenceLedgerBundle[];
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

const NEXT_OBJECTIVES_SCHEMA =
  '"nextObjectives"?: {"abstractPlan"?: string, "gather"?: string, "concretePlan"?: string, "execute"?: string, "verify"?: string, "review"?: string}';

const EVIDENCE_LOCATION_SCHEMA =
  '{"filePath"?: string, "symbol"?: string, "line"?: number, "column"?: number, "uri"?: string, "label"?: string}';
const EVIDENCE_REFERENCE_DRAFT_SCHEMA =
  `{"id"?: string, "sourceType": "file" | "terminal" | "web" | "search" | "human" | "generated" | "other", "location"?: ${EVIDENCE_LOCATION_SCHEMA}, "note"?: string}`;
const EVIDENCE_SNIPPET_DRAFT_SCHEMA =
  `{"id"?: string, "kind": "code" | "text" | "terminal" | "search_result", "content": string, "location"?: ${EVIDENCE_LOCATION_SCHEMA}, "referenceId"?: string, "rationale"?: string}`;
const EVIDENCE_BUNDLE_DRAFT_SCHEMA = `{
  "id"?: string,
  "summary": string,
  "facts"?: Array<{"id"?: string, "statement": string, "confidence"?: "low" | "medium" | "high" | "mixed", "referenceIds"?: string[]}>,
  "hypotheses"?: Array<{"id"?: string, "statement": string, "confidence"?: "low" | "medium" | "high" | "mixed", "referenceIds"?: string[]}>,
  "unknowns"?: Array<{"id"?: string, "question": string, "impact"?: "low" | "medium" | "high", "referenceIds"?: string[]}>,
  "relevantTargets"?: Array<{"filePath"?: string, "symbol"?: string, "note"?: string}>,
  "snippets"?: Array<${EVIDENCE_SNIPPET_DRAFT_SCHEMA}>,
  "references"?: Array<${EVIDENCE_REFERENCE_DRAFT_SCHEMA}>,
  "confidence"?: "low" | "medium" | "high" | "mixed"
}`;

const PHASE_RESPONSE_SCHEMAS: Record<OrchestratorCapability, string> = {
  abstractPlan: `{"summary": string, "targetsToInspect": string[], "evidenceRequirements": string[], ${NEXT_OBJECTIVES_SCHEMA}}`,
  gather:
    `{"summary": string, "evidenceBundles": Array<${EVIDENCE_BUNDLE_DRAFT_SCHEMA}>, "projectStructure"?: ProjectStructureReport, ${NEXT_OBJECTIVES_SCHEMA}}`,
  concretePlan:
    `{"summary": string, "childTasks": Array<{"title": string, "objective": string, "importance": "critical" | "high" | "medium" | "low", "assignedModels": ModelAssignment, "reviewPolicy"?: ReviewPolicy, "acceptanceCriteria"?: AcceptanceCriteria, "executionBudget"?: Partial<ExecutionBudget>}>, "executionNotes": string[], "needsMorePlanning"?: boolean, "needsAdditionalGather"?: boolean, "additionalGatherObjectives"?: string[], "needsProjectStructureInspection"?: boolean, "inspectionObjectives"?: string[], "projectStructureContradictions"?: string[], ${NEXT_OBJECTIVES_SCHEMA}}`,
  review:
    '{"summary": string, "followUpQuestions": string[], "approved"?: boolean, "nextActions"?: Array<{"title": string, "objective": string, "rationale": string, "priority": "critical" | "high" | "medium" | "low"}>, "carryForward"?: {"facts": string[], "openQuestions": string[], "projectPaths": string[], "evidenceSummaries": string[]}}',
  execute:
    `{"summary": string, "outputs": string[], "completed"?: boolean, "blockedReason"?: string, ${NEXT_OBJECTIVES_SCHEMA}}`,
  verify:
    `{"summary": string, "passed": boolean, "findings": string[], ${NEXT_OBJECTIVES_SCHEMA}}`,
  rehydrate:
    `{"summary": string, "evidenceBundles": Array<${EVIDENCE_BUNDLE_DRAFT_SCHEMA}>}`
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
    taskScope: context.sessionScopeHint
      ? {
          title: context.sessionScopeHint.ownerTaskTitle,
          objective: context.sessionScopeHint.ownerTaskObjective
        }
      : undefined,
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
    evidenceLedger: buildPhaseEvidenceLedger(capability, context),
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
      "Before deep planning, perform a brief pre-flight check to determine available environment tools (e.g. npm, yarn, python, go, rustc) using safe, read-only shell commands (like --version or which).",
      "Produce a low-cost, approximate sketch of the repository before deeper planning starts.",
      "Treat taskScope.objective and goal only as downstream intent for later stages. Do not execute them during bootstrap sketch.",
      "If you can phrase the next abstract-plan objective more precisely than the fallback, return it in nextObjectives.abstractPlan.",
      "Limit yourself to top-level structure, likely entrypoints, main runtime boundaries, and a few anchor files or directories.",
      "Stay at seed level only: capture clues and open questions, then defer any detailed inspection to the later planning and gather stages.",
      "Do not install dependencies, create files, write tests, edit files, or run builds during bootstrap sketch. This phase is read-only evidence collection.",
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
      "Plan execution using the current projectStructure memory and gathered evidence.",
      "Use evidenceLedger as the canonical, lossless gather-to-plan handoff. The summary-only evidenceBundles field is only a skim layer.",
      "Check evidenceBundles.snippetCount and snippetTargets first to see whether exact file or payload excerpts were actually gathered for the targets you need.",
      "If you can phrase the next execution objective more precisely than the fallback, return it in nextObjectives.execute. If the next verify or review objective also needs custom framing, return nextObjectives.verify or nextObjectives.review.",
      "CRITICAL: Do NOT guess or speculate if the gathered evidence is insufficient or contradictory. Early convergence on a wrong implementation plan is strictly prohibited.",
      "If execution depends on exact file structure, DOM markup, config keys, selectors, API payloads, command output, or error text and evidenceLedger lacks the relevant anchored snippets or raw excerpts, set needsAdditionalGather=true and ask for those exact snippets.",
      "If you cannot name the exact line of code, the specific configuration key, or the precise API response needed for execution, set needsAdditionalGather=true immediately.",
      "When requesting additional gather (needsAdditionalGather=true), provide 1-3 highly targeted additionalGatherObjectives that point exactly to the missing pieces of information. This ensures token efficiency by avoiding broad re-scans.",
      "Do not proceed to implementation (childTasks) if there are still open technical unknowns or unconfirmed assumptions that could lead to a 'wrong answer'.",
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
      "CRITICAL: This is a STRICTLY READ-ONLY PLANNING phase. You are NOT allowed to use any terminal tools, shell commands, or sub-agents.",
      "Do NOT try to 'inspect', 'tail', 'grep', 'ls', or 'edit' anything. Your ONLY task is to analyze the provided memory and plan.",
      "Any tool call in this phase will be AUTOMATICALLY REJECTED. Do not waste your budget trying.",
      "If you need more information, set the 'evidenceRequirements' in your plan so the next 'gather' phase can collect it for you.",
      "Focus 100% on high-level strategy and evidence requirements. Implementation and investigation happen in later phases."
    ].join(" ");
  }

  if (workflowStage === "bootstrap_sketch" && capability === "abstractPlan") {
    return [
      "In this initial bootstrap phase, you ARE allowed to use read-only terminal tools (like 'node -v', 'npm -v', 'ls') to understand the environment.",
      "Focus on identifying the project structure, tool versions, and any immediate blockers.",
      "Keep your investigations minimal and focused on environmental discovery."
    ].join(" ");
  }

  if (workflowStage === "task_orchestration" && capability === "gather") {
    return [
      "Treat taskScope.objective as downstream task intent only. This phase gathers evidence; it does not execute the task.",
      "If you can phrase the next concrete-plan objective more precisely than the fallback, return it in nextObjectives.concretePlan.",
      "Start from the provided evidence, workingMemory, and projectStructure before doing any new search.",
      "Gather only the minimum evidence needed to unblock the next concrete plan or execution step.",
      "Treat the abstract plan's inspection targets and evidence requirements as the current gather contract.",
      "Stay within that contract unless each named target has been exhausted and you can justify widening the search in the returned evidence.",
      "When returning evidenceBundles, ensure each fact is specific, concrete, and contains technical details (paths, symbols, actual values, error messages, or configuration snippets). Do not generalize or summarize multiple distinct findings into a single vague fact. Every technical detail discovered is crucial for the planning phase.",
      "If a finding comes from source code, HTML, config, test files, IPC/preload wiring, API payloads, or terminal output that downstream planning may need structurally, include the exact excerpt in snippets with file/source location and connect it through references.",
      "For codebase tasks, each materially relevant file or symbol target should usually contribute at least one anchored snippet/reference pair. Summary-only bundles are insufficient when later planning depends on the real file structure.",
      "If a tool output contains a crucial error, configuration, or structural pattern, record it exactly as a fact with its context.",
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
      "Any sub-agent call (like generalist or codebase_investigator) MUST be strictly for analysis or investigation. You are NOT allowed to request sub-agents to 'fix', 'edit', 'write', or 'implement' anything in this stage.",
      "CRITICAL: Do NOT attempt to enter 'plan mode', generate plan files (e.g., in a 'plans/' directory), or use tools like `write_file`, `exit_plan_mode`, or `ask_user`. You are NOT the planner. You must ONLY explore the codebase using read-only terminal commands, gather the requested evidence, and then immediately return your GatherResult JSON.",
      "Update projectStructure only for the files, directories, or entrypoints that are directly relevant to the current node.",
      "Do not search outside the workspace or managed tool installation paths unless the current node explicitly requires it.",
      "When using grep or search tools to look for literal strings that contain special regex characters (such as {, }, (, ), +, *, or ?), you MUST escape them (e.g., \\{) to prevent regex parsing errors."
    ].join(" ");
  }

  if (workflowStage === "task_orchestration" && capability === "execute") {
    return [
      "Carry out the requested implementation work instead of restating the plan.",
      "If you can phrase the next verification objective more precisely from the actual execution outcome, return it in nextObjectives.verify.",
      "Do not invent undocumented CLI flags, slash commands, APIs, or data sources.",
      "When execution needs tests in this TypeScript workspace, prefer the project's documented scripts or a build-first path such as npm run build followed by built dist tests over raw node --test src/**/*.ts entrypoints.",
      "If a required user-visible behavior still depends on placeholder/no-data fallback because the upstream source is missing or unsupported, set completed=false and explain the blocker instead of claiming success.",
      "Set completed=true only if the execution actually changed or completed the intended work.",
      "If execution was blocked, denied, or intentionally not performed, set completed=false and explain the concrete reason in blockedReason."
    ].join(" ");
  }

  if (capability === "verify") {
    return [
      "Verify the requested user-visible behavior and system state, not just the presence of code changes, strings, or build success.",
      "If review is enabled and you can phrase the next review objective more precisely than the fallback, return it in nextObjectives.review.",
      "A generic success claim or a simple 'grep' for modified text is insufficient. You must provide concrete evidence of logical correctness.",
      "CRITICAL: Perform behavioral verification. If the change involves a logic flow, try to execute a command or script that exercises that flow. Establish that the bug is fixed or the feature works as intended in its actual runtime context.",
      "Set passed=false if the implementation is technically present but logically disconnected (e.g., a variable is updated but its value is never used by the system).",
      "Set passed=false if any requested behavior still relies on placeholder, fallback, no-data, or unsupported upstream sources instead of the requested real result.",
      "When additional tests are necessary in this TypeScript workspace, prefer the project's documented scripts or built dist tests after a build.",
      "Do not modify files, create temp scripts, or attempt follow-up fixes during verify. If verification fails, state the exact reason why and report it as a failure.",
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

const MAX_EVIDENCE_FACTS = 25; // Increased from 10
const MAX_EVIDENCE_UNKNOWNS = 12; // Increased from 5
const MAX_EVIDENCE_TARGETS = 20; // Increased from 8

function isFullContextPhase(capability: OrchestratorCapability): boolean {
  return capability === "abstractPlan" || capability === "concretePlan";
}

function truncateArray<T>(items: T[], limit: number): T[] {
  return items.length <= limit ? items : items.slice(0, limit);
}

function normalizePromptStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === "string") {
          const trimmed = item.trim();
          return trimmed.length > 0 ? [trimmed] : [];
        }
        if (typeof item === "number" || typeof item === "boolean") {
          return [String(item)];
        }
        return [];
      });
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  return [];
}

/**
 * Build a skim-friendly evidence summary for the prompt.
 * concretePlan receives the full-fidelity evidence separately via evidenceLedger.
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
  const includeSnippetCoverage = capability === "concretePlan";

  return context.evidenceBundles.map((bundle) => ({
    summary: bundle.summary,
    facts: truncateArray(
      bundle.facts.map((fact) => fact.statement),
      summaryOnlyPhase ? 12 : MAX_EVIDENCE_FACTS
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
        ),
    snippetCount: includeSnippetCoverage ? bundle.snippets.length : undefined,
    referenceCount: includeSnippetCoverage ? bundle.references.length : undefined,
    snippetTargets: includeSnippetCoverage
      ? truncateArray(
          Array.from(new Set(
            bundle.snippets
              .map((snippet) =>
                snippet.location?.filePath
                ?? snippet.location?.symbol
                ?? snippet.location?.label
                ?? snippet.rationale
                ?? snippet.referenceId
              )
              .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          )),
          MAX_EVIDENCE_TARGETS
        )
      : undefined
  }));
}

function buildPhaseEvidenceLedger(
  capability: OrchestratorCapability,
  context: ModelInvocationContext
): CliPromptEnvelope["evidenceLedger"] {
  if (capability !== "concretePlan") {
    return undefined;
  }

  return context.evidenceBundles.map((bundle) => ({
    id: bundle.id,
    summary: bundle.summary,
    confidence: bundle.confidence,
    facts: bundle.facts.map((fact) => ({
      id: fact.id,
      statement: fact.statement,
      confidence: fact.confidence,
      referenceIds: normalizePromptStringArray(fact.referenceIds)
    })),
    hypotheses: bundle.hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      statement: hypothesis.statement,
      confidence: hypothesis.confidence,
      referenceIds: normalizePromptStringArray(hypothesis.referenceIds)
    })),
    unknowns: bundle.unknowns.map((unknown) => ({
      id: unknown.id,
      question: unknown.question,
      impact: unknown.impact,
      referenceIds: normalizePromptStringArray(unknown.referenceIds)
    })),
    relevantTargets: bundle.relevantTargets.map((target) => ({ ...target })),
    snippets: bundle.snippets.map((snippet) => ({
      id: snippet.id,
      kind: snippet.kind,
      content: snippet.content,
      location: snippet.location ? { ...snippet.location } : undefined,
      referenceId: snippet.referenceId,
      rationale: snippet.rationale
    })),
    references: bundle.references.map((reference) => ({
      id: reference.id,
      sourceType: reference.sourceType,
      location: reference.location ? { ...reference.location } : undefined,
      note: reference.note
    }))
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
