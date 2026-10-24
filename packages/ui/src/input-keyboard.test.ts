import { describe, expect, it, vi } from "vitest";
import { blurOnInputExit } from "./input-keyboard.js";

describe("property input confirmation", () => {
  it("keeps focus during Japanese IME confirmation, then commits once on Enter", () => {
    const blur = vi.fn();
    const event = {
      key: "Enter",
      currentTarget: { blur },
      preventDefault: vi.fn(),
      nativeEvent: { isComposing: true, keyCode: 13 },
    };
    blurOnInputExit(event);
    blurOnInputExit({
      ...event,
      nativeEvent: { isComposing: false, keyCode: 229 },
    });
    expect(blur).not.toHaveBeenCalled();
    blurOnInputExit({
      ...event,
      nativeEvent: { isComposing: false, keyCode: 13 },
    });
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it("lets Escape leave an input, and leaves other keys alone", () => {
    const blur = vi.fn();
    const event = {
      key: "ArrowRight",
      currentTarget: { blur },
      preventDefault: vi.fn(),
      nativeEvent: { isComposing: false, keyCode: 39 },
    };
    blurOnInputExit(event);
    expect(blur).not.toHaveBeenCalled();
    blurOnInputExit({ ...event, key: "Escape" });
    expect(blur).toHaveBeenCalledTimes(1);
  });
});
