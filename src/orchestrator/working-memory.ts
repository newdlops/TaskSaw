import { randomUUID } from "node:crypto";
import {
  ConfidenceLevel,
  WorkingMemoryConflict,
  WorkingMemoryDecision,
  WorkingMemoryEntryStatus,
  WorkingMemoryFact,
  WorkingMemoryQuestion,
  WorkingMemorySnapshot,
  WorkingMemoryUnknown
} from "./types";

export type RecordFactInput = {
  id?: string;
  statement: string;
  confidence?: ConfidenceLevel;
  referenceIds?: string[];
  relatedNodeIds?: string[];
};

export type RecordQuestionInput = {
  id?: string;
  question: string;
  referenceIds?: string[];
  relatedNodeIds?: string[];
};

export type RecordUnknownInput = {
  id?: string;
  description: string;
  impact: "low" | "medium" | "high";
  referenceIds?: string[];
  relatedNodeIds?: string[];
};

export type RecordConflictInput = {
  id?: string;
  summary: string;
  referenceIds?: string[];
  relatedNodeIds?: string[];
};

export type RecordDecisionInput = {
  id?: string;
  summary: string;
  rationale: string;
  referenceIds?: string[];
  relatedNodeIds?: string[];
};

export function createEmptyWorkingMemorySnapshot(runId: string, updatedAt: string): WorkingMemorySnapshot {
  return {
    runId,
    facts: [],
    openQuestions: [],
    unknowns: [],
    conflicts: [],
    decisions: [],
    updatedAt
  };
}

export class WorkingMemoryStore {
  private readonly facts = new Map<string, WorkingMemoryFact>();
  private readonly openQuestions = new Map<string, WorkingMemoryQuestion>();
  private readonly unknowns = new Map<string, WorkingMemoryUnknown>();
  private readonly conflicts = new Map<string, WorkingMemoryConflict>();
  private readonly decisions = new Map<string, WorkingMemoryDecision>();
  private updatedAt: string;

  constructor(
    private readonly runId: string,
    private readonly now: () => string = () => new Date().toISOString(),
    snapshot?: WorkingMemorySnapshot
  ) {
    this.updatedAt = this.now();

    if (snapshot) {
      for (const fact of snapshot.facts) this.facts.set(fact.id, { ...fact });
      for (const question of snapshot.openQuestions) this.openQuestions.set(question.id, { ...question });
      for (const unknown of snapshot.unknowns) this.unknowns.set(unknown.id, { ...unknown });
      for (const conflict of snapshot.conflicts) this.conflicts.set(conflict.id, { ...conflict });
      for (const decision of snapshot.decisions) this.decisions.set(decision.id, { ...decision });
      this.updatedAt = snapshot.updatedAt;
    }
  }

  recordFact(input: RecordFactInput): WorkingMemoryFact {
    const timestamp = this.bumpTimestamp();
    const existing = this.findFactByStatement(input.statement);
    if (existing) {
      const nextFact: WorkingMemoryFact = {
        ...existing,
        confidence: this.mergeConfidence(existing.confidence, input.confidence ?? existing.confidence),
        referenceIds: this.mergeStringArrays(existing.referenceIds, input.referenceIds),
        relatedNodeIds: this.mergeStringArrays(existing.relatedNodeIds, input.relatedNodeIds),
        updatedAt: timestamp
      };

      this.facts.set(nextFact.id, nextFact);
      return nextFact;
    }

    const fact: WorkingMemoryFact = {
      id: input.id ?? randomUUID(),
      statement: input.statement,
      confidence: input.confidence ?? "medium",
      referenceIds: [...(input.referenceIds ?? [])],
      relatedNodeIds: [...(input.relatedNodeIds ?? [])],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.facts.set(fact.id, fact);
    return fact;
  }

  recordQuestion(input: RecordQuestionInput): WorkingMemoryQuestion {
    const timestamp = this.bumpTimestamp();
    const existing = this.findQuestionByText(input.question);
    if (existing) {
      const nextQuestion: WorkingMemoryQuestion = {
        ...existing,
        referenceIds: this.mergeStringArrays(existing.referenceIds, input.referenceIds),
        relatedNodeIds: this.mergeStringArrays(existing.relatedNodeIds, input.relatedNodeIds),
        updatedAt: timestamp
      };

      this.openQuestions.set(nextQuestion.id, nextQuestion);
      return nextQuestion;
    }

    const question: WorkingMemoryQuestion = {
      id: input.id ?? randomUUID(),
      question: input.question,
      status: "open",
      referenceIds: [...(input.referenceIds ?? [])],
      relatedNodeIds: [...(input.relatedNodeIds ?? [])],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.openQuestions.set(question.id, question);
    return question;
  }

  recordUnknown(input: RecordUnknownInput): WorkingMemoryUnknown {
    const timestamp = this.bumpTimestamp();
    const existing = this.findUnknownByDescription(input.description);
    if (existing) {
      const nextUnknown: WorkingMemoryUnknown = {
        ...existing,
        impact: this.mergeImpact(existing.impact, input.impact),
        referenceIds: this.mergeStringArrays(existing.referenceIds, input.referenceIds),
        relatedNodeIds: this.mergeStringArrays(existing.relatedNodeIds, input.relatedNodeIds),
        updatedAt: timestamp
      };

      this.unknowns.set(nextUnknown.id, nextUnknown);
      return nextUnknown;
    }

    const unknown: WorkingMemoryUnknown = {
      id: input.id ?? randomUUID(),
      description: input.description,
      status: "open",
      impact: input.impact,
      referenceIds: [...(input.referenceIds ?? [])],
      relatedNodeIds: [...(input.relatedNodeIds ?? [])],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.unknowns.set(unknown.id, unknown);
    return unknown;
  }

  recordConflict(input: RecordConflictInput): WorkingMemoryConflict {
    const timestamp = this.bumpTimestamp();
    const existing = this.findConflictBySummary(input.summary);
    if (existing) {
      const nextConflict: WorkingMemoryConflict = {
        ...existing,
        referenceIds: this.mergeStringArrays(existing.referenceIds, input.referenceIds),
        relatedNodeIds: this.mergeStringArrays(existing.relatedNodeIds, input.relatedNodeIds),
        updatedAt: timestamp
      };

      this.conflicts.set(nextConflict.id, nextConflict);
      return nextConflict;
    }

    const conflict: WorkingMemoryConflict = {
      id: input.id ?? randomUUID(),
      summary: input.summary,
      status: "open",
      referenceIds: [...(input.referenceIds ?? [])],
      relatedNodeIds: [...(input.relatedNodeIds ?? [])],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.conflicts.set(conflict.id, conflict);
    return conflict;
  }

  recordDecision(input: RecordDecisionInput): WorkingMemoryDecision {
    const timestamp = this.bumpTimestamp();
    const existing = this.findDecision(input.summary, input.rationale);
    if (existing) {
      const nextDecision: WorkingMemoryDecision = {
        ...existing,
        referenceIds: this.mergeStringArrays(existing.referenceIds, input.referenceIds),
        relatedNodeIds: this.mergeStringArrays(existing.relatedNodeIds, input.relatedNodeIds),
        updatedAt: timestamp
      };

      this.decisions.set(nextDecision.id, nextDecision);
      return nextDecision;
    }

    const decision: WorkingMemoryDecision = {
      id: input.id ?? randomUUID(),
      summary: input.summary,
      rationale: input.rationale,
      referenceIds: [...(input.referenceIds ?? [])],
      relatedNodeIds: [...(input.relatedNodeIds ?? [])],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.decisions.set(decision.id, decision);
    return decision;
  }

  resolveQuestion(questionId: string, resolution: string): WorkingMemoryQuestion {
    return this.updateQuestionStatus(questionId, "resolved", resolution);
  }

  supersedeQuestion(questionId: string, resolution?: string): WorkingMemoryQuestion {
    return this.updateQuestionStatus(questionId, "superseded", resolution);
  }

  resolveUnknown(unknownId: string): WorkingMemoryUnknown {
    return this.updateUnknownStatus(unknownId, "resolved");
  }

  supersedeUnknown(unknownId: string): WorkingMemoryUnknown {
    return this.updateUnknownStatus(unknownId, "superseded");
  }

  resolveConflict(conflictId: string): WorkingMemoryConflict {
    return this.updateConflictStatus(conflictId, "resolved");
  }

  supersedeConflict(conflictId: string): WorkingMemoryConflict {
    return this.updateConflictStatus(conflictId, "superseded");
  }

  getSnapshot(): WorkingMemorySnapshot {
    return {
      runId: this.runId,
      facts: [...this.facts.values()],
      openQuestions: [...this.openQuestions.values()],
      unknowns: [...this.unknowns.values()],
      conflicts: [...this.conflicts.values()],
      decisions: [...this.decisions.values()],
      updatedAt: this.updatedAt
    };
  }

  private updateQuestionStatus(
    questionId: string,
    status: WorkingMemoryEntryStatus,
    resolution?: string
  ): WorkingMemoryQuestion {
    const current = this.openQuestions.get(questionId);
    if (!current) throw new Error(`Working memory question ${questionId} was not found`);

    const updatedAt = this.bumpTimestamp();
    const nextQuestion: WorkingMemoryQuestion = {
      ...current,
      status,
      resolution,
      updatedAt
    };

    this.openQuestions.set(questionId, nextQuestion);
    return nextQuestion;
  }

  private updateUnknownStatus(unknownId: string, status: WorkingMemoryEntryStatus): WorkingMemoryUnknown {
    const current = this.unknowns.get(unknownId);
    if (!current) throw new Error(`Working memory unknown ${unknownId} was not found`);

    const updatedAt = this.bumpTimestamp();
    const nextUnknown: WorkingMemoryUnknown = {
      ...current,
      status,
      updatedAt
    };

    this.unknowns.set(unknownId, nextUnknown);
    return nextUnknown;
  }

  private updateConflictStatus(conflictId: string, status: WorkingMemoryEntryStatus): WorkingMemoryConflict {
    const current = this.conflicts.get(conflictId);
    if (!current) throw new Error(`Working memory conflict ${conflictId} was not found`);

    const updatedAt = this.bumpTimestamp();
    const nextConflict: WorkingMemoryConflict = {
      ...current,
      status,
      updatedAt
    };

    this.conflicts.set(conflictId, nextConflict);
    return nextConflict;
  }

  private bumpTimestamp(): string {
    this.updatedAt = this.now();
    return this.updatedAt;
  }

  private findFactByStatement(statement: string): WorkingMemoryFact | undefined {
    return [...this.facts.values()].find((fact) => this.normalizeText(fact.statement) === this.normalizeText(statement));
  }

  private findQuestionByText(question: string): WorkingMemoryQuestion | undefined {
    return [...this.openQuestions.values()].find((entry) => this.normalizeText(entry.question) === this.normalizeText(question));
  }

  private findUnknownByDescription(description: string): WorkingMemoryUnknown | undefined {
    return [...this.unknowns.values()].find((entry) => this.normalizeText(entry.description) === this.normalizeText(description));
  }

  private findConflictBySummary(summary: string): WorkingMemoryConflict | undefined {
    return [...this.conflicts.values()].find((entry) => this.normalizeText(entry.summary) === this.normalizeText(summary));
  }

  private findDecision(summary: string, rationale: string): WorkingMemoryDecision | undefined {
    const normalizedSummary = this.normalizeText(summary);
    const normalizedRationale = this.normalizeText(rationale);
    return [...this.decisions.values()].find((entry) =>
      this.normalizeText(entry.summary) === normalizedSummary
      && this.normalizeText(entry.rationale) === normalizedRationale
    );
  }

  private mergeStringArrays(existing: string[], incoming: string[] | undefined): string[] {
    const merged = new Set<string>(existing);
    for (const value of incoming ?? []) {
      const trimmedValue = value.trim();
      if (trimmedValue.length === 0) continue;
      merged.add(trimmedValue);
    }

    return [...merged];
  }

  private mergeConfidence(current: ConfidenceLevel, next: ConfidenceLevel): ConfidenceLevel {
    if (current === next) return current;
    if (current === "mixed" || next === "mixed") return "mixed";

    const rank: Record<Exclude<ConfidenceLevel, "mixed">, number> = {
      low: 1,
      medium: 2,
      high: 3
    };

    return rank[current as Exclude<ConfidenceLevel, "mixed">] >= rank[next as Exclude<ConfidenceLevel, "mixed">]
      ? current
      : next;
  }

  private mergeImpact(
    current: WorkingMemoryUnknown["impact"],
    next: WorkingMemoryUnknown["impact"]
  ): WorkingMemoryUnknown["impact"] {
    const rank: Record<WorkingMemoryUnknown["impact"], number> = {
      low: 1,
      medium: 2,
      high: 3
    };

    return rank[current] >= rank[next] ? current : next;
  }

  private normalizeText(value: string): string {
    return value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[`"'’“”]/g, "")
      .replace(/[()[\]{}:;,.!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
