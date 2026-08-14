import { describe, expect, it } from "vitest";
import { GAMEPLAY_CONFIG, PRESENTATION_CONFIG, parseHexColor } from "./GameConfig";

describe("game configuration", () => {
  it("loads coherent gameplay and presentation tuning", () => {
    expect(GAMEPLAY_CONFIG.scout.marchStartHour).toBeLessThan(
      GAMEPLAY_CONFIG.scout.marchEndHour,
    );
    expect(PRESENTATION_CONFIG.settings.languages).toContain(
      PRESENTATION_CONFIG.settings.defaultLanguage,
    );
    expect(PRESENTATION_CONFIG.renderer.antialias).toBe(true);
  });

  it("parses author-facing CSS colors and rejects ambiguous notation", () => {
    expect(parseHexColor("#2b2d2c")).toBe(0x2b2d2c);
    expect(() => parseHexColor("#fff")).toThrow(/#rrggbb/);
  });
});
