import { randomUUID } from "node:crypto";
import {
  ConfidenceLevel,
  EvidenceBundle,
  EvidenceFact,
  EvidenceHypothesis,
  EvidenceReference,
  EvidenceSnippet,
  EvidenceTarget,
  EvidenceUnknown
} from "./types";

export type CreateEvidenceBundleInput = {
  id?: string;
  runId: string;
  nodeId: string;
  summary: string;
  facts?: Array<Omit<EvidenceFact, "id"> & { id?: string }>;
  hypotheses?: Array<Omit<EvidenceHypothesis, "id"> & { id?: string }>;
  unknowns?: Array<Omit<EvidenceUnknown, "id"> & { id?: string }>;
  relevantTargets?: EvidenceTarget[];
  snippets?: Array<Omit<EvidenceSnippet, "id"> & { id?: string }>;
  references?: Array<Omit<EvidenceReference, "id"> & { id?: string }>;
  confidence?: ConfidenceLevel;
};

export type MergeEvidenceBundlesInput = {
  runId: string;
  nodeId: string;
  bundleIds: string[];
  summary: string;
  id?: string;
  confidence?: ConfidenceLevel;
};

export class EvidenceStore {
  private readonly bundles = new Map<string, EvidenceBundle>();

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    initialBundles: EvidenceBundle[] = []
  ) {
    for (const bundle of initialBundles) {
      this.bundles.set(bundle.id, bundle);
    }
  }

  createBundle(input: CreateEvidenceBundleInput): EvidenceBundle {
    const timestamp = this.now();
    const bundle: EvidenceBundle = {
      id: input.id ?? randomUUID(),
      runId: input.runId,
      nodeId: input.nodeId,
      summary: input.summary,
      facts: this.normalizeFacts(input.facts),
      hypotheses: this.normalizeHypotheses(input.hypotheses),
      unknowns: this.normalizeUnknowns(input.unknowns),
      relevantTargets: (input.relevantTargets ?? []).map((target) => ({ ...target })),
      snippets: (input.snippets ?? []).map((snippet) => ({
        id: snippet.id ?? randomUUID(),
        kind: snippet.kind,
        content: snippet.content,
        location: snippet.location ? { ...snippet.location } : undefined,
        referenceId: snippet.referenceId,
        rationale: snippet.rationale
      })),
      references: (input.references ?? []).map((reference) => ({
        id: reference.id ?? randomUUID(),
        sourceType: reference.sourceType,
        location: reference.location ? { ...reference.location } : undefined,
        note: reference.note
      })),
      confidence: input.confidence ?? "medium",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.upsertBundle(bundle);
    return bundle;
  }

  upsertBundle(bundle: EvidenceBundle) {
    this.bundles.set(bundle.id, {
      ...bundle,
      facts: this.normalizeFacts(bundle.facts),
      hypotheses: this.normalizeHypotheses(bundle.hypotheses),
      unknowns: this.normalizeUnknowns(bundle.unknowns),
      relevantTargets: bundle.relevantTargets.map((target) => ({ ...target })),
      snippets: bundle.snippets.map((snippet) => ({
        ...snippet,
        location: snippet.location ? { ...snippet.location } : undefined
      })),
      references: bundle.references.map((reference) => ({
        ...reference,
        location: reference.location ? { ...reference.location } : undefined
      }))
    });
  }

  getBundle(bundleId: string): EvidenceBundle | undefined {
    return this.bundles.get(bundleId);
  }

  listNodeBundles(nodeId: string): EvidenceBundle[] {
    return [...this.bundles.values()]
      .filter((bundle) => bundle.nodeId === nodeId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listRunBundles(runId: string): EvidenceBundle[] {
    return [...this.bundles.values()]
      .filter((bundle) => bundle.runId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  mergeBundles(input: MergeEvidenceBundlesInput): EvidenceBundle {
    const bundles = input.bundleIds.map((bundleId) => {
      const bundle = this.getBundle(bundleId);
      if (!bundle) {
        throw new Error(`Evidence bundle ${bundleId} was not found`);
      }

      return bundle;
    });

    const mergedBundle = this.createBundle({
      id: input.id,
      runId: input.runId,
      nodeId: input.nodeId,
      summary: input.summary,
      facts: this.dedupeByIdentity(
        bundles.flatMap((bundle) => bundle.facts),
        (fact) => `${fact.statement}:${fact.confidence}:${fact.referenceIds.join(",")}`
      ),
      hypotheses: this.dedupeByIdentity(
        bundles.flatMap((bundle) => bundle.hypotheses),
        (hypothesis) => `${hypothesis.statement}:${hypothesis.confidence}:${hypothesis.referenceIds.join(",")}`
      ),
      unknowns: this.dedupeByIdentity(
        bundles.flatMap((bundle) => bundle.unknowns),
        (unknown) => `${unknown.question}:${unknown.impact}:${unknown.referenceIds.join(",")}`
      ),
      relevantTargets: this.dedupeByIdentity(
        bundles.flatMap((bundle) => bundle.relevantTargets),
        (target) => `${target.filePath ?? ""}:${target.symbol ?? ""}:${target.note ?? ""}`
      ),
      snippets: this.dedupeByIdentity(
        bundles.flatMap((bundle) => bundle.snippets),
        (snippet) =>
          `${snippet.kind}:${snippet.content}:${snippet.location?.filePath ?? ""}:${snippet.location?.symbol ?? ""}:${snippet.referenceId ?? ""}`
      ),
      references: this.dedupeByIdentity(
        bundles.flatMap((bundle) => bundle.references),
        (reference) =>
          `${reference.sourceType}:${reference.location?.filePath ?? ""}:${reference.location?.symbol ?? ""}:${reference.note ?? ""}`
      ),
      confidence: input.confidence ?? this.selectMergedConfidence(bundles)
    });

    return mergedBundle;
  }

  private selectMergedConfidence(bundles: EvidenceBundle[]): ConfidenceLevel {
    const confidenceSet = new Set(bundles.map((bundle) => bundle.confidence));
    if (confidenceSet.size === 1) {
      return bundles[0]?.confidence ?? "medium";
    }

    return "mixed";
  }

  private normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === "string") {
            return item.trim();
          }

          if (typeof item === "number" || typeof item === "boolean") {
            return String(item);
          }

          return "";
        })
        .filter((item): item is string => item.length > 0);
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

  private normalizeFacts(input: CreateEvidenceBundleInput["facts"] | EvidenceBundle["facts"] | undefined): EvidenceFact[] {
    const normalized: EvidenceFact[] = [];

    for (const fact of input ?? []) {
      const statement = this.normalizeNonEmptyString((fact as { statement?: unknown }).statement);
      if (!statement) continue;

      normalized.push({
        id: fact.id ?? randomUUID(),
        statement,
        confidence: this.normalizeConfidence((fact as { confidence?: unknown }).confidence),
        referenceIds: this.normalizeStringArray((fact as { referenceIds?: unknown }).referenceIds)
      });
    }

    return normalized;
  }

  private normalizeHypotheses(
    input: CreateEvidenceBundleInput["hypotheses"] | EvidenceBundle["hypotheses"] | undefined
  ): EvidenceHypothesis[] {
    const normalized: EvidenceHypothesis[] = [];

    for (const hypothesis of input ?? []) {
      const statement = this.normalizeNonEmptyString((hypothesis as { statement?: unknown }).statement);
      if (!statement) continue;

      normalized.push({
        id: hypothesis.id ?? randomUUID(),
        statement,
        confidence: this.normalizeConfidence((hypothesis as { confidence?: unknown }).confidence),
        referenceIds: this.normalizeStringArray((hypothesis as { referenceIds?: unknown }).referenceIds)
      });
    }

    return normalized;
  }

  private normalizeUnknowns(
    input: CreateEvidenceBundleInput["unknowns"] | EvidenceBundle["unknowns"] | undefined
  ): EvidenceUnknown[] {
    const normalized: EvidenceUnknown[] = [];

    for (const unknown of input ?? []) {
      const question = this.normalizeNonEmptyString((unknown as { question?: unknown }).question);
      if (!question) continue;

      normalized.push({
        id: unknown.id ?? randomUUID(),
        question,
        impact: this.normalizeImpact((unknown as { impact?: unknown }).impact),
        referenceIds: this.normalizeStringArray((unknown as { referenceIds?: unknown }).referenceIds)
      });
    }

    return normalized;
  }

  private normalizeConfidence(value: unknown): ConfidenceLevel {
    return value === "low" || value === "medium" || value === "high" || value === "mixed"
      ? value
      : "medium";
  }

  private normalizeImpact(value: unknown): EvidenceUnknown["impact"] {
    return value === "low" || value === "medium" || value === "high"
      ? value
      : "medium";
  }

  private normalizeNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private dedupeByIdentity<T>(items: T[], keyFn: (item: T) => string): T[] {
    const seen = new Set<string>();
    const deduped: T[] = [];

    for (const item of items) {
      const key = keyFn(item);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    return deduped;
  }
}
