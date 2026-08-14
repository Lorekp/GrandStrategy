import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { createGridBitset, setGridBit } from "./GridBitset";
import { refreshPlayerIntelligence } from "./Intelligence";
import type {
  CurrentPlayerVisibility,
  GeographicPosition,
  PlayerKnowledge,
  Settlement,
  Tribe,
  Unit,
} from "./model";
import { WorldGrid } from "./WorldGrid";

const projectionDefinition =
  "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs";
const projection = proj4("EPSG:4326", projectionDefinition);
const grid = new WorldGrid({
  projectionDefinition,
  extentWidthMeters: 41_000,
  extentHeightMeters: 41_000,
  width: 41,
  height: 41,
  terrainCells: new Uint8Array(41 * 41).fill(1),
  vegetationCells: new Uint8Array(41 * 41),
  moistureCells: new Uint8Array(41 * 41),
  riverCells: new Uint8Array(41 * 41),
  elevationMeters: new Int16Array(41 * 41),
});

function positionAt(easting: number): GeographicPosition {
  const [longitude, latitude] = projection.inverse([easting, 0]);
  return {
    longitudeE6: Math.round(longitude * 1_000_000),
    latitudeE6: Math.round(latitude * 1_000_000),
  };
}

const playerTribe: Tribe = {
  id: 1,
  name: "Player",
  cultureId: "test",
  terrainMovementModifiers: {},
  vegetationMovementModifiers: {},
  color: 0xffffff,
  controllerPlayerId: 9,
  warriors: 0,
};
const enemyTribe: Tribe = {
  ...playerTribe,
  id: 2,
  name: "Enemy",
  controllerPlayerId: null,
};
const enemyCamp: Settlement = {
  id: 2,
  tribeId: 2,
  name: "Enemy Camp",
  position: positionAt(2_000),
  tier: "camp",
  population: 120,
  influenceRadiusMeters: 5_000,
  administrator: "tribal-leader",
  buildings: [],
};
const enemyScout: Unit = {
  id: 2,
  tribeId: 2,
  homeSettlementId: 2,
  kind: "scout",
  position: positionAt(2_000),
  route: [positionAt(4_000)],
  terrain: "plains",
  vegetation: "none",
  vegetationDensity: "none",
  speedMetersPerHour: 4_474,
  slopeDegrees: 0,
  remainingTravelMinutes: 30,
  combat: null,
};

function emptyKnowledge(): PlayerKnowledge {
  return {
    playerId: 9,
    exploredCells: createGridBitset(grid.cellCount),
    settlementIntelligence: [],
    unitIntelligence: [],
  };
}

function visibilityAt(
  unitPositions: readonly GeographicPosition[] = [],
  campPositions: readonly GeographicPosition[] = [],
  villagePositions: readonly GeographicPosition[] = [],
): CurrentPlayerVisibility {
  const result: CurrentPlayerVisibility = {
    revision: 1,
    visibleCells: createGridBitset(grid.cellCount),
    unitDetectableCells: createGridBitset(grid.cellCount),
    campDetectableCells: createGridBitset(grid.cellCount),
    villageDetectableCells: createGridBitset(grid.cellCount),
  };
  for (const position of unitPositions) {
    setGridBit(result.unitDetectableCells, grid.cellAt(position)!.index);
  }
  for (const position of campPositions) {
    setGridBit(result.campDetectableCells, grid.cellAt(position)!.index);
  }
  for (const position of villagePositions) {
    setGridBit(result.villageDetectableCells, grid.cellAt(position)!.index);
  }
  return result;
}

function refresh(
  tick: number,
  previous: PlayerKnowledge,
  visibility: CurrentPlayerVisibility,
  settlements: readonly Settlement[] = [enemyCamp],
  units: readonly Unit[] = [enemyScout],
) {
  return refreshPlayerIntelligence({
    tick,
    playerId: 9,
    previous,
    tribes: [playerTribe, enemyTribe],
    settlements,
    units,
    visibility,
    worldGrid: grid,
  });
}

describe("last-known enemy intelligence", () => {
  it("does not identify an individual unit from settlement detection", () => {
    const settlementOnly = visibilityAt([], [enemyScout.position], [enemyScout.position]);
    expect(refresh(3, emptyKnowledge(), settlementOnly).unitIntelligence).toEqual([]);

    const closeEnough = visibilityAt([enemyScout.position]);
    const intelligence = refresh(3, emptyKnowledge(), closeEnough);
    expect(intelligence.unitIntelligence).toHaveLength(1);
    expect(intelligence.unitIntelligence[0]?.unit.route).toEqual([]);
  });

  it("keeps a discovered camp frozen after observation is lost", () => {
    const detected = refresh(
      3,
      emptyKnowledge(),
      visibilityAt([], [enemyCamp.position]),
      [enemyCamp],
      [],
    );
    const previous: PlayerKnowledge = {
      ...emptyKnowledge(),
      ...detected,
    };
    const remembered = refresh(4, previous, visibilityAt(), [enemyCamp], []);

    expect(remembered.settlementIntelligence[0]).toMatchObject({
      settlement: { id: 2, population: 120 },
      lastObservedTick: 3,
    });
  });

  it("removes stale intel when its last-known location is checked and empty", () => {
    const previous: PlayerKnowledge = {
      ...emptyKnowledge(),
      settlementIntelligence: [{
        settlement: enemyCamp,
        tribe: enemyTribe,
        lastObservedTick: 3,
      }],
    };
    const movedCamp = { ...enemyCamp, position: positionAt(12_000) };
    const refreshed = refresh(
      4,
      previous,
      visibilityAt([], [enemyCamp.position]),
      [movedCamp],
      [],
    );

    expect(refreshed.settlementIntelligence).toEqual([]);
  });

  it("replaces stale settlement information when it is observed again", () => {
    const previous: PlayerKnowledge = {
      ...emptyKnowledge(),
      settlementIntelligence: [{
        settlement: enemyCamp,
        tribe: enemyTribe,
        lastObservedTick: 3,
      }],
    };
    const changedCamp = { ...enemyCamp, population: 180 };
    const refreshed = refresh(
      8,
      previous,
      visibilityAt([], [changedCamp.position]),
      [changedCamp],
      [],
    );

    expect(refreshed.settlementIntelligence[0]).toMatchObject({
      settlement: { population: 180 },
      lastObservedTick: 8,
    });
  });
});
