import { gridBitIsSet } from "../core/GridBitset";
import type {
  CampBuilding,
  DiplomaticStance,
  GeographicPosition,
  IntelligenceState,
  PlayerWorldSnapshot,
  TerrainType,
  Tribe,
  UnitKind,
  VegetationDensity,
  VegetationType,
} from "../core/model";
import type { BiomeType } from "./Biome";
import { pointIsInsideInfluence } from "./Influence";
import type { TheaterPoint } from "./RegionalTheater";
import type { TheaterSurfaceSample } from "./TheaterSurface";

export type SurveyAllegiance = DiplomaticStance | "player" | "unclaimed";

export interface SurveyVegetation {
  readonly type: VegetationType;
  readonly density: VegetationDensity;
}

export interface SurveyNaturalFeature {
  readonly kind: "river";
  readonly riverClass: "major" | "minor";
  readonly regime?: NonNullable<TheaterSurfaceSample["waterwayRegime"]>;
}

export type SurveyFeature =
  | {
      readonly kind: "unit";
      readonly unitKind: UnitKind;
      readonly tribeName?: string;
      readonly intelligence: IntelligenceState;
    }
  | {
      readonly kind: "settlement";
      readonly name: string;
      readonly population: number;
      readonly intelligence: IntelligenceState;
    };

export interface MapSurveyInfo {
  readonly discovered: boolean;
  readonly terrain?: TerrainType;
  readonly biome?: BiomeType;
  readonly vegetation?: SurveyVegetation;
  readonly moisturePercent?: number;
  readonly naturalFeature?: SurveyNaturalFeature;
  readonly elevationMeters?: number;
  readonly feature?: SurveyFeature;
  readonly buildings?: readonly CampBuilding[];
  readonly influenceTribeName?: string;
  readonly allegianceTribeName?: string;
  readonly allegianceKind: SurveyAllegiance;
  readonly color?: number;
}

interface SurveySurface {
  sampleAt(point: TheaterPoint): Promise<TheaterSurfaceSample | undefined>;
}

interface SurveyProjection {
  toTheater(position: GeographicPosition): TheaterPoint;
}

function relationBetween(
  snapshot: PlayerWorldSnapshot,
  firstTribeId: number,
  secondTribeId: number,
): DiplomaticStance {
  const lower = Math.min(firstTribeId, secondTribeId);
  const upper = Math.max(firstTribeId, secondTribeId);
  return (
    snapshot.relations.find(
      (relation) =>
        relation.firstTribeId === lower && relation.secondTribeId === upper,
    )?.stance ?? "neutral"
  );
}

function allegianceTo(
  snapshot: PlayerWorldSnapshot,
  tribe: Tribe | undefined,
): Pick<MapSurveyInfo, "allegianceTribeName" | "allegianceKind" | "color"> {
  if (!tribe) {
    return { allegianceKind: "unclaimed" };
  }
  if (tribe.controllerPlayerId === snapshot.viewerPlayerId) {
    return {
      allegianceTribeName: tribe.name,
      allegianceKind: "player",
      color: tribe.color,
    };
  }
  const playerTribe = snapshot.tribes.find(
    (candidate) => candidate.controllerPlayerId === snapshot.viewerPlayerId,
  );
  const stance = playerTribe
    ? relationBetween(snapshot, playerTribe.id, tribe.id)
    : "neutral";
  return {
    allegianceTribeName: tribe.name,
    allegianceKind: stance,
    color: tribe.color,
  };
}

function distanceSquared(first: TheaterPoint, second: TheaterPoint): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function naturalFeatureFor(
  sample: TheaterSurfaceSample,
): SurveyNaturalFeature | undefined {
  if (sample.river === "none") return undefined;
  return {
    kind: "river",
    riverClass: sample.river,
    ...(sample.waterwayRegime ? { regime: sample.waterwayRegime } : {}),
  };
}

export async function surveyMapPoint(
  point: TheaterPoint,
  snapshot: PlayerWorldSnapshot | undefined,
  surface: SurveySurface,
  projection: SurveyProjection,
  metersPerPixel: number,
  entityHitRadiusPixels: number,
): Promise<MapSurveyInfo | undefined> {
  const sample = await surface.sampleAt(point);
  if (!sample) {
    return undefined;
  }
  if (!snapshot) {
    return {
      discovered: true,
      terrain: sample.terrain,
      biome: sample.biome,
      vegetation: {
        type: sample.vegetation,
        density: sample.vegetationDensity,
      },
      moisturePercent: Math.round(sample.moisture / 2.55),
      naturalFeature: naturalFeatureFor(sample),
      elevationMeters: sample.elevationMeters,
      allegianceKind: "unclaimed",
    };
  }
  if (!gridBitIsSet(snapshot.visibility.exploredCells, sample.cellIndex)) {
    return {
      discovered: false,
      allegianceKind: "unclaimed",
    };
  }

  const hitRadiusSquared = entityHitRadiusPixels ** 2;
  let nearbyUnit: (typeof snapshot.units)[number] | undefined;
  let nearbyUnitDistance = Number.POSITIVE_INFINITY;
  for (const unit of snapshot.units) {
    const distance = distanceSquared(point, projection.toTheater(unit.position));
    if (distance <= hitRadiusSquared && distance < nearbyUnitDistance) {
      nearbyUnit = unit;
      nearbyUnitDistance = distance;
    }
  }

  let nearbySettlement: (typeof snapshot.settlements)[number] | undefined;
  let nearbySettlementDistance = Number.POSITIVE_INFINITY;
  let influence: (typeof snapshot.settlements)[number] | undefined;
  let influenceDistance = Number.POSITIVE_INFINITY;
  for (const settlement of snapshot.settlements) {
    const settlementPoint = projection.toTheater(settlement.position);
    const distance = distanceSquared(point, settlementPoint);
    if (distance <= hitRadiusSquared && distance < nearbySettlementDistance) {
      nearbySettlement = settlement;
      nearbySettlementDistance = distance;
    }
    const normalizedDistance = distance / settlement.influenceRadiusMeters ** 2;
    if (
      normalizedDistance < influenceDistance &&
      pointIsInsideInfluence(
        point,
        settlementPoint,
        settlement,
        metersPerPixel,
      )
    ) {
      influence = settlement;
      influenceDistance = normalizedDistance;
    }
  }

  const subjectTribeId = nearbyUnit?.tribeId ?? nearbySettlement?.tribeId;
  const allegianceTribeId = subjectTribeId ?? influence?.tribeId;
  const allegiance = allegianceTo(
    snapshot,
    snapshot.tribes.find((tribe) => tribe.id === allegianceTribeId),
  );
  const subjectTribe = snapshot.tribes.find((tribe) => tribe.id === subjectTribeId);
  const influenceTribe = snapshot.tribes.find((tribe) => tribe.id === influence?.tribeId);

  return {
    discovered: true,
    terrain: sample.terrain,
    biome: sample.biome,
    vegetation: {
      type: sample.vegetation,
      density: sample.vegetationDensity,
    },
    moisturePercent: Math.round(sample.moisture / 2.55),
    elevationMeters: sample.elevationMeters,
    naturalFeature: naturalFeatureFor(sample),
    feature: nearbyUnit
      ? {
          kind: "unit",
          unitKind: nearbyUnit.kind,
          intelligence: nearbyUnit.intelligence,
          ...(subjectTribe ? { tribeName: subjectTribe.name } : {}),
        }
      : nearbySettlement
        ? {
            kind: "settlement",
            name: nearbySettlement.name,
            population: nearbySettlement.population,
            intelligence: nearbySettlement.intelligence,
          }
        : undefined,
    buildings: nearbySettlement ? nearbySettlement.buildings : undefined,
    influenceTribeName: influenceTribe?.name,
    ...allegiance,
  };
}
