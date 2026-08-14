import { describe, expect, it } from "vitest";
import {
  CULTURE_PALETTE,
  saturateCultureColor,
} from "../culture/CulturePalette";
import {
  CULTURE_BORDER_COLOR,
  CULTURE_MAP_STYLE,
  cultureBilinearGlsl,
  cultureEdgeGlsl,
  cultureMapStrokeWidth,
} from "./CultureMapStyle";

describe("culture map presentation", () => {
  it("uses a uniform black culture delimiter", () => {
    expect(CULTURE_MAP_STYLE.borderWidth).toBeGreaterThanOrEqual(3);
    expect(CULTURE_BORDER_COLOR).toBe(0x000000);
  });

  it("makes a hovered culture visibly stronger than an idle culture", () => {
    expect(CULTURE_MAP_STYLE.hoverFillAlpha).toBeGreaterThan(
      CULTURE_MAP_STYLE.fillAlpha,
    );
    expect(CULTURE_MAP_STYLE.hoverColorMix).toBeGreaterThan(0);
  });

  it("keeps the relief readable beneath culture selection", () => {
    expect(CULTURE_MAP_STYLE.atlasCultureDimAlpha).toBeLessThanOrEqual(0.15);
    expect(CULTURE_MAP_STYLE.fillAlpha).toBeLessThanOrEqual(0.25);
    expect(CULTURE_MAP_STYLE.selectedFillAlpha).toBeLessThanOrEqual(0.6);
    expect(CULTURE_MAP_STYLE.regionalTheaterFillAlpha).toBeLessThanOrEqual(0.24);
  });

  it("keeps every regional culture tint visibly chromatic over neutral relief", () => {
    const terrainChannel = 0.64;
    for (const color of CULTURE_PALETTE) {
      const saturated = saturateCultureColor(
        color,
        CULTURE_MAP_STYLE.culturePickerSaturation,
      );
      const channels = [
        saturated >>> 16 & 0xff,
        saturated >>> 8 & 0xff,
        saturated & 0xff,
      ].map(
        (channel) =>
          terrainChannel * (1 - CULTURE_MAP_STYLE.regionalTheaterFillAlpha) +
          channel / 255 * CULTURE_MAP_STYLE.regionalTheaterFillAlpha,
      );
      expect(Math.max(...channels) - Math.min(...channels)).toBeGreaterThanOrEqual(
        0.04,
      );
    }
  });

  it("keeps the Atlas theater tint identical to the regional filter tint", () => {
    expect(CULTURE_MAP_STYLE.fillAlpha).toBe(
      CULTURE_MAP_STYLE.regionalTheaterFillAlpha,
    );
    expect(CULTURE_MAP_STYLE.theaterFillAlpha).toBe(
      CULTURE_MAP_STYLE.regionalTheaterFillAlpha,
    );
    expect(CULTURE_MAP_STYLE.selectedFillAlpha).toBe(
      CULTURE_MAP_STYLE.regionalTheaterFillAlpha,
    );
  });

  it("feathers Culture Field brightness and opacity toward its edges", () => {
    expect(CULTURE_MAP_STYLE.edgeWidthPixels).toBeGreaterThanOrEqual(5);
    expect(CULTURE_MAP_STYLE.edgeWidthPixels).toBeLessThanOrEqual(8);
    expect(CULTURE_MAP_STYLE.edgeColorMix).toBeGreaterThanOrEqual(0.95);
    expect(CULTURE_MAP_STYLE.edgeColorMix).toBeLessThanOrEqual(1);
    const terrainLuminance = 0.62;
    const whiteEdgeLuminance =
      terrainLuminance * (1 - CULTURE_MAP_STYLE.edgeFillAlpha) +
      CULTURE_MAP_STYLE.edgeFillAlpha;
    expect(whiteEdgeLuminance - terrainLuminance).toBeGreaterThanOrEqual(0.14);
    const shader = cultureEdgeGlsl();
    expect(shader).toContain("uCultureEdgeStep");
    expect(shader.match(/cultureRingDifference\(center, uv,/g)).toHaveLength(5);
    expect(shader).toContain("smoothstep(0.0, 1.0, feather)");
    expect(shader).not.toContain("fwidth");
  });

  it("anti-aliases categorical tints without linearly filtering culture IDs", () => {
    const shader = cultureBilinearGlsl();
    expect(shader).toContain("uCultureTexelSize");
    expect(shader).toContain("smoothstep");
    expect(shader.match(/cultureAt\(/g)).toHaveLength(4);
  });

  it("uses a fine Atlas line at fit and reaches full weight when zoomed in", () => {
    const fit = cultureMapStrokeWidth(1);
    const close = cultureMapStrokeWidth(8);

    expect(fit).toBeLessThan(close);
    expect(close).toBe(CULTURE_MAP_STYLE.borderWidth);
  });
});
