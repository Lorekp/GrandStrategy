import { describe, expect, it } from "vitest";
import type { BattleFormation, Unit } from "../core/model";
import { cultureMilitaryUnits } from "./MilitaryRoster";
import { resolveBattleRound, resolveGroupBattleRound } from "./BattleResolver";

const [closeDefinition, rangedDefinition] = cultureMilitaryUnits("hellenic-balkan");

function combatUnit(
  id: number,
  tribeId: number,
  kind: string,
  formation: BattleFormation,
  experience = 0,
): Unit {
  const definition = kind === closeDefinition.id ? closeDefinition : rangedDefinition;
  return {
    id,
    tribeId,
    homeSettlementId: tribeId,
    kind,
    position: { longitudeE6: id * 10, latitudeE6: 0 },
    route: [],
    terrain: "plains",
    vegetation: "none",
    vegetationDensity: "none",
    speedMetersPerHour: 5_000,
    slopeDegrees: 0,
    remainingTravelMinutes: null,
    combat: {
      strength: definition.warriors,
      maximumStrength: definition.warriors,
      moralePermille: 1_000,
      cohesionPermille: 1_000,
      fatiguePermille: 0,
      missileReadinessPermille: 1_000,
      experience,
      status: "ready",
      order: {
        targetUnitId: id === 1 ? 2 : 1,
        doctrine: "balanced",
        formation,
        pursuit: "controlled",
        issuedTick: 0,
        engagementRounds: 0,
      },
    },
  };
}

const openGround = {
  terrain: "plains" as const,
  vegetation: "none" as const,
  attackerElevationMeters: 0,
  defenderElevationMeters: 0,
  attackerSlopeDegrees: 0,
  riverCrossing: "none" as const,
  ambushSide: "none" as const,
  distanceMeters: 80,
  isNight: false,
};

describe("BattleResolver", () => {
  it("is replay-deterministic and lets ranged pressure act before melee contact", () => {
    const ranged = combatUnit(1, 1, rangedDefinition.id, "loose");
    const close = combatUnit(2, 2, closeDefinition.id, "guard");
    const first = resolveBattleRound(
      { unit: ranged, completedTechnologyIds: new Set() },
      { unit: close, completedTechnologyIds: new Set() },
      openGround,
      44,
      10,
    );
    const replay = resolveBattleRound(
      { unit: ranged, completedTechnologyIds: new Set() },
      { unit: close, completedTechnologyIds: new Set() },
      openGround,
      44,
      10,
    );
    expect(first).toEqual(replay);
    expect(first.phase).toBe("missile");
    expect(first.exchanges.map((exchange) => exchange.sourceUnitId)).toEqual([1]);
    expect(first.defenderCombat.moralePermille).toBeLessThan(1_000);
    expect(first.attackerCombat.missileReadinessPermille).toBeLessThan(1_000);
  });

  it("resolves mutual melee with fatigue, cohesion, morale, casualties, and XP", () => {
    const first = combatUnit(1, 1, closeDefinition.id, "line", 300);
    const second = combatUnit(2, 2, closeDefinition.id, "guard");
    const result = resolveBattleRound(
      { unit: first, completedTechnologyIds: new Set(["hafted-polished-tools", "weaving"]) },
      { unit: second, completedTechnologyIds: new Set() },
      { ...openGround, terrain: "hills", distanceMeters: 40, attackerElevationMeters: 130 },
      9,
      20,
    );
    expect(result.phase).toBe("melee");
    expect(result.exchanges).toHaveLength(2);
    expect(result.attackerCombat.fatiguePermille).toBeGreaterThan(0);
    expect(result.defenderCombat.cohesionPermille).toBeLessThan(1_000);
    expect(result.attackerCombat.experience).toBeGreaterThan(300);
    expect(result.exchanges[0]?.modifiers).toContain("high-ground");
  });

  it("lets a nearby close screen and ranged group fight as combined arms", () => {
    const close = combatUnit(1, 1, closeDefinition.id, "guard");
    const ranged = combatUnit(3, 1, rangedDefinition.id, "loose");
    const defender = combatUnit(2, 2, closeDefinition.id, "guard");
    const result = resolveGroupBattleRound(
      [
        { unit: close, completedTechnologyIds: new Set() },
        { unit: ranged, completedTechnologyIds: new Set(["cordage-basketry"]) },
      ],
      [{ unit: defender, completedTechnologyIds: new Set() }],
      { ...openGround, distanceMeters: 80 },
      77,
      10,
    );
    expect(result.exchanges.map((exchange) => exchange.sourceUnitId)).toEqual([3]);
    expect(result.attackerCombats).toHaveLength(2);
    expect(result.defenderCombats[0]!.moralePermille).toBeLessThan(1_000);
    expect(result.exchanges[0]?.modifiers).toContain("combined-arms");
  });

  it("penalizes a steep uphill assault and rewards the defender's slope", () => {
    const attacker = combatUnit(1, 1, closeDefinition.id, "line", 700);
    const defender = combatUnit(2, 2, closeDefinition.id, "line");
    const level = resolveBattleRound(
      { unit: attacker, completedTechnologyIds: new Set(["hafted-polished-tools"]) },
      { unit: defender, completedTechnologyIds: new Set() },
      { ...openGround, distanceMeters: 40 },
      101,
      20,
    );
    const uphill = resolveBattleRound(
      { unit: attacker, completedTechnologyIds: new Set(["hafted-polished-tools"]) },
      { unit: defender, completedTechnologyIds: new Set() },
      {
        ...openGround,
        distanceMeters: 40,
        attackerElevationMeters: 0,
        defenderElevationMeters: 140,
        attackerSlopeDegrees: 18,
      },
      101,
      20,
    );
    const levelAttack = level.exchanges.find((exchange) => exchange.sourceUnitId === 1)!;
    const uphillAttack = uphill.exchanges.find((exchange) => exchange.sourceUnitId === 1)!;
    expect(uphillAttack.moraleLossPermille).toBeLessThan(levelAttack.moraleLossPermille);
    expect(uphillAttack.modifiers).toContain("uphill-assault");
  });

  it("turns a major river assault into a narrow, exhausting crossing", () => {
    const attackers = [1, 3, 4].map((id) => ({
      unit: combatUnit(id, 1, closeDefinition.id, "line"),
      completedTechnologyIds: new Set<string>(),
    }));
    const defenders = [2, 5].map((id) => ({
      unit: combatUnit(id, 2, closeDefinition.id, "guard"),
      completedTechnologyIds: new Set<string>(),
    }));
    const result = resolveGroupBattleRound(
      attackers,
      defenders,
      { ...openGround, distanceMeters: 40, riverCrossing: "major" },
      202,
      30,
    );
    expect(result.exchanges.filter((exchange) => exchange.sourceUnitId === 1)).toHaveLength(1);
    expect(result.exchanges.filter((exchange) => [1, 3, 4].includes(exchange.sourceUnitId))).toHaveLength(1);
    expect(result.attackerCombats[0]!.fatiguePermille).toBeGreaterThan(result.defenderCombats[0]!.fatiguePermille);
    expect(result.attackerCombats[0]!.cohesionPermille).toBeLessThan(result.attackerCombats[1]!.cohesionPermille);
    expect(result.exchanges[0]?.modifiers).toContain("major-river-crossing");
  });

  it("gives a prepared defender in concealment one decisive ambush round", () => {
    const attacker = combatUnit(1, 1, closeDefinition.id, "line");
    const defender = combatUnit(2, 2, rangedDefinition.id, "loose");
    const result = resolveBattleRound(
      { unit: attacker, completedTechnologyIds: new Set() },
      { unit: defender, completedTechnologyIds: new Set() },
      {
        ...openGround,
        vegetation: "forest",
        distanceMeters: 80,
        ambushSide: "defender",
      },
      303,
      40,
    );
    expect(result.exchanges).toHaveLength(1);
    expect(result.exchanges[0]?.sourceUnitId).toBe(2);
    expect(result.exchanges[0]?.modifiers).toContain("ambush");
    expect(result.attackerCombat.moralePermille).toBeLessThan(900);
    expect(result.attackerCombat.cohesionPermille).toBeLessThan(850);
  });

  it("routes a broken formation and applies its pursuer's declared policy", () => {
    const attacker = combatUnit(1, 1, closeDefinition.id, "line");
    const defender = combatUnit(2, 2, closeDefinition.id, "line");
    const weakened: Unit = {
      ...defender,
      combat: { ...defender.combat!, moralePermille: 190, cohesionPermille: 250, strength: 3 },
    };
    const result = resolveBattleRound(
      { unit: attacker, completedTechnologyIds: new Set(["hafted-polished-tools"]) },
      { unit: weakened, completedTechnologyIds: new Set() },
      { ...openGround, distanceMeters: 30 },
      5,
      30,
    );
    expect(result.defenderRouted).toBe(true);
    expect(result.defenderCombat.status).toBe("routed");
    expect(result.defenderCombat.order).toBeNull();
  });
});
