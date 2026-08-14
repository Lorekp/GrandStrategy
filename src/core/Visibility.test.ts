import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { gridBitIsSet } from "./GridBitset";
import { VISION_FOOTPRINT_PERIMETER_SAMPLE_COUNT } from "./constants";
import type { GeographicPosition, Settlement, Unit } from "./model";
import {
  unitVisionObserver,
  settlementVisionObserver,
  resolveObserverSources,
  VisibilitySystem,
  type VisionObserver,
} from "./Visibility";
import { WorldGrid } from "./WorldGrid";

const projectionDefinition =
  "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs";
const projection = proj4("EPSG:4326", projectionDefinition);

function positionAt(easting: number, northing = 0): GeographicPosition {
  const [longitude, latitude] = projection.inverse([easting, northing]);
  return {
    longitudeE6: Math.round(longitude * 1_000_000),
    latitudeE6: Math.round(latitude * 1_000_000),
  };
}

function makeGrid(): WorldGrid {
  const width = 201;
  const height = 201;
  return new WorldGrid({
    projectionDefinition,
    extentWidthMeters: width * 500,
    extentHeightMeters: height * 500,
    width,
    height,
    terrainCells: new Uint8Array(width * height).fill(1),
    vegetationCells: new Uint8Array(width * height),
    moistureCells: new Uint8Array(width * height),
    riverCells: new Uint8Array(width * height),
    elevationMeters: new Int16Array(width * height),
  });
}

function countBits(words: Uint32Array): number {
  let count = 0;
  for (const word of words) {
    let remaining = word;
    while (remaining !== 0) {
      remaining &= remaining - 1;
      count += 1;
    }
  }
  return count;
}

describe("visibility composition", () => {
  it("unions observers while retaining their different detection limits", () => {
    const grid = makeGrid();
    const system = new VisibilitySystem(grid);
    const observers: VisionObserver[] = [
      {
        id: "camp",
        position: positionAt(0),
        observerHeightMeters: 100,
        detectionRadiusMeters: 10_000,
        footprintRadiusMeters: 0,
        maximumTerrainDistanceMeters: 80_000,
      },
      {
        id: "scout",
        position: positionAt(20_000),
        observerHeightMeters: 100,
        detectionRadiusMeters: 3_000,
        footprintRadiusMeters: 0,
        maximumTerrainDistanceMeters: 80_000,
      },
    ];
    const visibility = system.compute(observers, 1);
    const cellAt = (easting: number) => grid.cellAt(positionAt(easting))!.index;

    expect(gridBitIsSet(visibility.campDetectableCells, cellAt(9_000))).toBe(true);
    expect(gridBitIsSet(visibility.campDetectableCells, cellAt(-11_000))).toBe(false);
    expect(gridBitIsSet(visibility.villageDetectableCells, cellAt(22_500))).toBe(true);
    expect(gridBitIsSet(visibility.villageDetectableCells, cellAt(24_000))).toBe(false);
    expect(gridBitIsSet(visibility.unitDetectableCells, cellAt(20_500))).toBe(true);
    expect(gridBitIsSet(visibility.unitDetectableCells, cellAt(21_000))).toBe(false);
    expect(gridBitIsSet(visibility.visibleCells, cellAt(0))).toBe(true);
    expect(gridBitIsSet(visibility.visibleCells, cellAt(20_000))).toBe(true);
  });

  it("turns a Scout Post into observer height rather than a radius bonus", () => {
    const grid = makeGrid();
    const system = new VisibilitySystem(grid);
    const camp: Settlement = {
      id: 1,
      tribeId: 1,
      name: "Camp",
      position: positionAt(0),
      tier: "camp",
      population: 100,
      influenceRadiusMeters: 10_000,
      administrator: "tribal-leader",
      buildings: [],
    };
    const campObserver = settlementVisionObserver(camp);
    const postObserver = settlementVisionObserver({
      ...camp,
      buildings: ["scout-post"],
    });
    const fromCamp = system.compute([campObserver], 1);
    const fromPost = system.compute([postObserver], 2);

    expect(campObserver.observerHeightMeters).toBe(1.75);
    expect(campObserver.footprintRadiusMeters).toBe(1_000);
    expect(postObserver.observerHeightMeters).toBe(12);
    expect(countBits(fromPost.visibleCells)).toBeGreaterThan(
      countBits(fromCamp.visibleCells),
    );
    expect(postObserver.detectionRadiusMeters).toBe(
      campObserver.detectionRadiusMeters,
    );
    expect(
      gridBitIsSet(
        fromPost.campDetectableCells,
        grid.cellAt(positionAt(11_000))!.index,
      ),
    ).toBe(false);

    const sources = resolveObserverSources(grid, campObserver);
    expect(VISION_FOOTPRINT_PERIMETER_SAMPLE_COUNT).toBe(360);
    expect(sources.length).toBeGreaterThan(1);
    expect(sources.length).toBeLessThan(
      VISION_FOOTPRINT_PERIMETER_SAMPLE_COUNT,
    );
    expect(new Set(sources.map(({ cell }) => cell.index)).size).toBe(
      sources.length,
    );
    expect(
      sources.reduce((sum, source) => sum + source.sampleWeight, 0),
    ).toBe(VISION_FOOTPRINT_PERIMETER_SAMPLE_COUNT);
    for (const footprintCell of grid.cellsWithinRadius(
      camp.position,
      1_000,
    )) {
      expect(gridBitIsSet(fromCamp.visibleCells, footprintCell.index)).toBe(true);
    }
  });

  it("samples a Scout from a 1 km perimeter and fully reveals its interior", () => {
    const grid = makeGrid();
    const scout: Unit = {
      id: 1,
      tribeId: 1,
      homeSettlementId: 1,
      kind: "scout",
      position: positionAt(0),
      route: [],
      terrain: "plains",
      vegetation: "none",
      vegetationDensity: "none",
      speedMetersPerHour: 4_474,
      slopeDegrees: 0,
      remainingTravelMinutes: null,
      combat: null,
    };
    const observer = unitVisionObserver(scout);
    const sources = resolveObserverSources(grid, observer);
    const visibility = new VisibilitySystem(grid).compute([observer], 1);

    expect(observer.footprintRadiusMeters).toBe(1_000);
    expect(
      sources.reduce((sum, source) => sum + source.sampleWeight, 0),
    ).toBe(VISION_FOOTPRINT_PERIMETER_SAMPLE_COUNT);
    for (const footprintCell of grid.cellsWithinRadius(scout.position, 1_000)) {
      expect(gridBitIsSet(visibility.visibleCells, footprintCell.index)).toBe(true);
    }
  });
});
