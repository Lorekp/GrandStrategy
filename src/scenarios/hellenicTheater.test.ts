import { describe, expect, it } from "vitest";
import { geographicDistanceMeters } from "../core/Geography";
import type { WorldGridDefinition } from "../core/model";
import { createHellenicTheaterScenario } from "./hellenicTheater";
import type { CultureProfile } from "../culture/CultureProfile";

const culture: CultureProfile = {
  id: "hellenic-balkan",
  name: "Hellenic-Balkan",
  focus: ["Exchange", "Civic Rivalry"],
  legacy: { name: "Agora Exchange", effect: "Test legacy" },
  tradeoff: { name: "Polis Rivalry", effect: "Test tradeoff" },
  acclimatization: {
    name: "Broken Peninsula",
    description: "Test acclimatization",
    terrain: [{ terrain: "hills", movementBonusPercent: 25 }],
  },
  specialTechnology: {
    name: "Dry-stone Terraces",
    effect: "Test technology",
    unlock: "Terraced Farm",
  },
};

const spawn = { longitudeE6: 23_750_000, latitudeE6: 37_920_000 } as const;
const worldGrid: WorldGridDefinition = {
  projectionDefinition: "+proj=aeqd +lat_0=37.98 +lon_0=23.72 +ellps=WGS84 +units=m +no_defs",
  extentWidthMeters: 512_000,
  extentHeightMeters: 512_000,
  width: 128,
  height: 128,
  terrainCells: new Uint8Array(128 * 128).fill(1),
  vegetationCells: new Uint8Array(128 * 128),
  moistureCells: new Uint8Array(128 * 128).fill(128),
  riverCells: new Uint8Array(128 * 128),
  elevationMeters: new Int16Array(128 * 128),
};

describe("Hellenic theater founding", () => {
  it("uses the chosen position and generates a deterministic rival roster", () => {
    const first = createHellenicTheaterScenario(spawn, worldGrid, 0, culture);
    const second = createHellenicTheaterScenario(spawn, worldGrid, 0, culture);

    expect(first).toEqual(second);
    expect(first.settlements[0]?.position).toEqual(spawn);
    expect(first.tribes).toHaveLength(9);
    expect(first.settlements).toHaveLength(9);
    expect(first.tribes[0]?.warriors).toBe(0);
    expect(first.settlements[0]?.population).toBe(100);
  });

  it("keeps generated rival Camps away from the founding Camp", () => {
    const scenario = createHellenicTheaterScenario(spawn, worldGrid, 0, culture);
    for (const camp of scenario.settlements.slice(1)) {
      expect(geographicDistanceMeters(spawn, camp.position)).toBeGreaterThanOrEqual(
        35_000,
      );
    }
  });

  it("uses the re-dice roll to change the deterministic opening", () => {
    const first = createHellenicTheaterScenario(spawn, worldGrid, 0, culture);
    const rerolled = createHellenicTheaterScenario(spawn, worldGrid, 1, culture);
    expect(rerolled.seed).not.toBe(first.seed);
    expect(rerolled.settlements.slice(1)).not.toEqual(first.settlements.slice(1));
  });
});
