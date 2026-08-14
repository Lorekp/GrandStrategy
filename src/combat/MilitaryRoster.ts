import cultureMilitarySource from "../config/culture-military.json";
import rosterSource from "../config/tribal-roster.json";
import type {
  BattleFormation,
  CampBuilding,
  CombatRole,
  SettlementTier,
  TechnologyId,
  UnitKind,
} from "../core/model";

export interface MilitaryCombatDefinition {
  readonly role: CombatRole;
  readonly archetypeId: string;
  readonly traitId: string;
  readonly attack: number;
  readonly ranged: number;
  readonly defense: number;
  readonly shock: number;
  readonly armor: number;
  readonly pursuit: number;
  readonly rangeMeters: number;
  readonly formations: readonly BattleFormation[];
}

export interface TribalUnitDefinition {
  readonly id: UnitKind;
  readonly name: string | null;
  readonly abbreviation: string;
  readonly cultureId: string | null;
  readonly requiredTechnologyIds: readonly TechnologyId[];
  readonly requiredBuildingId: CampBuilding | null;
  readonly minimumTier: SettlementTier;
  readonly populationCost: number;
  readonly minimumPopulationAfterTraining: number;
  readonly maximumPerSettlement: number;
  readonly warriors: number;
  readonly detectionRadiusMeters: number;
  readonly footprintRadiusMeters: number;
  readonly maximumTerrainDistanceMeters: number;
  readonly combat: MilitaryCombatDefinition | null;
}

interface ArchetypeSource {
  readonly role: CombatRole;
  readonly attack: number;
  readonly ranged: number;
  readonly defense: number;
  readonly shock: number;
  readonly armor: number;
  readonly pursuit: number;
  readonly rangeMeters: number;
  readonly formations: readonly BattleFormation[];
}

interface CultureUnitSource {
  readonly id: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly archetype: string;
  readonly trait: string;
}

interface CultureSource {
  readonly cultureId: string;
  readonly close: CultureUnitSource;
  readonly ranged: CultureUnitSource;
}

const archetypes = cultureMilitarySource.archetypes as Readonly<Record<string, ArchetypeSource>>;
const cultures = cultureMilitarySource.cultures as readonly CultureSource[];

function cultureDefinition(
  cultureId: string,
  unit: CultureUnitSource,
  expectedRole: CombatRole,
): TribalUnitDefinition {
  const archetype = archetypes[unit.archetype];
  if (!archetype || archetype.role !== expectedRole) {
    throw new Error(`${cultureId}.${unit.id} has an invalid ${expectedRole} archetype`);
  }
  return {
    id: unit.id,
    name: unit.name,
    abbreviation: unit.abbreviation,
    cultureId,
    requiredTechnologyIds: ["warband-discipline"],
    requiredBuildingId: "rally-ground",
    minimumTier: "camp",
    populationCost: expectedRole === "close" ? 12 : 10,
    minimumPopulationAfterTraining: 4,
    maximumPerSettlement: 3,
    warriors: expectedRole === "close" ? 12 : 10,
    detectionRadiusMeters: 750,
    footprintRadiusMeters: 250,
    maximumTerrainDistanceMeters: 30_000,
    combat: {
      role: archetype.role,
      archetypeId: unit.archetype,
      traitId: unit.trait,
      attack: archetype.attack,
      ranged: archetype.ranged,
      defense: archetype.defense,
      shock: archetype.shock,
      armor: archetype.armor,
      pursuit: archetype.pursuit,
      rangeMeters: archetype.rangeMeters,
      formations: archetype.formations,
    },
  };
}

const supportUnits: readonly TribalUnitDefinition[] = rosterSource.units.map((unit) => ({
  ...unit,
  name: null,
  cultureId: null,
  combat: null,
})) as readonly TribalUnitDefinition[];

const cultureUnits: readonly TribalUnitDefinition[] = cultures.flatMap((culture) => [
  cultureDefinition(culture.cultureId, culture.close, "close"),
  cultureDefinition(culture.cultureId, culture.ranged, "ranged"),
]);

export const TRIBAL_SUPPORT_UNITS = supportUnits;
export const CULTURE_MILITARY_UNITS = cultureUnits;
export const TRIBAL_UNITS: readonly TribalUnitDefinition[] = [
  ...supportUnits,
  ...cultureUnits,
];

const UNIT_BY_ID = new Map(TRIBAL_UNITS.map((unit) => [unit.id, unit]));
const UNITS_BY_CULTURE = new Map(
  cultures.map((culture) => [
    culture.cultureId,
    [
      UNIT_BY_ID.get(culture.close.id)!,
      UNIT_BY_ID.get(culture.ranged.id)!,
    ] as const,
  ]),
);

function validateMilitaryRoster(): void {
  if (cultures.length !== 40) throw new Error("culture-military must define 40 cultures");
  if (UNIT_BY_ID.size !== TRIBAL_UNITS.length) {
    throw new Error("Military unit ids must be globally unique");
  }
  for (const culture of cultures) {
    if (!culture.cultureId || !UNITS_BY_CULTURE.get(culture.cultureId)) {
      throw new Error("Every military culture needs one close and one ranged unit");
    }
  }
}

validateMilitaryRoster();

export function tribalUnitDefinition(id: UnitKind): TribalUnitDefinition {
  const definition = UNIT_BY_ID.get(id);
  if (!definition) throw new Error(`Unknown Tribal unit ${id}`);
  return definition;
}

export function cultureMilitaryUnits(
  cultureId: string,
): readonly [TribalUnitDefinition, TribalUnitDefinition] {
  const definitions = UNITS_BY_CULTURE.get(cultureId);
  if (!definitions) throw new Error(`Unknown military culture ${cultureId}`);
  return definitions;
}

export function unitIsAvailableToCulture(
  definition: TribalUnitDefinition,
  cultureId: string,
): boolean {
  return definition.cultureId === null || definition.cultureId === cultureId;
}

export function unitDisplayName(definition: TribalUnitDefinition): string {
  return definition.name ?? definition.id;
}

export interface CultureMilitaryTrait {
  readonly name: string;
  readonly attackPermille: number;
  readonly defensePermille: number;
  readonly rangedPermille: number;
  readonly shockPermille: number;
  readonly pursuitPermille: number;
  readonly fatiguePermille: number;
  readonly moraleDamagePermille: number;
  readonly terrainAttackPermille: Readonly<Record<string, number>>;
  readonly terrainDefensePermille: Readonly<Record<string, number>>;
  readonly vegetationAttackPermille: Readonly<Record<string, number>>;
  readonly vegetationDefensePermille: Readonly<Record<string, number>>;
}

const traits = cultureMilitarySource.traits as Readonly<Record<string, CultureMilitaryTrait>>;

export function cultureMilitaryTrait(id: string): CultureMilitaryTrait {
  const trait = traits[id];
  if (!trait) throw new Error(`Unknown military trait ${id}`);
  return trait;
}
