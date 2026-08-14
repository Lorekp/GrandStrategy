import { describe, expect, it } from "vitest";
import type { TribeRelation } from "../core/model";
import {
  DIPLOMATIC_ACTIONS,
  applyRelationshipDelta,
  diplomaticRelationKey,
  proposalAcceptanceScore,
} from "./TribalDiplomacy";

const relation: TribeRelation = {
  firstTribeId: 1,
  secondTribeId: 2,
  stance: "neutral",
  opinion: 20,
  trust: 30,
  tension: 15,
  agreements: [],
  lastInteractionTick: -1_000,
};

describe("tribal diplomacy rules", () => {
  it("offers a broad, unique catalog of unilateral and bilateral actions", () => {
    expect(DIPLOMATIC_ACTIONS).toHaveLength(10);
    expect(new Set(DIPLOMATIC_ACTIONS.map(({ id }) => id)).size).toBe(10);
    expect(DIPLOMATIC_ACTIONS.filter(({ kind }) => kind === "proposal").length).toBeGreaterThanOrEqual(5);
  });

  it("clamps relationship axes and derives a readable stance", () => {
    const improved = applyRelationshipDelta(
      relation,
      { opinionDelta: 200, trustDelta: 100, tensionDelta: -100 },
      12,
    );
    expect(improved).toMatchObject({
      stance: "friendly",
      opinion: 100,
      trust: 100,
      tension: 0,
      lastInteractionTick: 12,
    });
  });

  it("scores proposals from opinion, trust, tension, and stance", () => {
    expect(proposalAcceptanceScore(relation)).toBe(35);
    expect(
      proposalAcceptanceScore({ ...relation, stance: "hostile", tension: 70 }),
    ).toBeLessThan(0);
    expect(diplomaticRelationKey(9, 3)).toBe("3:9");
  });
});
