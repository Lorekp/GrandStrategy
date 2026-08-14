import {
  EARTH_RADIUS_METERS,
  TERRAIN_VISIBILITY_LIMIT_METERS,
  TERRAIN_VISIBILITY_REFRACTION_COEFFICIENT,
} from "./constants";
import { createGridBitset, setGridBit } from "./GridBitset";
import type { GridCell } from "./WorldGrid";
import { WorldGrid } from "./WorldGrid";

const TWO_PI = Math.PI * 2;
const SLOPE_EPSILON = 1e-12;

interface AngularSample {
  readonly dx: number;
  readonly dy: number;
  readonly distanceSquaredCells: number;
  readonly distanceMeters: number;
  readonly startBin: number;
  readonly endBin: number;
  readonly wraps: boolean;
}

export interface ViewshedPatch {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly cells: Uint32Array;
}

export interface ViewshedOptions {
  readonly maximumDistanceMeters?: number;
  readonly earthRadiusMeters?: number;
  readonly refractionCoefficient?: number;
}

function normalizeAngle(angle: number): number {
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

/**
 * Deterministic outward horizon sweep over the semantic elevation grid.
 * Each angular bin remembers the steepest corrected terrain slope encountered.
 */
export class ViewshedSolver {
  private readonly maximumDistanceMeters: number;
  private readonly effectiveEarthDiameterMeters: number;
  private readonly binCount: number;
  private readonly samples: readonly AngularSample[];

  public constructor(
    private readonly grid: WorldGrid,
    options: ViewshedOptions = {},
  ) {
    this.maximumDistanceMeters =
      options.maximumDistanceMeters ?? TERRAIN_VISIBILITY_LIMIT_METERS;
    const earthRadiusMeters = options.earthRadiusMeters ?? EARTH_RADIUS_METERS;
    const refractionCoefficient =
      options.refractionCoefficient ??
      TERRAIN_VISIBILITY_REFRACTION_COEFFICIENT;
    if (
      this.maximumDistanceMeters <= 0 ||
      earthRadiusMeters <= 0 ||
      refractionCoefficient < 0 ||
      refractionCoefficient >= 1
    ) {
      throw new Error("Viewshed options are outside their valid ranges");
    }
    this.effectiveEarthDiameterMeters =
      (2 * earthRadiusMeters) / (1 - refractionCoefficient);

    const radiusCells = Math.ceil(
      this.maximumDistanceMeters / this.grid.cellSizeMeters,
    );
    this.binCount = Math.max(64, Math.ceil(4 * Math.PI * radiusCells));
    this.samples = this.buildSamples(radiusCells);
  }

  public compute(
    observer: GridCell,
    observerHeightMeters: number,
    maximumDistanceMeters = this.maximumDistanceMeters,
  ): ViewshedPatch {
    if (
      observerHeightMeters < 0 ||
      maximumDistanceMeters <= 0 ||
      maximumDistanceMeters > this.maximumDistanceMeters
    ) {
      throw new Error("Observer height cannot be negative");
    }
    const radiusCells = Math.ceil(
      maximumDistanceMeters / this.grid.cellSizeMeters,
    );
    const left = Math.max(0, observer.column - radiusCells);
    const top = Math.max(0, observer.row - radiusCells);
    const right = Math.min(this.grid.width - 1, observer.column + radiusCells);
    const bottom = Math.min(this.grid.height - 1, observer.row + radiusCells);
    const width = right - left + 1;
    const height = bottom - top + 1;
    const cells = createGridBitset(width * height);
    setGridBit(
      cells,
      (observer.row - top) * width + observer.column - left,
    );

    const observerElevation =
      this.grid.surfaceElevationAtIndex(observer.index) + observerHeightMeters;
    const horizons = new Float64Array(this.binCount);
    horizons.fill(Number.NEGATIVE_INFINITY);

    let groupStart = 0;
    while (groupStart < this.samples.length) {
      const distanceSquared =
        this.samples[groupStart]?.distanceSquaredCells ?? 0;
      if (
        (this.samples[groupStart]?.distanceMeters ?? Number.POSITIVE_INFINITY) >
        maximumDistanceMeters
      ) {
        break;
      }
      let groupEnd = groupStart + 1;
      while (
        groupEnd < this.samples.length &&
        this.samples[groupEnd]?.distanceSquaredCells === distanceSquared
      ) {
        groupEnd += 1;
      }

      for (let index = groupStart; index < groupEnd; index += 1) {
        const sample = this.samples[index];
        if (!sample) continue;
        const column = observer.column + sample.dx;
        const row = observer.row + sample.dy;
        if (
          column < 0 ||
          row < 0 ||
          column >= this.grid.width ||
          row >= this.grid.height
        ) {
          continue;
        }
        const targetIndex = row * this.grid.width + column;
        const curvatureDrop =
          (sample.distanceMeters * sample.distanceMeters) /
          this.effectiveEarthDiameterMeters;
        const slope =
          (this.grid.surfaceElevationAtIndex(targetIndex) -
            observerElevation -
            curvatureDrop) /
          sample.distanceMeters;
        if (this.isAboveHorizon(sample, slope, horizons)) {
          setGridBit(cells, (row - top) * width + column - left);
        }
      }

      for (let index = groupStart; index < groupEnd; index += 1) {
        const sample = this.samples[index];
        if (!sample) continue;
        const column = observer.column + sample.dx;
        const row = observer.row + sample.dy;
        if (
          column < 0 ||
          row < 0 ||
          column >= this.grid.width ||
          row >= this.grid.height
        ) {
          continue;
        }
        const targetIndex = row * this.grid.width + column;
        const curvatureDrop =
          (sample.distanceMeters * sample.distanceMeters) /
          this.effectiveEarthDiameterMeters;
        const slope =
          (this.grid.surfaceElevationAtIndex(targetIndex) -
            observerElevation -
            curvatureDrop) /
          sample.distanceMeters;
        this.raiseHorizon(sample, slope, horizons);
      }
      groupStart = groupEnd;
    }

    return { left, top, width, height, cells };
  }

  private buildSamples(radiusCells: number): AngularSample[] {
    const samples: AngularSample[] = [];
    const maximumDistanceSquared =
      this.maximumDistanceMeters * this.maximumDistanceMeters;
    for (let dy = -radiusCells; dy <= radiusCells; dy += 1) {
      for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const distanceSquaredCells = dx * dx + dy * dy;
        const distanceMeters =
          Math.sqrt(distanceSquaredCells) * this.grid.cellSizeMeters;
        if (distanceMeters * distanceMeters > maximumDistanceSquared) continue;

        const angle = normalizeAngle(Math.atan2(dy, dx));
        const angularHalfWidth = Math.atan2(
          Math.SQRT1_2,
          Math.sqrt(distanceSquaredCells),
        );
        const startAngle = normalizeAngle(angle - angularHalfWidth);
        const endAngle = normalizeAngle(angle + angularHalfWidth);
        samples.push({
          dx,
          dy,
          distanceSquaredCells,
          distanceMeters,
          startBin: this.angleToBin(startAngle),
          endBin: this.angleToBin(endAngle),
          wraps: startAngle > endAngle,
        });
      }
    }
    samples.sort(
      (first, second) =>
        first.distanceSquaredCells - second.distanceSquaredCells ||
        first.dy - second.dy ||
        first.dx - second.dx,
    );
    return samples;
  }

  private angleToBin(angle: number): number {
    return Math.min(
      this.binCount - 1,
      Math.floor((angle / TWO_PI) * this.binCount),
    );
  }

  private isAboveHorizon(
    sample: AngularSample,
    slope: number,
    horizons: Float64Array,
  ): boolean {
    let visible = false;
    this.forEachBin(sample, (bin) => {
      if (slope + SLOPE_EPSILON >= (horizons[bin] ?? Number.POSITIVE_INFINITY)) {
        visible = true;
      }
    });
    return visible;
  }

  private raiseHorizon(
    sample: AngularSample,
    slope: number,
    horizons: Float64Array,
  ): void {
    this.forEachBin(sample, (bin) => {
      if (slope > (horizons[bin] ?? Number.POSITIVE_INFINITY)) {
        horizons[bin] = slope;
      }
    });
  }

  private forEachBin(sample: AngularSample, visit: (bin: number) => void): void {
    if (!sample.wraps) {
      for (let bin = sample.startBin; bin <= sample.endBin; bin += 1) visit(bin);
      return;
    }
    for (let bin = sample.startBin; bin < this.binCount; bin += 1) visit(bin);
    for (let bin = 0; bin <= sample.endBin; bin += 1) visit(bin);
  }
}
