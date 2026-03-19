import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import { DirectoryDialogOptions } from "./types";

type ActiveScope = {
  refCount: number;
  stopAccessing: (() => void) | null;
};

type BookmarkStore = Record<string, string>;

export class WorkspaceAccessManager {
  private readonly bookmarkStorePath: string;
  private readonly bookmarks = new Map<string, string>();
  private readonly authorizedPaths = new Set<string>();
  private readonly activeScopes = new Map<string, ActiveScope>();

  constructor(userDataDirectory: string) {
    this.bookmarkStorePath = path.join(userDataDirectory, "workspace-bookmarks.json");
    this.loadBookmarks();
  }

  registerSelectedDirectory(selectedPath: string, bookmark?: string): string {
    const normalizedPath = this.normalizePath(selectedPath);
    this.authorizedPaths.add(normalizedPath);

    if (bookmark) {
      this.bookmarks.set(normalizedPath, bookmark);
      this.persistBookmarks();
    }

    return normalizedPath;
  }

  async acquireWorkspace(
    requestedPath: string,
    mainWindow: BrowserWindow,
    dialogOptions: DirectoryDialogOptions = {}
  ): Promise<string | null> {
    const normalizedRequestedPath = path.resolve(requestedPath);
    const bookmarkedPath = this.tryAcquireStoredBookmark(normalizedRequestedPath);
    if (bookmarkedPath) return bookmarkedPath;

    const normalizedExistingPath = this.tryNormalizePath(normalizedRequestedPath) ?? normalizedRequestedPath;
    if (this.authorizedPaths.has(normalizedExistingPath)) {
      return normalizedExistingPath;
    }

    const dialogResult = await dialog.showOpenDialog(mainWindow, {
      defaultPath: dialogOptions.defaultPath ?? normalizedRequestedPath,
      title: dialogOptions.title,
      buttonLabel: dialogOptions.buttonLabel,
      message: dialogOptions.message,
      properties: ["openDirectory", "createDirectory"],
      securityScopedBookmarks: process.platform === "darwin"
    });

    if (dialogResult.canceled) return null;

    const selectedPath = dialogResult.filePaths[0];
    if (!selectedPath) return null;

    const bookmark = dialogResult.bookmarks?.[0];
    const normalizedPath = this.registerSelectedDirectory(selectedPath, bookmark);

    if (!bookmark) {
      return normalizedPath;
    }

    return this.acquireWithBookmark(normalizedPath, bookmark);
  }

  releaseWorkspace(workspacePath: string) {
    const normalizedPath = this.tryNormalizePath(workspacePath) ?? path.resolve(workspacePath);
    const activeScope = this.activeScopes.get(normalizedPath);
    if (!activeScope) return;

    activeScope.refCount -= 1;
    if (activeScope.refCount > 0) return;

    activeScope.stopAccessing?.();
    this.activeScopes.delete(normalizedPath);
  }

  resetAllAccess() {
    for (const activeScope of this.activeScopes.values()) {
      activeScope.stopAccessing?.();
    }

    this.activeScopes.clear();
    this.authorizedPaths.clear();
    this.bookmarks.clear();
    fs.rmSync(this.bookmarkStorePath, { force: true });
  }

  private tryAcquireStoredBookmark(requestedPath: string): string | null {
    const bookmarkEntry = this.lookupBookmark(requestedPath);
    if (!bookmarkEntry) return null;

    const [bookmarkPath, bookmark] = bookmarkEntry;

    try {
      return this.acquireWithBookmark(bookmarkPath, bookmark);
    } catch {
      this.bookmarks.delete(bookmarkPath);
      this.persistBookmarks();
      return null;
    }
  }

  private acquireWithBookmark(bookmarkPath: string, bookmark: string): string {
    const existingScope = this.activeScopes.get(bookmarkPath);
    if (existingScope) {
      existingScope.refCount += 1;
      return bookmarkPath;
    }

    const stopAccessing = app.startAccessingSecurityScopedResource(bookmark);
    const normalizedPath = this.normalizePath(bookmarkPath);
    const currentScope = this.activeScopes.get(normalizedPath);

    if (currentScope) {
      currentScope.refCount += 1;
      stopAccessing?.();
      return normalizedPath;
    }

    this.authorizedPaths.add(normalizedPath);

    if (normalizedPath !== bookmarkPath) {
      this.bookmarks.delete(bookmarkPath);
      this.bookmarks.set(normalizedPath, bookmark);
      this.persistBookmarks();
    }

    this.activeScopes.set(normalizedPath, {
      refCount: 1,
      stopAccessing: typeof stopAccessing === "function" ? () => stopAccessing() : null
    });

    return normalizedPath;
  }

  private lookupBookmark(targetPath: string): [string, string] | null {
    const exactMatch = this.bookmarks.get(targetPath);
    if (exactMatch) return [targetPath, exactMatch];

    const normalizedPath = this.tryNormalizePath(targetPath);
    if (!normalizedPath || normalizedPath === targetPath) return null;

    const normalizedMatch = this.bookmarks.get(normalizedPath);
    return normalizedMatch ? [normalizedPath, normalizedMatch] : null;
  }

  private normalizePath(targetPath: string): string {
    return this.tryNormalizePath(targetPath) ?? path.resolve(targetPath);
  }

  private tryNormalizePath(targetPath: string): string | null {
    try {
      return fs.realpathSync(targetPath);
    } catch {
      return null;
    }
  }

  private loadBookmarks() {
    try {
      if (!fs.existsSync(this.bookmarkStorePath)) return;

      const fileText = fs.readFileSync(this.bookmarkStorePath, "utf8");
      const bookmarkStore = JSON.parse(fileText) as BookmarkStore;

      for (const [workspacePath, bookmark] of Object.entries(bookmarkStore)) {
        if (typeof bookmark !== "string" || bookmark.length === 0) continue;
        this.bookmarks.set(workspacePath, bookmark);
      }
    } catch {
      this.bookmarks.clear();
    }
  }

  private persistBookmarks() {
    const bookmarkStore = Object.fromEntries(this.bookmarks.entries());
    fs.writeFileSync(this.bookmarkStorePath, `${JSON.stringify(bookmarkStore, null, 2)}\n`);
  }
}
