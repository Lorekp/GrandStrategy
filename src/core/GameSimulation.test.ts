import { describe, expect, it } from "vitest";
import { geographicDistanceMeters } from "./Geography";
import { GameSimulation } from "./GameSimulation";
import { createGridBitset } from "./GridBitset";
import type { ScenarioDefinition } from "./model";
import { cultureMilitaryUnits } from "../combat/MilitaryRoster";
import { legalActionCatalog } from "../ai/LegalActions";

const hellenicCloseUnit = cultureMilitaryUnits("hellenic-balkan")[0];

const scenario: ScenarioDefinition = {
  seed: 42,
  startWorldTime: { year: -9_999, month: 3, day: 1, hour: 6, minute: 0 },
  worldGrid: {
    projectionDefinition: "+proj=aeqd +lat_0=37.98 +lon_0=23.72 +ellps=WGS84 +units=m +no_defs",
    extentWidthMeters: 512_000,
    extentHeightMeters: 512_000,
    width: 1,
    height: 1,
    terrainCells: Uint8Array.of(1),
    vegetationCells: Uint8Array.of(0),
    moistureCells: Uint8Array.of(128),
    riverCells: Uint8Array.of(0),
    elevationMeters: Int16Array.of(0),
  },
  tribes: [
    {
      id: 1,
      name: "Test tribe",
      cultureId: "test",
      terrainMovementModifiers: {},
      vegetationMovementModifiers: {},
      color: 0xaabb66,
      controllerPlayerId: 7,
      warriors: 12,
    },
  ],
  settlements: [
    {
      id: 1,
      tribeId: 1,
      name: "Test camp",
      position: { longitudeE6: 23_720_000, latitudeE6: 37_980_000 },
      tier: "camp",
      population: 20,
      influenceRadiusMeters: 8_000,
      administrator: "tribal-leader",
      buildings: [],
    },
  ],
  units: [],
  relations: [],
  diplomaticProposals: [],
  events: [],
  research: [
    {
      tribeId: 1,
      queuedTechnologyIds: [],
      completedTechnologyIds: [],
      progress: [],
    },
  ],
  playerKnowledge: [
    {
      playerId: 7,
      exploredCells: createGridBitset(1),
      settlementIntelligence: [],
      unitIntelligence: [],
    },
  ],
};

const villageAdministrationTechnologies = [
  "seasonal-lore",
  "cordage-basketry",
  "hearthcraft",
  "council-customs",
  "food-preservation",
  "permanent-dwellings",
  "oral-tradition",
  "communal-storage",
  "village-planning",
  "tallies-measures",
  "village-administration",
] as const;

describe("GameSimulation", () => {
  const countBits = (values: Uint32Array): number => {
    let count = 0;
    for (const value of values) {
      let word = value;
      while (word !== 0) {
        word &= word - 1;
        count += 1;
      }
    }
    return count;
  };
  it("produces identical state from identical ordered tick inputs", () => {
    const first = new GameSimulation(scenario);
    const second = new GameSimulation(scenario);

    for (let tick = 0; tick < 50; tick += 1) {
      const input = { tick, commands: [] } as const;
      expect(first.step(input)).toEqual(second.step(input));
    }
  });

  it("keeps the snapshotting and headless-advance paths identical", () => {
    const snapshotting = new GameSimulation(scenario);
    const headless = new GameSimulation(scenario);

    snapshotting.step({ tick: 0, commands: [] });
    headless.advance({ tick: 0, commands: [] });

    expect(headless.snapshot()).toEqual(snapshotting.snapshot());
  });

  it("keeps geography in integer WGS84 coordinates", () => {
    const snapshot = new GameSimulation(scenario).snapshot();
    expect(snapshot.settlements[0]?.position).toEqual({
      longitudeE6: 23_720_000,
      latitudeE6: 37_980_000,
    });
  });

  it("advances a selected Technology with deterministic integer Knowledge", () => {
    const simulation = new GameSimulation(scenario);
    const snapshot = simulation.step({
      tick: 0,
      commands: [
        {
          kind: "select-research",
          playerId: 7,
          sequence: 1,
          tribeId: 1,
          technologyId: "seasonal-lore",
        },
      ],
    });
    expect(snapshot.research[0]).toMatchObject({
      queuedTechnologyIds: ["seasonal-lore"],
      progress: [{ technologyId: "seasonal-lore", investedKnowledgeMinutes: 18 }],
    });
  });

  it("preserves partial work when Research focus changes", () => {
    const simulation = new GameSimulation(scenario);
    simulation.step({
      tick: 0,
      commands: [
        { kind: "select-research", playerId: 7, sequence: 1, tribeId: 1, technologyId: "seasonal-lore" },
      ],
    });
    const snapshot = simulation.step({
      tick: 1,
      commands: [
        { kind: "select-research", playerId: 7, sequence: 2, tribeId: 1, technologyId: "hearthcraft" },
      ],
    });
    expect(snapshot.research[0]?.queuedTechnologyIds).toEqual(["hearthcraft"]);
    expect(snapshot.research[0]?.progress).toEqual([
      { technologyId: "hearthcraft", investedKnowledgeMinutes: 18 },
      { technologyId: "seasonal-lore", investedKnowledgeMinutes: 18 },
    ]);
  });

  it("turns a locked Research destination into a prerequisite-first plan", () => {
    const simulation = new GameSimulation(scenario);
    const snapshot = simulation.step({
      tick: 0,
      commands: [
        { kind: "select-research", playerId: 7, sequence: 1, tribeId: 1, technologyId: "village-planning" },
      ],
    });
    expect(snapshot.research[0]?.queuedTechnologyIds.at(-1)).toBe("village-planning");
    expect(snapshot.research[0]?.queuedTechnologyIds[0]).toBe("council-customs");
  });

  it("upgrades a controlled Camp in place", () => {
    const simulation = new GameSimulation({
      ...scenario,
      research: [
        {
          ...scenario.research[0]!,
          completedTechnologyIds: [
            "seasonal-lore",
            "cordage-basketry",
            "hearthcraft",
            "council-customs",
            "permanent-dwellings",
            "village-planning",
          ],
        },
      ],
    });
    simulation.step({
      tick: 0,
      commands: [
        { kind: "upgrade-camp", playerId: 7, sequence: 1, settlementId: 1 },
      ],
    });
    expect(simulation.snapshot().settlements[0]).toMatchObject({
      id: 1,
      tier: "village",
      position: scenario.settlements[0]?.position,
    });
  });

  it("assigns unlocked Village administrators through an ordered command", () => {
    const simulation = new GameSimulation({
      ...scenario,
      settlements: [
        { ...scenario.settlements[0]!, tier: "village" },
      ],
      research: [
        {
          ...scenario.research[0]!,
          completedTechnologyIds: villageAdministrationTechnologies,
        },
      ],
    });
    const snapshot = simulation.step({
      tick: 0,
      commands: [
        {
          kind: "assign-administrator",
          playerId: 7,
          sequence: 1,
          settlementId: 1,
          administrator: "sage",
        },
      ],
    });
    expect(snapshot.settlements[0]?.administrator).toBe("sage");
  });

  it("applies the Sage's Village Knowledge specialization", () => {
    const simulation = new GameSimulation({
      ...scenario,
      settlements: [
        {
          ...scenario.settlements[0]!,
          tier: "village",
          administrator: "sage",
        },
      ],
      research: [
        {
          ...scenario.research[0]!,
          queuedTechnologyIds: ["warband-discipline"],
          completedTechnologyIds: [
            ...villageAdministrationTechnologies,
            "cooperative-hunts",
          ],
        },
      ],
    });
    const snapshot = simulation.step({ tick: 0, commands: [] });
    expect(snapshot.research[0]?.progress).toEqual([
      { technologyId: "warband-discipline", investedKnowledgeMinutes: 24 },
    ]);
  });

  it("keeps specialized administrators unavailable in Camps", () => {
    const simulation = new GameSimulation({
      ...scenario,
      research: [
        {
          ...scenario.research[0]!,
          completedTechnologyIds: villageAdministrationTechnologies,
        },
      ],
    });
    expect(() =>
      simulation.step({
        tick: 0,
        commands: [
          {
            kind: "assign-administrator",
            playerId: 7,
            sequence: 1,
            settlementId: 1,
            administrator: "elder",
          },
        ],
      }),
    ).toThrow("elder can only administer a Village");
  });

  it("constructs a Scout Post through an ordered player command", () => {
    const simulation = new GameSimulation(scenario);
    simulation.step({
      tick: 0,
      commands: [
        {
          kind: "construct-building",
          building: "scout-post",
          playerId: 7,
          sequence: 1,
          settlementId: 1,
        },
      ],
    });
    expect(simulation.snapshot().settlements[0]?.buildings).toEqual([
      "scout-post",
    ]);
  });

  it("keeps researched Tribal buildings authoritative and technology-locked", () => {
    const locked = new GameSimulation(scenario);
    expect(() =>
      locked.step({
        tick: 0,
        commands: [
          {
            kind: "construct-building",
            building: "hearth",
            playerId: 7,
            sequence: 1,
            settlementId: 1,
          },
        ],
      }),
    ).toThrow("hearth requires hearthcraft");

    const unlocked = new GameSimulation({
      ...scenario,
      research: [
        {
          ...scenario.research[0]!,
          completedTechnologyIds: ["hearthcraft"],
        },
      ],
    });
    unlocked.step({
      tick: 0,
      commands: [
        {
          kind: "construct-building",
          building: "hearth",
          playerId: 7,
          sequence: 1,
          settlementId: 1,
        },
      ],
    });
    expect(unlocked.snapshot().settlements[0]?.buildings).toEqual(["hearth"]);
  });

  it("requires Village status for permanent production works", () => {
    const simulation = new GameSimulation({
      ...scenario,
      research: [
        {
          ...scenario.research[0]!,
          completedTechnologyIds: [
            "seasonal-lore",
            "cordage-basketry",
            "hearthcraft",
            "food-preservation",
            "permanent-dwellings",
            "communal-storage",
          ],
        },
      ],
    });
    expect(() =>
      simulation.step({
        tick: 0,
        commands: [
          {
            kind: "construct-building",
            building: "granary",
            playerId: 7,
            sequence: 1,
            settlementId: 1,
          },
        ],
      }),
    ).toThrow("granary requires a village");
  });

  it("trains one controllable Scout from one resident", () => {
    const simulation = new GameSimulation(scenario);
    simulation.step({
      tick: 0,
      commands: [
        {
          kind: "train-unit",
          unitKind: "scout",
          playerId: 7,
          sequence: 1,
          settlementId: 1,
        },
      ],
    });
    expect(simulation.snapshot().settlements[0]?.population).toBe(19);
    expect(simulation.snapshot().units[0]).toMatchObject({
      id: 1,
      tribeId: 1,
      homeSettlementId: 1,
      kind: "scout",
      route: [],
      terrain: "plains",
      vegetation: "none",
      vegetationDensity: "none",
      speedMetersPerHour: 4_476,
      slopeDegrees: 0,
      remainingTravelMinutes: null,
    });
  });

  it("trains researched Warbands and assigns their people as warriors", () => {
    const simulation = new GameSimulation({
      ...scenario,
      tribes: [{ ...scenario.tribes[0]!, cultureId: "hellenic-balkan" }],
      settlements: [
        { ...scenario.settlements[0]!, buildings: ["rally-ground"] },
      ],
      research: [
        {
          ...scenario.research[0]!,
          completedTechnologyIds: [
            "cooperative-hunts",
            "council-customs",
            "warband-discipline",
          ],
        },
      ],
    });
    simulation.step({
      tick: 0,
      commands: [
        {
          kind: "train-unit",
          unitKind: hellenicCloseUnit.id,
          playerId: 7,
          sequence: 1,
          settlementId: 1,
        },
      ],
    });
    expect(simulation.snapshot().settlements[0]?.population).toBe(8);
    expect(simulation.snapshot().tribes[0]?.warriors).toBe(24);
    expect(simulation.snapshot().units[0]).toMatchObject({
      kind: hellenicCloseUnit.id,
      homeSettlementId: 1,
      combat: {
        strength: 12,
        moralePermille: 1_000,
        cohesionPermille: 1_000,
        fatiguePermille: 0,
        status: "ready",
      },
    });
  });

  it("rejects field groups whose training building is absent", () => {
    const simulation = new GameSimulation({
      ...scenario,
      tribes: [{ ...scenario.tribes[0]!, cultureId: "hellenic-balkan" }],
      research: [
        {
          ...scenario.research[0]!,
          completedTechnologyIds: [
            "cooperative-hunts",
            "council-customs",
            "warband-discipline",
          ],
        },
      ],
    });
    expect(() =>
      simulation.step({
        tick: 0,
        commands: [
          {
            kind: "train-unit",
            unitKind: hellenicCloseUnit.id,
            playerId: 7,
            sequence: 1,
            settlementId: 1,
          },
        ],
      }),
    ).toThrow(`${hellenicCloseUnit.id} requires rally-ground`);
  });

  it("resolves observed wartime engagements on deterministic ten-minute rounds", () => {
    const combat = (targetUnitId: number) => ({
      strength: 12,
      maximumStrength: 12,
      moralePermille: 1_000,
      cohesionPermille: 1_000,
      fatiguePermille: 0,
      missileReadinessPermille: 1_000,
      experience: 0,
      status: "ready" as const,
      order: null,
    });
    const battleScenario: ScenarioDefinition = {
      ...scenario,
      worldGrid: {
        ...scenario.worldGrid,
        vegetationCells: Uint8Array.of(3),
      },
      tribes: [
        { ...scenario.tribes[0]!, cultureId: "hellenic-balkan" },
        { ...scenario.tribes[0]!, id: 2, name: "Rival", cultureId: "hellenic-balkan", controllerPlayerId: null },
      ],
      settlements: [
        scenario.settlements[0]!,
        { ...scenario.settlements[0]!, id: 2, tribeId: 2, name: "Rival camp" },
      ],
      units: [
        {
          id: 1,
          tribeId: 1,
          homeSettlementId: 1,
          kind: hellenicCloseUnit.id,
          position: scenario.settlements[0]!.position,
          route: [],
          terrain: "plains",
          vegetation: "none",
          vegetationDensity: "none",
          speedMetersPerHour: 0,
          slopeDegrees: 0,
          remainingTravelMinutes: null,
          combat: combat(2),
        },
        {
          id: 2,
          tribeId: 2,
          homeSettlementId: 2,
          kind: hellenicCloseUnit.id,
          position: scenario.settlements[0]!.position,
          route: [],
          terrain: "plains",
          vegetation: "none",
          vegetationDensity: "none",
          speedMetersPerHour: 0,
          slopeDegrees: 0,
          remainingTravelMinutes: null,
          combat: combat(1),
        },
      ],
      relations: [{
        firstTribeId: 1,
        secondTribeId: 2,
        stance: "war",
        opinion: -100,
        trust: 0,
        tension: 100,
        agreements: [],
        lastInteractionTick: 0,
      }],
      research: [scenario.research[0]!, { ...scenario.research[0]!, tribeId: 2 }],
    };
    const simulation = new GameSimulation(battleScenario);
    const playerView = simulation.playerSnapshot(7);
    expect(playerView.units.find((unit) => unit.id === 2)?.intelligence).toBe("observed");
    expect(legalActionCatalog(playerView).engagement[0]).toMatchObject({
      unitId: 1,
      targetUnitIds: [2],
      doctrines: ["cautious", "balanced", "aggressive"],
    });
    simulation.step({
      tick: 0,
      commands: [{
        kind: "engage-unit",
        playerId: 7,
        sequence: 1,
        unitId: 1,
        targetUnitId: 2,
        doctrine: "balanced",
        formation: "guard",
        pursuit: "controlled",
      }],
    });
    for (let tick = 1; tick < 10; tick += 1) simulation.step({ tick, commands: [] });
    const units = simulation.snapshot().units;
    expect(units[0]?.combat?.fatiguePermille).toBeGreaterThan(0);
    expect(units[1]?.combat?.cohesionPermille).toBeLessThan(1_000);
    expect(units[0]?.combat?.experience).toBeGreaterThan(0);
    expect(units[0]?.combat?.order?.engagementRounds).toBe(1);
    expect(units[0]?.combat?.moralePermille).toBeLessThan(units[1]?.combat?.moralePermille ?? 0);
  });

  it("moves a Scout through deterministic terrain-paced ticks", () => {
    const simulation = new GameSimulation(scenario);
    simulation.step({
      tick: 0,
      commands: [
        {
          kind: "train-unit",
          unitKind: "scout",
          playerId: 7,
          sequence: 1,
          settlementId: 1,
        },
      ],
    });
    const start = simulation.snapshot().units[0]!.position;
    const destination = {
      longitudeE6: start.longitudeE6 + 1_000,
      latitudeE6: start.latitudeE6,
    };
    const moving = simulation.step({
      tick: 1,
      commands: [
        {
          kind: "move-unit",
          playerId: 7,
          sequence: 2,
          unitId: 1,
          destination,
          mode: "replace",
        },
      ],
    }).units[0]!;
    expect(geographicDistanceMeters(start, moving.position)).toBeCloseTo(74.5, 0);
    expect(moving.route).toEqual([destination]);

    const arrived = simulation.step({ tick: 2, commands: [] }).units[0]!;
    expect(arrived.position).toEqual(destination);
    expect(arrived.route).toEqual([]);
  });

  it("appends queued waypoints and visits them in order", () => {
    const simulation = new GameSimulation(scenario);
    simulation.step({
      tick: 0,
      commands: [{
        kind: "train-unit",
        unitKind: "scout",
        playerId: 7,
        sequence: 1,
        settlementId: 1,
      }],
    });
    const start = simulation.snapshot().units[0]!.position;
    const first = { longitudeE6: start.longitudeE6 + 1_000, latitudeE6: start.latitudeE6 };
    const second = { longitudeE6: start.longitudeE6 + 2_000, latitudeE6: start.latitudeE6 };
    const ordered = simulation.step({
      tick: 1,
      commands: [
        { kind: "move-unit", playerId: 7, sequence: 2, unitId: 1, destination: first, mode: "replace" },
        { kind: "move-unit", playerId: 7, sequence: 3, unitId: 1, destination: second, mode: "append" },
      ],
    }).units[0]!;
    expect(ordered.route).toEqual([first, second]);

    const afterFirst = simulation.step({ tick: 2, commands: [] }).units[0]!;
    expect(afterFirst.position).toEqual(first);
    expect(afterFirst.route).toEqual([second]);
  });

  it("rests Scouts at night while retaining their queued route", () => {
    const simulation = new GameSimulation({
      ...scenario,
      startWorldTime: { ...scenario.startWorldTime, hour: 18 },
    });
    simulation.step({
      tick: 0,
      commands: [{
        kind: "train-unit",
        unitKind: "scout",
        playerId: 7,
        sequence: 1,
        settlementId: 1,
      }],
    });
    const start = simulation.snapshot().units[0]!.position;
    const destination = {
      longitudeE6: start.longitudeE6 + 1_000,
      latitudeE6: start.latitudeE6,
    };
    const resting = simulation.step({
      tick: 1,
      commands: [{
        kind: "move-unit",
        playerId: 7,
        sequence: 2,
        unitId: 1,
        destination,
        mode: "replace",
      }],
    }).units[0]!;
    expect(resting.position).toEqual(start);
    expect(resting.route).toEqual([destination]);
  });

  it("authoritatively reduces sight at night", () => {
    const size = 64;
    const worldGrid = {
      ...scenario.worldGrid,
      extentWidthMeters: size * 500,
      extentHeightMeters: size * 500,
      width: size,
      height: size,
      terrainCells: new Uint8Array(size * size).fill(1),
      vegetationCells: new Uint8Array(size * size),
      moistureCells: new Uint8Array(size * size).fill(128),
      riverCells: new Uint8Array(size * size),
      elevationMeters: new Int16Array(size * size),
    };
    const knowledge = [{
      playerId: 7,
      exploredCells: createGridBitset(size * size),
      settlementIntelligence: [],
      unitIntelligence: [],
    }];
    const day = new GameSimulation({ ...scenario, worldGrid, playerKnowledge: knowledge });
    const night = new GameSimulation({
      ...scenario,
      startWorldTime: { ...scenario.startWorldTime, hour: 18 },
      worldGrid,
      playerKnowledge: knowledge,
    });
    expect(countBits(night.playerSnapshot(7).visibility.visibleCells)).toBeLessThan(
      countBits(day.playerSnapshot(7).visibility.visibleCells),
    );
  });

  it("refreshes observed enemy intel even when the observer viewshed is cached", () => {
    const rivalTribe = {
      ...scenario.tribes[0]!,
      id: 2,
      name: "Rival",
      controllerPlayerId: null,
    };
    const rivalCamp = {
      ...scenario.settlements[0]!,
      id: 2,
      tribeId: 2,
      name: "Rival camp",
    };
    const simulation = new GameSimulation({
      ...scenario,
      tribes: [...scenario.tribes, rivalTribe],
      settlements: [...scenario.settlements, rivalCamp],
      research: [
        ...scenario.research,
        { tribeId: 2, queuedTechnologyIds: [], completedTechnologyIds: [], progress: [] },
      ],
      relations: [
        {
          firstTribeId: 1,
          secondTribeId: 2,
          stance: "neutral",
          opinion: 0,
          trust: 15,
          tension: 20,
          agreements: [],
          lastInteractionTick: -1_000_000,
        },
      ],
    });

    expect(
      simulation.playerSnapshot(7).settlements.find(({ id }) => id === 2),
    ).toMatchObject({ intelligence: "observed", lastObservedTick: 0 });
    simulation.step({ tick: 0, commands: [] });
    expect(
      simulation.playerSnapshot(7).settlements.find(({ id }) => id === 2),
    ).toMatchObject({ intelligence: "observed", lastObservedTick: 1 });
  });

  it("rejects out-of-order ticks", () => {
    const simulation = new GameSimulation(scenario);
    expect(() => simulation.step({ tick: 2, commands: [] })).toThrow(
      "Expected tick 0",
    );
  });

  it("rejects duplicate per-player command sequences", () => {
    const simulation = new GameSimulation(scenario);
    expect(() =>
      simulation.step({
        tick: 0,
        commands: [
          { kind: "upgrade-camp", playerId: 7, sequence: 1, settlementId: 1 },
          { kind: "upgrade-camp", playerId: 7, sequence: 1, settlementId: 1 },
        ],
      }),
    ).toThrow("Duplicate command sequence 1 for player 7");
  });
});
