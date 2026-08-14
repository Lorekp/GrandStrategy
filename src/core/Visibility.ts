import {
  CAMP_DETECTION_RADIUS_METERS,
  HUMAN_OBSERVER_HEIGHT_METERS,
  TERRAIN_VISIBILITY_LIMIT_METERS,
  UNIT_DETECTION_RADIUS_METERS,
  VISION_FOOTPRINT_RADIUS_METERS,
  VISION_FOOTPRINT_PERIMETER_SAMPLE_COUNT,
  VILLAGE_DETECTION_RADIUS_METERS,
  VILLAGE_OBSERVER_HEIGHT_METERS,
} from "./constants";
import { PRESENTATION_CONFIG } from "../config/GameConfig";
import { tribalBuildingEffects } from "../tribal/TribalRoster";
import { tribalUnitDefinition } from "../combat/MilitaryRoster";
import {
  createGridBitset,
  gridBitIsSet,
  orGridBitsets,
  setGridBit,
} from "./GridBitset";
import type {
  CurrentPlayerVisibility,
  GeographicPosition,
  Settlement,
  Unit,
} from "./model";
import {
  shapeVisibilityEnvelope,
  type GridBounds,
} from "./VisibilityEnvelope";
import { ViewshedSolver, type ViewshedPatch } from "./Viewshed";
import { WorldGrid, type GridCell } from "./WorldGrid";

const MAXIMUM_CACHED_VIEWSHEDS = PRESENTATION_CONFIG.performance.maximumCachedViewsheds;
const MAXIMUM_CACHED_OBSERVER_RESULTS = PRESENTATION_CONFIG.performance.maximumCachedObserverResults;
const TARGET_VIEWSHED_CELL_SIZE_METERS = PRESENTATION_CONFIG.performance.targetViewshedCellSizeMeters;

export interface VisionObserver {
  readonly id: string;
  readonly position: GeographicPosition;
  readonly observerHeightMeters: number;
  readonly detectionRadiusMeters: number;
  readonly footprintRadiusMeters: number;
  readonly maximumTerrainDistanceMeters: number;
}

export interface ObserverSource {
  readonly cell: GridCell;
  /** Number of the original perimeter samples represented by this grid cell. */
  readonly sampleWeight: number;
}

interface ObserverVisibility {
  readonly visibleCells: Uint32Array;
  readonly unitDetectableCells: Uint32Array;
  readonly campDetectableCells: Uint32Array;
  readonly villageDetectableCells: Uint32Array;
}

export function settlementVisionObserver(
  settlement: Settlement,
): VisionObserver {
  const baseHeight =
    settlement.tier === "village"
      ? VILLAGE_OBSERVER_HEIGHT_METERS
      : HUMAN_OBSERVER_HEIGHT_METERS;
  const buildingHeight = tribalBuildingEffects(
    settlement.buildings,
  ).observerHeightMeters;
  return {
    id: `settlement:${settlement.id}`,
    position: settlement.position,
    observerHeightMeters: Math.max(baseHeight, buildingHeight),
    detectionRadiusMeters:
      settlement.tier === "village"
        ? VILLAGE_DETECTION_RADIUS_METERS
        : CAMP_DETECTION_RADIUS_METERS,
    footprintRadiusMeters: VISION_FOOTPRINT_RADIUS_METERS,
    maximumTerrainDistanceMeters: TERRAIN_VISIBILITY_LIMIT_METERS,
  };
}

export function unitVisionObserver(unit: Unit): VisionObserver {
  const definition = tribalUnitDefinition(unit.kind);
  return {
    id: `unit:${unit.id}`,
    position: unit.position,
    observerHeightMeters: HUMAN_OBSERVER_HEIGHT_METERS,
    detectionRadiusMeters: definition.detectionRadiusMeters,
    footprintRadiusMeters: definition.footprintRadiusMeters,
    maximumTerrainDistanceMeters: definition.maximumTerrainDistanceMeters,
  };
}

/** Resolves 360 metric samples to weighted, unique semantic source cells. */
export function resolveObserverSources(
  grid: WorldGrid,
  observer: VisionObserver,
): ObserverSource[] {
  const center = grid.cellAt(observer.position);
  if (!center) return [];
  if (observer.footprintRadiusMeters <= 0) {
    return [{ cell: center, sampleWeight: 1 }];
  }

  const sources = new Map<number, ObserverSource>();
  for (
    let sample = 0;
    sample < VISION_FOOTPRINT_PERIMETER_SAMPLE_COUNT;
    sample += 1
  ) {
    const angle =
      (sample / VISION_FOOTPRINT_PERIMETER_SAMPLE_COUNT) * Math.PI * 2;
    const cell = grid.cellAtOffset(
      observer.position,
      Math.cos(angle) * observer.footprintRadiusMeters,
      Math.sin(angle) * observer.footprintRadiusMeters,
    );
    if (!cell) continue;
    const previous = sources.get(cell.index);
    sources.set(cell.index, {
      cell,
      sampleWeight: (previous?.sampleWeight ?? 0) + 1,
    });
  }
  if (!sources.has(center.index)) {
    sources.set(center.index, { cell: center, sampleWeight: 0 });
  }
  return [...sources.values()].sort(
    (left, right) => left.cell.index - right.cell.index,
  );
}

export class VisibilitySystem {
  private readonly solver: ViewshedSolver;
  private readonly sightGrid: WorldGrid;
  private readonly sightCellFactor: number;
  private readonly patchCache = new Map<string, ViewshedPatch>();
  private readonly observerCache = new Map<string, ObserverVisibility>();

  public constructor(private readonly grid: WorldGrid) {
    const requestedFactor = Math.max(
      1,
      Math.round(TARGET_VIEWSHED_CELL_SIZE_METERS / grid.cellSizeMeters),
    );
    this.sightCellFactor =
      grid.width % requestedFactor === 0 && grid.height % requestedFactor === 0
        ? requestedFactor
        : 1;
    this.sightGrid = grid.createElevationLod(this.sightCellFactor);
    this.solver = new ViewshedSolver(this.sightGrid);
  }

  public observerKey(observers: readonly VisionObserver[]): string {
    return observers
      .map((observer) => `${observer.id}:${this.observerCacheKey(observer)}`)
      .join("|");
  }

  public compute(
    observers: readonly VisionObserver[],
    revision: number,
  ): CurrentPlayerVisibility {
    const visibleCells = createGridBitset(this.grid.cellCount);
    const unitDetectableCells = createGridBitset(this.grid.cellCount);
    const campDetectableCells = createGridBitset(this.grid.cellCount);
    const villageDetectableCells = createGridBitset(this.grid.cellCount);
    for (const observer of observers) {
      const result = this.getObserverVisibility(observer);
      if (!result) continue;
      orGridBitsets(visibleCells, result.visibleCells);
      orGridBitsets(unitDetectableCells, result.unitDetectableCells);
      orGridBitsets(campDetectableCells, result.campDetectableCells);
      orGridBitsets(villageDetectableCells, result.villageDetectableCells);
    }
    return {
      revision,
      visibleCells,
      unitDetectableCells,
      campDetectableCells,
      villageDetectableCells,
    };
  }

  private getObserverVisibility(
    observer: VisionObserver,
  ): ObserverVisibility | undefined {
    const key = this.observerCacheKey(observer);
    const cached = this.observerCache.get(key);
    if (cached) {
      this.observerCache.delete(key);
      this.observerCache.set(key, cached);
      return cached;
    }

    const sightCenter = this.sightGrid.cellAt(observer.position);
    const center = this.grid.cellAt(observer.position);
    if (!sightCenter || !center) return undefined;
    const sources = resolveObserverSources(this.sightGrid, observer);
    const supportSampleCount = Math.max(
      1,
      sources.reduce((sum, source) => sum + source.sampleWeight, 0),
    );
    const rawVisibleCells = createGridBitset(this.sightGrid.cellCount);
    const protectedCells = createGridBitset(this.sightGrid.cellCount);
    const observerSupport = new Uint16Array(this.sightGrid.cellCount);
    let bounds: GridBounds = {
      left: sightCenter.column,
      top: sightCenter.row,
      right: sightCenter.column,
      bottom: sightCenter.row,
    };

    for (const footprintCell of this.sightGrid.cellsWithinRadius(
      observer.position,
      observer.footprintRadiusMeters,
    )) {
      setGridBit(rawVisibleCells, footprintCell.index);
      setGridBit(protectedCells, footprintCell.index);
      observerSupport[footprintCell.index] = supportSampleCount;
    }
    for (const source of sources) {
      const patch = this.getPatch(
        source.cell.index,
        observer.observerHeightMeters,
        observer.maximumTerrainDistanceMeters,
      );
      bounds = {
        left: Math.min(bounds.left, patch.left),
        top: Math.min(bounds.top, patch.top),
        right: Math.max(bounds.right, patch.left + patch.width - 1),
        bottom: Math.max(bounds.bottom, patch.top + patch.height - 1),
      };
      const patchCellCount = patch.width * patch.height;
      for (let wordIndex = 0; wordIndex < patch.cells.length; wordIndex += 1) {
        let word = patch.cells[wordIndex] ?? 0;
        while (word !== 0) {
          const lowestBit = word & -word;
          const localIndex = (wordIndex << 5) + 31 - Math.clz32(lowestBit);
          if (localIndex >= patchCellCount) break;
          const localRow = Math.floor(localIndex / patch.width);
          const localColumn = localIndex - localRow * patch.width;
          const worldIndex =
            (patch.top + localRow) * this.sightGrid.width +
            patch.left +
            localColumn;
          setGridBit(rawVisibleCells, worldIndex);
          observerSupport[worldIndex] = Math.min(
            0xffff,
            (observerSupport[worldIndex] ?? 0) + source.sampleWeight,
          );
          word &= word - 1;
        }
      }
    }

    const sightVisibleCells = shapeVisibilityEnvelope({
      rawVisibleCells,
      observerSupport,
      protectedCells,
      width: this.sightGrid.width,
      height: this.sightGrid.height,
      cellSizeMeters: this.sightGrid.cellSizeMeters,
      observerCell: sightCenter,
      supportSampleCount,
      bounds,
    });
    const visibleCells = this.expandSightCells(sightVisibleCells);
    for (const footprintCell of this.grid.cellsWithinRadius(
      observer.position,
      observer.footprintRadiusMeters,
    )) {
      setGridBit(visibleCells, footprintCell.index);
    }
    const unitDetectableCells = createGridBitset(this.grid.cellCount);
    const campDetectableCells = createGridBitset(this.grid.cellCount);
    const villageDetectableCells = createGridBitset(this.grid.cellCount);
    const unitRadiusCells =
      Math.min(observer.detectionRadiusMeters, UNIT_DETECTION_RADIUS_METERS) /
      this.grid.cellSizeMeters;
    const campRadiusCells =
      Math.min(observer.detectionRadiusMeters, CAMP_DETECTION_RADIUS_METERS) /
      this.grid.cellSizeMeters;
    const villageRadiusCells =
      Math.min(observer.detectionRadiusMeters, VILLAGE_DETECTION_RADIUS_METERS) /
      this.grid.cellSizeMeters;
    const unitRadiusSquared = unitRadiusCells * unitRadiusCells;
    const campRadiusSquared = campRadiusCells * campRadiusCells;
    const villageRadiusSquared = villageRadiusCells * villageRadiusCells;
    const radiusCeiling = Math.ceil(
      Math.max(unitRadiusCells, campRadiusCells, villageRadiusCells),
    );
    const top = Math.max(0, center.row - radiusCeiling);
    const bottom = Math.min(this.grid.height - 1, center.row + radiusCeiling);
    const left = Math.max(0, center.column - radiusCeiling);
    const right = Math.min(this.grid.width - 1, center.column + radiusCeiling);
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const dx = column - center.column;
        const dy = row - center.row;
        const index = row * this.grid.width + column;
        if (!gridBitIsSet(visibleCells, index)) continue;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared <= unitRadiusSquared) {
          setGridBit(unitDetectableCells, index);
        }
        if (distanceSquared <= campRadiusSquared) {
          setGridBit(campDetectableCells, index);
        }
        if (distanceSquared <= villageRadiusSquared) {
          setGridBit(villageDetectableCells, index);
        }
      }
    }

    const result = {
      visibleCells,
      unitDetectableCells,
      campDetectableCells,
      villageDetectableCells,
    };
    this.observerCache.set(key, result);
    if (this.observerCache.size > MAXIMUM_CACHED_OBSERVER_RESULTS) {
      const oldestKey = this.observerCache.keys().next().value as
        | string
        | undefined;
      if (oldestKey !== undefined) this.observerCache.delete(oldestKey);
    }
    return result;
  }

  private observerCacheKey(observer: VisionObserver): string {
    const centerIndex = this.grid.cellAt(observer.position)?.index ?? -1;
    const sources = resolveObserverSources(this.sightGrid, observer)
      .map((source) => `${source.cell.index}:${source.sampleWeight}`)
      .join(",");
    return `${centerIndex}:${sources}:${observer.observerHeightMeters}:${observer.detectionRadiusMeters}:${observer.footprintRadiusMeters}:${observer.maximumTerrainDistanceMeters}`;
  }

  private getPatch(
    cellIndex: number,
    observerHeightMeters: number,
    maximumDistanceMeters: number,
  ): ViewshedPatch {
    const key = `${cellIndex}:${observerHeightMeters}:${maximumDistanceMeters}`;
    const cached = this.patchCache.get(key);
    if (cached) {
      this.patchCache.delete(key);
      this.patchCache.set(key, cached);
      return cached;
    }
    const source = {
      column: cellIndex % this.sightGrid.width,
      row: Math.floor(cellIndex / this.sightGrid.width),
      index: cellIndex,
    };
    const patch = this.solver.compute(
      source,
      observerHeightMeters,
      maximumDistanceMeters,
    );
    this.patchCache.set(key, patch);
    if (this.patchCache.size > MAXIMUM_CACHED_VIEWSHEDS) {
      const oldestKey = this.patchCache.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.patchCache.delete(oldestKey);
    }
    return patch;
  }

  private expandSightCells(sightCells: Uint32Array): Uint32Array {
    if (this.sightCellFactor === 1) return sightCells;
    const expanded = createGridBitset(this.grid.cellCount);
    for (let wordIndex = 0; wordIndex < sightCells.length; wordIndex += 1) {
      let word = sightCells[wordIndex] ?? 0;
      while (word !== 0) {
        const lowestBit = word & -word;
        const sightIndex = (wordIndex << 5) + 31 - Math.clz32(lowestBit);
        if (sightIndex >= this.sightGrid.cellCount) break;
        const sightRow = Math.floor(sightIndex / this.sightGrid.width);
        const sightColumn = sightIndex - sightRow * this.sightGrid.width;
        const top = sightRow * this.sightCellFactor;
        const left = sightColumn * this.sightCellFactor;
        for (let row = 0; row < this.sightCellFactor; row += 1) {
          for (let column = 0; column < this.sightCellFactor; column += 1) {
            setGridBit(
              expanded,
              (top + row) * this.grid.width + left + column,
            );
          }
        }
        word &= word - 1;
      }
    }
    return expanded;
  }
}
