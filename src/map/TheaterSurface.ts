import type {
  GeographicPosition,
  RiverClass,
  TerrainType,
  VegetationDensity,
  VegetationType,
  WorldGridDefinition,
} from "../core/model";
import { WorldGrid } from "../core/WorldGrid";
import { deriveBiomeType, type BiomeType } from "./Biome";
import {
  RegionalTheaterProjection,
  type RegionalTheaterManifest,
  type TheaterPoint,
} from "./RegionalTheater";
import { SemanticChunkStore } from "./SemanticChunkStore";
import { WaterwayIndex, type WaterwayRegime } from "./WaterwayIndex";

export interface TheaterSurfaceSample {
  readonly cellIndex: number;
  readonly terrain: TerrainType;
  readonly biome: BiomeType;
  readonly vegetation: VegetationType;
  readonly vegetationDensity: VegetationDensity;
  readonly moisture: number;
  readonly river: RiverClass;
  readonly waterwayRegime?: WaterwayRegime;
  readonly waterwayWidthMeters?: number;
  readonly elevationMeters: number;
}

const TERRAIN_TYPES: readonly TerrainType[] = [
  "water",
  "plains",
  "hills",
  "mountains",
  "desert",
  "tundra",
  "ice",
] as const;

const VEGETATION: readonly Readonly<{
  vegetation: VegetationType;
  vegetationDensity: VegetationDensity;
}>[] = [
  { vegetation: "none", vegetationDensity: "none" },
  { vegetation: "forest", vegetationDensity: "sparse" },
  { vegetation: "forest", vegetationDensity: "light" },
  { vegetation: "forest", vegetationDensity: "moderate" },
  { vegetation: "forest", vegetationDensity: "dense" },
  { vegetation: "jungle", vegetationDensity: "sparse" },
  { vegetation: "jungle", vegetationDensity: "light" },
  { vegetation: "jungle", vegetationDensity: "moderate" },
  { vegetation: "jungle", vegetationDensity: "dense" },
] as const;

async function loadWaterways(
  theater: RegionalTheaterManifest,
): Promise<WaterwayIndex> {
  const response = await fetch(
    `/maps/theaters/${theater.id}/${theater.hydrographySource.geometryPath}?v=${theater.formatVersion}`,
  );
  if (!response.ok) {
    throw new Error(`Unable to load projected waterways: ${response.status}`);
  }
  return WaterwayIndex.decode(await response.arrayBuffer());
}

/** Rasterizes immutable centerlines once; combat then reads rivers in O(1). */
function rasterizeWaterways(
  theater: RegionalTheaterManifest,
  waterways: WaterwayIndex,
): Uint8Array {
  const width = theater.semantic.width;
  const height = theater.semantic.height;
  const cells = new Uint8Array(width * height);
  const cellSize = theater.semantic.metersPerCell;
  const halfWidth = theater.extent.widthMeters / 2;
  const halfHeight = theater.extent.heightMeters / 2;
  const mark = (column: number, row: number, radius: number, code: number): void => {
    for (let y = Math.max(0, row - radius); y <= Math.min(height - 1, row + radius); y += 1) {
      for (let x = Math.max(0, column - radius); x <= Math.min(width - 1, column + radius); x += 1) {
        const index = y * width + x;
        cells[index] = Math.max(cells[index] ?? 0, code);
      }
    }
  };
  for (const feature of waterways.features) {
    const code = feature.riverClass === "major" ? 2 : 1;
    const radius = Math.max(0, Math.floor(feature.widthMeters / 2 / cellSize));
    for (let point = 0; point < feature.points.length - 2; point += 2) {
      const startColumn = (feature.points[point]! + halfWidth) / cellSize;
      const startRow = (halfHeight - feature.points[point + 1]!) / cellSize;
      const endColumn = (feature.points[point + 2]! + halfWidth) / cellSize;
      const endRow = (halfHeight - feature.points[point + 3]!) / cellSize;
      const steps = Math.max(1, Math.ceil(Math.max(
        Math.abs(endColumn - startColumn),
        Math.abs(endRow - startRow),
      )));
      for (let step = 0; step <= steps; step += 1) {
        const ratio = step / steps;
        mark(
          Math.floor(startColumn + (endColumn - startColumn) * ratio),
          Math.floor(startRow + (endRow - startRow) * ratio),
          radius,
          code,
        );
      }
    }
  }
  return cells;
}

/** Chunk-streamed geography shared by survey, route previews, and worker startup. */
export class TheaterSurface {
  private readonly chunks: SemanticChunkStore;
  private readonly projection: RegionalTheaterProjection;
  private readonly worldGrid: WorldGrid;

  private constructor(
    private readonly theater: RegionalTheaterManifest,
    private readonly waterways: WaterwayIndex,
  ) {
    this.chunks = new SemanticChunkStore(theater);
    this.projection = new RegionalTheaterProjection(theater);
    this.worldGrid = WorldGrid.fromCellSource(
      {
        projectionDefinition: theater.projection.definition,
        extentWidthMeters: theater.extent.widthMeters,
        extentHeightMeters: theater.extent.heightMeters,
        width: theater.semantic.width,
        height: theater.semantic.height,
      },
      this.chunks,
    );
  }

  public static async load(
    theater: RegionalTheaterManifest,
  ): Promise<TheaterSurface> {
    return new TheaterSurface(theater, await loadWaterways(theater));
  }

  public async toSimulationDefinition(): Promise<WorldGridDefinition> {
    const definition = await this.chunks.toSimulationDefinition();
    return {
      ...definition,
      riverCells: rasterizeWaterways(this.theater, this.waterways),
    };
  }

  public async typeAt(point: TheaterPoint): Promise<TerrainType> {
    return (await this.sampleAt(point))?.terrain ?? "water";
  }

  public async sampleAt(
    point: TheaterPoint,
  ): Promise<TheaterSurfaceSample | undefined> {
    const sample = await this.chunks.sampleAt(point);
    if (!sample) return undefined;
    const vegetation = VEGETATION[sample.vegetationCode] ?? VEGETATION[0]!;
    const terrain = TERRAIN_TYPES[sample.terrainCode] ?? "water";
    const easting =
      point.x * this.theater.render.metersPerPixel -
      this.theater.extent.widthMeters / 2;
    const northing =
      this.theater.extent.heightMeters / 2 -
      point.y * this.theater.render.metersPerPixel;
    const waterway = this.waterways.featureAt(
      easting,
      northing,
      this.theater.semantic.metersPerCell / 2,
    );
    return {
      cellIndex: sample.cellIndex,
      terrain,
      biome: deriveBiomeType(
        terrain,
        vegetation.vegetation,
        vegetation.vegetationDensity,
      ),
      ...vegetation,
      moisture: sample.moisture,
      river: waterway?.riverClass ?? "none",
      ...(waterway ? { waterwayRegime: waterway.regime } : {}),
      ...(waterway ? { waterwayWidthMeters: waterway.widthMeters } : {}),
      elevationMeters: sample.elevationMeters,
    };
  }

  public async estimateScoutTravelMinutes(
    start: GeographicPosition,
    destination: GeographicPosition,
    terrainModifiers: Readonly<Partial<Record<TerrainType, number>>>,
    vegetationModifiers: Readonly<Partial<Record<VegetationType, number>>> = {},
  ): Promise<number | null> {
    await this.chunks.prefetchCorridor(
      this.projection.toTheater(start),
      this.projection.toTheater(destination),
    );
    return this.worldGrid.estimateScoutTravelMinutes(
      start,
      destination,
      terrainModifiers,
      vegetationModifiers,
    );
  }

  public async isPassable(point: TheaterPoint): Promise<boolean> {
    return (await this.typeAt(point)) !== "water";
  }
}
