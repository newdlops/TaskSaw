import { createHash } from "node:crypto";
import {
  ModelInvocationContext,
  ModelInvocationSessionScopeHint,
  OrchestratorCapability
} from "./model-adapter";

const MAX_LEDGER_ENTRIES = 6;
const MAX_PRELUDE_ENTRIES = 4;
const MAX_INLINE_TEXT_LENGTH = 180;
const MAX_EVIDENCE_SUMMARIES = 3;
const MAX_LINEAGE_SEGMENTS = 6;

export type SessionReuseCapabilityFamily = "analysis" | "execution";

export type SessionReuseScope = {
  key: string;
  family: SessionReuseCapabilityFamily;
  workflowStage: ModelInvocationContext["workflowStage"];
  ownerLabel: string;
  ownerFingerprint: string;
};

export type SessionContextLedgerEntry = {
  id: string;
  runId: string;
  nodeId: string;
  capability: OrchestratorCapability;
  workflowStage: ModelInvocationContext["workflowStage"];
  family: SessionReuseCapabilityFamily;
  model: string;
  objective: string;
  contextSummary: string;
  promptDigest: string;
  responseSummary?: string;
  createdAt: string;
};

export function resolveSessionCapabilityFamily(
  capability: OrchestratorCapability
): SessionReuseCapabilityFamily {
  return capability === "execute" ? "execution" : "analysis";
}

export function buildSessionReuseScope(
  transportId: string,
  workspaceRoot: string,
  capability: OrchestratorCapability,
  context: ModelInvocationContext
): SessionReuseScope {
  const family = resolveSessionCapabilityFamily(capability);
  const owner = resolveOwnerHint(context.sessionScopeHint, context);
  const ownerFingerprintSource = JSON.stringify({
    goal: normalizeText(context.run.goal),
    ownerTaskTitle: normalizeText(owner.ownerTaskTitle),
    ownerTaskObjective: normalizeText(owner.ownerTaskObjective),
    ownerTaskLineage: owner.ownerTaskLineage
      .map((segment) => normalizeText(segment))
      .filter(Boolean)
      .slice(-MAX_LINEAGE_SEGMENTS),
    workflowStage: context.workflowStage,
    family
  });

  return {
    key: createDigest([
      transportId,
      normalizeText(workspaceRoot),
      normalizeText(context.assignedModel.provider),
      normalizeText(context.assignedModel.model),
      normalizeText(context.workflowStage),
      normalizeText(family),
      ownerFingerprintSource
    ]),
    family,
    workflowStage: context.workflowStage,
    ownerLabel: compactText(`${owner.ownerTaskTitle}: ${owner.ownerTaskObjective}`),
    ownerFingerprint: createDigest([ownerFingerprintSource])
  };
}

export function createSessionContextLedgerEntry(
  scope: SessionReuseScope,
  capability: OrchestratorCapability,
  prompt: string,
  context: ModelInvocationContext
): SessionContextLedgerEntry {
  return {
    id: createDigest([
      context.run.id,
      context.node.id,
      capability,
      context.assignedModel.model,
      prompt
    ]),
    runId: context.run.id,
    nodeId: context.node.id,
    capability,
    workflowStage: context.workflowStage,
    family: scope.family,
    model: context.assignedModel.model,
    objective: compactText(context.node.objective),
    contextSummary: buildContextSummary(capability, context),
    promptDigest: createDigest([prompt]),
    createdAt: context.node.updatedAt || context.run.updatedAt
  };
}

export function finalizeSessionContextLedgerEntry(
  entry: SessionContextLedgerEntry,
  stdout: string
): SessionContextLedgerEntry {
  const responseSummary = extractModelResponseSummary(stdout);
  return responseSummary
    ? {
        ...entry,
        responseSummary
      }
    : entry;
}

export function appendSessionContextLedger(
  ledger: SessionContextLedgerEntry[],
  entry: SessionContextLedgerEntry
): SessionContextLedgerEntry[] {
  return [...ledger, entry].slice(-MAX_LEDGER_ENTRIES);
}

export function buildSessionReusePrelude(
  scope: SessionReuseScope,
  ledger: SessionContextLedgerEntry[],
  currentEntry: SessionContextLedgerEntry
): string | undefined {
  if (ledger.length === 0) {
    return undefined;
  }

  const priorEntries = ledger.slice(-MAX_PRELUDE_ENTRIES);
  const lines = [
    "TASKSAW SESSION REUSE PRELUDE",
    "This invocation is reusing an existing TaskSaw session scope.",
    "Treat the JSON envelope below as the canonical source of truth. Hidden session memory and these notes are only a cache.",
    `Scope family: ${scope.family}`,
    `Workflow stage: ${scope.workflowStage}`,
    `Scope owner: ${scope.ownerLabel}`,
    "Previously sent context in this same scope:"
  ];

  for (const [index, entry] of priorEntries.entries()) {
    lines.push(
      `${index + 1}. capability=${entry.capability}; run=${entry.runId}; node=${entry.nodeId}; context=${compactText(entry.contextSummary)}${entry.responseSummary ? `; response=${compactText(entry.responseSummary)}` : ""}`
    );
  }

  lines.push(`Current turn summary: ${compactText(currentEntry.contextSummary)}`);
  lines.push("The current prompt starts after this prelude.");
  return lines.join("\n");
}

function resolveOwnerHint(
  hint: ModelInvocationSessionScopeHint | undefined,
  context: ModelInvocationContext
): ModelInvocationSessionScopeHint {
  if (hint) {
    return {
      ownerTaskId: hint.ownerTaskId,
      ownerTaskTitle: hint.ownerTaskTitle,
      ownerTaskObjective: hint.ownerTaskObjective,
      ownerTaskLineage: [...hint.ownerTaskLineage]
    };
  }

  return {
    ownerTaskId: context.node.id,
    ownerTaskTitle: context.node.title,
    ownerTaskObjective: context.node.objective,
    ownerTaskLineage: [context.run.goal, context.node.title, context.node.objective]
  };
}

function buildContextSummary(
  capability: OrchestratorCapability,
  context: ModelInvocationContext
): string {
  const segments: string[] = [
    `capability=${capability}`,
    `objective=${compactText(context.node.objective)}`
  ];

  if (context.evidenceBundles.length > 0) {
    const summaries = context.evidenceBundles
      .slice(-MAX_EVIDENCE_SUMMARIES)
      .map((bundle) => compactText(bundle.summary))
      .filter(Boolean);
    const evidenceSegment = summaries.length > 0
      ? `${context.evidenceBundles.length} bundles [${summaries.join(" | ")}]`
      : `${context.evidenceBundles.length} bundles`;
    segments.push(`evidence=${evidenceSegment}`);
  } else {
    segments.push("evidence=0 bundles");
  }

  segments.push(`openQuestions=${context.workingMemory.openQuestions.filter((entry) => entry.status === "open").length}`);
  segments.push(`unknowns=${context.workingMemory.unknowns.filter((entry) => entry.status === "open").length}`);
  segments.push(`conflicts=${context.workingMemory.conflicts.filter((entry) => entry.status === "open").length}`);
  segments.push(`decisions=${context.workingMemory.decisions.length}`);

  const projectSummary = compactText(context.projectStructure.summary);
  if (projectSummary.length > 0) {
    segments.push(`project=${projectSummary}`);
  }

  return segments.join("; ");
}

function extractModelResponseSummary(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const summary = typeof parsed.summary === "string" ? parsed.summary : undefined;
    return summary ? compactText(summary) : undefined;
  } catch {
    return compactText(trimmed.split("\n")[0] ?? "");
  }
}

function createDigest(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 24);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function compactText(value: string): string {
  const normalized = normalizeText(value);
  if (normalized.length <= MAX_INLINE_TEXT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_INLINE_TEXT_LENGTH - 3)}...`;
}
