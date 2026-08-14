import { describe, expect, it } from "vitest";
import type { TribalEventContext } from "./TribalEvents";
import {
  TRIBAL_EVENTS,
  chooseWeightedEvent,
  deterministicEventRoll,
  eventIsEligible,
} from "./TribalEvents";

const context: TribalEventContext = {
  tribe: { id: 1, name: "Attic", cultureId: "test", terrainMovementModifiers: {}, vegetationMovementModifiers: {}, color: 0xffffff, controllerPlayerId: 7, warriors: 2 },
  settlements: [{ id: 1, tribeId: 1, name: "Camp", position: { longitudeE6: 0, latitudeE6: 0 }, tier: "camp", population: 40, influenceRadiusMeters: 1_000, administrator: "tribal-leader", buildings: [] }],
  units: [{ id: 1, tribeId: 1, homeSettlementId: 1, kind: "scout", position: { longitudeE6: 0, latitudeE6: 0 }, route: [], terrain: "plains", vegetation: "none", vegetationDensity: "none", speedMetersPerHour: 5_000, slopeDegrees: 0, remainingTravelMinutes: null, combat: null }],
  research: { tribeId: 1, queuedTechnologyIds: ["seasonal-lore"], completedTechnologyIds: [], progress: [] },
  knownTribeIds: [2],
};

describe("tribal event catalog", () => {
  it("contains a large choice-driven catalog across every gameplay category", () => {
    expect(TRIBAL_EVENTS.length).toBeGreaterThanOrEqual(39);
    const periodic = TRIBAL_EVENTS.filter(({ trigger }) => trigger === "periodic");
    expect(periodic.every(({ choices }) => choices.length === 2)).toBe(true);
    expect(new Set(TRIBAL_EVENTS.map(({ category }) => category))).toEqual(
      new Set(["diplomatic", "scout", "camp", "research", "conflict", "society"]),
    );
  });

  it("uses deterministic weighted selection", () => {
    const eligible = TRIBAL_EVENTS.filter((event) => eventIsEligible(event, context));
    const roll = deterministicEventRoll(77, 144, 1, "definition");
    expect(chooseWeightedEvent(eligible, roll)?.id).toBe(
      chooseWeightedEvent(eligible, roll)?.id,
    );
  });

  it("filters events against the current world context", () => {
    const contact = TRIBAL_EVENTS.find(({ id }) => id === "disputed-hunting-ground")!;
    expect(eventIsEligible(contact, context)).toBe(true);
    expect(eventIsEligible(contact, { ...context, knownTribeIds: [] })).toBe(false);
  });
});
