import { describe, expect, it } from "vitest";
import {
  CULTURE_PALETTE,
  culturePaletteColor,
  culturePaletteGlsl,
  saturateCultureColor,
} from "./CulturePalette";
import { CULTURE_MAP_STYLE } from "../map/CultureMapStyle";
import cultures from "../../public/maps/cultures/manifest.json";
import borders from "../../public/maps/cultures/borders.json";

function rgbDistance(first: number, second: number): number {
  const red = (first >>> 16 & 0xff) - (second >>> 16 & 0xff);
  const green = (first >>> 8 & 0xff) - (second >>> 8 & 0xff);
  const blue = (first & 0xff) - (second & 0xff);
  return Math.hypot(red, green, blue);
}

describe("shared Culture palette", () => {
  it("provides the Atlas colors to every Culture presentation", () => {
    expect(CULTURE_PALETTE).toHaveLength(cultures.cultures.length);
    expect(culturePaletteColor(1)).toBe(0x6a727f);
    expect(culturePaletteColor(2)).toBe(0x766261);
    expect(culturePaletteColor(6)).toBe(0x87978b);
    expect(culturePaletteGlsl()).toContain("vec3 cultureColor(float index)");
    expect(CULTURE_MAP_STYLE.culturePickerSaturation).toBe(32);
  });

  it("keeps neighboring western European cultures distinct after display saturation", () => {
    const displayed = (cultureIndex: number) =>
      saturateCultureColor(
        culturePaletteColor(cultureIndex),
        CULTURE_MAP_STYLE.culturePickerSaturation,
      );
    const atlanticCeltic = displayed(1);
    const continentalGermanic = displayed(2);
    const westernMediterranean = displayed(6);

    for (const [first, second] of [
      [atlanticCeltic, continentalGermanic],
      [atlanticCeltic, westernMediterranean],
      [continentalGermanic, westernMediterranean],
    ]) {
      expect(rgbDistance(first!, second!)).toBeGreaterThanOrEqual(100);
    }
  });

  it("keeps every pair of bordering cultures perceptually separated", () => {
    const checkedPairs = new Set<string>();
    for (const path of borders.paths) {
      const [firstIndex, secondIndex] = path.cultures;
      const key = `${firstIndex}:${secondIndex}`;
      if (checkedPairs.has(key)) continue;
      checkedPairs.add(key);
      const first = saturateCultureColor(
        culturePaletteColor(firstIndex!),
        CULTURE_MAP_STYLE.culturePickerSaturation,
      );
      const second = saturateCultureColor(
        culturePaletteColor(secondIndex!),
        CULTURE_MAP_STYLE.culturePickerSaturation,
      );
      expect(
        rgbDistance(first, second),
        `${cultures.cultures[firstIndex!]!.displayName} and ${cultures.cultures[secondIndex!]!.displayName}`,
      ).toBeGreaterThanOrEqual(120);
    }
  });
});
