import fs from "node:fs";
import path from "node:path";
import { createEmptyProjectStructureSnapshot } from "./project-structure-memory";
import { createEmptyWorkingMemorySnapshot } from "./working-memory";
import {
  ContinuationSeed,
  ProjectStructureEntryPoint,
  ProjectStructureModule,
  ProjectStructurePathEntry,
  ProjectStructureSnapshot,
  RunSnapshot,
  WorkingMemoryDecision,
  WorkingMemoryFact,
  WorkingMemorySnapshot
} from "./types";

const CACHE_VERSION = 1;
const CACHE_DIRECTORY_NAME = ".tasksaw";
const CACHE_CONTEXT_FILE_NAME = "context.json";
const CACHE_OVERVIEW_FILE_NAME = "README.md";
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
    if (!payload) {
      return undefined;
    }

    return {
      sourceRunId: payload.sourceRunId,
      evidenceBundles: [],
      workingMemory: payload.workingMemory,
      projectStructure: payload.projectStructure
    };
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

    fs.rmSync(this.cacheRoot, { recursive: true, force: true });
    fs.mkdirSync(this.cacheRoot, { recursive: true });

    this.writeJsonFile(path.join(this.cacheRoot, CACHE_CONTEXT_FILE_NAME), payload);
    this.writeOverviewFile(payload);
    this.writeMirroredHintFiles(payload);
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
        workingMemory: payload.workingMemory ?? createEmptyWorkingMemorySnapshot(sourceRunId, updatedAt),
        projectStructure: payload.projectStructure ?? createEmptyProjectStructureSnapshot(sourceRunId, updatedAt)
      };
    } catch {
      return undefined;
    }
  }

  private buildPayload(snapshot: RunSnapshot): WorkspaceContextCachePayload {
    const updatedAt = snapshot.projectStructure.updatedAt
      || snapshot.workingMemory.updatedAt
      || snapshot.run.updatedAt;

    return {
      version: CACHE_VERSION,
      updatedAt,
      sourceRunId: snapshot.run.id,
      workingMemory: this.trimWorkingMemory(snapshot.workingMemory, updatedAt),
      projectStructure: this.trimProjectStructure(snapshot.projectStructure, updatedAt)
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
    return payload.projectStructure.summary.trim().length > 0
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

  private writeOverviewFile(payload: WorkspaceContextCachePayload) {
    const lines = [
      "# TaskSaw Workspace Cache",
      "",
      "This directory is a shallow hint cache. If any note here conflicts with the real workspace, trust the real files.",
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
