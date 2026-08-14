import { describe, expect, it } from "vitest";
import { technologyDefinition } from "../technology/TribalTechnology";
import {
  TRIBAL_BUILDINGS,
  tribalBuildingDefinition,
  tribalBuildingEffects,
} from "./TribalRoster";
import { TRIBAL_UNITS, tribalUnitDefinition } from "../combat/MilitaryRoster";

describe("TribalRoster", () => {
  it("provides a broad but finite Tribal Age roster", () => {
    expect(TRIBAL_BUILDINGS).toHaveLength(20);
    expect(TRIBAL_UNITS).toHaveLength(82);
    expect(new Set(TRIBAL_BUILDINGS.map(({ id }) => id)).size).toBe(20);
    expect(new Set(TRIBAL_UNITS.map(({ id }) => id)).size).toBe(82);
  });

  it("references known technologies and buildings", () => {
    for (const building of TRIBAL_BUILDINGS) {
      if (building.requiredTechnologyId) {
        expect(technologyDefinition(building.requiredTechnologyId).id).toBe(
          building.requiredTechnologyId,
        );
      }
      expect(tribalBuildingDefinition(building.id)).toBe(building);
    }
    for (const unit of TRIBAL_UNITS) {
      for (const technologyId of unit.requiredTechnologyIds) {
        expect(technologyDefinition(technologyId).id).toBe(technologyId);
      }
      if (unit.requiredBuildingId) {
        expect(tribalBuildingDefinition(unit.requiredBuildingId).id).toBe(
          unit.requiredBuildingId,
        );
      }
      expect(tribalUnitDefinition(unit.id)).toBe(unit);
    }
  });

  it("combines settlement effects without order dependence", () => {
    expect(tribalBuildingEffects(["lore-hut", "granary", "palisade"])).toEqual({
      populationGrowthPerInterval: 2,
      influenceGrowthMetersPerInterval: 5,
      knowledgePerWorldDay: 2,
      observerHeightMeters: 15,
    });
    expect(tribalBuildingEffects(["palisade", "granary", "lore-hut"])).toEqual(
      tribalBuildingEffects(["lore-hut", "granary", "palisade"]),
    );
  });
});
