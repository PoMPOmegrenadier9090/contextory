import { describe, expect, it } from "vitest";
import {
  APP_COMMANDS,
  commandKeys,
  conflictingCommands,
  normalizeShortcut,
  parseKeybindingOverrides,
  resolvedShortcut,
  shortcutFromEvent,
  shortcutProblem,
} from "./app-commands.js";

const event = (key: string, options = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...options,
});
describe("application keybindings", () => {
  it("matches the primary modifier for each platform without treating Ctrl as Cmd on Mac", () => {
    expect(
      shortcutFromEvent(event("S", { metaKey: true, shiftKey: true }), "mac"),
    ).toBe("Mod+Shift+s");
    expect(shortcutFromEvent(event("s", { ctrlKey: true }), "mac")).toBe(
      "Ctrl+s",
    );
    expect(shortcutFromEvent(event("s", { ctrlKey: true }), "other")).toBe(
      "Mod+s",
    );
    expect(resolvedShortcut("Mod+Shift+s", "mac")).toBe(
      resolvedShortcut("Shift+Meta+s", "mac"),
    );
    expect(resolvedShortcut("Mod+s", "other")).toBe(
      resolvedShortcut("Ctrl+s", "other"),
    );
  });
  it("rejects typing keys and malformed bindings, while supporting function and punctuation keys", () => {
    for (const key of [
      "s",
      "Shift+s",
      "Mod+",
      "Mod+Mod+s",
      "Mod+Ctrl+s",
      "Mod+Unknown",
      "Mod+Dead",
      "Control+s",
    ])
      expect(normalizeShortcut(key)).toBeNull();
    expect(normalizeShortcut("Shift+Mod+S")).toBe("Mod+Shift+s");
    expect(normalizeShortcut("F6")).toBe("F6");
    expect(shortcutFromEvent(event(",", { metaKey: true }), "mac")).toBe(
      "Mod+,",
    );
    expect(
      shortcutFromEvent(event("+", { ctrlKey: true, shiftKey: true }), "other"),
    ).toBe("Mod+Shift+Plus");
    expect(
      shortcutFromEvent(event("Shift", { shiftKey: true }), "mac"),
    ).toBeNull();
    expect(shortcutProblem("Meta+f", "mac")).toContain("本文編集");
    expect(shortcutProblem("Ctrl+z", "other")).toContain("本文編集");
  });
  it("retains explicit unassignment and supplies new defaults when overrides are missing", () => {
    const overrides = parseKeybindingOverrides(
      JSON.stringify({
        version: 1,
        keybindings: {
          "document.save": [],
          "capture.open": ["Shift+Mod+C", "Mod+Shift+c"],
          "tab.new": ["t"],
          "unknown.operation": ["Mod+j"],
        },
      }),
    );
    expect(overrides).toEqual({
      "document.save": [],
      "capture.open": ["Mod+Shift+c"],
    });
    expect(commandKeys(APP_COMMANDS[0], overrides, "mac")).toEqual([]);
    expect(commandKeys(APP_COMMANDS[1], overrides, "other")).toEqual(["Mod+k"]);
    expect(commandKeys(APP_COMMANDS[5], {}, "other")).toEqual([]);
    expect(commandKeys(APP_COMMANDS[5], {}, "mac")).toEqual(["Meta+ArrowLeft"]);
    for (const raw of [
      "broken",
      "null",
      "[]",
      '{"version":2,"keybindings":{}}',
    ])
      expect(parseKeybindingOverrides(raw)).toEqual({});
  });
  it("detects conflicts across overlapping scopes and equivalent platform modifiers", () => {
    expect(conflictingCommands("document.save", ["Meta+k"], {}, "mac")).toEqual(
      ["quickOpen.open"],
    );
    expect(
      conflictingCommands("document.save", ["Mod+ArrowLeft"], {}, "mac"),
    ).toEqual(["navigation.back"]);
    expect(
      conflictingCommands(
        "document.save",
        ["Mod+k"],
        { "quickOpen.open": [] },
        "mac",
      ),
    ).toEqual([]);
    for (const platform of ["mac", "other"] as const)
      for (const command of APP_COMMANDS)
        expect(
          conflictingCommands(
            command.id,
            commandKeys(command, {}, platform),
            {},
            platform,
          ),
        ).toEqual([]);
  });
});
