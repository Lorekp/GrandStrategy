import { describe, expect, it } from "vitest";
import { createGridBitset } from "../core/GridBitset";
import type { ScenarioDefinition, Tribe } from "../core/model";
import { createSelfPlayScenario } from "./SelfPlayScenario";
import { TribalRlEnvironment, type RlAgentAction } from "./TribalRlEnvironment";

const westPosition = { longitudeE6: 22_580_000, latitudeE6: 37_980_000 } as const;
const eastPosition = { longitudeE6: 24_860_000, latitudeE6: 37_980_000 } as const;

function tribe(id: number, controllerPlayerId: number | null): Tribe {
  return {
    id,
    name: `Tribe ${id}`,
    cultureId: "test",
    terrainMovementModifiers: {},
    vegetationMovementModifiers: {},
    color: 0x778855 + id,
    controllerPlayerId,
    warriors: 0,
  };
}

function scenario(seed: number): ScenarioDefinition {
  return {
    seed,
    startWorldTime: { year: -9_999, month: 3, day: 1, hour: 6, minute: 0 },
    worldGrid: {
      projectionDefinition:
        "+proj=aeqd +lat_0=37.98 +lon_0=23.72 +ellps=WGS84 +units=m +no_defs",
      extentWidthMeters: 300_000,
      extentHeightMeters: 100_000,
      width: 3,
      height: 1,
      terrainCells: Uint8Array.of(1, 2, 3),
      vegetationCells: Uint8Array.of(1, 2, 3),
      moistureCells: Uint8Array.of(20, 100, 220),
      riverCells: Uint8Array.of(0, 1, 2),
      elevationMeters: Int16Array.of(10, 200, 800),
    },
    tribes: [tribe(1, 7), tribe(2, null)],
    settlements: [
      {
        id: 1,
        tribeId: 1,
        name: "West camp",
        position: westPosition,
        tier: "camp",
        population: 100,
        influenceRadiusMeters: 10_000,
        administrator: "tribal-leader",
        buildings: [],
      },
      {
        id: 2,
        tribeId: 2,
        name: "East camp",
        position: eastPosition,
        tier: "camp",
        population: 100,
        influenceRadiusMeters: 10_000,
        administrator: "tribal-leader",
        buildings: [],
      },
    ],
    units: [],
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
    diplomaticProposals: [],
    events: [],
    research: [
      {
        tribeId: 1,
        queuedTechnologyIds: [],
        completedTechnologyIds: [],
        progress: [],
      },
      {
        tribeId: 2,
        queuedTechnologyIds: [],
        completedTechnologyIds: [],
        progress: [],
      },
    ],
    playerKnowledge: [
      {
        playerId: 7,
        exploredCells: createGridBitset(3),
        settlementIntelligence: [],
        unitIntelligence: [],
      },
    ],
  };
}

function environment(
  ticksPerDecision = 1,
  maxEpisodeTicks = 10,
): TribalRlEnvironment {
  return new TribalRlEnvironment({
    scenarioFactory: scenario,
    ticksPerDecision,
    maxEpisodeTicks,
  });
}

function waitActions(): Record<`player:${number}`, RlAgentAction> {
  return {
    "player:7": { type: "wait" },
    "player:8": { type: "wait" },
  };
}

describe("createSelfPlayScenario", () => {
  it("assigns stable controllers, knowledge, and a complete relation graph", () => {
    const source = scenario(42);
    const third = tribe(3, null);
    const converted = createSelfPlayScenario({
      ...source,
      tribes: [...source.tribes, third],
      research: [
        ...source.research,
        {
          tribeId: 3,
          queuedTechnologyIds: [],
          completedTechnologyIds: [],
          progress: [],
        },
      ],
    });

    expect(converted.tribes.map((entry) => entry.controllerPlayerId)).toEqual([
      7,
      8,
      9,
    ]);
    expect(converted.playerKnowledge.map((entry) => entry.playerId)).toEqual([
      7,
      8,
      9,
    ]);
    expect(converted.relations).toHaveLength(3);
    expect(source.tribes[1]?.controllerPlayerId).toBeNull();
  });
});

describe("TribalRlEnvironment", () => {
  it("is deterministic across seeded reset and simultaneous action streams", () => {
    const first = environment();
    const second = environment();
    const firstReset = first.reset(123);
    const secondReset = second.reset(123);
    expect(firstReset).toEqual(secondReset);

    const actions = {
      "player:7": {
        type: "decision",
        decision: {
          kind: "select-research",
          tribeId: 1,
          technologyId: "seasonal-lore",
        },
      },
      "player:8": {
        type: "decision",
        decision: {
          kind: "select-research",
          tribeId: 2,
          technologyId: "seasonal-lore",
        },
      },
    } as const;
    expect(first.step(actions)).toEqual(second.step(actions));
    expect(first.stateHash).toBe(second.stateHash);
  });

  it("does not expose rival entities or unexplored semantic cells", () => {
    const reset = environment().reset(42);
    const west = reset.observations["player:7"]!;
    const east = reset.observations["player:8"]!;

    expect(west.state.tribes.map((entry) => entry.id)).toEqual([1]);
    expect(east.state.tribes.map((entry) => entry.id)).toEqual([2]);
    expect([...west.visibleWorld.cellIndices]).not.toContain(2);
    expect([...east.visibleWorld.cellIndices]).not.toContain(0);
    expect(west.visibleWorld.terrainCodes).toHaveLength(
      west.visibleWorld.cellIndices.length,
    );
    expect(west.visibleWorld.riverCodes).toHaveLength(
      west.visibleWorld.cellIndices.length,
    );
  });

  it("derives legal choices from the same player-filtered state", () => {
    const reset = environment().reset(42);
    const decisions = reset.observations["player:7"]!.legalActions.discrete;

    expect(decisions).toContainEqual({
      kind: "construct-building",
      settlementId: 1,
      building: "scout-post",
    });
    expect(decisions).toContainEqual({
      kind: "train-unit",
      settlementId: 1,
      unitKind: "scout",
    });
    expect(decisions).not.toContainEqual({
      kind: "construct-building",
      settlementId: 1,
      building: "hearth",
    });
    expect(
      decisions.some((decision) => decision.kind === "take-diplomatic-action"),
    ).toBe(false);
  });

  it("rejects actions outside the advertised mask", () => {
    const rlEnvironment = environment();
    rlEnvironment.reset(42);
    expect(() =>
      rlEnvironment.step({
        "player:7": {
          type: "decision",
          decision: {
            kind: "construct-building",
            settlementId: 1,
            building: "hearth",
          },
        },
        "player:8": { type: "wait" },
      }),
    ).toThrow("outside its legal mask");
  });

  it("applies both agents' decisions on the same authoritative tick", () => {
    const rlEnvironment = environment();
    rlEnvironment.reset(42);
    const result = rlEnvironment.step({
      "player:7": {
        type: "decision",
        decision: {
          kind: "select-research",
          tribeId: 1,
          technologyId: "seasonal-lore",
        },
      },
      "player:8": {
        type: "decision",
        decision: {
          kind: "select-research",
          tribeId: 2,
          technologyId: "seasonal-lore",
        },
      },
    });

    expect(result.observations["player:7"]!.state.research[0]?.queuedTechnologyIds).toEqual([
      "seasonal-lore",
    ]);
    expect(result.observations["player:8"]!.state.research[0]?.queuedTechnologyIds).toEqual([
      "seasonal-lore",
    ]);
  });

  it("reports episode time limits as truncation rather than defeat", () => {
    const rlEnvironment = environment(2, 3);
    rlEnvironment.reset(42);
    const first = rlEnvironment.step(waitActions());
    const last = rlEnvironment.step(waitActions());

    expect(first.truncated.__all__).toBe(false);
    expect(last.infos["player:7"]?.ticksAdvanced).toBe(1);
    expect(last.truncated).toMatchObject({
      __all__: true,
      "player:7": true,
      "player:8": true,
    });
    expect(last.terminated.__all__).toBe(false);
    expect(() => rlEnvironment.step(waitActions())).toThrow(
      "stepping a finished episode",
    );
  });
});
