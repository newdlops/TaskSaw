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
    '{"summary": string, "childTasks": Array<{"title": string, "objective": string, "importance": "critical" | "high" | "medium" | "low", "assignedModels": ModelAssignment, "reviewPolicy"?: ReviewPolicy, "acceptanceCriteria"?: AcceptanceCriteria, "executionBudget"?: Partial<ExecutionBudget>}>, "executionNotes": string[], "needsMorePlanning"?: boolean, "needsProjectStructureInspection"?: boolean, "inspectionObjectives"?: string[], "projectStructureContradictions"?: string[]}',
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
    evidenceBundles: context.evidenceBundles.map((bundle) => ({
      summary: bundle.summary,
      facts: bundle.facts.map((fact) => fact.statement),
      unknowns: bundle.unknowns.map((unknown) => unknown.question),
      relevantTargets: bundle.relevantTargets.map((target) => target.filePath ?? target.symbol ?? target.note ?? "unknown")
    })),
    workingMemory: {
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
    },
    projectStructure: {
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
    }
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
      "Do not over-explore or speculate in detail.",
      "Return only compact clues that reduce future search cost."
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
        "Return an updated projectStructure summary."
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
      "Do not call tools, create temp files, or run shell commands during concrete planning. Use only the provided memory and gathered evidence.",
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
      "If the current memory already names likely files, modules, entrypoints, or managed tool locations, inspect those first instead of widening the search.",
      "Do not edit files, call tools, create temp files, run builds, or execute shell commands during planning.",
      "Do not ask for broad repository or external tool exploration unless the current memory is insufficient to name a concrete next target."
    ].join(" ");
  }

  if (workflowStage === "task_orchestration" && capability === "gather") {
    return [
      "Start from the provided evidence, workingMemory, and projectStructure before doing any new search.",
      "Gather only the minimum evidence needed to unblock the next concrete plan or execution step.",
      "Prefer confirming or disproving the current memory's open questions at the named files, entrypoints, modules, relevantTargets, or managed tool locations before running broader searches.",
      "If the current memory already suggests a likely absence or integration gap, confirm that directly and return compact evidence instead of expanding the search surface.",
      "If an external CLI/API surface already appears absent or unsupported, stop after enough evidence to establish that fact. Do not keep probing undocumented alternative commands, slash commands, or ad hoc flags.",
      "Do not ask the user for permission to continue planning, escape plan mode, or work around internal tool/runtime errors. Report those blockers directly in the JSON response instead.",
      "Do not edit files, run builds, or execute other mutating commands in gather. This phase is read-only evidence collection.",
      "Update projectStructure only for the files, directories, or entrypoints that are directly relevant to the current node.",
      "Do not search outside the workspace or managed tool installation paths unless the current node explicitly requires it."
    ].join(" ");
  }

  if (workflowStage === "task_orchestration" && capability === "execute") {
    return [
      "Carry out the requested implementation work instead of restating the plan.",
      "Do not invent undocumented CLI flags, slash commands, APIs, or data sources.",
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
