import rosterSource from "../config/tribal-roster.json";
import type {
  CampBuilding,
  SettlementTier,
  TechnologyId,
} from "../core/model";

export interface TribalBuildingDefinition {
  readonly id: CampBuilding;
  readonly requiredTechnologyId: TechnologyId | null;
  readonly minimumTier: SettlementTier;
  readonly populationGrowthPerInterval: number;
  readonly influenceGrowthMetersPerInterval: number;
  readonly knowledgePerWorldDay: number;
  readonly observerHeightMeters: number;
}

export interface TribalBuildingEffects {
  readonly populationGrowthPerInterval: number;
  readonly influenceGrowthMetersPerInterval: number;
  readonly knowledgePerWorldDay: number;
  readonly observerHeightMeters: number;
}

const TIER_RANK: Readonly<Record<SettlementTier, number>> = {
  camp: 0,
  village: 1,
};

function assertNonNegativeInteger(value: number, path: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
}

function validateCatalog(): void {
  const buildingIds = new Set<string>();
  for (const [index, building] of rosterSource.buildings.entries()) {
    if (!building.id || buildingIds.has(building.id)) {
      throw new Error(`tribal-roster.buildings[${index}] has a missing or duplicate id`);
    }
    buildingIds.add(building.id);
    assertNonNegativeInteger(
      building.populationGrowthPerInterval,
      `tribal-roster.buildings[${index}].populationGrowthPerInterval`,
    );
    assertNonNegativeInteger(
      building.influenceGrowthMetersPerInterval,
      `tribal-roster.buildings[${index}].influenceGrowthMetersPerInterval`,
    );
    assertNonNegativeInteger(
      building.knowledgePerWorldDay,
      `tribal-roster.buildings[${index}].knowledgePerWorldDay`,
    );
    assertNonNegativeInteger(
      building.observerHeightMeters,
      `tribal-roster.buildings[${index}].observerHeightMeters`,
    );
  }

}

validateCatalog();

export const TRIBAL_BUILDINGS = rosterSource.buildings as readonly TribalBuildingDefinition[];

const BUILDING_BY_ID = new Map(TRIBAL_BUILDINGS.map((building) => [building.id, building]));

export function tribalBuildingDefinition(id: CampBuilding): TribalBuildingDefinition {
  const definition = BUILDING_BY_ID.get(id);
  if (!definition) throw new Error(`Unknown Tribal building ${id}`);
  return definition;
}

export function tierMeetsMinimum(
  tier: SettlementTier,
  minimumTier: SettlementTier,
): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minimumTier];
}

export function tribalBuildingEffects(
  buildingIds: readonly CampBuilding[],
): TribalBuildingEffects {
  let populationGrowthPerInterval = 0;
  let influenceGrowthMetersPerInterval = 0;
  let knowledgePerWorldDay = 0;
  let observerHeightMeters = 0;
  for (const id of buildingIds) {
    const building = tribalBuildingDefinition(id);
    populationGrowthPerInterval += building.populationGrowthPerInterval;
    influenceGrowthMetersPerInterval += building.influenceGrowthMetersPerInterval;
    knowledgePerWorldDay += building.knowledgePerWorldDay;
    observerHeightMeters = Math.max(observerHeightMeters, building.observerHeightMeters);
  }
  return {
    populationGrowthPerInterval,
    influenceGrowthMetersPerInterval,
    knowledgePerWorldDay,
    observerHeightMeters,
  };
}
