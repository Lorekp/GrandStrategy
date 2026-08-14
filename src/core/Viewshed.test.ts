import { describe, expect, it } from "vitest";
import { gridBitIsSet } from "./GridBitset";
import type { WorldGridDefinition } from "./model";
import { ViewshedSolver, type ViewshedPatch } from "./Viewshed";
import { WorldGrid } from "./WorldGrid";

function makeGrid(
  width: number,
  height: number,
  cellSizeMeters: number,
  elevations: Int16Array = new Int16Array(width * height),
): WorldGrid {
  const definition: WorldGridDefinition = {
    projectionDefinition:
      "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs",
    extentWidthMeters: width * cellSizeMeters,
    extentHeightMeters: height * cellSizeMeters,
    width,
    height,
    terrainCells: new Uint8Array(width * height).fill(1),
    vegetationCells: new Uint8Array(width * height),
    moistureCells: new Uint8Array(width * height),
    riverCells: new Uint8Array(width * height),
    elevationMeters: elevations,
  };
  return new WorldGrid(definition);
}

function patchContains(
  patch: ViewshedPatch,
  column: number,
  row: number,
): boolean {
  if (
    column < patch.left ||
    row < patch.top ||
    column >= patch.left + patch.width ||
    row >= patch.top + patch.height
  ) {
    return false;
  }
  return gridBitIsSet(
    patch.cells,
    (row - patch.top) * patch.width + column - patch.left,
  );
}

describe("elevation viewshed", () => {
  it("applies Earth curvature to flat terrain", () => {
    const grid = makeGrid(121, 3, 1_000);
    const observer = { column: 60, row: 1, index: 181 };
    const patch = new ViewshedSolver(grid).compute(observer, 1.75);

    expect(patchContains(patch, 65, 1)).toBe(true);
    expect(patchContains(patch, 70, 1)).toBe(false);
  });

  it("lets a hilltop observer see much farther across plains", () => {
    const elevations = new Int16Array(121 * 3);
    elevations[181] = 100;
    const grid = makeGrid(121, 3, 1_000, elevations);
    const observer = { column: 60, row: 1, index: 181 };
    const patch = new ViewshedSolver(grid).compute(observer, 1.75);

    expect(patchContains(patch, 95, 1)).toBe(true);
    expect(patchContains(patch, 110, 1)).toBe(false);
  });

  it("allows a ridge to hide lower terrain behind it", () => {
    const elevations = new Int16Array(21 * 3);
    elevations[1 * 21 + 8] = 200;
    const grid = makeGrid(21, 3, 100, elevations);
    const observer = { column: 3, row: 1, index: 24 };
    const patch = new ViewshedSolver(grid, {
      maximumDistanceMeters: 2_000,
    }).compute(observer, 1.75);

    expect(patchContains(patch, 8, 1)).toBe(true);
    expect(patchContains(patch, 13, 1)).toBe(false);
  });

  it("returns identical bits for identical inputs", () => {
    const grid = makeGrid(31, 31, 500);
    const observer = { column: 15, row: 15, index: 480 };
    const solver = new ViewshedSolver(grid);

    expect(solver.compute(observer, 12).cells).toEqual(
      solver.compute(observer, 12).cells,
    );
  });
});
