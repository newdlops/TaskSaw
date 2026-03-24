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
// [디버깅 추가] gemini-cli가 출력하려는 모든 내용을 캡처해서 확인
  const originalWrite = process.stdout.write.bind(process.stdout);

// TS 에러를 피하기 위해 any 타입의 가변 인자로 받아서 그대로 넘겨줍니다.
  process.stdout.write = (...args: any[]): boolean => {
    const chunk = args[0];
    if (chunk) {
      // 터미널뿐만 아니라 확실히 볼 수 있게 로그 파일로 빼거나 에러 스트림으로 출력
      process.stderr.write(`[CLI 캡처]: ${chunk.toString()}\n`);
    }
    return (originalWrite as any)(...args);
  };

  await dynamicImport(pathToFileURL(resolvedEntryPath).href);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
