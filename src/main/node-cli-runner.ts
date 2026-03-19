import path from "node:path";
import { pathToFileURL } from "node:url";

const dynamicImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<unknown>;

async function main() {
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
  await dynamicImport(pathToFileURL(resolvedEntryPath).href);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
