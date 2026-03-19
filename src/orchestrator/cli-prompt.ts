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
    '{"summary": string, "childTasks": Array<{"title": string, "objective": string, "importance": "critical" | "high" | "medium" | "low", "assignedModels": ModelAssignment, "reviewPolicy"?: ReviewPolicy, "acceptanceCriteria"?: AcceptanceCriteria, "executionBudget"?: Partial<ExecutionBudget>}>, "executionNotes": string[], "needsProjectStructureInspection"?: boolean, "inspectionObjectives"?: string[], "projectStructureContradictions"?: string[]}',
  review:
    '{"summary": string, "approved": boolean, "followUpQuestions": string[]}',
  execute:
    '{"summary": string, "outputs": string[]}',
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

  const stageInstructions = buildStageInstructions(capability, context.workflowStage);

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
  workflowStage: ModelInvocationContext["workflowStage"]
): string {
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
      "If projectStructure is contradictory or missing critical facts, set needsProjectStructureInspection=true, provide inspectionObjectives, and explain the contradiction in projectStructureContradictions.",
      "Child tasks created here are planning nodes only. Do not merge execution into the planning node.",
      "Each child task must include an importance field and explicit assignedModels chosen from nodeModelRouting.",
      "There is no model inheritance. The orchestrator will execute child nodes only with the exact assignedModels you return."
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
