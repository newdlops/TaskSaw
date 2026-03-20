import { randomUUID } from "node:crypto";
import {
  ConfidenceLevel,
  ProjectStructureContradiction,
  ProjectStructureEntryPoint,
  ProjectStructureEntryPointReport,
  ProjectStructureModule,
  ProjectStructureModuleReport,
  ProjectStructurePathEntry,
  ProjectStructurePathReport,
  ProjectStructureQuestion,
  ProjectStructureReport,
  ProjectStructureSnapshot,
  WorkingMemoryEntryStatus
} from "./types";

type RecordPathInput = ProjectStructurePathReport & {
  id?: string;
  relatedNodeIds?: string[];
};

type RecordEntryPointInput = ProjectStructureEntryPointReport & {
  id?: string;
  relatedNodeIds?: string[];
};

type RecordModuleInput = ProjectStructureModuleReport & {
  id?: string;
  relatedNodeIds?: string[];
};

type RecordQuestionInput = {
  id?: string;
  question: string;
  referenceIds?: string[];
  relatedNodeIds?: string[];
};

type RecordContradictionInput = {
  id?: string;
  summary: string;
  referenceIds?: string[];
  relatedNodeIds?: string[];
};

export function createEmptyProjectStructureSnapshot(runId: string, updatedAt: string): ProjectStructureSnapshot {
  return {
    runId,
    summary: "",
    directories: [],
    keyFiles: [],
    entryPoints: [],
    modules: [],
    openQuestions: [],
    contradictions: [],
    updatedAt
  };
}

export class ProjectStructureMemoryStore {
  private summary = "";
  private readonly directories = new Map<string, ProjectStructurePathEntry>();
  private readonly keyFiles = new Map<string, ProjectStructurePathEntry>();
  private readonly entryPoints = new Map<string, ProjectStructureEntryPoint>();
  private readonly modules = new Map<string, ProjectStructureModule>();
  private readonly openQuestions = new Map<string, ProjectStructureQuestion>();
  private readonly contradictions = new Map<string, ProjectStructureContradiction>();
  private updatedAt: string;

  constructor(
    private readonly runId: string,
    private readonly now: () => string = () => new Date().toISOString(),
    snapshot?: ProjectStructureSnapshot
  ) {
    this.updatedAt = this.now();

    if (snapshot) {
      this.summary = snapshot.summary;
      for (const entry of snapshot.directories) this.directories.set(entry.id, { ...entry });
      for (const entry of snapshot.keyFiles) this.keyFiles.set(entry.id, { ...entry });
      for (const entry of snapshot.entryPoints) this.entryPoints.set(entry.id, { ...entry });
      for (const entry of snapshot.modules) this.modules.set(entry.id, { ...entry });
      for (const question of snapshot.openQuestions) this.openQuestions.set(question.id, { ...question });
      for (const contradiction of snapshot.contradictions) this.contradictions.set(contradiction.id, { ...contradiction });
      this.updatedAt = snapshot.updatedAt;
    }
  }

  mergeReport(nodeId: string, report: ProjectStructureReport | undefined): ProjectStructureSnapshot {
    if (!report) {
      return this.getSnapshot();
    }

    const trimmedSummary = report.summary.trim();
    if (trimmedSummary.length > 0) {
      this.summary = trimmedSummary;
      this.bumpTimestamp();
    }

    for (const entry of report.directories) {
      this.recordDirectory({
        ...entry,
        relatedNodeIds: [nodeId]
      });
    }

    for (const entry of report.keyFiles) {
      this.recordKeyFile({
        ...entry,
        relatedNodeIds: [nodeId]
      });
    }

    for (const entry of report.entryPoints) {
      this.recordEntryPoint({
        ...entry,
        relatedNodeIds: [nodeId]
      });
    }

    for (const entry of report.modules) {
      this.recordModule({
        ...entry,
        relatedNodeIds: [nodeId]
      });
    }

    for (const question of report.openQuestions) {
      this.recordQuestion({
        question,
        relatedNodeIds: [nodeId]
      });
    }

    for (const contradiction of report.contradictions) {
      this.recordContradiction({
        summary: contradiction,
        relatedNodeIds: [nodeId]
      });
    }

    return this.getSnapshot();
  }

  recordInspectionObjectives(nodeId: string, objectives: string[]) {
    for (const objective of objectives) {
      this.recordQuestion({
        question: objective,
        relatedNodeIds: [nodeId]
      });
    }
  }

  recordContradictions(nodeId: string, contradictions: string[]) {
    for (const contradiction of contradictions) {
      this.recordContradiction({
        summary: contradiction,
        relatedNodeIds: [nodeId]
      });
    }
  }

  resolveQuestions(questions: string[], resolution: string) {
    for (const question of questions) {
      const existing = this.findQuestionByText(question);
      if (!existing) continue;
      this.updateQuestionStatus(existing.id, "resolved", resolution);
    }
  }

  resolveContradictions(contradictions: string[], resolution: string) {
    for (const contradiction of contradictions) {
      const existing = this.findContradictionBySummary(contradiction);
      if (!existing) continue;
      this.updateContradictionStatus(existing.id, "resolved", resolution);
    }
  }

  getSnapshot(): ProjectStructureSnapshot {
    return {
      runId: this.runId,
      summary: this.summary,
      directories: [...this.directories.values()],
      keyFiles: [...this.keyFiles.values()],
      entryPoints: [...this.entryPoints.values()],
      modules: [...this.modules.values()],
      openQuestions: [...this.openQuestions.values()],
      contradictions: [...this.contradictions.values()],
      updatedAt: this.updatedAt
    };
  }

  private recordDirectory(input: RecordPathInput): ProjectStructurePathEntry {
    return this.upsertPathEntry(this.directories, input, this.normalizePath(input.path));
  }

  private recordKeyFile(input: RecordPathInput): ProjectStructurePathEntry {
    return this.upsertPathEntry(this.keyFiles, input, this.normalizePath(input.path));
  }

  private recordEntryPoint(input: RecordEntryPointInput): ProjectStructureEntryPoint {
    const timestamp = this.bumpTimestamp();
    const existing = this.findEntryPoint(input.path, input.role) ?? this.findSupersededEntryPoint(input);
    if (existing) {
      const nextConfidence = input.confidence ?? existing.confidence;
      const nextEntry: ProjectStructureEntryPoint = {
        ...existing,
        path: input.path,
        role: input.role,
        summary: this.pickPreferredSummary(
          existing.summary,
          existing.confidence,
          input.summary,
          nextConfidence
        ),
        confidence: this.mergeConfidence(existing.confidence, nextConfidence),
        referenceIds: this.mergeStringArrays(existing.referenceIds, input.referenceIds),
        relatedNodeIds: this.mergeStringArrays(existing.relatedNodeIds, input.relatedNodeIds),
        updatedAt: timestamp
      };
      this.entryPoints.set(nextEntry.id, nextEntry);
      return nextEntry;
    }

    const entry: ProjectStructureEntryPoint = {
      id: input.id ?? randomUUID(),
      path: input.path,
      role: input.role,
      summary: input.summary,
      confidence: input.confidence ?? "medium",
      referenceIds: [...(input.referenceIds ?? [])],
      relatedNodeIds: [...(input.relatedNodeIds ?? [])],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.entryPoints.set(entry.id, entry);
    return entry;
  }

  private recordModule(input: RecordModuleInput): ProjectStructureModule {
    const timestamp = this.bumpTimestamp();
    const existing = this.findModule(input.name);
    if (existing) {
      const nextModule: ProjectStructureModule = {
        ...existing,
        summary: this.pickPreferredSummary(
          existing.summary,
          existing.confidence,
          input.summary,
          input.confidence ?? existing.confidence
        ),
        relatedPaths: this.mergeStringArrays(existing.relatedPaths, input.relatedPaths),
        confidence: this.mergeConfidence(existing.confidence, input.confidence ?? existing.confidence),
        referenceIds: this.mergeStringArrays(existing.referenceIds, input.referenceIds),
        relatedNodeIds: this.mergeStringArrays(existing.relatedNodeIds, input.relatedNodeIds),
        updatedAt: timestamp
      };
      this.modules.set(nextModule.id, nextModule);
      return nextModule;
    }

    const moduleEntry: ProjectStructureModule = {
      id: input.id ?? randomUUID(),
      name: input.name,
      summary: input.summary,
      relatedPaths: [...(input.relatedPaths ?? [])],
      confidence: input.confidence ?? "medium",
      referenceIds: [...(input.referenceIds ?? [])],
      relatedNodeIds: [...(input.relatedNodeIds ?? [])],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.modules.set(moduleEntry.id, moduleEntry);
    return moduleEntry;
  }

  private recordQuestion(input: RecordQuestionInput): ProjectStructureQuestion {
    const timestamp = this.bumpTimestamp();
    const existing = this.findQuestionByText(input.question);
    if (existing) {
      const nextQuestion: ProjectStructureQuestion = {
        ...existing,
        status: "open",
        resolution: undefined,
        referenceIds: this.mergeStringArrays(existing.referenceIds, input.referenceIds),
        relatedNodeIds: this.mergeStringArrays(existing.relatedNodeIds, input.relatedNodeIds),
        updatedAt: timestamp
      };
      this.openQuestions.set(nextQuestion.id, nextQuestion);
      return nextQuestion;
    }

    const question: ProjectStructureQuestion = {
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

  private recordContradiction(input: RecordContradictionInput): ProjectStructureContradiction {
    const timestamp = this.bumpTimestamp();
    const existing = this.findContradictionBySummary(input.summary);
    if (existing) {
      const nextContradiction: ProjectStructureContradiction = {
        ...existing,
        status: "open",
        resolution: undefined,
        referenceIds: this.mergeStringArrays(existing.referenceIds, input.referenceIds),
        relatedNodeIds: this.mergeStringArrays(existing.relatedNodeIds, input.relatedNodeIds),
        updatedAt: timestamp
      };
      this.contradictions.set(nextContradiction.id, nextContradiction);
      return nextContradiction;
    }

    const contradiction: ProjectStructureContradiction = {
      id: input.id ?? randomUUID(),
      summary: input.summary,
      status: "open",
      referenceIds: [...(input.referenceIds ?? [])],
      relatedNodeIds: [...(input.relatedNodeIds ?? [])],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.contradictions.set(contradiction.id, contradiction);
    return contradiction;
  }

  private upsertPathEntry(
    store: Map<string, ProjectStructurePathEntry>,
    input: RecordPathInput,
    normalizedPath: string
  ): ProjectStructurePathEntry {
    const timestamp = this.bumpTimestamp();
    const existing = [...store.values()].find((entry) => this.normalizePath(entry.path) === normalizedPath);
    if (existing) {
      const nextEntry: ProjectStructurePathEntry = {
        ...existing,
        summary: this.pickPreferredSummary(
          existing.summary,
          existing.confidence,
          input.summary,
          input.confidence ?? existing.confidence
        ),
        confidence: this.mergeConfidence(existing.confidence, input.confidence ?? existing.confidence),
        referenceIds: this.mergeStringArrays(existing.referenceIds, input.referenceIds),
        relatedNodeIds: this.mergeStringArrays(existing.relatedNodeIds, input.relatedNodeIds),
        updatedAt: timestamp
      };
      store.set(nextEntry.id, nextEntry);
      return nextEntry;
    }

    const entry: ProjectStructurePathEntry = {
      id: input.id ?? randomUUID(),
      path: input.path,
      summary: input.summary,
      confidence: input.confidence ?? "medium",
      referenceIds: [...(input.referenceIds ?? [])],
      relatedNodeIds: [...(input.relatedNodeIds ?? [])],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    store.set(entry.id, entry);
    return entry;
  }

  private updateQuestionStatus(
    questionId: string,
    status: WorkingMemoryEntryStatus,
    resolution?: string
  ): ProjectStructureQuestion {
    const current = this.openQuestions.get(questionId);
    if (!current) {
      throw new Error(`Project structure question ${questionId} was not found`);
    }

    const updatedAt = this.bumpTimestamp();
    const nextQuestion: ProjectStructureQuestion = {
      ...current,
      status,
      resolution,
      updatedAt
    };
    this.openQuestions.set(questionId, nextQuestion);
    return nextQuestion;
  }

  private updateContradictionStatus(
    contradictionId: string,
    status: WorkingMemoryEntryStatus,
    resolution?: string
  ): ProjectStructureContradiction {
    const current = this.contradictions.get(contradictionId);
    if (!current) {
      throw new Error(`Project structure contradiction ${contradictionId} was not found`);
    }

    const updatedAt = this.bumpTimestamp();
    const nextContradiction: ProjectStructureContradiction = {
      ...current,
      status,
      resolution,
      updatedAt
    };
    this.contradictions.set(contradictionId, nextContradiction);
    return nextContradiction;
  }

  private findEntryPoint(path: string, role: string): ProjectStructureEntryPoint | undefined {
    const normalizedPath = this.normalizePath(path);
    const normalizedRole = this.normalizeText(role);
    return [...this.entryPoints.values()].find((entry) =>
      this.normalizePath(entry.path) === normalizedPath && this.normalizeText(entry.role) === normalizedRole
    );
  }

  private findSupersededEntryPoint(input: RecordEntryPointInput): ProjectStructureEntryPoint | undefined {
    const normalizedPath = this.normalizePath(input.path);
    const normalizedRole = this.normalizeEntryPointRole(input.role);
    const nextConfidence = input.confidence ?? "medium";
    const inputLooksTentative = this.entryPointLooksTentative(input.role, input.summary, nextConfidence);

    if (normalizedRole.length === 0) {
      return undefined;
    }

    return [...this.entryPoints.values()].find((entry) => {
      if (this.normalizePath(entry.path) === normalizedPath) {
        return false;
      }

      if (this.normalizeEntryPointRole(entry.role) !== normalizedRole) {
        return false;
      }

      const existingLooksTentative = this.entryPointLooksTentative(entry.role, entry.summary, entry.confidence);
      const nextIsStronger = this.confidenceRank(nextConfidence) > this.confidenceRank(entry.confidence)
        || (!inputLooksTentative && existingLooksTentative);

      return nextIsStronger;
    });
  }

  private findModule(name: string): ProjectStructureModule | undefined {
    const normalizedName = this.normalizeText(name);
    return [...this.modules.values()].find((entry) => this.normalizeText(entry.name) === normalizedName);
  }

  private findQuestionByText(question: string): ProjectStructureQuestion | undefined {
    const normalizedQuestion = this.normalizeText(question);
    return [...this.openQuestions.values()].find((entry) => this.normalizeText(entry.question) === normalizedQuestion);
  }

  private findContradictionBySummary(summary: string): ProjectStructureContradiction | undefined {
    const normalizedSummary = this.normalizeText(summary);
    return [...this.contradictions.values()].find((entry) => this.normalizeText(entry.summary) === normalizedSummary);
  }

  private bumpTimestamp(): string {
    this.updatedAt = this.now();
    return this.updatedAt;
  }

  private pickPreferredSummary(
    currentSummary: string,
    currentConfidence: ConfidenceLevel,
    nextSummary: string,
    nextConfidence: ConfidenceLevel
  ): string {
    const trimmedCurrent = currentSummary.trim();
    const trimmedNext = nextSummary.trim();
    if (trimmedNext.length === 0) {
      return currentSummary;
    }

    if (trimmedCurrent.length === 0) {
      return nextSummary;
    }

    if (this.normalizeText(trimmedCurrent) === this.normalizeText(trimmedNext)) {
      return trimmedNext.length >= trimmedCurrent.length ? nextSummary : currentSummary;
    }

    const currentRank = this.confidenceRank(currentConfidence);
    const nextRank = this.confidenceRank(nextConfidence);
    if (nextRank > currentRank) {
      return nextSummary;
    }

    if (currentRank > nextRank) {
      return currentSummary;
    }

    return nextSummary;
  }

  private mergeConfidence(left: ConfidenceLevel, right: ConfidenceLevel): ConfidenceLevel {
    const ranking: Record<ConfidenceLevel, number> = {
      low: 0,
      medium: 1,
      mixed: 2,
      high: 3
    };
    return ranking[right] >= ranking[left] ? right : left;
  }

  private mergeStringArrays(left: string[] | undefined, right: string[] | undefined): string[] {
    return [...new Set([...(left ?? []), ...(right ?? [])])];
  }

  private confidenceRank(value: ConfidenceLevel): number {
    const ranking: Record<ConfidenceLevel, number> = {
      low: 0,
      medium: 1,
      mixed: 2,
      high: 3
    };

    return ranking[value];
  }

  private normalizePath(path: string): string {
    return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
  }

  private normalizeText(value: string): string {
    return value
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  private normalizeEntryPointRole(role: string): string {
    const normalized = this.normalizeText(role)
      .replace(/\b(actual|real|main|primary|canonical|suspected|likely|possible|probable|guessed|guess|initial|stale|legacy|old|candidate)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return normalized.length > 0 ? normalized : this.normalizeText(role);
  }

  private entryPointLooksTentative(role: string, summary: string, confidence: ConfidenceLevel): boolean {
    if (confidence === "low") {
      return true;
    }

    return /\b(suspected|likely|possible|probable|guess|guessed|initial|stale|legacy|old|candidate)\b/.test(
      this.normalizeText(`${role} ${summary}`)
    );
  }
}
