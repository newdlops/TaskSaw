import path from "node:path";
import { pathToFileURL } from "node:url";

const dynamicImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<unknown>;

async function main() {
  if (process.env.TASKSAW_AGENT_INCEPTION_DETECTED) {
    process.stderr.write("[TASKSAW] Agent Inception detected! Refusing to run another TaskSaw instance within this context to prevent infinite loops.\n");
    process.exit(1);
  }
  process.env.TASKSAW_AGENT_INCEPTION_DETECTED = "1";

  const [, , entryPath, ...cliArgs] = process.argv;
  if (!entryPath) {
    throw new Error("TaskSaw node CLI runner requires an entry path");
  }

  Object.defineProperty(process, "defaultApp", {
    configurable: true,
    value: true
  });

  const resolvedEntryPath = path.resolve(entryPath);
  process.argv = [process.execPath, resolvedEntryPath, ...cliArgs];

  // Optimization: Do NOT intercept stdout when in --acp mode.
  // The ACP protocol handles its own streaming via stdout; duplicating it to stderr
  // causes unnecessary string processing overhead and can interfere with the protocol timing.
  if (!process.argv.includes("--acp")) {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: any, encoding?: any, callback?: any): boolean => {
      if (chunk) {
        process.stderr.write(chunk);
      }
      return originalWrite(chunk, encoding, callback);
    };
  }

  await dynamicImport(pathToFileURL(resolvedEntryPath).href);
}


void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
