import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { TICK_DURATION_MS } from "./constants";
import type { GeographicPosition } from "./model";
import { VisibilitySystem, type VisionObserver } from "./Visibility";
import { WorldGrid } from "./WorldGrid";

const GRID_SIZE = 3_072;
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

function scout(position: GeographicPosition): VisionObserver {
  return {
    id: "unit:1",
    position,
    observerHeightMeters: 1.75,
    detectionRadiusMeters: 3_000,
    footprintRadiusMeters: 1_000,
    maximumTerrainDistanceMeters: 80_000,
  };
}

describe("moving Scout visibility", () => {
  it("avoids the previous half-tick visibility spike on a newly entered cell", () => {
    const grid = new WorldGrid({
      projectionDefinition,
      extentWidthMeters: GRID_SIZE * 250,
      extentHeightMeters: GRID_SIZE * 250,
      width: GRID_SIZE,
      height: GRID_SIZE,
      terrainCells: new Uint8Array(GRID_SIZE * GRID_SIZE).fill(1),
      vegetationCells: new Uint8Array(GRID_SIZE * GRID_SIZE),
      moistureCells: new Uint8Array(GRID_SIZE * GRID_SIZE),
      riverCells: new Uint8Array(GRID_SIZE * GRID_SIZE),
      elevationMeters: new Int16Array(GRID_SIZE * GRID_SIZE),
    });
    const system = new VisibilitySystem(grid);
    expect(grid.cellAt(positionAt(0))?.index).not.toBe(
      grid.cellAt(positionAt(250))?.index,
    );
    system.compute([scout(positionAt(0))], 1);

    const start = performance.now();
    system.compute([scout(positionAt(250))], 2);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(TICK_DURATION_MS / 2);
  });
});
