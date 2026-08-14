import { describe, expect, it } from "vitest";
import { PRESENTATION_CONFIG } from "../config/GameConfig";
import type { WorldGridDefinition } from "../core/model";
import {
  buildTheaterContourPresentation,
  buildTheaterMapViewData,
  colorTheaterMapViewPixel,
  traceTheaterContourSegments,
} from "./TheaterMapViewLayer";

describe("theater map views", () => {
  it("packs a bounded immutable display atlas from the semantic grid", () => {
    const definition: WorldGridDefinition = {
      projectionDefinition: "test",
      extentWidthMeters: 4_000,
      extentHeightMeters: 2_000,
      width: 4,
      height: 2,
      terrainCells: Uint8Array.of(1, 1, 1, 1, 1, 2, 3, 4),
      vegetationCells: Uint8Array.of(0, 0, 0, 0, 0, 4, 7, 0),
      moistureCells: Uint8Array.of(0, 0, 0, 0, 0, 64, 128, 255),
      riverCells: new Uint8Array(8),
      elevationMeters: Int16Array.of(0, 0, 0, 0, 0, 400, 1_200, 4_000),
    };

    const data = buildTheaterMapViewData(definition, 2);
    expect({ width: data.width, height: data.height }).toEqual({
      width: 2,
      height: 1,
    });
    expect([...data.fields]).toEqual([
      expect.any(Number), 64, 4, 2,
      255, 255, 0, 4,
    ]);
  });

  it("maps continuous height and moisture values to ordered palettes", () => {
    const low = colorTheaterMapViewPixel("height", 0, 0, 0, 1);
    const high = colorTheaterMapViewPixel("height", 255, 0, 0, 1);
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(high[1]).toBeGreaterThan(low[1]);

    const dry = colorTheaterMapViewPixel("moisture", 0, 0, 0, 1);
    const wet = colorTheaterMapViewPixel("moisture", 0, 255, 0, 1);
    expect(wet).not.toEqual(dry);
  });

  it("shows only tree cover in the initial resource palette", () => {
    const empty = colorTheaterMapViewPixel("resources", 0, 0, 0, 1);
    const forest = colorTheaterMapViewPixel("resources", 0, 0, 4, 1);
    const jungle = colorTheaterMapViewPixel("resources", 0, 0, 8, 1);
    expect(forest).not.toEqual(empty);
    expect(jungle).not.toEqual(empty);
    expect(jungle).not.toEqual(forest);
  });

  it("uses one water treatment across analytic views", () => {
    expect(colorTheaterMapViewPixel("height", 255, 255, 8, 0)).toEqual(
      colorTheaterMapViewPixel("moisture", 0, 0, 0, 0),
    );
  });

  it("derives regular and labelled index contours from land elevation", () => {
    const elevations = Int16Array.from(
      { length: 32 },
      (_, index) => (index % 8) * 120,
    );
    const definition: WorldGridDefinition = {
      projectionDefinition: "test",
      extentWidthMeters: 8_000,
      extentHeightMeters: 4_000,
      width: 8,
      height: 4,
      terrainCells: new Uint8Array(32).fill(1),
      vegetationCells: new Uint8Array(32),
      moistureCells: new Uint8Array(32),
      riverCells: new Uint8Array(32),
      elevationMeters: elevations,
    };

    const data = buildTheaterMapViewData(definition, 8);
    let regularSegments = 0;
    let indexSegments = 0;
    let hasSubcellEndpoint = false;
    traceTheaterContourSegments(
      data,
      (x1, y1, x2, y2, _elevation, strength) => {
        if (strength === 1) regularSegments += 1;
        else indexSegments += 1;
        hasSubcellEndpoint ||= [x1, y1, x2, y2].some(
          (coordinate) => !Number.isInteger(coordinate),
        );
      },
    );
    expect(regularSegments).toBeGreaterThan(0);
    expect(indexSegments).toBeGreaterThan(0);
    expect(hasSubcellEndpoint).toBe(true);
    const contourLabels = buildTheaterContourPresentation(data);
    expect(contourLabels.length).toBeGreaterThan(0);
    expect(contourLabels.length).toBeLessThanOrEqual(
      PRESENTATION_CONFIG.mapViews.contourMaximumLabels,
    );
    for (const label of contourLabels) {
      expect(
        label.elevationMeters %
          PRESENTATION_CONFIG.mapViews.contourLabelIntervalMeters,
      ).toBe(0);
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.x).toBeLessThan(data.width);
      expect(label.y).toBeGreaterThanOrEqual(0);
      expect(label.y).toBeLessThan(data.height);
    }
  });

  it("does not mistake a coastline for an elevation contour", () => {
    const definition: WorldGridDefinition = {
      projectionDefinition: "test",
      extentWidthMeters: 2_000,
      extentHeightMeters: 2_000,
      width: 2,
      height: 2,
      terrainCells: Uint8Array.of(0, 1, 0, 1),
      vegetationCells: Uint8Array.of(0, 0, 0, 0),
      moistureCells: Uint8Array.of(0, 0, 0, 0),
      riverCells: new Uint8Array(4),
      elevationMeters: Int16Array.of(0, 1_000, 0, 1_000),
    };

    let segmentCount = 0;
    traceTheaterContourSegments(
      buildTheaterMapViewData(definition, 2),
      () => {
        segmentCount += 1;
      },
    );
    expect(segmentCount).toBe(0);
  });
});
