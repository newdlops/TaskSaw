import fs from "node:fs";
import path from "node:path";
import { createEmptyProjectStructureSnapshot } from "./project-structure-memory";
import { createEmptyWorkingMemorySnapshot } from "./working-memory";
import {
  ConfidenceLevel,
  ContinuationSeed,
  EvidenceBundle,
  ProjectStructureEntryPoint,
  ProjectStructureModule,
  ProjectStructurePathEntry,
  ProjectStructureSnapshot,
  RunSnapshot,
  WorkingMemoryDecision,
  WorkingMemoryFact,
  WorkingMemorySnapshot
} from "./types";

const CACHE_VERSION = 2;
const CACHE_DIRECTORY_NAME = ".tasksaw";
const CACHE_CONTEXT_FILE_NAME = "context.json";
const CACHE_OVERVIEW_FILE_NAME = "README.md";
const CACHE_NOTE_FILE_NAME = ".tasksaw.md";
const MAX_EVIDENCE_HINTS = 8;
const MAX_DIRECTORY_HINTS = 12;
const MAX_FILE_HINTS = 16;
const MAX_ENTRY_POINT_HINTS = 8;
const MAX_MODULE_HINTS = 8;
const MAX_OPEN_STRUCTURE_ITEMS = 8;
const MAX_FACT_HINTS = 8;
const MAX_DECISION_HINTS = 8;
const MAX_WORKING_MEMORY_OPEN_ITEMS = 6;

type WorkspaceContextCachePayload = {
  version: number;
  updatedAt: string;
  sourceRunId: string;
  evidenceBundles: EvidenceBundle[];
  workingMemory: WorkingMemorySnapshot;
  projectStructure: ProjectStructureSnapshot;
};

type NoteBuilder = {
  sourcePath: string;
  sections: string[];
};

export class WorkspaceContextCache {
  private readonly workspaceRoot: string;
  private readonly cacheRoot: string;

  constructor(workspacePath: string) {
    this.workspaceRoot = path.resolve(workspacePath);
    this.cacheRoot = path.join(this.workspaceRoot, CACHE_DIRECTORY_NAME);
  }

  loadSeed(): ContinuationSeed | undefined {
    const payload = this.readPayload();
    const payloadSeed = payload ? this.createSeedFromPayload(payload) : undefined;
    const fallbackSourceRunId = payload?.sourceRunId ?? `workspace-cache:${path.basename(this.workspaceRoot)}`;
    const fallbackUpdatedAt = payload?.updatedAt ?? new Date().toISOString();
    const hintSeed = this.readHintSeed(fallbackSourceRunId, fallbackUpdatedAt);
    const merged = this.mergeSeeds(payloadSeed, hintSeed);
    return merged ? this.deduplicateSeed(merged) : undefined;
  }

  saveSnapshot(snapshot: RunSnapshot) {
    const snapshotWorkspacePath = snapshot.run.workspacePath?.trim();
    if (!snapshotWorkspacePath || path.resolve(snapshotWorkspacePath) !== this.workspaceRoot) {
      return;
    }

    const payload = this.buildPayload(snapshot);
    if (!this.hasMeaningfulPayload(payload)) {
      return;
    }
    const hintPayload = this.buildHintPayload(payload);

    fs.rmSync(this.cacheRoot, { recursive: true, force: true });
    fs.mkdirSync(this.cacheRoot, { recursive: true });

    this.writeJsonFile(path.join(this.cacheRoot, CACHE_CONTEXT_FILE_NAME), payload);
    this.writeOverviewFile(hintPayload);
    this.writeMirroredHintFiles(hintPayload);
  }

  clear() {
    fs.rmSync(this.cacheRoot, { recursive: true, force: true });
  }

  private readPayload(): WorkspaceContextCachePayload | undefined {
    const filePath = path.join(this.cacheRoot, CACHE_CONTEXT_FILE_NAME);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<WorkspaceContextCachePayload>;
      const updatedAt = typeof payload.updatedAt === "string" && payload.updatedAt.trim().length > 0
        ? payload.updatedAt
        : new Date().toISOString();
      const sourceRunId = typeof payload.sourceRunId === "string" && payload.sourceRunId.trim().length > 0
        ? payload.sourceRunId
        : `workspace-cache:${path.basename(this.workspaceRoot)}`;

      return {
        version: typeof payload.version === "number" ? payload.version : CACHE_VERSION,
        updatedAt,
        sourceRunId,
        evidenceBundles: Array.isArray(payload.evidenceBundles) ? payload.evidenceBundles : [],
        workingMemory: payload.workingMemory ?? createEmptyWorkingMemorySnapshot(sourceRunId, updatedAt),
        projectStructure: payload.projectStructure ?? createEmptyProjectStructureSnapshot(sourceRunId, updatedAt)
      };
    } catch {
      return undefined;
    }
  }

  private createSeedFromPayload(payload: WorkspaceContextCachePayload): ContinuationSeed {
    return {
      sourceRunId: payload.sourceRunId,
      evidenceBundles: payload.evidenceBundles,
      workingMemory: payload.workingMemory,
      projectStructure: payload.projectStructure
    };
  }

  private buildPayload(snapshot: RunSnapshot): WorkspaceContextCachePayload {
    const updatedAt = snapshot.projectStructure.updatedAt
      || snapshot.workingMemory.updatedAt
      || snapshot.run.updatedAt;

    return {
      version: CACHE_VERSION,
      updatedAt,
      sourceRunId: snapshot.run.id,
      evidenceBundles: snapshot.evidenceBundles,
      workingMemory: snapshot.workingMemory,
      projectStructure: snapshot.projectStructure
    };
  }

  private buildHintPayload(payload: WorkspaceContextCachePayload): WorkspaceContextCachePayload {
    return {
      ...payload,
      evidenceBundles: this.pickTop(payload.evidenceBundles, MAX_EVIDENCE_HINTS, (bundle) =>
        (this.confidenceRank(bundle.confidence) * 100) + this.timestampRank(bundle.updatedAt)
      ),
      workingMemory: this.trimWorkingMemory(payload.workingMemory, payload.updatedAt),
      projectStructure: this.trimProjectStructure(payload.projectStructure, payload.updatedAt)
    };
  }

  private trimWorkingMemory(snapshot: WorkingMemorySnapshot, updatedAt: string): WorkingMemorySnapshot {
    return {
      ...snapshot,
      facts: this.pickTop(snapshot.facts, MAX_FACT_HINTS, (fact) =>
        (this.confidenceRank(fact.confidence) * 100) + this.timestampRank(fact.updatedAt)
      ),
      openQuestions: this.pickTop(
        snapshot.openQuestions.filter((entry) => entry.status === "open"),
        MAX_WORKING_MEMORY_OPEN_ITEMS,
        (entry) => this.timestampRank(entry.updatedAt)
      ),
      unknowns: this.pickTop(
        snapshot.unknowns.filter((entry) => entry.status === "open"),
        MAX_WORKING_MEMORY_OPEN_ITEMS,
        (entry) => this.timestampRank(entry.updatedAt)
      ),
      conflicts: this.pickTop(
        snapshot.conflicts.filter((entry) => entry.status === "open"),
        MAX_WORKING_MEMORY_OPEN_ITEMS,
        (entry) => this.timestampRank(entry.updatedAt)
      ),
      decisions: this.pickTop(snapshot.decisions, MAX_DECISION_HINTS, (decision) => this.timestampRank(decision.updatedAt)),
      updatedAt
    };
  }

  private trimProjectStructure(snapshot: ProjectStructureSnapshot, updatedAt: string): ProjectStructureSnapshot {
    return {
      ...snapshot,
      directories: this.pickTop(snapshot.directories, MAX_DIRECTORY_HINTS, (entry) =>
        (this.confidenceRank(entry.confidence) * 100) + this.timestampRank(entry.updatedAt)
      ),
      keyFiles: this.pickTop(snapshot.keyFiles, MAX_FILE_HINTS, (entry) =>
        (this.confidenceRank(entry.confidence) * 100) + this.timestampRank(entry.updatedAt)
      ),
      entryPoints: this.pickTop(snapshot.entryPoints, MAX_ENTRY_POINT_HINTS, (entry) =>
        (this.confidenceRank(entry.confidence) * 100) + this.timestampRank(entry.updatedAt)
      ),
      modules: this.pickTop(snapshot.modules, MAX_MODULE_HINTS, (entry) =>
        (this.confidenceRank(entry.confidence) * 100) + this.timestampRank(entry.updatedAt)
      ),
      openQuestions: this.pickTop(
        snapshot.openQuestions.filter((entry) => entry.status === "open"),
        MAX_OPEN_STRUCTURE_ITEMS,
        (entry) => this.timestampRank(entry.updatedAt)
      ),
      contradictions: this.pickTop(
        snapshot.contradictions.filter((entry) => entry.status === "open"),
        MAX_OPEN_STRUCTURE_ITEMS,
        (entry) => this.timestampRank(entry.updatedAt)
      ),
      updatedAt
    };
  }

  private hasMeaningfulPayload(payload: WorkspaceContextCachePayload): boolean {
    return payload.evidenceBundles.length > 0
      || payload.projectStructure.summary.trim().length > 0
      || payload.projectStructure.directories.length > 0
      || payload.projectStructure.keyFiles.length > 0
      || payload.projectStructure.entryPoints.length > 0
      || payload.projectStructure.modules.length > 0
      || payload.workingMemory.facts.length > 0
      || payload.workingMemory.openQuestions.length > 0
      || payload.workingMemory.unknowns.length > 0
      || payload.workingMemory.conflicts.length > 0
      || payload.workingMemory.decisions.length > 0;
  }

  private readHintSeed(sourceRunId: string, updatedAt: string): ContinuationSeed | undefined {
    const seed = this.createEmptySeed(sourceRunId, updatedAt);
    const overviewPath = path.join(this.cacheRoot, CACHE_OVERVIEW_FILE_NAME);
    if (fs.existsSync(overviewPath)) {
      this.applyOverviewHints(seed, overviewPath, updatedAt);
    }

    for (const notePath of this.listMirroredHintFiles()) {
      this.applyMirroredHint(seed, notePath, updatedAt);
    }

    return this.hasContinuationClues(seed) ? this.deduplicateSeed(seed) : undefined;
  }

  private createEmptySeed(sourceRunId: string, updatedAt: string): ContinuationSeed {
    return {
      sourceRunId,
      evidenceBundles: [],
      workingMemory: createEmptyWorkingMemorySnapshot(sourceRunId, updatedAt),
      projectStructure: createEmptyProjectStructureSnapshot(sourceRunId, updatedAt)
    };
  }

  private applyOverviewHints(seed: ContinuationSeed, filePath: string, updatedAt: string) {
    const blocks = this.parseMarkdownSectionBlocks(fs.readFileSync(filePath, "utf8"));

    const projectSummary = blocks
      .filter((block) => block.title === "Project Summary")
      .flatMap((block) => block.lines)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
    if (projectSummary.length > 0 && seed.projectStructure.summary.trim().length === 0) {
      seed.projectStructure.summary = projectSummary;
    }

    for (const block of blocks) {
      if (block.title === "Key Directories") {
        for (const item of this.extractBulletItems(block.lines)) {
          const parsed = this.parsePathSummaryItem(item);
          if (!parsed) {
            continue;
          }
          seed.projectStructure.directories.push({
            id: this.nextHintId("hint-dir", seed.projectStructure.directories.length + 1),
            path: parsed.path,
            summary: parsed.summary,
            confidence: "medium",
            referenceIds: [],
            relatedNodeIds: [],
            createdAt: updatedAt,
            updatedAt
          });
        }
      }

      if (block.title === "Key Files") {
        for (const item of this.extractBulletItems(block.lines)) {
          const parsed = this.parsePathSummaryItem(item);
          if (!parsed) {
            continue;
          }
          seed.projectStructure.keyFiles.push({
            id: this.nextHintId("hint-file", seed.projectStructure.keyFiles.length + 1),
            path: parsed.path,
            summary: parsed.summary,
            confidence: "medium",
            referenceIds: [],
            relatedNodeIds: [],
            createdAt: updatedAt,
            updatedAt
          });
        }
      }

      if (block.title === "Entry Points") {
        for (const item of this.extractBulletItems(block.lines)) {
          const parsed = this.parseEntryPointItem(item);
          if (!parsed) {
            continue;
          }
          seed.projectStructure.entryPoints.push({
            id: this.nextHintId("hint-entry", seed.projectStructure.entryPoints.length + 1),
            path: parsed.path,
            role: parsed.role,
            summary: parsed.summary,
            confidence: "medium",
            referenceIds: [],
            relatedNodeIds: [],
            createdAt: updatedAt,
            updatedAt
          });
        }
      }

      if (block.title === "Modules") {
        for (const item of this.extractBulletItems(block.lines)) {
          const parsed = this.parseModuleItem(item);
          if (!parsed) {
            continue;
          }
          seed.projectStructure.modules.push({
            id: this.nextHintId("hint-module", seed.projectStructure.modules.length + 1),
            name: parsed.name,
            summary: parsed.summary,
            relatedPaths: parsed.relatedPaths,
            confidence: "medium",
            referenceIds: [],
            relatedNodeIds: [],
            createdAt: updatedAt,
            updatedAt
          });
        }
      }

      if (block.title === "Cached Facts") {
        for (const item of this.extractBulletItems(block.lines)) {
          seed.workingMemory.facts.push({
            id: this.nextHintId("hint-fact", seed.workingMemory.facts.length + 1),
            statement: item,
            confidence: "medium",
            referenceIds: [],
            relatedNodeIds: [],
            createdAt: updatedAt,
            updatedAt
          });
        }
      }

      if (block.title === "Cached Decisions") {
        for (const item of this.extractBulletItems(block.lines)) {
          const parsed = this.parseDecisionItem(item);
          if (!parsed) {
            continue;
          }
          seed.workingMemory.decisions.push({
            id: this.nextHintId("hint-decision", seed.workingMemory.decisions.length + 1),
            summary: parsed.summary,
            rationale: parsed.rationale,
            referenceIds: [],
            relatedNodeIds: [],
            createdAt: updatedAt,
            updatedAt
          });
        }
      }
    }
  }

  private applyMirroredHint(seed: ContinuationSeed, filePath: string, updatedAt: string) {
    const content = fs.readFileSync(filePath, "utf8");
    const sourcePath = this.parseSourcePath(content) ?? this.deriveSourcePathFromHintPath(filePath);
    if (!sourcePath) {
      return;
    }

    for (const block of this.parseMarkdownSectionBlocks(content)) {
      const fields = this.parseKeyValueLines(block.lines);
      const summary = fields.get("Summary")?.trim() ?? "";
      const confidence = this.parseConfidenceLevel(fields.get("Confidence"));
      if (block.title === "Directory" && summary.length > 0) {
        seed.projectStructure.directories.push({
          id: this.nextHintId("hint-dir", seed.projectStructure.directories.length + 1),
          path: sourcePath,
          summary,
          confidence,
          referenceIds: [],
          relatedNodeIds: [],
          createdAt: updatedAt,
          updatedAt
        });
      }

      if (block.title === "Key File" && summary.length > 0) {
        seed.projectStructure.keyFiles.push({
          id: this.nextHintId("hint-file", seed.projectStructure.keyFiles.length + 1),
          path: sourcePath,
          summary,
          confidence,
          referenceIds: [],
          relatedNodeIds: [],
          createdAt: updatedAt,
          updatedAt
        });
      }

      if (block.title === "Entry Point" && summary.length > 0) {
        const role = fields.get("Role")?.trim();
        if (!role) {
          continue;
        }
        seed.projectStructure.entryPoints.push({
          id: this.nextHintId("hint-entry", seed.projectStructure.entryPoints.length + 1),
          path: sourcePath,
          role,
          summary,
          confidence,
          referenceIds: [],
          relatedNodeIds: [],
          createdAt: updatedAt,
          updatedAt
        });
      }

      if (block.title === "Module" && summary.length > 0) {
        const name = fields.get("Name")?.trim();
        if (!name) {
          continue;
        }
        seed.projectStructure.modules.push({
          id: this.nextHintId("hint-module", seed.projectStructure.modules.length + 1),
          name,
          summary,
          relatedPaths: [sourcePath],
          confidence,
          referenceIds: [],
          relatedNodeIds: [],
          createdAt: updatedAt,
          updatedAt
        });
      }
    }
  }

  private listMirroredHintFiles(): string[] {
    if (!fs.existsSync(this.cacheRoot)) {
      return [];
    }

    const pending = [this.cacheRoot];
    const files: string[] = [];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const nextPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(nextPath);
          continue;
        }
        if (entry.isFile() && entry.name === CACHE_NOTE_FILE_NAME) {
          files.push(nextPath);
          continue;
        }
        if (entry.isFile() && entry.name.endsWith(CACHE_NOTE_FILE_NAME)) {
          files.push(nextPath);
        }
      }
    }

    return files.sort();
  }

  private mergeSeeds(
    primary: ContinuationSeed | undefined,
    supplemental: ContinuationSeed | undefined
  ): ContinuationSeed | undefined {
    if (!primary) {
      return supplemental;
    }
    if (!supplemental) {
      return primary;
    }

    return {
      sourceRunId: primary.sourceRunId,
      evidenceBundles: this.mergeSeedEntries(
        primary.evidenceBundles,
        supplemental.evidenceBundles,
        (entry) => entry.id.trim() || this.normalizeHintText(entry.summary)
      ),
      workingMemory: {
        ...primary.workingMemory,
        facts: this.mergeSeedEntries(
          primary.workingMemory.facts,
          supplemental.workingMemory.facts,
          (entry) => this.normalizeHintText(entry.statement)
        ),
        openQuestions: this.mergeSeedEntries(
          primary.workingMemory.openQuestions,
          supplemental.workingMemory.openQuestions,
          (entry) => this.normalizeHintText(entry.question)
        ),
        unknowns: this.mergeSeedEntries(
          primary.workingMemory.unknowns,
          supplemental.workingMemory.unknowns,
          (entry) => this.normalizeHintText(entry.description)
        ),
        conflicts: this.mergeSeedEntries(
          primary.workingMemory.conflicts,
          supplemental.workingMemory.conflicts,
          (entry) => this.normalizeHintText(entry.summary)
        ),
        decisions: this.mergeSeedEntries(
          primary.workingMemory.decisions,
          supplemental.workingMemory.decisions,
          (entry) => `${this.normalizeHintText(entry.summary)}::${this.normalizeHintText(entry.rationale)}`
        ),
        updatedAt: this.pickLaterTimestamp(primary.workingMemory.updatedAt, supplemental.workingMemory.updatedAt)
      },
      projectStructure: {
        ...primary.projectStructure,
        summary: primary.projectStructure.summary.trim().length > 0
          ? primary.projectStructure.summary
          : supplemental.projectStructure.summary,
        directories: this.mergeSeedEntries(
          primary.projectStructure.directories,
          supplemental.projectStructure.directories,
          (entry) => entry.path.trim()
        ),
        keyFiles: this.mergeSeedEntries(
          primary.projectStructure.keyFiles,
          supplemental.projectStructure.keyFiles,
          (entry) => entry.path.trim()
        ),
        entryPoints: this.mergeSeedEntries(
          primary.projectStructure.entryPoints,
          supplemental.projectStructure.entryPoints,
          (entry) => `${entry.path.trim()}::${entry.role.trim()}`
        ),
        modules: this.mergeSeedEntries(
          primary.projectStructure.modules,
          supplemental.projectStructure.modules,
          (entry) => entry.name.trim()
        ),
        openQuestions: this.mergeSeedEntries(
          primary.projectStructure.openQuestions,
          supplemental.projectStructure.openQuestions,
          (entry) => this.normalizeHintText(entry.question)
        ),
        contradictions: this.mergeSeedEntries(
          primary.projectStructure.contradictions,
          supplemental.projectStructure.contradictions,
          (entry) => this.normalizeHintText(entry.summary)
        ),
        updatedAt: this.pickLaterTimestamp(primary.projectStructure.updatedAt, supplemental.projectStructure.updatedAt)
      }
    };
  }

  private deduplicateSeed(seed: ContinuationSeed): ContinuationSeed {
    return {
      ...seed,
      evidenceBundles: this.deduplicateEntries(
        seed.evidenceBundles,
        (entry) => entry.id.trim() || this.normalizeHintText(entry.summary)
      ),
      workingMemory: {
        ...seed.workingMemory,
        facts: this.deduplicateEntries(seed.workingMemory.facts, (entry) => this.normalizeHintText(entry.statement)),
        openQuestions: this.deduplicateEntries(seed.workingMemory.openQuestions, (entry) => this.normalizeHintText(entry.question)),
        unknowns: this.deduplicateEntries(seed.workingMemory.unknowns, (entry) => this.normalizeHintText(entry.description)),
        conflicts: this.deduplicateEntries(seed.workingMemory.conflicts, (entry) => this.normalizeHintText(entry.summary)),
        decisions: this.deduplicateEntries(
          seed.workingMemory.decisions,
          (entry) => `${this.normalizeHintText(entry.summary)}::${this.normalizeHintText(entry.rationale)}`
        )
      },
      projectStructure: {
        ...seed.projectStructure,
        directories: this.deduplicateEntries(seed.projectStructure.directories, (entry) => entry.path.trim()),
        keyFiles: this.deduplicateEntries(seed.projectStructure.keyFiles, (entry) => entry.path.trim()),
        entryPoints: this.deduplicateEntries(seed.projectStructure.entryPoints, (entry) => `${entry.path.trim()}::${entry.role.trim()}`),
        modules: this.deduplicateEntries(seed.projectStructure.modules, (entry) => entry.name.trim()),
        openQuestions: this.deduplicateEntries(seed.projectStructure.openQuestions, (entry) => this.normalizeHintText(entry.question)),
        contradictions: this.deduplicateEntries(seed.projectStructure.contradictions, (entry) => this.normalizeHintText(entry.summary))
      }
    };
  }

  private mergeSeedEntries<T>(primary: T[], supplemental: T[], keyFor: (entry: T) => string): T[] {
    const merged = new Map<string, T>();
    for (const entry of primary) {
      const key = keyFor(entry).trim();
      if (!key) {
        continue;
      }
      merged.set(key, entry);
    }
    for (const entry of supplemental) {
      const key = keyFor(entry).trim();
      if (!key || merged.has(key)) {
        continue;
      }
      merged.set(key, entry);
    }
    return [...merged.values()];
  }

  private deduplicateEntries<T>(entries: T[], keyFor: (entry: T) => string): T[] {
    const seen = new Set<string>();
    const deduplicated: T[] = [];
    for (const entry of entries) {
      const key = keyFor(entry).trim();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduplicated.push(entry);
    }
    return deduplicated;
  }

  private hasContinuationClues(seed: ContinuationSeed): boolean {
    return seed.evidenceBundles.length > 0
      || seed.workingMemory.facts.length > 0
      || seed.workingMemory.openQuestions.length > 0
      || seed.workingMemory.unknowns.length > 0
      || seed.workingMemory.conflicts.length > 0
      || seed.workingMemory.decisions.length > 0
      || seed.projectStructure.summary.trim().length > 0
      || seed.projectStructure.directories.length > 0
      || seed.projectStructure.keyFiles.length > 0
      || seed.projectStructure.entryPoints.length > 0
      || seed.projectStructure.modules.length > 0;
  }

  private writeOverviewFile(payload: WorkspaceContextCachePayload) {
    const lines = [
      "# TaskSaw Workspace Cache",
      "",
      "This directory is a shallow hint cache. If any note here conflicts with the real workspace, trust the real files.",
      "The canonical full-fidelity continuation seed is stored in .tasksaw/context.json.",
      "",
      `Updated at: ${payload.updatedAt}`,
      `Source run: ${payload.sourceRunId}`,
      ""
    ];

    if (payload.projectStructure.summary.trim().length > 0) {
      lines.push("## Project Summary", "", payload.projectStructure.summary.trim(), "");
    }

    this.appendPathSummary(lines, "Key Directories", payload.projectStructure.directories);
    this.appendPathSummary(lines, "Key Files", payload.projectStructure.keyFiles);
    this.appendEntryPointSummary(lines, payload.projectStructure.entryPoints);
    this.appendModuleSummary(lines, payload.projectStructure.modules);
    this.appendFactSummary(lines, payload.workingMemory.facts);
    this.appendDecisionSummary(lines, payload.workingMemory.decisions);

    fs.writeFileSync(path.join(this.cacheRoot, CACHE_OVERVIEW_FILE_NAME), `${lines.join("\n")}\n`, "utf8");
  }

  private appendPathSummary(lines: string[], title: string, entries: ProjectStructurePathEntry[]) {
    if (entries.length === 0) {
      return;
    }

    lines.push(`## ${title}`, "");
    for (const entry of entries) {
      lines.push(`- ${entry.path}: ${entry.summary}`);
    }
    lines.push("");
  }

  private appendEntryPointSummary(lines: string[], entries: ProjectStructureEntryPoint[]) {
    if (entries.length === 0) {
      return;
    }

    lines.push("## Entry Points", "");
    for (const entry of entries) {
      lines.push(`- ${entry.path} (${entry.role}): ${entry.summary}`);
    }
    lines.push("");
  }

  private appendModuleSummary(lines: string[], entries: ProjectStructureModule[]) {
    if (entries.length === 0) {
      return;
    }

    lines.push("## Modules", "");
    for (const entry of entries) {
      const relatedPaths = entry.relatedPaths.length > 0 ? ` [${entry.relatedPaths.join(", ")}]` : "";
      lines.push(`- ${entry.name}: ${entry.summary}${relatedPaths}`);
    }
    lines.push("");
  }

  private appendFactSummary(lines: string[], facts: WorkingMemoryFact[]) {
    if (facts.length === 0) {
      return;
    }

    lines.push("## Cached Facts", "");
    for (const fact of facts) {
      lines.push(`- ${fact.statement}`);
    }
    lines.push("");
  }

  private appendDecisionSummary(lines: string[], decisions: WorkingMemoryDecision[]) {
    if (decisions.length === 0) {
      return;
    }

    lines.push("## Cached Decisions", "");
    for (const decision of decisions) {
      lines.push(`- ${decision.summary}: ${decision.rationale}`);
    }
    lines.push("");
  }

  private writeMirroredHintFiles(payload: WorkspaceContextCachePayload) {
    const notes = new Map<string, NoteBuilder>();
    const addNoteSection = (sourcePath: string | undefined, sectionTitle: string, bodyLines: string[]) => {
      const notePath = this.buildMirroredNotePath(sourcePath, sectionTitle === "Directory");
      if (!notePath || bodyLines.length === 0) {
        return;
      }

      const existing = notes.get(notePath) ?? {
        sourcePath: sourcePath!,
        sections: []
      };
      existing.sections.push([`## ${sectionTitle}`, ...bodyLines].join("\n"));
      notes.set(notePath, existing);
    };

    for (const entry of payload.projectStructure.directories) {
      addNoteSection(entry.path, "Directory", [
        `Summary: ${entry.summary}`,
        `Confidence: ${entry.confidence}`
      ]);
    }

    for (const entry of payload.projectStructure.keyFiles) {
      addNoteSection(entry.path, "Key File", [
        `Summary: ${entry.summary}`,
        `Confidence: ${entry.confidence}`
      ]);
    }

    for (const entry of payload.projectStructure.entryPoints) {
      addNoteSection(entry.path, "Entry Point", [
        `Role: ${entry.role}`,
        `Summary: ${entry.summary}`,
        `Confidence: ${entry.confidence}`
      ]);
    }

    for (const module of payload.projectStructure.modules) {
      if (module.relatedPaths.length === 0) {
        continue;
      }

      for (const relatedPath of module.relatedPaths) {
        addNoteSection(relatedPath, "Module", [
          `Name: ${module.name}`,
          `Summary: ${module.summary}`,
          `Confidence: ${module.confidence}`
        ]);
      }
    }

    for (const [filePath, note] of notes) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        [
          "# TaskSaw Hint",
          "",
          `Source path: ${note.sourcePath}`,
          "Reference only. Real workspace files win on conflict.",
          "",
          ...note.sections
        ].join("\n") + "\n",
        "utf8"
      );
    }
  }

  private buildMirroredNotePath(sourcePath: string | undefined, isDirectory: boolean): string | undefined {
    const sanitizedRelativePath = this.sanitizeRelativePath(sourcePath);
    if (!sanitizedRelativePath) {
      return undefined;
    }

    return isDirectory
      ? path.join(this.cacheRoot, sanitizedRelativePath, ".tasksaw.md")
      : path.join(this.cacheRoot, `${sanitizedRelativePath}.tasksaw.md`);
  }

  private sanitizeRelativePath(candidate: string | undefined): string | undefined {
    if (!candidate) {
      return undefined;
    }

    const normalized = candidate.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized.length === 0) {
      return undefined;
    }

    const parts = normalized.split("/").filter((part) => part.length > 0);
    if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
      return undefined;
    }

    return path.join(...parts);
  }

  private parseMarkdownSectionBlocks(content: string): Array<{ title: string; lines: string[] }> {
    const blocks: Array<{ title: string; lines: string[] }> = [];
    let current: { title: string; lines: string[] } | undefined;
    for (const rawLine of content.split(/\r?\n/)) {
      if (rawLine.startsWith("## ")) {
        current = { title: rawLine.slice(3).trim(), lines: [] };
        blocks.push(current);
        continue;
      }
      current?.lines.push(rawLine);
    }
    return blocks;
  }

  private extractBulletItems(lines: string[]): string[] {
    return lines
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
  }

  private parsePathSummaryItem(item: string): { path: string; summary: string } | undefined {
    const separatorIndex = item.indexOf(":");
    if (separatorIndex <= 0) {
      return undefined;
    }
    const targetPath = item.slice(0, separatorIndex).trim();
    const summary = item.slice(separatorIndex + 1).trim();
    return targetPath && summary ? { path: targetPath, summary } : undefined;
  }

  private parseEntryPointItem(item: string): { path: string; role: string; summary: string } | undefined {
    const match = item.match(/^(.+?) \((.+?)\): (.+)$/);
    if (!match) {
      return undefined;
    }
    const [, targetPath, role, summary] = match;
    return {
      path: targetPath.trim(),
      role: role.trim(),
      summary: summary.trim()
    };
  }

  private parseModuleItem(item: string): { name: string; summary: string; relatedPaths: string[] } | undefined {
    const match = item.match(/^(.+?): (.+?)(?: \[(.+)\])?$/);
    if (!match) {
      return undefined;
    }
    const [, name, summary, relatedPathsRaw] = match;
    return {
      name: name.trim(),
      summary: summary.trim(),
      relatedPaths: relatedPathsRaw
        ? relatedPathsRaw.split(",").map((entry) => entry.trim()).filter(Boolean)
        : []
    };
  }

  private parseDecisionItem(item: string): { summary: string; rationale: string } | undefined {
    const separatorIndex = item.indexOf(":");
    if (separatorIndex <= 0) {
      return undefined;
    }
    const summary = item.slice(0, separatorIndex).trim();
    const rationale = item.slice(separatorIndex + 1).trim();
    return summary && rationale ? { summary, rationale } : undefined;
  }

  private parseSourcePath(content: string): string | undefined {
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("Source path:")) {
        continue;
      }
      const value = trimmed.slice("Source path:".length).trim();
      return value || undefined;
    }
    return undefined;
  }

  private deriveSourcePathFromHintPath(filePath: string): string | undefined {
    const relative = path.relative(this.cacheRoot, filePath).replace(/\\/g, "/");
    if (relative.endsWith(`/${CACHE_NOTE_FILE_NAME}`)) {
      return relative.slice(0, -(`/${CACHE_NOTE_FILE_NAME}`).length);
    }
    if (relative.endsWith(CACHE_NOTE_FILE_NAME)) {
      return relative.slice(0, -CACHE_NOTE_FILE_NAME.length);
    }
    return undefined;
  }

  private parseKeyValueLines(lines: string[]): Map<string, string> {
    const fields = new Map<string, string>();
    for (const line of lines) {
      const trimmed = line.trim();
      const separatorIndex = trimmed.indexOf(":");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key && value) {
        fields.set(key, value);
      }
    }
    return fields;
  }

  private parseConfidenceLevel(value: string | undefined): ConfidenceLevel {
    if (value === "high" || value === "mixed" || value === "medium" || value === "low") {
      return value;
    }
    return "medium";
  }

  private nextHintId(prefix: string, index: number): string {
    return `${prefix}-${index}`;
  }

  private pickLaterTimestamp(left: string, right: string): string {
    return this.timestampRank(left) >= this.timestampRank(right) ? left : right;
  }

  private normalizeHintText(value: string): string {
    return value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[`"'’“”]/g, "")
      .replace(/[()[\]{}:;,.!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private pickTop<T>(entries: T[], limit: number, score: (entry: T) => number): T[] {
    return [...entries]
      .sort((left, right) => score(right) - score(left))
      .slice(0, limit);
  }

  private confidenceRank(value: string): number {
    if (value === "high") return 4;
    if (value === "mixed") return 3;
    if (value === "medium") return 2;
    if (value === "low") return 1;
    return 0;
  }

  private timestampRank(value: string): number {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private writeJsonFile(filePath: string, value: unknown) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}
