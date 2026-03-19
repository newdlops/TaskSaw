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
      facts: (input.facts ?? []).map((fact) => ({
        id: fact.id ?? randomUUID(),
        statement: fact.statement,
        confidence: fact.confidence,
        referenceIds: [...fact.referenceIds]
      })),
      hypotheses: (input.hypotheses ?? []).map((hypothesis) => ({
        id: hypothesis.id ?? randomUUID(),
        statement: hypothesis.statement,
        confidence: hypothesis.confidence,
        referenceIds: [...hypothesis.referenceIds]
      })),
      unknowns: (input.unknowns ?? []).map((unknown) => ({
        id: unknown.id ?? randomUUID(),
        question: unknown.question,
        impact: unknown.impact,
        referenceIds: [...unknown.referenceIds]
      })),
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
      facts: bundle.facts.map((fact) => ({ ...fact, referenceIds: [...fact.referenceIds] })),
      hypotheses: bundle.hypotheses.map((hypothesis) => ({
        ...hypothesis,
        referenceIds: [...hypothesis.referenceIds]
      })),
      unknowns: bundle.unknowns.map((unknown) => ({ ...unknown, referenceIds: [...unknown.referenceIds] })),
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
