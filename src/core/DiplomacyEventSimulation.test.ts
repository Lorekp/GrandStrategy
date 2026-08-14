import { describe, expect, it } from "vitest";
import { createGridBitset } from "./GridBitset";
import { GameSimulation } from "./GameSimulation";
import type { ScenarioDefinition } from "./model";

function scenario(): ScenarioDefinition {
  const tribes = [
    { id: 1, name: "Attic", cultureId: "test", terrainMovementModifiers: {}, vegetationMovementModifiers: {}, color: 0xd8c76f, controllerPlayerId: 7, warriors: 4 },
    { id: 2, name: "Boeotian", cultureId: "test", terrainMovementModifiers: {}, vegetationMovementModifiers: {}, color: 0xb96855, controllerPlayerId: 8, warriors: 5 },
  ];
  const settlements = [
    { id: 1, tribeId: 1, name: "Attic Camp", position: { longitudeE6: 23_720_000, latitudeE6: 37_980_000 }, tier: "camp" as const, population: 40, influenceRadiusMeters: 10_000, administrator: "tribal-leader" as const, buildings: [] },
    { id: 2, tribeId: 2, name: "Boeotian Camp", position: { longitudeE6: 23_730_000, latitudeE6: 37_990_000 }, tier: "camp" as const, population: 35, influenceRadiusMeters: 10_000, administrator: "tribal-leader" as const, buildings: [] },
  ];
  const intelligence = (playerId: number, enemyIndex: number) => ({
    playerId,
    exploredCells: createGridBitset(4),
    settlementIntelligence: [{ settlement: settlements[enemyIndex]!, tribe: tribes[enemyIndex]!, lastObservedTick: 0 }],
    unitIntelligence: [],
  });
  return {
    seed: 41,
    startWorldTime: { year: -9_999, month: 3, day: 1, hour: 6, minute: 0 },
    worldGrid: {
      projectionDefinition: "+proj=aeqd +lat_0=37.98 +lon_0=23.72 +ellps=WGS84 +units=m +no_defs",
      extentWidthMeters: 20_000,
      extentHeightMeters: 20_000,
      width: 2,
      height: 2,
      terrainCells: new Uint8Array(4).fill(1),
      vegetationCells: new Uint8Array(4),
      moistureCells: new Uint8Array(4),
      riverCells: new Uint8Array(4),
      elevationMeters: new Int16Array(4),
    },
    tribes,
    settlements,
    units: [],
    relations: [{ firstTribeId: 1, secondTribeId: 2, stance: "neutral", opinion: 10, trust: 20, tension: 15, agreements: [], lastInteractionTick: -1_000_000 }],
    diplomaticProposals: [{ id: 1, fromTribeId: 1, toTribeId: 2, action: "propose-guest-right", createdTick: 0, expiresTick: 100 }],
    events: [{ id: 1, definitionId: "crowded-hearth", category: "camp", tribeId: 1, targetTribeId: null, settlementId: 1, unitId: null, occurredTick: 0, status: "pending", selectedChoiceId: null }],
    playerKnowledge: [intelligence(7, 1), intelligence(8, 0)],
    research: [
      { tribeId: 1, queuedTechnologyIds: [], completedTechnologyIds: [], progress: [] },
      { tribeId: 2, queuedTechnologyIds: [], completedTechnologyIds: [], progress: [] },
    ],
  };
}

describe("diplomacy and events in the fixed-tick simulation", () => {
  it("applies unilateral relationship actions authoritatively", () => {
    const simulation = new GameSimulation(scenario());
    const snapshot = simulation.step({ tick: 0, commands: [{ kind: "take-diplomatic-action", sequence: 1, playerId: 7, tribeId: 1, targetTribeId: 2, action: "insult" }] });
    expect(snapshot.relations[0]).toMatchObject({ opinion: -10, trust: 10, tension: 30 });
  });

  it("accepts bilateral proposals and records the pact for both players", () => {
    const simulation = new GameSimulation(scenario());
    const snapshot = simulation.step({ tick: 0, commands: [{ kind: "respond-diplomatic-proposal", sequence: 1, playerId: 8, proposalId: 1, accept: true }] });
    expect(snapshot.diplomaticProposals).toHaveLength(0);
    expect(snapshot.relations[0]?.agreements).toEqual(["guest-right"]);
    expect(snapshot.events.filter(({ definitionId }) => definitionId === "pact-sealed")).toHaveLength(2);
  });

  it("resolves event choices into world state and preserves the chronicle", () => {
    const simulation = new GameSimulation(scenario());
    const snapshot = simulation.step({ tick: 0, commands: [{ kind: "resolve-event", sequence: 1, playerId: 7, eventId: 1, choiceId: "raise-shelters" }] });
    expect(snapshot.settlements.find(({ id }) => id === 1)?.population).toBe(42);
    expect(snapshot.events.find(({ id }) => id === 1)).toMatchObject({ status: "resolved", selectedChoiceId: "raise-shelters" });
  });
});
