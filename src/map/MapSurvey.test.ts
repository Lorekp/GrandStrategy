import { describe, expect, it } from "vitest";
import { createGridBitset, setGridBit } from "../core/GridBitset";
import type { PlayerWorldSnapshot } from "../core/model";
import type { TheaterPoint } from "./RegionalTheater";
import { surveyMapPoint } from "./MapSurvey";

const projection = {
  toTheater: (position: { longitudeE6: number; latitudeE6: number }) => ({
    x: position.longitudeE6,
    y: position.latitudeE6,
  }),
};

function snapshot(explored: boolean): PlayerWorldSnapshot {
  const exploredCells = createGridBitset(1);
  if (explored) setGridBit(exploredCells, 0);
  return {
    seed: 1,
    tick: 1,
    worldTime: { year: -9_999, month: 3, day: 1, hour: 6, minute: 1 },
    viewerPlayerId: 1,
    tribes: [
      { id: 1, name: "Attic", cultureId: "hellenic-balkan", terrainMovementModifiers: {}, vegetationMovementModifiers: {}, color: 0xd8c76f, controllerPlayerId: 1, warriors: 0 },
      { id: 2, name: "Boeotian", cultureId: "hellenic-balkan", terrainMovementModifiers: {}, vegetationMovementModifiers: {}, color: 0xb96855, controllerPlayerId: null, warriors: 20 },
    ],
    settlements: [
      {
        id: 1,
        tribeId: 1,
        name: "Attic Camp",
        position: { longitudeE6: 0, latitudeE6: 0 },
        tier: "camp",
        population: 100,
        influenceRadiusMeters: 10_000,
        administrator: "tribal-leader",
        buildings: ["scout-post"],
        intelligence: "controlled",
        lastObservedTick: 1,
      },
    ],
    units: [],
    relations: [{ firstTribeId: 1, secondTribeId: 2, stance: "hostile", opinion: -40, trust: 5, tension: 70, agreements: [], lastInteractionTick: -1_000_000 }],
    diplomaticProposals: [],
    events: [],
    research: [
      { tribeId: 1, queuedTechnologyIds: [], completedTechnologyIds: [], progress: [] },
    ],
    visibility: {
      width: 1,
      height: 1,
      revision: 1,
      visibleCells: exploredCells.slice(),
      exploredCells,
    },
  };
}

const surface = {
  sampleAt: async (_point: TheaterPoint) => ({
    cellIndex: 0,
    terrain: "plains" as const,
    biome: "woodland" as const,
    vegetation: "forest" as const,
    vegetationDensity: "light" as const,
    moisture: 153,
    river: "major" as const,
    elevationMeters: 184,
  }),
};

describe("map survey", () => {
  it("reports semantic terrain and the exact owning influence/entity", async () => {
    const result = await surveyMapPoint(
      { x: 0, y: 0 },
      snapshot(true),
      surface,
      projection,
      1,
      20,
    );

    expect(result).toMatchObject({
      discovered: true,
      terrain: "plains",
      biome: "woodland",
      vegetation: { type: "forest", density: "light" },
      moisturePercent: 60,
      naturalFeature: { kind: "river", riverClass: "major" },
      elevationMeters: 184,
      feature: { kind: "settlement", name: "Attic Camp", population: 100 },
      buildings: ["scout-post"],
      influenceTribeName: "Attic",
      allegianceTribeName: "Attic",
      allegianceKind: "player",
    });
  });

  it("does not leak terrain, height, or ownership through unexplored fog", async () => {
    const result = await surveyMapPoint(
      { x: 0, y: 0 },
      snapshot(false),
      surface,
      projection,
      1,
      20,
    );

    expect(result).toEqual({
      discovered: false,
      allegianceKind: "unclaimed",
    });
  });
});
