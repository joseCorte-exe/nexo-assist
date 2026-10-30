import { describe, expect, it } from "vitest";
import { confirmShortcut } from "./shortcut";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";

describe("confirmShortcut", () => {
  it("is ⌘↵ on Apple systems, as the design draws it", () => {
    expect(confirmShortcut({ platform: '"macOS"', userAgent: MAC })).toEqual({ label: "⌘↵", keys: "Meta+Enter" });
    expect(confirmShortcut({ platform: null, userAgent: MAC })).toEqual({ label: "⌘↵", keys: "Meta+Enter" });
    expect(confirmShortcut({ platform: null, userAgent: IPHONE }).keys).toBe("Meta+Enter");
  });

  it("is Ctrl ↵ everywhere else", () => {
    expect(confirmShortcut({ platform: '"Windows"', userAgent: WINDOWS })).toEqual({ label: "Ctrl ↵", keys: "Control+Enter" });
    expect(confirmShortcut({ platform: '"Android"', userAgent: ANDROID }).keys).toBe("Control+Enter");
    expect(confirmShortcut({ platform: null, userAgent: null }).keys).toBe("Control+Enter");
  });

  it("believes the platform hint over the user agent, which some browsers freeze", () => {
    expect(confirmShortcut({ platform: '"Windows"', userAgent: MAC }).keys).toBe("Control+Enter");
  });
});
