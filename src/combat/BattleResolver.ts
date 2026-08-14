import battleSource from "../config/battle.json";
import type {
  TerrainType,
  Unit,
  UnitCombatState,
  RiverClass,
  VegetationType,
} from "../core/model";
import {
  cultureMilitaryTrait,
  tribalUnitDefinition,
  type MilitaryCombatDefinition,
} from "./MilitaryRoster";

const PERMILLE = 1_000;

export interface BattleParticipant {
  readonly unit: Unit;
  readonly completedTechnologyIds: ReadonlySet<string>;
}

export interface BattleEnvironment {
  readonly terrain: TerrainType;
  readonly vegetation: VegetationType;
  readonly attackerElevationMeters: number;
  readonly defenderElevationMeters: number;
  /** Positive when the attacker climbs toward the defender. */
  readonly attackerSlopeDegrees: number;
  readonly riverCrossing: RiverClass;
  readonly ambushSide: "none" | "attacker" | "defender";
  readonly distanceMeters: number;
  readonly isNight: boolean;
}

export type BattlePhase = "missile" | "closing" | "melee" | "rout";

export interface BattleExchange {
  readonly sourceUnitId: number;
  readonly targetUnitId: number;
  readonly casualties: number;
  readonly moraleLossPermille: number;
  readonly cohesionLossPermille: number;
  readonly modifiers: readonly string[];
}

export interface BattleRoundResult {
  readonly phase: BattlePhase;
  readonly attackerCombat: UnitCombatState;
  readonly defenderCombat: UnitCombatState;
  readonly exchanges: readonly BattleExchange[];
  readonly attackerRouted: boolean;
  readonly defenderRouted: boolean;
}

export interface GroupBattleRoundResult {
  readonly phase: BattlePhase;
  readonly attackerCombats: readonly UnitCombatState[];
  readonly defenderCombats: readonly UnitCombatState[];
  readonly exchanges: readonly BattleExchange[];
  readonly attackersRouted: boolean;
  readonly defendersRouted: boolean;
}

interface NumericModifier {
  readonly attackPermille: number;
  readonly defensePermille: number;
  readonly rangedPermille: number;
  readonly armorPermille: number;
}

interface PreparedParticipant {
  readonly participant: BattleParticipant;
  readonly definition: MilitaryCombatDefinition;
  readonly attackPower: number;
  readonly defensePower: number;
  readonly modifiers: readonly string[];
  readonly side: "attacker" | "defender";
  readonly surprised: boolean;
}

interface GroupTactics {
  readonly combinedArms: boolean;
  readonly flankingExtraUnits: number;
}

interface Config {
  readonly roundWorldMinutes: number;
  readonly supportRadiusMeters: number;
  readonly meleeRangeMeters: number;
  readonly routMoralePermille: number;
  readonly rallyMoralePermille: number;
  readonly baseCasualtyPermille: number;
  readonly baseFatiguePerRound: number;
  readonly restRecoveryPerRound: number;
  readonly casualtyMoraleLossPermille: number;
  readonly outnumberedMoraleLossPermille: number;
  readonly nightRangedFactorPermille: number;
  readonly maximumElevationBonusPermille: number;
  readonly elevationBonusPerHundredMetersPermille: number;
  readonly highGroundRangedBonusPerHundredMetersPermille: number;
  readonly maximumHighGroundRangedBonusPermille: number;
  readonly uphillAttackPenaltyPerDegreePermille: number;
  readonly maximumUphillAttackPenaltyPermille: number;
  readonly downhillCloseBonusPerDegreePermille: number;
  readonly maximumDownhillCloseBonusPermille: number;
  readonly slopeDefenseBonusPerDegreePermille: number;
  readonly maximumSlopeDefenseBonusPermille: number;
  readonly steepSlopeDegrees: number;
  readonly verySteepSlopeDegrees: number;
  readonly combinedArmsAttackPermille: number;
  readonly flankingAttackPerExtraUnitPermille: number;
  readonly maximumFlankingAttackBonusPermille: number;
  readonly flankedMoraleLossPermille: number;
  readonly ambushAttackPermille: number;
  readonly ambushRangedPermille: number;
  readonly surprisedAttackPermille: number;
  readonly surprisedMoraleLossPermille: number;
  readonly surprisedCohesionLossPermille: number;
  readonly seededRollMinimumPermille: number;
  readonly seededRollMaximumPermille: number;
  readonly experiencePerCasualty: number;
  readonly experiencePerRound: number;
  readonly pursuitCasualtyPermille: Readonly<Record<string, number>>;
  readonly pursuitFatigue: Readonly<Record<string, number>>;
  readonly doctrines: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly formations: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly terrainDefensePermille: Readonly<Record<TerrainType, number>>;
  readonly terrainFatiguePermille: Readonly<Record<TerrainType, number>>;
  readonly vegetationRangedPermille: Readonly<Record<VegetationType, number>>;
  readonly vegetationDefensePermille: Readonly<Record<VegetationType, number>>;
  readonly riverCrossings: Readonly<Record<RiverClass, Readonly<{
    readonly closeAttackPermille: number;
    readonly rangedAttackPermille: number;
    readonly defenderDefensePermille: number;
    readonly attackerFatigue: number;
    readonly attackerCohesionLossPermille: number;
    readonly maximumAttackerFrontage: number;
  }>>>;
  readonly veterancy: readonly {
    readonly id: string;
    readonly minimumExperience: number;
    readonly powerPermille: number;
    readonly moraleBonusPermille: number;
  }[];
  readonly technologyUpgrades: readonly {
    readonly id: string;
    readonly technologyId: string;
    readonly roles: readonly string[];
    readonly attackPermille: number;
    readonly defensePermille: number;
    readonly rangedPermille: number;
    readonly armorPermille: number;
  }[];
}

export const BATTLE_CONFIG = battleSource as Config;

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function multiply(...values: number[]): number {
  return values.reduce((value, factor) => Math.round((value * factor) / PERMILLE), PERMILLE);
}

function deterministicRoll(seed: number, tick: number, sourceId: number, targetId: number): number {
  let value = (seed ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ sourceId, 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ targetId, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  const span = BATTLE_CONFIG.seededRollMaximumPermille - BATTLE_CONFIG.seededRollMinimumPermille;
  return BATTLE_CONFIG.seededRollMinimumPermille + (value % (span + 1));
}

export function veterancyRank(experience: number): string {
  return [...BATTLE_CONFIG.veterancy]
    .reverse()
    .find((rank) => experience >= rank.minimumExperience)?.id ?? "unblooded";
}

function veterancy(experience: number): Config["veterancy"][number] {
  return [...BATTLE_CONFIG.veterancy]
    .reverse()
    .find((rank) => experience >= rank.minimumExperience) ?? BATTLE_CONFIG.veterancy[0]!;
}

function technologyModifier(
  definition: MilitaryCombatDefinition,
  technologies: ReadonlySet<string>,
): NumericModifier {
  let attackPermille = PERMILLE;
  let defensePermille = PERMILLE;
  let rangedPermille = PERMILLE;
  let armorPermille = PERMILLE;
  for (const upgrade of BATTLE_CONFIG.technologyUpgrades) {
    if (!technologies.has(upgrade.technologyId) || !upgrade.roles.includes(definition.role)) continue;
    attackPermille = multiply(attackPermille, upgrade.attackPermille);
    defensePermille = multiply(defensePermille, upgrade.defensePermille);
    rangedPermille = multiply(rangedPermille, upgrade.rangedPermille);
    armorPermille = multiply(armorPermille, upgrade.armorPermille);
  }
  return { attackPermille, defensePermille, rangedPermille, armorPermille };
}

function prepare(
  participant: BattleParticipant,
  environment: BattleEnvironment,
  elevationDifferenceMeters: number,
  side: "attacker" | "defender",
  tactics: GroupTactics,
): PreparedParticipant {
  const unitDefinition = tribalUnitDefinition(participant.unit.kind);
  const definition = unitDefinition.combat;
  const state = participant.unit.combat;
  if (!definition || !state) throw new Error("Battle participants must be combat units");
  const order = state.order ?? {
    doctrine: "balanced" as const,
    formation: definition.formations[0] ?? "line" as const,
    pursuit: "controlled" as const,
  };
  if (!definition.formations.includes(order.formation)) {
    throw new Error(`${participant.unit.kind} cannot use ${order.formation}`);
  }
  const doctrine = BATTLE_CONFIG.doctrines[order.doctrine]!;
  const formation = BATTLE_CONFIG.formations[order.formation]!;
  const trait = cultureMilitaryTrait(definition.traitId);
  const technology = technologyModifier(definition, participant.completedTechnologyIds);
  const rank = veterancy(state.experience);
  const strength = Math.max(1, Math.round((state.strength * PERMILLE) / state.maximumStrength));
  const morale = 600 + Math.round(state.moralePermille * 0.4);
  const cohesion = 400 + Math.round(state.cohesionPermille * 0.6);
  const freshness = 1_100 - Math.round(state.fatiguePermille * 0.65);
  const rangedEnvironment = multiply(
    BATTLE_CONFIG.vegetationRangedPermille[environment.vegetation],
    environment.isNight ? BATTLE_CONFIG.nightRangedFactorPermille : PERMILLE,
  );
  const elevation = clampInteger(
    Math.round((elevationDifferenceMeters / 100) * BATTLE_CONFIG.elevationBonusPerHundredMetersPermille),
    -BATTLE_CONFIG.maximumElevationBonusPermille,
    BATTLE_CONFIG.maximumElevationBonusPermille,
  );
  const elevationAttack = PERMILLE + elevation;
  const uphillDegrees = side === "attacker" ? Math.max(0, environment.attackerSlopeDegrees) : 0;
  const downhillDegrees = side === "attacker" ? Math.max(0, -environment.attackerSlopeDegrees) : 0;
  const uphillAttack = PERMILLE - Math.min(
    BATTLE_CONFIG.maximumUphillAttackPenaltyPermille,
    Math.round(uphillDegrees * BATTLE_CONFIG.uphillAttackPenaltyPerDegreePermille),
  );
  const downhillAttack = definition.role === "close"
    ? PERMILLE + Math.min(
        BATTLE_CONFIG.maximumDownhillCloseBonusPermille,
        Math.round(downhillDegrees * BATTLE_CONFIG.downhillCloseBonusPerDegreePermille),
      )
    : PERMILLE;
  const slopeDefense = side === "defender"
    ? PERMILLE + Math.min(
        BATTLE_CONFIG.maximumSlopeDefenseBonusPermille,
        Math.round(Math.max(0, environment.attackerSlopeDegrees) * BATTLE_CONFIG.slopeDefenseBonusPerDegreePermille),
      )
    : PERMILLE;
  const rangedHighGround = definition.role === "ranged" && elevationDifferenceMeters > 0
    ? PERMILLE + Math.min(
        BATTLE_CONFIG.maximumHighGroundRangedBonusPermille,
        Math.round((elevationDifferenceMeters / 100) * BATTLE_CONFIG.highGroundRangedBonusPerHundredMetersPermille),
      )
    : PERMILLE;
  const river = BATTLE_CONFIG.riverCrossings[environment.riverCrossing];
  const riverAttack = side === "attacker"
    ? definition.role === "close"
      ? river.closeAttackPermille
      : river.rangedAttackPermille
    : PERMILLE;
  const riverDefense = side === "defender" ? river.defenderDefensePermille : PERMILLE;
  const isAmbusher = environment.ambushSide === side;
  const surprised = environment.ambushSide !== "none" && environment.ambushSide !== side;
  const ambushAttack = isAmbusher
    ? definition.role === "ranged"
      ? BATTLE_CONFIG.ambushRangedPermille
      : BATTLE_CONFIG.ambushAttackPermille
    : surprised
      ? BATTLE_CONFIG.surprisedAttackPermille
      : PERMILLE;
  const combinedArms = tactics.combinedArms ? BATTLE_CONFIG.combinedArmsAttackPermille : PERMILLE;
  const flanking = PERMILLE + Math.min(
    BATTLE_CONFIG.maximumFlankingAttackBonusPermille,
    tactics.flankingExtraUnits * BATTLE_CONFIG.flankingAttackPerExtraUnitPermille,
  );
  const terrainAttack = trait.terrainAttackPermille[environment.terrain] ?? PERMILLE;
  const vegetationAttack = trait.vegetationAttackPermille[environment.vegetation] ?? PERMILLE;
  const terrainDefense = multiply(
    BATTLE_CONFIG.terrainDefensePermille[environment.terrain],
    trait.terrainDefensePermille[environment.terrain] ?? PERMILLE,
    BATTLE_CONFIG.vegetationDefensePermille[environment.vegetation],
    trait.vegetationDefensePermille[environment.vegetation] ?? PERMILLE,
  );
  const baseAttack = definition.role === "ranged" && environment.distanceMeters > BATTLE_CONFIG.meleeRangeMeters
    ? definition.ranged
    : definition.attack;
  const roleFactor = definition.role === "ranged"
    ? multiply(formation.rangedPermille!, trait.rangedPermille, technology.rangedPermille, rangedEnvironment)
    : multiply(formation.attackPermille!, trait.attackPermille, technology.attackPermille);
  const attackPower = Math.max(1, Math.round(baseAttack * multiply(
    strength,
    morale,
    cohesion,
    freshness,
    doctrine.attackPermille!,
    roleFactor,
    rank.powerPermille,
    terrainAttack,
    vegetationAttack,
    elevationAttack,
    uphillAttack,
    downhillAttack,
    rangedHighGround,
    riverAttack,
    ambushAttack,
    combinedArms,
    flanking,
  ) / PERMILLE));
  const defensePower = Math.max(1, Math.round((definition.defense + definition.armor * 0.5) * multiply(
    strength,
    morale,
    cohesion,
    freshness,
    doctrine.defensePermille!,
    formation.defensePermille!,
    trait.defensePermille,
    technology.defensePermille,
    technology.armorPermille,
    rank.powerPermille,
    terrainDefense,
    slopeDefense,
    riverDefense,
  ) / PERMILLE));
  const modifiers = [
    elevation > 0 ? "high-ground" : elevation < 0 ? "uphill" : "level-ground",
    environment.vegetation === "none" ? environment.terrain : environment.vegetation,
    rank.id,
    trait.name,
    order.formation,
    ...(uphillDegrees >= 1 ? ["uphill-assault"] : []),
    ...(downhillDegrees >= 1 && definition.role === "close" ? ["downhill-charge"] : []),
    ...(environment.riverCrossing !== "none" ? [`${environment.riverCrossing}-river-crossing`] : []),
    ...(isAmbusher ? ["ambush"] : []),
    ...(surprised ? ["surprised"] : []),
    ...(tactics.combinedArms ? ["combined-arms"] : []),
    ...(tactics.flankingExtraUnits > 0 ? ["flanking"] : []),
  ];
  return { participant, definition, attackPower, defensePower, modifiers, side, surprised };
}

function canAttack(prepared: PreparedParticipant, distanceMeters: number): boolean {
  const state = prepared.participant.unit.combat!;
  if (state.status === "routed") return false;
  if (prepared.definition.role === "ranged") {
    return distanceMeters <= prepared.definition.rangeMeters && state.missileReadinessPermille >= 100;
  }
  return distanceMeters <= BATTLE_CONFIG.meleeRangeMeters;
}

function exchange(
  source: PreparedParticipant,
  target: PreparedParticipant,
  seed: number,
  tick: number,
): BattleExchange {
  const sourceState = source.participant.unit.combat!;
  const targetState = target.participant.unit.combat!;
  const rolledPower = multiply(source.attackPower, deterministicRoll(seed, tick, source.participant.unit.id, target.participant.unit.id));
  const ratioPermille = clampInteger(
    Math.round((rolledPower * PERMILLE) / Math.max(1, target.defensePower)),
    250,
    2_500,
  );
  const expected = sourceState.strength * BATTLE_CONFIG.baseCasualtyPermille * ratioPermille / 1_000_000;
  const casualties = clampInteger(expected, expected >= 0.55 ? 1 : 0, Math.max(1, Math.floor(targetState.strength / 4)));
  const pressure = clampInteger((ratioPermille - 700) / 4, 0, 260);
  return {
    sourceUnitId: source.participant.unit.id,
    targetUnitId: target.participant.unit.id,
    casualties,
    moraleLossPermille: clampInteger(casualties * BATTLE_CONFIG.casualtyMoraleLossPermille + pressure, 15, 420),
    cohesionLossPermille: clampInteger(35 + pressure + casualties * 28, 25, 380),
    modifiers: source.modifiers,
  };
}

function applyExchange(
  state: UnitCombatState,
  received: BattleExchange | undefined,
  dealtCasualties: number,
  prepared: PreparedParticipant,
  environment: BattleEnvironment,
  outnumberedBy: number,
): UnitCombatState {
  const definition = prepared.definition;
  const order = state.order;
  const doctrine = BATTLE_CONFIG.doctrines[order?.doctrine ?? "balanced"]!;
  const trait = cultureMilitaryTrait(definition.traitId);
  const formation = BATTLE_CONFIG.formations[order?.formation ?? definition.formations[0] ?? "line"]!;
  const fatigue = Math.round(BATTLE_CONFIG.baseFatiguePerRound * multiply(
    doctrine.fatiguePermille!,
    formation.fatiguePermille!,
    trait.fatiguePermille,
    BATTLE_CONFIG.terrainFatiguePermille[environment.terrain],
  ) / PERMILLE);
  const river = BATTLE_CONFIG.riverCrossings[environment.riverCrossing];
  const riverFatigue = prepared.side === "attacker" ? river.attackerFatigue : 0;
  const openingMoraleLoss = prepared.surprised ? BATTLE_CONFIG.surprisedMoraleLossPermille : 0;
  const outnumberedMoraleLoss = Math.max(0, outnumberedBy) * BATTLE_CONFIG.outnumberedMoraleLossPermille;
  const flankedMoraleLoss = outnumberedBy > 0 ? BATTLE_CONFIG.flankedMoraleLossPermille : 0;
  const openingCohesionLoss = prepared.surprised ? BATTLE_CONFIG.surprisedCohesionLossPermille : 0;
  const riverCohesionLoss = prepared.side === "attacker" ? river.attackerCohesionLossPermille : 0;
  const strength = Math.max(0, state.strength - (received?.casualties ?? 0));
  const moralePermille = clampInteger(
    state.moralePermille - (received?.moraleLossPermille ?? 0) - openingMoraleLoss - outnumberedMoraleLoss - flankedMoraleLoss,
    0,
    PERMILLE,
  );
  const cohesionPermille = clampInteger(
    state.cohesionPermille - (received?.cohesionLossPermille ?? 0) - openingCohesionLoss - riverCohesionLoss,
    0,
    PERMILLE,
  );
  const status = strength === 0 || moralePermille <= BATTLE_CONFIG.routMoralePermille
    ? "routed"
    : moralePermille < 400 || cohesionPermille < 350
      ? "wavering"
      : "ready";
  return {
    ...state,
    strength,
    moralePermille,
    cohesionPermille,
    fatiguePermille: clampInteger(state.fatiguePermille + fatigue + riverFatigue, 0, PERMILLE),
    missileReadinessPermille: definition.role === "ranged"
      ? clampInteger(state.missileReadinessPermille - 140, 0, PERMILLE)
      : state.missileReadinessPermille,
    experience: state.experience + BATTLE_CONFIG.experiencePerRound + dealtCasualties * BATTLE_CONFIG.experiencePerCasualty,
    status,
    order: status === "routed" ? null : state.order,
  };
}

function applyPursuit(
  pursuer: UnitCombatState,
  routed: UnitCombatState,
): [UnitCombatState, UnitCombatState] {
  const policy = pursuer.order?.pursuit ?? "controlled";
  const casualties = clampInteger(
    routed.strength * (BATTLE_CONFIG.pursuitCasualtyPermille[policy] ?? 0) / PERMILLE,
    0,
    Math.max(0, routed.strength - 1),
  );
  return [
    {
      ...pursuer,
      fatiguePermille: clampInteger(
        pursuer.fatiguePermille + (BATTLE_CONFIG.pursuitFatigue[policy] ?? 0),
        0,
        PERMILLE,
      ),
      experience: pursuer.experience + casualties * BATTLE_CONFIG.experiencePerCasualty,
    },
    { ...routed, strength: Math.max(0, routed.strength - casualties) },
  ];
}

export function resolveBattleRound(
  attacker: BattleParticipant,
  defender: BattleParticipant,
  environment: BattleEnvironment,
  seed: number,
  tick: number,
): BattleRoundResult {
  const group = resolveGroupBattleRound(
    [attacker],
    [defender],
    environment,
    seed,
    tick,
  );
  return {
    phase: group.phase,
    attackerCombat: group.attackerCombats[0]!,
    defenderCombat: group.defenderCombats[0]!,
    exchanges: group.exchanges,
    attackerRouted: group.attackersRouted,
    defenderRouted: group.defendersRouted,
  };
}

function aggregateExchanges(
  exchanges: readonly BattleExchange[],
  targetUnitId: number,
): BattleExchange | undefined {
  const received = exchanges.filter((exchange) => exchange.targetUnitId === targetUnitId);
  const first = received[0];
  if (!first) return undefined;
  return {
    ...first,
    casualties: received.reduce((sum, exchange) => sum + exchange.casualties, 0),
    moraleLossPermille: clampInteger(
      received.reduce((sum, exchange) => sum + exchange.moraleLossPermille, 0),
      0,
      600,
    ),
    cohesionLossPermille: clampInteger(
      received.reduce((sum, exchange) => sum + exchange.cohesionLossPermille, 0),
      0,
      600,
    ),
    modifiers: received.length > 1
      ? ["concentrated-attack", ...first.modifiers].slice(0, 12)
      : first.modifiers,
  };
}

function terrainFrontage(environment: BattleEnvironment): number {
  if (environment.vegetation === "jungle" || environment.terrain === "mountains") return 2;
  if (environment.vegetation === "forest" || environment.terrain === "hills") return 3;
  return 4;
}

function attackerFrontage(environment: BattleEnvironment): number {
  const terrain = terrainFrontage(environment);
  const river = BATTLE_CONFIG.riverCrossings[environment.riverCrossing].maximumAttackerFrontage;
  const slope = environment.attackerSlopeDegrees >= BATTLE_CONFIG.verySteepSlopeDegrees
    ? 1
    : environment.attackerSlopeDegrees >= BATTLE_CONFIG.steepSlopeDegrees
      ? Math.max(1, terrain - 1)
      : terrain;
  return Math.min(terrain, river, slope);
}

function groupTactics(
  group: readonly BattleParticipant[],
  opposingCount: number,
): GroupTactics {
  const roles = new Set(group.map((participant) => tribalUnitDefinition(participant.unit.kind).combat?.role));
  return {
    combinedArms: roles.has("close") && roles.has("ranged"),
    flankingExtraUnits: Math.max(0, group.length - opposingCount),
  };
}

/** Resolves a small Theater battle without creating a second tactical map. */
export function resolveGroupBattleRound(
  attackers: readonly BattleParticipant[],
  defenders: readonly BattleParticipant[],
  environment: BattleEnvironment,
  seed: number,
  tick: number,
): GroupBattleRoundResult {
  if (attackers.length === 0 || defenders.length === 0) {
    throw new Error("A battle needs participants on both sides");
  }
  const attackerLimit = attackerFrontage(environment);
  const defenderLimit = terrainFrontage(environment);
  const orderedAttackers = [...attackers].sort((left, right) => left.unit.id - right.unit.id);
  const orderedDefenders = [...defenders].sort((left, right) => left.unit.id - right.unit.id);
  const activeAttackers = orderedAttackers.slice(0, attackerLimit);
  const activeDefenders = orderedDefenders.slice(0, defenderLimit);
  const attackerTactics = groupTactics(activeAttackers, activeDefenders.length);
  const defenderTactics = groupTactics(activeDefenders, activeAttackers.length);
  const attackerPrepared = activeAttackers.map((participant) => prepare(
    participant,
    environment,
    environment.attackerElevationMeters - environment.defenderElevationMeters,
    "attacker",
    attackerTactics,
  ));
  const defenderPrepared = activeDefenders.map((participant) => prepare(
    participant,
    environment,
    environment.defenderElevationMeters - environment.attackerElevationMeters,
    "defender",
    defenderTactics,
  ));
  const exchanges: BattleExchange[] = [];
  for (let index = 0; index < attackerPrepared.length; index += 1) {
    const source = attackerPrepared[index]!;
    const target = defenderPrepared[index % defenderPrepared.length]!;
    if (canAttack(source, environment.distanceMeters)) {
      exchanges.push(exchange(source, target, seed, tick));
    }
  }
  for (let index = 0; index < defenderPrepared.length; index += 1) {
    const source = defenderPrepared[index]!;
    const target = attackerPrepared[index % attackerPrepared.length]!;
    if (canAttack(source, environment.distanceMeters)) {
      exchanges.push(exchange(source, target, seed, tick));
    }
  }
  let attackerCombats = attackerPrepared.map((prepared) => {
    const received = aggregateExchanges(exchanges, prepared.participant.unit.id);
    const dealt = exchanges
      .filter((exchange) => exchange.sourceUnitId === prepared.participant.unit.id)
      .reduce((sum, exchange) => sum + exchange.casualties, 0);
    return applyExchange(
      prepared.participant.unit.combat!,
      received,
      dealt,
      prepared,
      environment,
      activeDefenders.length - activeAttackers.length,
    );
  });
  let defenderCombats = defenderPrepared.map((prepared) => {
    const received = aggregateExchanges(exchanges, prepared.participant.unit.id);
    const dealt = exchanges
      .filter((exchange) => exchange.sourceUnitId === prepared.participant.unit.id)
      .reduce((sum, exchange) => sum + exchange.casualties, 0);
    return applyExchange(
      prepared.participant.unit.combat!,
      received,
      dealt,
      prepared,
      environment,
      activeAttackers.length - activeDefenders.length,
    );
  });
  attackerCombats = [
    ...attackerCombats,
    ...orderedAttackers.slice(attackerLimit).map((participant) => participant.unit.combat!),
  ];
  defenderCombats = [
    ...defenderCombats,
    ...orderedDefenders.slice(defenderLimit).map((participant) => participant.unit.combat!),
  ];
  const attackersRouted = attackerCombats.every((combat) => combat.status === "routed");
  const defendersRouted = defenderCombats.every((combat) => combat.status === "routed");
  if (attackersRouted !== defendersRouted) {
    const winners = attackersRouted ? defenderCombats : attackerCombats;
    const losers = attackersRouted ? attackerCombats : defenderCombats;
    for (let index = 0; index < losers.length; index += 1) {
      if (losers[index]!.status !== "routed") continue;
      const winnerIndex = index % winners.length;
      [winners[winnerIndex]!, losers[index]!] = applyPursuit(
        winners[winnerIndex]!,
        losers[index]!,
      );
    }
  }
  const phase: BattlePhase = attackersRouted || defendersRouted
    ? "rout"
    : environment.distanceMeters <= BATTLE_CONFIG.meleeRangeMeters
      ? "melee"
      : exchanges.length > 0
        ? "missile"
        : "closing";
  return {
    phase,
    attackerCombats,
    defenderCombats,
    exchanges,
    attackersRouted,
    defendersRouted,
  };
}

export function recoverCombatState(state: UnitCombatState): UnitCombatState {
  const fatiguePermille = clampInteger(
    state.fatiguePermille - BATTLE_CONFIG.restRecoveryPerRound,
    0,
    PERMILLE,
  );
  const cohesionPermille = clampInteger(
    state.cohesionPermille + (state.status === "routed" ? 15 : 18),
    0,
    PERMILLE,
  );
  const moralePermille = clampInteger(
    state.moralePermille + (state.status === "routed" ? 20 : 8),
    0,
    PERMILLE,
  );
  const status = state.status === "routed"
    ? moralePermille >= BATTLE_CONFIG.rallyMoralePermille && cohesionPermille >= 300
      ? "wavering"
      : "routed"
    : moralePermille < 400 || cohesionPermille < 350
      ? "wavering"
      : "ready";
  return {
    ...state,
    fatiguePermille,
    cohesionPermille,
    moralePermille,
    missileReadinessPermille: clampInteger(state.missileReadinessPermille + 30, 0, PERMILLE),
    status,
  };
}
