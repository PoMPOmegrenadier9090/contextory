import { afterEach, describe, expect, it, vi } from "vitest";
import { createScrollVisibilityController } from "./floating-actions.js";

afterEach(() => vi.useRealTimers());

describe("floating action visibility", () => {
  it("hides while moving down and waits for upward movement to stop", () => {
    vi.useFakeTimers();
    const visible = vi.fn();
    const controller = createScrollVisibilityController(visible, 100);
    controller.scroll(160);
    expect(visible).toHaveBeenLastCalledWith(false);
    controller.scroll(155);
    vi.advanceTimersByTime(200);
    expect(visible).toHaveBeenLastCalledWith(false);
    controller.scroll(145);
    vi.advanceTimersByTime(100);
    controller.scroll(130);
    vi.advanceTimersByTime(179);
    expect(visible).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(1);
    expect(visible).toHaveBeenLastCalledWith(true);
    controller.dispose();
  });

  it("cancels a pending reveal if downward scrolling resumes", () => {
    vi.useFakeTimers();
    const visible = vi.fn();
    const controller = createScrollVisibilityController(visible, 100);
    controller.scroll(80);
    controller.scroll(90);
    vi.advanceTimersByTime(300);
    expect(visible).toHaveBeenCalledExactlyOnceWith(false);
    controller.scroll(-10);
    expect(visible).toHaveBeenLastCalledWith(true);
    controller.dispose();
  });

  it("does not reveal after disposal", () => {
    vi.useFakeTimers();
    const visible = vi.fn();
    const controller = createScrollVisibilityController(visible, 100);
    controller.scroll(80);
    controller.dispose();
    vi.advanceTimersByTime(300);
    expect(visible).not.toHaveBeenCalled();
  });
});
