import type { TerrainType, VegetationType } from "../core/model";

export interface CultureRule {
  readonly name: string;
  readonly effect: string;
}

export type AcclimatizationEnvironment =
  | Exclude<TerrainType, "water">
  | Exclude<VegetationType, "none">;

export interface EnvironmentAcclimatization {
  readonly terrain: AcclimatizationEnvironment;
  /** Relative bonus applied after the terrain's base movement pace. */
  readonly movementBonusPercent: number;
}

export interface CultureProfile {
  readonly id: string;
  readonly name: string;
  readonly focus: readonly [string, string];
  readonly legacy: CultureRule;
  readonly tradeoff: CultureRule;
  readonly acclimatization: {
    readonly name: string;
    readonly description: string;
    readonly terrain: readonly EnvironmentAcclimatization[];
  };
  readonly specialTechnology: CultureRule & { readonly unlock: string };
}

export interface CultureProfileCatalog {
  readonly formatVersion: 1;
  readonly profiles: readonly CultureProfile[];
}

const LAND_TERRAINS = new Set<TerrainType>([
  "plains",
  "hills",
  "mountains",
  "desert",
  "tundra",
  "ice",
]);
const VEGETATION_FEATURES = new Set<VegetationType>(["forest", "jungle"]);

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseRule(value: unknown, label: string): CultureRule {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    name: requiredString(record.name, `${label}.name`),
    effect: requiredString(record.effect, `${label}.effect`),
  };
}

export function parseCultureProfileCatalog(
  value: unknown,
): CultureProfileCatalog {
  if (!value || typeof value !== "object") {
    throw new Error("Culture profile catalog must be an object");
  }
  const catalog = value as Record<string, unknown>;
  if (catalog.formatVersion !== 1 || !Array.isArray(catalog.profiles)) {
    throw new Error("Unsupported culture profile catalog");
  }

  const ids = new Set<string>();
  const profiles = catalog.profiles.map((raw, index): CultureProfile => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`profiles[${index}] must be an object`);
    }
    const record = raw as Record<string, unknown>;
    const id = requiredString(record.id, `profiles[${index}].id`);
    if (ids.has(id)) {
      throw new Error(`Duplicate culture profile ${id}`);
    }
    ids.add(id);
    if (!Array.isArray(record.focus) || record.focus.length !== 2) {
      throw new Error(`${id}.focus must contain exactly two entries`);
    }
    const acclimatization = record.acclimatization;
    if (!acclimatization || typeof acclimatization !== "object") {
      throw new Error(`${id}.acclimatization must be an object`);
    }
    const acclimatizationRecord = acclimatization as Record<string, unknown>;
    if (!Array.isArray(acclimatizationRecord.terrain)) {
      throw new Error(`${id}.acclimatization.terrain must be an array`);
    }
    const terrain = acclimatizationRecord.terrain.map((rawTerrain) => {
      if (!rawTerrain || typeof rawTerrain !== "object") {
        throw new Error(`${id} has an invalid terrain acclimatization`);
      }
      const terrainRecord = rawTerrain as Record<string, unknown>;
      const terrainName = requiredString(
        terrainRecord.terrain,
        `${id}.acclimatization.terrain`,
      ) as AcclimatizationEnvironment;
      if (
        !LAND_TERRAINS.has(terrainName as TerrainType) &&
        !VEGETATION_FEATURES.has(terrainName as VegetationType)
      ) {
        throw new Error(`${id} has unknown movement environment ${terrainName}`);
      }
      const movementBonusPercent = terrainRecord.movementBonusPercent;
      if (
        !Number.isInteger(movementBonusPercent) ||
        (movementBonusPercent as number) < 1 ||
        (movementBonusPercent as number) > 50
      ) {
        throw new Error(`${id} has an invalid movement bonus`);
      }
      return {
        terrain: terrainName,
        movementBonusPercent: movementBonusPercent as number,
      };
    });
    const technology = parseRule(record.specialTechnology, `${id}.specialTechnology`);
    const technologyRecord = record.specialTechnology as Record<string, unknown>;
    return {
      id,
      name: requiredString(record.name, `${id}.name`),
      focus: [
        requiredString(record.focus[0], `${id}.focus[0]`),
        requiredString(record.focus[1], `${id}.focus[1]`),
      ],
      legacy: parseRule(record.legacy, `${id}.legacy`),
      tradeoff: parseRule(record.tradeoff, `${id}.tradeoff`),
      acclimatization: {
        name: requiredString(acclimatizationRecord.name, `${id}.acclimatization.name`),
        description: requiredString(
          acclimatizationRecord.description,
          `${id}.acclimatization.description`,
        ),
        terrain,
      },
      specialTechnology: {
        ...technology,
        unlock: requiredString(technologyRecord.unlock, `${id}.specialTechnology.unlock`),
      },
    };
  });
  if (profiles.length !== 40) {
    throw new Error(`Expected 40 culture profiles, received ${profiles.length}`);
  }
  return { formatVersion: 1, profiles };
}

export async function loadCultureProfiles(
  path: string,
): Promise<ReadonlyMap<string, CultureProfile>> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Culture profiles failed to load (${response.status})`);
  }
  const catalog = parseCultureProfileCatalog(await response.json());
  return new Map(catalog.profiles.map((profile) => [profile.id, profile]));
}

export function movementModifiers(
  profile: CultureProfile,
): {
  readonly terrain: Readonly<Partial<Record<TerrainType, number>>>;
  readonly vegetation: Readonly<Partial<Record<VegetationType, number>>>;
} {
  const terrain: Partial<Record<TerrainType, number>> = {};
  const vegetation: Partial<Record<VegetationType, number>> = {};
  for (const entry of profile.acclimatization.terrain) {
    if (VEGETATION_FEATURES.has(entry.terrain as VegetationType)) {
      vegetation[entry.terrain as VegetationType] = entry.movementBonusPercent;
    } else {
      terrain[entry.terrain as TerrainType] = entry.movementBonusPercent;
    }
  }
  return { terrain, vegetation };
}
