import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { shell } from "electron";

type BrowserBridgeRequest = {
  url?: string;
};

export class BrowserBridge {
  private server: http.Server | null = null;
  private endpointUrl: string | null = null;
  private readonly token = randomUUID();
  private readonly recentlyOpenedAt = new Map<string, number>();

  constructor() {}

  async start() {
    if (this.server && this.endpointUrl) return;

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error("Browser bridge server was not initialized"));
        return;
      }

      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Browser bridge failed to determine its listen address"));
          return;
        }

        this.endpointUrl = `http://127.0.0.1:${address.port}/open-external`;
        server.removeListener("error", reject);
        resolve();
      });
    });
  }

  async stop() {
    if (!this.server) return;

    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });

    this.server = null;
    this.endpointUrl = null;
  }

  isStarted(): boolean {
    return this.endpointUrl !== null;
  }

  getEndpointUrl(): string {
    if (!this.endpointUrl) {
      throw new Error("Browser bridge has not been started");
    }

    return this.endpointUrl;
  }

  getToken(): string {
    return this.token;
  }

  async openExternal(rawUrl: string): Promise<boolean> {
    const targetUrl = this.normalizeTargetUrl(rawUrl);
    if (this.shouldSuppressDuplicateOpen(targetUrl)) {
      return false;
    }
    await shell.openExternal(targetUrl.toString());
    return true;
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    if (request.method !== "POST" || request.url !== "/open-external") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"ok":false,"error":"not_found"}');
      return;
    }

    if (request.headers["x-tasksaw-token"] !== this.token) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end('{"ok":false,"error":"forbidden"}');
      return;
    }

    try {
      const payload = await this.readJsonBody(request);
      const targetUrl = this.normalizeTargetUrl(payload.url ?? "");

      if (this.shouldSuppressDuplicateOpen(targetUrl)) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true,"suppressed":true}');
        return;
      }

      await shell.openExternal(targetUrl.toString());

      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: message }));
    }
  }

  private readJsonBody(request: http.IncomingMessage): Promise<BrowserBridgeRequest> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16 * 1024) {
          reject(new Error("Request body is too large"));
          request.destroy();
          return;
        }

        chunks.push(chunk);
      });

      request.on("end", () => {
        try {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          resolve(rawBody ? JSON.parse(rawBody) as BrowserBridgeRequest : {});
        } catch (error) {
          reject(error);
        }
      });

      request.on("error", reject);
    });
  }

  private normalizeTargetUrl(rawUrl: string): URL {
    let targetUrl: URL;

    try {
      targetUrl = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid browser URL: ${rawUrl}`);
    }

    if (!["http:", "https:"].includes(targetUrl.protocol)) {
      throw new Error(`Unsupported browser URL protocol: ${targetUrl.protocol}`);
    }

    return targetUrl;
  }

  private shouldSuppressDuplicateOpen(targetUrl: URL): boolean {
    const dedupeKey = this.buildDedupeKey(targetUrl);

    const now = Date.now();
    for (const [key, openedAt] of this.recentlyOpenedAt) {
      if (now - openedAt > 15_000) {
        this.recentlyOpenedAt.delete(key);
      }
    }

    const previousOpenedAt = this.recentlyOpenedAt.get(dedupeKey);
    if (previousOpenedAt && now - previousOpenedAt < 15_000) {
      return true;
    }

    this.recentlyOpenedAt.set(dedupeKey, now);
    return false;
  }

  private buildDedupeKey(targetUrl: URL): string {
    return `url:${targetUrl.toString()}`;
  }
}
