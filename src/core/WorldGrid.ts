import proj4 from "proj4";
import { GAMEPLAY_CONFIG } from "../config/GameConfig";
import type {
  GeographicPosition,
  RiverClass,
  TerrainType,
  VegetationDensity,
  VegetationType,
  WorldGridDefinition,
} from "./model";

/** Stable semantic codes used by map data, replays, and headless AI observations. */
export const TERRAIN_TYPES_BY_CODE: readonly TerrainType[] = [
  "water",
  "plains",
  "hills",
  "mountains",
  "desert",
  "tundra",
  "ice",
] as const;

export interface VegetationFeature {
  readonly vegetation: VegetationType;
  readonly density: VegetationDensity;
}

/** Stable semantic codes used by map data, replays, and headless AI observations. */
export const VEGETATION_FEATURES_BY_CODE: readonly VegetationFeature[] = [
  { vegetation: "none", density: "none" },
  { vegetation: "forest", density: "sparse" },
  { vegetation: "forest", density: "light" },
  { vegetation: "forest", density: "moderate" },
  { vegetation: "forest", density: "dense" },
  { vegetation: "jungle", density: "sparse" },
  { vegetation: "jungle", density: "light" },
  { vegetation: "jungle", density: "moderate" },
  { vegetation: "jungle", density: "dense" },
] as const;

/** Multipliers over the measured trained-firefighter slope curve. */
export const SCOUT_TERRAIN_FACTORS: Readonly<Record<TerrainType, number>> = {
  ...GAMEPLAY_CONFIG.scout.terrainFactors,
};

export const SCOUT_VEGETATION_FACTORS: Readonly<
  Record<VegetationType, Readonly<Record<VegetationDensity, number>>>
> = {
  ...GAMEPLAY_CONFIG.scout.vegetationFactors,
};

export interface GridCell {
  readonly column: number;
  readonly row: number;
  readonly index: number;
}

export interface ScoutTravelMetrics {
  readonly terrain: TerrainType;
  readonly vegetation: VegetationType;
  readonly vegetationDensity: VegetationDensity;
  readonly speedMetersPerHour: number;
  readonly slopeDegrees: number;
  readonly impassable: boolean;
}

export interface MovementAdvance extends ScoutTravelMetrics {
  readonly position: GeographicPosition;
  readonly reached: boolean;
  readonly blocked: boolean;
}

export interface WorldGridGeometry {
  readonly projectionDefinition: string;
  readonly extentWidthMeters: number;
  readonly extentHeightMeters: number;
  readonly width: number;
  readonly height: number;
}

export interface WorldGridCellSource {
  terrainCodeAt(index: number): number;
  vegetationCodeAt(index: number): number;
  moistureAt(index: number): number;
  riverCodeAt(index: number): number;
  elevationAt(index: number): number;
}

export interface BattleApproachMetrics {
  readonly attackerElevationMeters: number;
  readonly defenderElevationMeters: number;
  /** Positive means the attacker is climbing toward the defender. */
  readonly attackerSlopeDegrees: number;
  readonly riverCrossing: RiverClass;
}

export function terrainTypeFromCode(code: number): TerrainType {
  return TERRAIN_TYPES_BY_CODE[code] ?? "water";
}

export function vegetationFeatureFromCode(code: number): VegetationFeature {
  return VEGETATION_FEATURES_BY_CODE[code] ?? VEGETATION_FEATURES_BY_CODE[0]!;
}

/** Lorentz median curve fitted to trained Type-1 firefighters hiking under load. */
export function trainedScoutSlopeSpeedMetersPerSecond(
  slopeDegrees: number,
): number {
  const model = GAMEPLAY_CONFIG.scout.slopeModel;
  const slope = Math.max(
    model.minimumDegrees,
    Math.min(model.maximumDegrees, slopeDegrees),
  );
  return (
    model.numerator /
      (Math.PI *
        model.width *
        (1 + ((slope + model.offsetDegrees) / model.width) ** 2)) +
    model.constantMetersPerSecond -
    model.linearSlopeCoefficient * slope
  );
}

export function flatScoutSpeedKilometersPerHour(
  terrain: TerrainType,
  vegetation: VegetationType = "none",
  density: VegetationDensity = "none",
): number {
  return (
    trainedScoutSlopeSpeedMetersPerSecond(0) *
    SCOUT_TERRAIN_FACTORS[terrain] *
    SCOUT_VEGETATION_FACTORS[vegetation][density] *
    3.6
  );
}

export class WorldGrid {
  private readonly projection: proj4.Converter;
  private readonly geometry: WorldGridGeometry;
  private readonly cells: WorldGridCellSource;
  public readonly width: number;
  public readonly height: number;
  public readonly cellSizeMeters: number;

  /** Builds a deterministic elevation-only LOD for horizon calculations. */
  public createElevationLod(factor: number): WorldGrid {
    if (
      !Number.isInteger(factor) ||
      factor < 1 ||
      this.width % factor !== 0 ||
      this.height % factor !== 0
    ) {
      throw new Error("Elevation LOD factor must divide the world grid");
    }
    if (factor === 1) return this;
    const width = this.width / factor;
    const height = this.height / factor;
    const elevations = new Int16Array(width * height);
    const samplesPerCell = factor * factor;
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        let elevation = 0;
        for (let localRow = 0; localRow < factor; localRow += 1) {
          const sourceRow = row * factor + localRow;
          for (let localColumn = 0; localColumn < factor; localColumn += 1) {
            const sourceColumn = column * factor + localColumn;
            elevation += this.surfaceElevationAtIndex(
              sourceRow * this.width + sourceColumn,
            );
          }
        }
        elevations[row * width + column] = Math.round(elevation / samplesPerCell);
      }
    }
    return WorldGrid.fromCellSource(
      {
        projectionDefinition: this.geometry.projectionDefinition,
        extentWidthMeters: this.geometry.extentWidthMeters,
        extentHeightMeters: this.geometry.extentHeightMeters,
        width,
        height,
      },
      {
        terrainCodeAt: () => 1,
        vegetationCodeAt: () => 0,
        moistureAt: () => 0,
        riverCodeAt: () => 0,
        elevationAt: (index) => elevations[index] ?? 0,
      },
    );
  }

  public constructor(definition: WorldGridDefinition);
  public constructor(
    definition: WorldGridGeometry,
    cells: WorldGridCellSource,
  );
  public constructor(
    definition: WorldGridDefinition | WorldGridGeometry,
    cells?: WorldGridCellSource,
  ) {
    const cellCount = definition.width * definition.height;
    if (
      !Number.isInteger(definition.width) ||
      !Number.isInteger(definition.height) ||
      definition.width < 1 ||
      definition.height < 1
    ) {
      throw new Error("World grid dimensions do not match its semantic cells");
    }
    if (
      definition.extentWidthMeters <= 0 ||
      definition.extentHeightMeters <= 0
    ) {
      throw new Error("World grid extent must be positive");
    }
    const horizontalCellSize = definition.extentWidthMeters / definition.width;
    const verticalCellSize = definition.extentHeightMeters / definition.height;
    if (Math.abs(horizontalCellSize - verticalCellSize) > 0.001) {
      throw new Error("World grid cells must be square for deterministic viewsheds");
    }
    if (!cells) {
      const dense = definition as WorldGridDefinition;
      if (
        dense.terrainCells.length !== cellCount ||
        dense.vegetationCells.length !== cellCount ||
        dense.moistureCells.length !== cellCount ||
        dense.riverCells.length !== cellCount ||
        dense.elevationMeters.length !== cellCount
      ) {
        throw new Error("World grid dimensions do not match its semantic cells");
      }
      for (const code of dense.terrainCells) {
        if (TERRAIN_TYPES_BY_CODE[code] === undefined) {
          throw new Error(`Unknown terrain code ${code}`);
        }
      }
      for (const code of dense.vegetationCells) {
        if (VEGETATION_FEATURES_BY_CODE[code] === undefined) {
          throw new Error(`Unknown vegetation code ${code}`);
        }
      }
      for (const code of dense.riverCells) {
        if (code > 2) throw new Error(`Unknown river code ${code}`);
      }
      cells = {
        terrainCodeAt: (index) => dense.terrainCells[index] ?? 0,
        vegetationCodeAt: (index) => dense.vegetationCells[index] ?? 0,
        moistureAt: (index) => dense.moistureCells[index] ?? 0,
        riverCodeAt: (index) => dense.riverCells[index] ?? 0,
        elevationAt: (index) => dense.elevationMeters[index] ?? 0,
      };
    }
    this.geometry = definition;
    this.cells = cells;
    this.width = definition.width;
    this.height = definition.height;
    this.cellSizeMeters = horizontalCellSize;
    this.projection = proj4("EPSG:4326", definition.projectionDefinition);
  }

  public static fromCellSource(
    geometry: WorldGridGeometry,
    cells: WorldGridCellSource,
  ): WorldGrid {
    return new WorldGrid(geometry, cells);
  }

  public get cellCount(): number {
    return this.width * this.height;
  }

  public cellAt(position: GeographicPosition): GridCell | undefined {
    const [easting, northing] = this.toProjected(position);
    return this.cellAtProjected(easting, northing);
  }

  public cellAtOffset(
    position: GeographicPosition,
    eastMeters: number,
    northMeters: number,
  ): GridCell | undefined {
    const [easting, northing] = this.toProjected(position);
    return this.cellAtProjected(easting + eastMeters, northing + northMeters);
  }

  public cellsWithinRadius(
    position: GeographicPosition,
    radiusMeters: number,
  ): GridCell[] {
    if (!Number.isFinite(radiusMeters) || radiusMeters < 0) {
      throw new Error("Grid query radius must be a non-negative distance");
    }
    if (radiusMeters === 0) {
      const cell = this.cellAt(position);
      return cell ? [cell] : [];
    }

    const [easting, northing] = this.toProjected(position);
    const halfWidth = this.geometry.extentWidthMeters / 2;
    const halfHeight = this.geometry.extentHeightMeters / 2;
    const minimumColumn = Math.max(
      0,
      Math.floor((easting - radiusMeters + halfWidth) / this.cellSizeMeters),
    );
    const maximumColumn = Math.min(
      this.width - 1,
      Math.floor((easting + radiusMeters + halfWidth) / this.cellSizeMeters),
    );
    const minimumRow = Math.max(
      0,
      Math.floor((halfHeight - (northing + radiusMeters)) / this.cellSizeMeters),
    );
    const maximumRow = Math.min(
      this.height - 1,
      Math.floor((halfHeight - (northing - radiusMeters)) / this.cellSizeMeters),
    );
    const radiusSquared = radiusMeters * radiusMeters;
    const cells: GridCell[] = [];
    for (let row = minimumRow; row <= maximumRow; row += 1) {
      const cellNorthing = halfHeight - (row + 0.5) * this.cellSizeMeters;
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        const cellEasting = -halfWidth + (column + 0.5) * this.cellSizeMeters;
        const deltaEast = cellEasting - easting;
        const deltaNorth = cellNorthing - northing;
        if (deltaEast * deltaEast + deltaNorth * deltaNorth <= radiusSquared + 0.001) {
          cells.push({ column, row, index: row * this.width + column });
        }
      }
    }
    return cells;
  }

  public typeAt(position: GeographicPosition): TerrainType {
    const cell = this.cellAt(position);
    return cell ? this.typeAtIndex(cell.index) : "water";
  }

  public typeAtIndex(index: number): TerrainType {
    return terrainTypeFromCode(this.cells.terrainCodeAt(index));
  }

  public vegetationAt(position: GeographicPosition): VegetationFeature {
    const cell = this.cellAt(position);
    return cell
      ? this.vegetationAtIndex(cell.index)
      : VEGETATION_FEATURES_BY_CODE[0]!;
  }

  public vegetationAtIndex(index: number): VegetationFeature {
    return vegetationFeatureFromCode(this.cells.vegetationCodeAt(index));
  }

  public moistureAt(position: GeographicPosition): number {
    const cell = this.cellAt(position);
    return cell ? this.moistureAtIndex(cell.index) : 0;
  }

  public moistureAtIndex(index: number): number {
    return this.cells.moistureAt(index);
  }

  public riverAt(position: GeographicPosition): RiverClass {
    const cell = this.cellAt(position);
    return cell ? this.riverAtIndex(cell.index) : "none";
  }

  public riverAtIndex(index: number): RiverClass {
    const code = this.cells.riverCodeAt(index);
    return code === 2 ? "major" : code === 1 ? "minor" : "none";
  }

  /** Samples the short tactical approach once for deterministic combat resolution. */
  public battleApproachMetrics(
    attacker: GeographicPosition,
    defender: GeographicPosition,
  ): BattleApproachMetrics {
    const start = this.toProjected(attacker);
    const end = this.toProjected(defender);
    const startCell = this.cellAtProjected(start[0], start[1]);
    const endCell = this.cellAtProjected(end[0], end[1]);
    const attackerElevationMeters = startCell
      ? this.surfaceElevationAtIndex(startCell.index)
      : 0;
    const defenderElevationMeters = endCell
      ? this.surfaceElevationAtIndex(endCell.index)
      : 0;
    const distanceMeters = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const attackerSlopeDegrees = distanceMeters <= 0.5
      ? 0
      : Math.atan2(defenderElevationMeters - attackerElevationMeters, distanceMeters) * (180 / Math.PI);
    const sampleCount = Math.max(1, Math.ceil(distanceMeters / Math.max(1, this.cellSizeMeters / 2)));
    let riverCrossing: RiverClass = "none";
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      const ratio = sample / sampleCount;
      const cell = this.cellAtProjected(
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      );
      if (!cell) continue;
      const river = this.riverAtIndex(cell.index);
      if (river === "major") return {
        attackerElevationMeters,
        defenderElevationMeters,
        attackerSlopeDegrees,
        riverCrossing: "major",
      };
      if (river === "minor") riverCrossing = "minor";
    }
    return {
      attackerElevationMeters,
      defenderElevationMeters,
      attackerSlopeDegrees,
      riverCrossing,
    };
  }

  public surfaceElevationAtIndex(index: number): number {
    return this.typeAtIndex(index) === "water"
      ? 0
      : this.cells.elevationAt(index);
  }

  public scoutTravelMetrics(
    position: GeographicPosition,
    destination: GeographicPosition | null,
    terrainModifiers: Readonly<Partial<Record<TerrainType, number>>>,
    vegetationModifiers: Readonly<Partial<Record<VegetationType, number>>> = {},
  ): ScoutTravelMetrics {
    const terrain = this.typeAt(position);
    const { vegetation, density: vegetationDensity } = this.vegetationAt(position);
    const slopeDegrees = destination
      ? this.directionalSlopeDegrees(position, destination)
      : 0;
    const impassable = terrain === "water" || Math.abs(slopeDegrees) > 45;
    const acclimatization = Math.max(
      0,
      (1 + (terrainModifiers[terrain] ?? 0) / 100) *
        (1 + (vegetationModifiers[vegetation] ?? 0) / 100),
    );
    const speedMetersPerHour = impassable
      ? 0
      : Math.round(
          trainedScoutSlopeSpeedMetersPerSecond(slopeDegrees) *
            SCOUT_TERRAIN_FACTORS[terrain] *
            SCOUT_VEGETATION_FACTORS[vegetation][vegetationDensity] *
            acclimatization *
            3_600,
        );
    return {
      terrain,
      vegetation,
      vegetationDensity,
      speedMetersPerHour,
      slopeDegrees: Math.round(slopeDegrees * 10) / 10,
      impassable,
    };
  }

  public advance(
    position: GeographicPosition,
    destination: GeographicPosition,
    worldMinutes: number,
    terrainModifiers: Readonly<Partial<Record<TerrainType, number>>>,
    vegetationModifiers: Readonly<Partial<Record<VegetationType, number>>> = {},
  ): MovementAdvance {
    const metrics = this.scoutTravelMetrics(
      position,
      destination,
      terrainModifiers,
      vegetationModifiers,
    );
    if (metrics.impassable || metrics.speedMetersPerHour <= 0) {
      return {
        ...metrics,
        position: { ...position },
        reached: false,
        blocked: true,
      };
    }

    const current = this.toProjected(position);
    const target = this.toProjected(destination);
    const deltaX = target[0] - current[0];
    const deltaY = target[1] - current[1];
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 0.5) {
      return {
        ...this.scoutTravelMetrics(
          destination,
          null,
          terrainModifiers,
          vegetationModifiers,
        ),
        position: { ...destination },
        reached: true,
        blocked: false,
      };
    }

    const distanceThisTick = Math.min(
      distance,
      (metrics.speedMetersPerHour / 60) * worldMinutes,
    );
    const ratio = distanceThisTick / distance;
    const nextPosition = this.toGeographic([
      current[0] + deltaX * ratio,
      current[1] + deltaY * ratio,
    ]);
    if (this.typeAt(nextPosition) === "water") {
      return {
        ...metrics,
        position: { ...position },
        reached: false,
        blocked: true,
      };
    }
    return {
      ...metrics,
      position: distanceThisTick >= distance ? { ...destination } : nextPosition,
      reached: distanceThisTick >= distance,
      blocked: false,
    };
  }

  /** Integrates the straight preview route in half-cell segments. */
  public estimateScoutTravelMinutes(
    position: GeographicPosition,
    destination: GeographicPosition,
    terrainModifiers: Readonly<Partial<Record<TerrainType, number>>>,
    vegetationModifiers: Readonly<Partial<Record<VegetationType, number>>> = {},
  ): number | null {
    let current = this.toProjected(position);
    const target = this.toProjected(destination);
    const totalDistance = Math.hypot(target[0] - current[0], target[1] - current[1]);
    const sampleLength = Math.max(1, this.cellSizeMeters / 2);
    const maximumSamples = Math.ceil(totalDistance / sampleLength) + 2;
    let totalMinutes = 0;

    for (let sample = 0; sample < maximumSamples; sample += 1) {
      const deltaX = target[0] - current[0];
      const deltaY = target[1] - current[1];
      const remaining = Math.hypot(deltaX, deltaY);
      if (remaining <= 0.5) return Math.ceil(totalMinutes);
      const currentPosition = this.toGeographic(current);
      const metrics = this.scoutTravelMetrics(
        currentPosition,
        destination,
        terrainModifiers,
        vegetationModifiers,
      );
      if (metrics.impassable || metrics.speedMetersPerHour <= 0) return null;
      const segment = Math.min(sampleLength, remaining);
      const ratio = segment / remaining;
      const next: [number, number] = [
        current[0] + deltaX * ratio,
        current[1] + deltaY * ratio,
      ];
      if (this.typeAt(this.toGeographic(next)) === "water") return null;
      totalMinutes += segment / (metrics.speedMetersPerHour / 60);
      current = next;
    }
    return null;
  }

  private directionalSlopeDegrees(
    position: GeographicPosition,
    destination: GeographicPosition,
  ): number {
    const current = this.toProjected(position);
    const target = this.toProjected(destination);
    const deltaX = target[0] - current[0];
    const deltaY = target[1] - current[1];
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 0.5) return 0;
    const directionX = deltaX / distance;
    const directionY = deltaY / distance;
    const halfSample = this.cellSizeMeters * 0.51;
    const currentCell = this.cellAtProjected(current[0], current[1]);
    const fallbackElevation = currentCell
      ? this.surfaceElevationAtIndex(currentCell.index)
      : 0;
    const behind = this.landElevationAtProjected(
      current[0] - directionX * halfSample,
      current[1] - directionY * halfSample,
    );
    const ahead = this.landElevationAtProjected(
      current[0] + directionX * halfSample,
      current[1] + directionY * halfSample,
    );
    return (
      Math.atan2(
        (ahead ?? fallbackElevation) - (behind ?? fallbackElevation),
        halfSample * 2,
      ) *
      (180 / Math.PI)
    );
  }

  private landElevationAtProjected(
    easting: number,
    northing: number,
  ): number | undefined {
    const cell = this.cellAtProjected(easting, northing);
    if (!cell || this.typeAtIndex(cell.index) === "water") return undefined;
    return this.cells.elevationAt(cell.index);
  }

  private cellAtProjected(easting: number, northing: number): GridCell | undefined {
    const column = Math.floor(
      ((easting + this.geometry.extentWidthMeters / 2) /
        this.geometry.extentWidthMeters) *
        this.width,
    );
    const row = Math.floor(
      ((this.geometry.extentHeightMeters / 2 - northing) /
        this.geometry.extentHeightMeters) *
        this.height,
    );
    if (column < 0 || row < 0 || column >= this.width || row >= this.height) {
      return undefined;
    }
    return { column, row, index: row * this.width + column };
  }

  private toProjected(position: GeographicPosition): [number, number] {
    return this.projection.forward([
      position.longitudeE6 / 1_000_000,
      position.latitudeE6 / 1_000_000,
    ]);
  }

  private toGeographic(point: [number, number]): GeographicPosition {
    const [longitude, latitude] = this.projection.inverse(point);
    return {
      longitudeE6: Math.round(longitude * 1_000_000),
      latitudeE6: Math.round(latitude * 1_000_000),
    };
  }
}
