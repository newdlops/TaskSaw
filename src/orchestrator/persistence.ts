import fs from "node:fs";
import path from "node:path";
import { createEmptyProjectStructureSnapshot } from "./project-structure-memory";
import { OrchestratorFinalReport, RunSnapshot } from "./types";

export class OrchestratorPersistence {
  constructor(private readonly rootDirectory: string) {
    fs.mkdirSync(this.rootDirectory, { recursive: true });
  }

  saveSnapshot(snapshot: RunSnapshot) {
    const runDirectory = this.getRunDirectory(snapshot.run.id);
    fs.mkdirSync(runDirectory, { recursive: true });

    this.writeJsonFile(path.join(runDirectory, "run.json"), snapshot.run);
    this.writeJsonFile(path.join(runDirectory, "nodes.json"), snapshot.nodes);
    this.writeJsonFile(path.join(runDirectory, "evidence.json"), snapshot.evidenceBundles);
    this.writeJsonFile(path.join(runDirectory, "working-memory.json"), snapshot.workingMemory);
    this.writeJsonFile(path.join(runDirectory, "project-structure.json"), snapshot.projectStructure);
    this.writeJsonFile(path.join(runDirectory, "events.json"), snapshot.events);

    if (snapshot.finalReport) {
      this.writeJsonFile(path.join(runDirectory, "final-report.json"), snapshot.finalReport);
    }
  }

  loadSnapshot(runId: string): RunSnapshot {
    const runDirectory = this.getRunDirectory(runId);
    const run = this.readJsonFile<RunSnapshot["run"]>(path.join(runDirectory, "run.json"));
    const workingMemory = this.readJsonFile<RunSnapshot["workingMemory"]>(path.join(runDirectory, "working-memory.json"));

    return {
      run,
      nodes: this.readJsonFile(path.join(runDirectory, "nodes.json")),
      evidenceBundles: this.readJsonFile(path.join(runDirectory, "evidence.json")),
      workingMemory,
      projectStructure: this.readOptionalJsonFile(path.join(runDirectory, "project-structure.json"))
        ?? createEmptyProjectStructureSnapshot(run.id, workingMemory.updatedAt),
      events: this.readJsonFile(path.join(runDirectory, "events.json")),
      finalReport: this.readOptionalJsonFile(path.join(runDirectory, "final-report.json"))
    };
  }

  saveFinalReport(report: OrchestratorFinalReport) {
    const runDirectory = this.getRunDirectory(report.runId);
    fs.mkdirSync(runDirectory, { recursive: true });
    this.writeJsonFile(path.join(runDirectory, "final-report.json"), report);
  }

  getRunDirectory(runId: string): string {
    return path.join(this.rootDirectory, runId);
  }

  private writeJsonFile(filePath: string, value: unknown) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  }

  private readOptionalJsonFile<T>(filePath: string): T | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    return this.readJsonFile<T>(filePath);
  }
}
