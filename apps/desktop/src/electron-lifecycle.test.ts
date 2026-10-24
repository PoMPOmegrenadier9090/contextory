import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  app: { on: vi.fn(), once: vi.fn(), quit: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn() },
}));
vi.mock("electron", () => electron);

import { registerDesktopLifecycle } from "./electron-lifecycle.js";

let events: EventEmitter;
const tick = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();
  events = new EventEmitter();
  electron.app.on.mockImplementation(
    (name: string, handler: (...args: unknown[]) => void) =>
      events.on(name, handler),
  );
  electron.app.once.mockImplementation(
    (name: string, handler: (...args: unknown[]) => void) =>
      events.once(name, handler),
  );
  electron.BrowserWindow.getAllWindows.mockReturnValue([]);
});

const setup = (closeVault = vi.fn(() => Promise.resolve())) => {
  const createWindow = vi.fn(() => Promise.resolve({} as BrowserWindow));
  const unregisterIpc = vi.fn();
  registerDesktopLifecycle(createWindow, closeVault, unregisterIpc);
  return { createWindow, closeVault, unregisterIpc };
};

describe("desktop quit lifecycle", () => {
  it("keeps the Vault and IPC available when a window cancels quitting", async () => {
    const lifecycle = setup();
    events.emit("before-quit", { preventDefault: vi.fn() });
    // A cancelled window close never reaches will-quit. On macOS the user
    // can later close the window and activate the still-running app again.
    events.emit("activate");
    await tick();
    expect(lifecycle.closeVault).not.toHaveBeenCalled();
    expect(lifecycle.unregisterIpc).not.toHaveBeenCalled();
    expect(lifecycle.createWindow).toHaveBeenCalledOnce();
  });

  it("drains the Vault once and prevents reopening windows during shutdown", async () => {
    let finishClose!: () => void;
    const closing = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const lifecycle = setup(vi.fn(() => closing));
    const first = { preventDefault: vi.fn() };
    const repeated = { preventDefault: vi.fn() };
    events.emit("will-quit", first);
    events.emit("will-quit", repeated);
    events.emit("activate");
    await tick();
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(repeated.preventDefault).toHaveBeenCalledOnce();
    expect(lifecycle.closeVault).toHaveBeenCalledOnce();
    expect(lifecycle.createWindow).not.toHaveBeenCalled();
    expect(electron.app.quit).not.toHaveBeenCalled();
    expect(lifecycle.unregisterIpc).not.toHaveBeenCalled();

    finishClose();
    await tick();
    await tick();
    expect(electron.app.quit).toHaveBeenCalledOnce();
    const resumed = { preventDefault: vi.fn() };
    events.emit("will-quit", resumed);
    expect(resumed.preventDefault).not.toHaveBeenCalled();
    expect(lifecycle.unregisterIpc).not.toHaveBeenCalled();
    events.emit("quit");
    expect(lifecycle.unregisterIpc).toHaveBeenCalledOnce();
  });

  it("reports cleanup failures and still lets the process terminate", async () => {
    const error = new Error("Vault close failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const lifecycle = setup(vi.fn(() => Promise.reject(error)));
      events.emit("will-quit", { preventDefault: vi.fn() });
      await tick();
      await tick();
      expect(log).toHaveBeenCalledWith("Vault could not be closed", error);
      expect(electron.app.quit).toHaveBeenCalledOnce();
      events.emit("quit");
      expect(lifecycle.unregisterIpc).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});
