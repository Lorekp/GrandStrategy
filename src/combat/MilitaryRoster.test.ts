import { describe, expect, it } from "vitest";
import cultureManifest from "../../public/maps/cultures/manifest.json";
import {
  CULTURE_MILITARY_UNITS,
  TRIBAL_SUPPORT_UNITS,
  cultureMilitaryUnits,
  tribalUnitDefinition,
} from "./MilitaryRoster";

describe("culture military roster", () => {
  it("gives every map culture exactly one close and one ranged field group", () => {
    const cultureIds = cultureManifest.cultures.map((culture) => culture.id).sort();
    const rosterCultureIds = [
      ...new Set(CULTURE_MILITARY_UNITS.map((unit) => unit.cultureId!)),
    ].sort();
    expect(rosterCultureIds).toEqual(cultureIds);
    for (const cultureId of cultureIds) {
      const [close, ranged] = cultureMilitaryUnits(cultureId);
      expect(close.combat?.role).toBe("close");
      expect(ranged.combat?.role).toBe("ranged");
      expect(close.name).toBeTruthy();
      expect(ranged.name).toBeTruthy();
    }
  });

  it("keeps support groups culture-neutral and every id globally resolvable", () => {
    expect(TRIBAL_SUPPORT_UNITS.map((unit) => unit.id)).toEqual(["scout", "hunting-party"]);
    const all = [...TRIBAL_SUPPORT_UNITS, ...CULTURE_MILITARY_UNITS];
    expect(new Set(all.map((unit) => unit.id)).size).toBe(all.length);
    for (const unit of all) expect(tribalUnitDefinition(unit.id)).toBe(unit);
  });
});
