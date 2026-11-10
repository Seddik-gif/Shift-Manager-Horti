import { describe, expect, it } from "vitest";
import { isDesktopClient } from "@/lib/desktop";

describe("recognising the Windows desktop app", () => {
  const shell = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0 HortiDesktop/0.1.0";
  it("matches the shell's user agent", () => {
    expect(isDesktopClient(shell)).toBe(true);
  });
  it("does not match ordinary browsers, empty values or look-alikes", () => {
    expect(isDesktopClient("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1")).toBe(false);
    expect(isDesktopClient("Mozilla/5.0 Chrome/130 Edg/130")).toBe(false);
    expect(isDesktopClient("HortiDesktop")).toBe(false);
    expect(isDesktopClient("XHortiDesktop/1")).toBe(false);
    expect(isDesktopClient(null)).toBe(false);
    expect(isDesktopClient(undefined)).toBe(false);
    expect(isDesktopClient("")).toBe(false);
  });
});
