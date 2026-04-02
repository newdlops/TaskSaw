import fs from 'fs';
import path from 'path';

// 1. Mock matchMedia FIRST because it's used in index.html's inline script
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// 2. Mock localStorage with initial workspace path
const localStorageMock = (function() {
  let store: Record<string, string> = {
    'tasksaw-last-workspace': '/test/workspace'
  };
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: jest.fn((index: number) => Object.keys(store)[index] || null),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

// 3. Mock tasksaw API BEFORE loading HTML/App
const handlers = {
  onTerminalData: null as ((...args: any[]) => void) | null,
  onTerminalExit: null as ((...args: any[]) => void) | null,
  onOrchestratorEvent: null as ((...args: any[]) => void) | null,
  onToolsProgress: null as ((...args: any[]) => void) | null,
};
(window as any).handlers = handlers;

const tasksawMock = {
  createSession: jest.fn(),
  listSessions: jest.fn().mockResolvedValue([]),
  updateManagedTools: jest.fn().mockResolvedValue([]),
  getManagedToolStatuses: jest.fn().mockResolvedValue([]),
  resetAppState: jest.fn(),
  runOrchestrator: jest.fn().mockResolvedValue({ runId: 'run-1' }),
  cancelOrchestratorRun: jest.fn().mockResolvedValue(true),
  respondOrchestratorApproval: jest.fn(),
  respondOrchestratorUserInput: jest.fn(),
  respondOrchestratorInteractiveSession: jest.fn(),
  listOrchestratorRuns: jest.fn().mockResolvedValue([]),
  getOrchestratorRun: jest.fn(),
  clearWorkspaceCache: jest.fn().mockResolvedValue(undefined),
  selectDirectory: jest.fn().mockResolvedValue('/test/workspace'),
  createDirectory: jest.fn(),
  writeTerminal: jest.fn(),
  resizeTerminal: jest.fn(),
  killSession: jest.fn(),
  onTerminalData: jest.fn((handler: (...args: any[]) => void) => {
    handlers.onTerminalData = handler;
  }),
  onTerminalExit: jest.fn((handler: (...args: any[]) => void) => {
    handlers.onTerminalExit = handler;
  }),
  onOrchestratorEvent: jest.fn((handler: (...args: any[]) => void) => {
    handlers.onOrchestratorEvent = handler;
  }),
  onToolsProgress: jest.fn((handler: (...args: any[]) => void) => {
    handlers.onToolsProgress = handler;
  }),
  openExternal: jest.fn(),
};
(window as any).tasksaw = tasksawMock;

// 4. Load HTML content (this triggers inline scripts)
const html = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf8');
document.write(html);
document.close();

// 5. Additional mocks
(window as any).HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
  measureText: jest.fn().mockImplementation((text) => ({
    width: (parseInt(window.getComputedStyle(document.body).fontSize) || 14) * 0.6
  })),
  fillText: jest.fn(),
  strokeText: jest.fn(),
  getImageData: jest.fn().mockReturnValue({ data: new Uint8ClampedArray() }),
  createImageData: jest.fn(),
  setTransform: jest.fn(),
  drawImage: jest.fn(),
  save: jest.fn(),
  restore: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  stroke: jest.fn(),
  fill: jest.fn(),
  arc: jest.fn(),
  closePath: jest.fn(),
});

(window as any).Terminal = class {
  options: any = {
    fontSize: 14,
    fontFamily: 'monospace',
    scrollback: 1000,
    theme: {}
  };
  open = jest.fn();
  write = jest.fn();
  dispose = jest.fn();
  loadAddon = jest.fn();
  onData = jest.fn().mockReturnValue({ dispose: jest.fn() });
  onResize = jest.fn().mockReturnValue({ dispose: jest.fn() });
  reset = jest.fn();
  clear = jest.fn();
  focus = jest.fn();
  blur = jest.fn();
  resize = jest.fn();
  scrollLines = jest.fn();
  getSelection = jest.fn().mockReturnValue('');
};
(window as any).Terminal.prototype.write = jest.fn();
(window as any).Terminal.prototype.open = jest.fn();
(window as any).Terminal.prototype.resize = jest.fn();
(window as any).Terminal.prototype.onData = jest.fn().mockReturnValue({ dispose: jest.fn() });
(window as any).Terminal.prototype.getSelection = jest.fn().mockReturnValue('');

(window as any).Notification = class {
  title: string;
  options: any;
  constructor(title: string, options?: any) {
    this.title = title;
    this.options = options;
  }
  static permission = 'granted';
  static requestPermission = jest.fn().mockResolvedValue('granted');
};
