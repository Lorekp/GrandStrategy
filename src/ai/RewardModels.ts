import type { PlayerWorldSnapshot } from "../core/model";

export interface RlAgentMetrics {
  readonly population: number;
  readonly warriors: number;
  readonly settlementCount: number;
  readonly villageCount: number;
  readonly influenceMeters: number;
  readonly completedTechnologyCount: number;
  readonly exploredCellCount: number;
  readonly combatStrength: number;
  readonly unitExperience: number;
  readonly routedUnitCount: number;
}

export interface RlRewardSignals {
  readonly population: number;
  readonly warriors: number;
  readonly settlements: number;
  readonly villages: number;
  readonly influenceMeters: number;
  readonly completedTechnologies: number;
  readonly exploredCells: number;
  readonly combatStrength: number;
  readonly unitExperience: number;
  readonly routedUnits: number;
}

export interface RlRewardContext {
  readonly previous: RlAgentMetrics;
  readonly current: RlAgentMetrics;
  readonly signals: RlRewardSignals;
  readonly ticksAdvanced: number;
}

export type RlRewardModel = (context: RlRewardContext) => number;

export const TRIBAL_DEVELOPMENT_REWARD_WEIGHTS = {
  population: 0.01,
  warriors: 0.05,
  settlements: 0.5,
  villages: 2,
  influenceMeters: 0.000_01,
  completedTechnologies: 1,
  exploredCells: 0.000_05,
  combatStrength: 0.08,
  unitExperience: 0.002,
  routedUnits: -0.5,
} as const;

function countSetBits(values: Uint32Array): number {
  let count = 0;
  for (const value of values) {
    let word = value;
    while (word !== 0) {
      word &= word - 1;
      count += 1;
    }
  }
  return count;
}

export function rlAgentMetrics(snapshot: PlayerWorldSnapshot): RlAgentMetrics {
  const controlledTribeIds = new Set(
    snapshot.tribes
      .filter((tribe) => tribe.controllerPlayerId === snapshot.viewerPlayerId)
      .map((tribe) => tribe.id),
  );
  const settlements = snapshot.settlements.filter((settlement) =>
    controlledTribeIds.has(settlement.tribeId),
  );
  const research = snapshot.research.filter((entry) =>
    controlledTribeIds.has(entry.tribeId),
  );
  const units = snapshot.units.filter((unit) => controlledTribeIds.has(unit.tribeId));
  return {
    population: settlements.reduce((sum, settlement) => sum + settlement.population, 0),
    warriors: snapshot.tribes
      .filter((tribe) => controlledTribeIds.has(tribe.id))
      .reduce((sum, tribe) => sum + tribe.warriors, 0),
    settlementCount: settlements.length,
    villageCount: settlements.filter((settlement) => settlement.tier === "village").length,
    influenceMeters: settlements.reduce(
      (sum, settlement) => sum + settlement.influenceRadiusMeters,
      0,
    ),
    completedTechnologyCount: research.reduce(
      (sum, entry) => sum + entry.completedTechnologyIds.length,
      0,
    ),
    exploredCellCount: countSetBits(snapshot.visibility.exploredCells),
    combatStrength: units.reduce((sum, unit) => sum + (unit.combat?.strength ?? 0), 0),
    unitExperience: units.reduce((sum, unit) => sum + (unit.combat?.experience ?? 0), 0),
    routedUnitCount: units.filter((unit) => unit.combat?.status === "routed").length,
  };
}

export function rewardSignals(
  previous: RlAgentMetrics,
  current: RlAgentMetrics,
): RlRewardSignals {
  return {
    population: current.population - previous.population,
    warriors: current.warriors - previous.warriors,
    settlements: current.settlementCount - previous.settlementCount,
    villages: current.villageCount - previous.villageCount,
    influenceMeters: current.influenceMeters - previous.influenceMeters,
    completedTechnologies:
      current.completedTechnologyCount - previous.completedTechnologyCount,
    exploredCells: current.exploredCellCount - previous.exploredCellCount,
    combatStrength: current.combatStrength - previous.combatStrength,
    unitExperience: current.unitExperience - previous.unitExperience,
    routedUnits: current.routedUnitCount - previous.routedUnitCount,
  };
}

/** Potential-difference shaping for an early Tribal-development curriculum. */
export const tribalDevelopmentReward: RlRewardModel = ({ signals }) =>
  signals.population * TRIBAL_DEVELOPMENT_REWARD_WEIGHTS.population +
  signals.warriors * TRIBAL_DEVELOPMENT_REWARD_WEIGHTS.warriors +
  signals.settlements * TRIBAL_DEVELOPMENT_REWARD_WEIGHTS.settlements +
  signals.villages * TRIBAL_DEVELOPMENT_REWARD_WEIGHTS.villages +
  signals.influenceMeters * TRIBAL_DEVELOPMENT_REWARD_WEIGHTS.influenceMeters +
  signals.completedTechnologies *
    TRIBAL_DEVELOPMENT_REWARD_WEIGHTS.completedTechnologies +
  signals.exploredCells * TRIBAL_DEVELOPMENT_REWARD_WEIGHTS.exploredCells +
  signals.combatStrength * TRIBAL_DEVELOPMENT_REWARD_WEIGHTS.combatStrength +
  signals.unitExperience * TRIBAL_DEVELOPMENT_REWARD_WEIGHTS.unitExperience +
  signals.routedUnits * TRIBAL_DEVELOPMENT_REWARD_WEIGHTS.routedUnits;

export const zeroReward: RlRewardModel = () => 0;
