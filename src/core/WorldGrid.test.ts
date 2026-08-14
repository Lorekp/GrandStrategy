import { describe, expect, it } from "vitest";
import { geographicDistanceMeters } from "./Geography";
import {
  flatScoutSpeedKilometersPerHour,
  trainedScoutSlopeSpeedMetersPerSecond,
  WorldGrid,
} from "./WorldGrid";

function flatGrid(vegetationCells = Uint8Array.of(0, 0, 0)): WorldGrid {
  return new WorldGrid({
    projectionDefinition:
      "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs",
    extentWidthMeters: 3_000,
    extentHeightMeters: 1_000,
    width: 3,
    height: 1,
    terrainCells: Uint8Array.of(1, 1, 1),
    vegetationCells,
    moistureCells: Uint8Array.of(64, 128, 192),
    riverCells: new Uint8Array(3),
    elevationMeters: Int16Array.of(0, 0, 0),
  });
}

describe("elevation LOD", () => {
  it("averages fine cells deterministically for visibility", () => {
    const grid = new WorldGrid({
      projectionDefinition:
        "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs",
      extentWidthMeters: 1_000,
      extentHeightMeters: 1_000,
      width: 4,
      height: 4,
      terrainCells: new Uint8Array(16).fill(1),
      vegetationCells: new Uint8Array(16),
      moistureCells: new Uint8Array(16),
      riverCells: new Uint8Array(16),
      elevationMeters: Int16Array.from([
        0, 10, 20, 30,
        20, 30, 40, 50,
        60, 70, 80, 90,
        80, 90, 100, 110,
      ]),
    });

    const visibilityGrid = grid.createElevationLod(2);

    expect(visibilityGrid.width).toBe(2);
    expect(visibilityGrid.height).toBe(2);
    expect(visibilityGrid.cellSizeMeters).toBe(500);
    expect(visibilityGrid.surfaceElevationAtIndex(0)).toBe(15);
    expect(visibilityGrid.surfaceElevationAtIndex(3)).toBe(95);
  });
});

describe("realistic scout travel", () => {
  it("uses measured trained-firefighter pace and explicit surface footing", () => {
    expect(trainedScoutSlopeSpeedMetersPerSecond(0)).toBeCloseTo(1.381, 3);
    expect(trainedScoutSlopeSpeedMetersPerSecond(15)).toBeCloseTo(0.901, 3);
    expect(trainedScoutSlopeSpeedMetersPerSecond(-15)).toBeCloseTo(1.111, 3);
    expect(flatScoutSpeedKilometersPerHour("plains")).toBeCloseTo(4.48, 2);
    expect(flatScoutSpeedKilometersPerHour("plains", "forest", "moderate")).toBeCloseTo(4.22, 2);
    expect(flatScoutSpeedKilometersPerHour("plains", "jungle", "dense")).toBeCloseTo(1.49, 2);
    expect(flatScoutSpeedKilometersPerHour("tundra")).toBeCloseTo(3.73, 2);
    expect(flatScoutSpeedKilometersPerHour("ice")).toBeCloseTo(2.49, 2);
  });

  it("advances by physical distance per world minute", () => {
    const grid = flatGrid(Uint8Array.of(3, 3, 3));
    const start = { longitudeE6: 0, latitudeE6: 0 };
    const destination = { longitudeE6: 5_000, latitudeE6: 0 };
    const advance = grid.advance(start, destination, 1, {});
    expect(advance.vegetation).toBe("forest");
    expect(advance.vegetationDensity).toBe("moderate");
    expect(advance.speedMetersPerHour).toBeCloseTo(4_226, -1);
    expect(geographicDistanceMeters(start, advance.position)).toBeCloseTo(70, 0);
  });

  it("applies directional elevation continuously instead of a hill percentage", () => {
    const grid = new WorldGrid({
      projectionDefinition:
        "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs",
      extentWidthMeters: 5_000,
      extentHeightMeters: 1_000,
      width: 5,
      height: 1,
      terrainCells: Uint8Array.of(1, 2, 2, 2, 1),
      vegetationCells: Uint8Array.of(0, 0, 0, 0, 0),
      moistureCells: Uint8Array.of(0, 0, 0, 0, 0),
      riverCells: new Uint8Array(5),
      elevationMeters: Int16Array.of(0, 0, 200, 400, 400),
    });
    const center = { longitudeE6: 0, latitudeE6: 0 };
    const east = { longitudeE6: 20_000, latitudeE6: 0 };
    const west = { longitudeE6: -20_000, latitudeE6: 0 };
    const uphill = grid.scoutTravelMetrics(center, east, {});
    const downhill = grid.scoutTravelMetrics(center, west, {});

    expect(uphill.slopeDegrees).toBeGreaterThan(10);
    expect(downhill.slopeDegrees).toBeLessThan(-10);
    expect(uphill.speedMetersPerHour).toBeLessThan(downhill.speedMetersPerHour);
  });

  it("applies culture acclimatization after physical surface and slope pace", () => {
    const grid = flatGrid();
    const position = { longitudeE6: 0, latitudeE6: 0 };
    const base = grid.scoutTravelMetrics(position, null, {});
    const acclimatized = grid.scoutTravelMetrics(position, null, { plains: 25 });
    expect(acclimatized.speedMetersPerHour).toBeCloseTo(
      base.speedMetersPerHour * 1.25,
      -1,
    );
  });
});

describe("world grid", () => {
  it("shares terrain, surface cover, and elevation on semantic cells", () => {
    const grid = new WorldGrid({
      projectionDefinition:
        "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs",
      extentWidthMeters: 3_000,
      extentHeightMeters: 1_000,
      width: 3,
      height: 1,
      terrainCells: Uint8Array.of(1, 2, 3),
      vegetationCells: Uint8Array.of(0, 2, 0),
      moistureCells: Uint8Array.of(32, 128, 224),
      riverCells: Uint8Array.of(0, 1, 2),
      elevationMeters: Int16Array.of(20, 35, 800),
    });
    const center = grid.cellAt({ longitudeE6: 0, latitudeE6: 0 });
    expect(center && grid.typeAtIndex(center.index)).toBe("hills");
    expect(center && grid.vegetationAtIndex(center.index)).toEqual({
      vegetation: "forest",
      density: "light",
    });
    expect(center && grid.surfaceElevationAtIndex(center.index)).toBe(35);
    expect(center && grid.riverAtIndex(center.index)).toBe("minor");
  });

  it("reports tactical height, slope, and the strongest crossed river", () => {
    const grid = new WorldGrid({
      projectionDefinition:
        "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs",
      extentWidthMeters: 3_000,
      extentHeightMeters: 1_000,
      width: 3,
      height: 1,
      terrainCells: Uint8Array.of(1, 1, 2),
      vegetationCells: new Uint8Array(3),
      moistureCells: new Uint8Array(3),
      riverCells: Uint8Array.of(0, 2, 0),
      elevationMeters: Int16Array.of(0, 100, 200),
    });
    const metrics = grid.battleApproachMetrics(
      { longitudeE6: -8_000, latitudeE6: 0 },
      { longitudeE6: 8_000, latitudeE6: 0 },
    );
    expect(metrics.attackerElevationMeters).toBe(0);
    expect(metrics.defenderElevationMeters).toBe(200);
    expect(metrics.attackerSlopeDegrees).toBeGreaterThan(5);
    expect(metrics.riverCrossing).toBe("major");
  });

  it("resolves metric circles and offsets on the semantic grid", () => {
    const grid = new WorldGrid({
      projectionDefinition:
        "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs",
      extentWidthMeters: 10_500,
      extentHeightMeters: 10_500,
      width: 21,
      height: 21,
      terrainCells: new Uint8Array(21 * 21).fill(1),
      vegetationCells: new Uint8Array(21 * 21),
      moistureCells: new Uint8Array(21 * 21),
      riverCells: new Uint8Array(21 * 21),
      elevationMeters: new Int16Array(21 * 21),
    });
    const center = { longitudeE6: 0, latitudeE6: 0 };
    const footprint = grid.cellsWithinRadius(center, 1_000);
    const eastEdge = grid.cellAtOffset(center, 1_000, 0)!;
    const outsideDiagonal = grid.cellAtOffset(center, 1_000, 500)!;

    expect(footprint).toHaveLength(13);
    expect(footprint.map((cell) => cell.index)).toContain(eastEdge.index);
    expect(footprint.map((cell) => cell.index)).not.toContain(
      outsideDiagonal.index,
    );
  });
});
