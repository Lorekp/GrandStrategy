import { describe, expect, it } from "vitest";
import { createGridBitset, gridBitIsSet, setGridBit } from "./GridBitset";
import type {
  CurrentPlayerVisibility,
  Settlement,
  Tribe,
  Unit,
  WorldGridDefinition,
  WorldSnapshot,
} from "./model";
import { createPlayerWorldSnapshot } from "./PlayerView";
import { WorldGrid } from "./WorldGrid";

const definition: WorldGridDefinition = {
  projectionDefinition:
    "+proj=aeqd +lat_0=37.98 +lon_0=23.72 +ellps=WGS84 +units=m +no_defs",
  extentWidthMeters: 512_000,
  extentHeightMeters: 512_000,
  width: 512,
  height: 512,
  terrainCells: new Uint8Array(512 * 512).fill(1),
  vegetationCells: new Uint8Array(512 * 512),
  moistureCells: new Uint8Array(512 * 512),
  riverCells: new Uint8Array(512 * 512),
  elevationMeters: new Int16Array(512 * 512),
};
const grid = new WorldGrid(definition);
const playerPosition = { longitudeE6: 23_720_000, latitudeE6: 37_980_000 };
const nearPosition = { longitudeE6: 23_760_000, latitudeE6: 38_020_000 };
const farPosition = { longitudeE6: 20_740_000, latitudeE6: 39_150_000 };
const exploredCells = createGridBitset(grid.cellCount);
const visibleCells = createGridBitset(grid.cellCount);
setGridBit(exploredCells, grid.cellAt(playerPosition)!.index);
setGridBit(exploredCells, grid.cellAt(nearPosition)!.index);
setGridBit(visibleCells, grid.cellAt(playerPosition)!.index);
setGridBit(visibleCells, grid.cellAt(nearPosition)!.index);

const currentVisibility: CurrentPlayerVisibility = {
  revision: 3,
  visibleCells,
  unitDetectableCells: createGridBitset(grid.cellCount),
  campDetectableCells: createGridBitset(grid.cellCount),
  villageDetectableCells: createGridBitset(grid.cellCount),
};

const tribes: Tribe[] = [
  { id: 1, name: "Player", cultureId: "test", terrainMovementModifiers: {}, vegetationMovementModifiers: {}, color: 0xffffff, controllerPlayerId: 9, warriors: 10 },
  { id: 2, name: "Near", cultureId: "test", terrainMovementModifiers: {}, vegetationMovementModifiers: {}, color: 0xbbbbbb, controllerPlayerId: null, warriors: 20 },
  { id: 3, name: "Hidden", cultureId: "test", terrainMovementModifiers: {}, vegetationMovementModifiers: {}, color: 0x777777, controllerPlayerId: null, warriors: 30 },
];
const playerCamp: Settlement = {
  id: 1,
  tribeId: 1,
  name: "Player Camp",
  position: playerPosition,
  tier: "camp",
  population: 10,
  influenceRadiusMeters: 5_000,
  administrator: "tribal-leader",
  buildings: [],
};
const nearCamp: Settlement = {
  id: 2,
  tribeId: 2,
  name: "Near Camp",
  position: nearPosition,
  tier: "camp",
  population: 20,
  influenceRadiusMeters: 5_000,
  administrator: "tribal-leader",
  buildings: [],
};
const hiddenCamp: Settlement = {
  id: 3,
  tribeId: 3,
  name: "Hidden Camp",
  position: farPosition,
  tier: "camp",
  population: 30,
  influenceRadiusMeters: 5_000,
  administrator: "tribal-leader",
  buildings: [],
};

const world: WorldSnapshot = {
  seed: 7,
  tick: 12,
  worldTime: { year: -9_999, month: 3, day: 1, hour: 6, minute: 12 },
  tribes,
  settlements: [playerCamp, nearCamp, hiddenCamp],
  units: [],
  relations: [
    { firstTribeId: 1, secondTribeId: 2, stance: "hostile", opinion: -40, trust: 5, tension: 70, agreements: [], lastInteractionTick: -1_000_000 },
    { firstTribeId: 1, secondTribeId: 3, stance: "neutral", opinion: 0, trust: 15, tension: 20, agreements: [], lastInteractionTick: -1_000_000 },
  ],
  diplomaticProposals: [],
  events: [],
  research: [
    { tribeId: 1, queuedTechnologyIds: [], completedTechnologyIds: [], progress: [] },
    { tribeId: 2, queuedTechnologyIds: [], completedTechnologyIds: [], progress: [] },
    { tribeId: 3, queuedTechnologyIds: [], completedTechnologyIds: [], progress: [] },
  ],
  playerKnowledge: [{
    playerId: 9,
    exploredCells,
    settlementIntelligence: [{
      settlement: nearCamp,
      tribe: tribes[1]!,
      lastObservedTick: 12,
    }],
    unitIntelligence: [],
  }],
  stateHash: "test",
};

describe("player fog-of-war view", () => {
  it("transmits controlled and known rivals without leaking unknown tribes", () => {
    const view = createPlayerWorldSnapshot(world, 9, grid, currentVisibility);
    expect(view.tribes.map((tribe) => tribe.name)).toEqual(["Player", "Near"]);
    expect(view.settlements.map((settlement) => settlement.name)).toEqual([
      "Player Camp",
      "Near Camp",
    ]);
    expect(view.research.map((research) => research.tribeId)).toEqual([1]);
    expect(view.settlements.map((settlement) => settlement.intelligence)).toEqual([
      "controlled",
      "observed",
    ]);
    expect(view.relations).toEqual([
      {
        firstTribeId: 1,
        secondTribeId: 2,
        stance: "hostile",
        opinion: -40,
        trust: 5,
        tension: 70,
        agreements: [],
        lastInteractionTick: -1_000_000,
      },
    ]);
  });

  it("keeps explored terrain memory distinct from current terrain visibility", () => {
    const remembered = exploredCells.slice();
    const rememberedIndex = grid.cellAt(playerPosition)!.index + 1;
    setGridBit(remembered, rememberedIndex);
    const knowledge = world.playerKnowledge[0]!;
    const view = createPlayerWorldSnapshot(
      {
        ...world,
        playerKnowledge: [{ ...knowledge, exploredCells: remembered }],
      },
      9,
      grid,
      currentVisibility,
    );

    expect(gridBitIsSet(view.visibility.visibleCells, rememberedIndex)).toBe(false);
    expect(gridBitIsSet(view.visibility.exploredCells, rememberedIndex)).toBe(true);
  });

  it("renders frozen last-known entities and never exposes enemy orders", () => {
    const enemyUnit: Unit = {
      id: 7,
      tribeId: 2,
      homeSettlementId: 2,
      kind: "scout",
      position: nearPosition,
      route: [farPosition],
      terrain: "plains",
      vegetation: "none",
      vegetationDensity: "none",
      speedMetersPerHour: 4_474,
      slopeDegrees: 0,
      remainingTravelMinutes: 90,
      combat: null,
    };
    const knowledge = world.playerKnowledge[0]!;
    const view = createPlayerWorldSnapshot(
      {
        ...world,
        units: [enemyUnit],
        playerKnowledge: [{
          ...knowledge,
          settlementIntelligence: [{
            settlement: { ...nearCamp, population: 17 },
            tribe: tribes[1]!,
            lastObservedTick: 8,
          }],
          unitIntelligence: [{
            unit: enemyUnit,
            tribe: tribes[1]!,
            lastObservedTick: 8,
          }],
        }],
      },
      9,
      grid,
      currentVisibility,
    );

    expect(view.settlements.find((settlement) => settlement.id === 2)).toMatchObject({
      population: 17,
      intelligence: "remembered",
      lastObservedTick: 8,
    });
    expect(view.units[0]).toMatchObject({
      intelligence: "remembered",
      route: [],
      remainingTravelMinutes: null,
    });
  });
});
