import { describe, expect, it } from "vitest";
import {
  buildAdaptiveCultureIndexField,
  buildCulturePresentationField,
  cultureBoundarySegments,
  cultureIndexFieldDimensions,
} from "./TheaterCultureField";

describe("Regional Theater culture field presentation", () => {
  it("keeps the regional tint within two render pixels without oversized textures", () => {
    expect(cultureIndexFieldDimensions(8_192, 8_192)).toEqual({
      width: 4_096,
      height: 4_096,
    });
    expect(cultureIndexFieldDimensions(4_096, 4_096)).toEqual({
      width: 4_096,
      height: 4_096,
    });
  });

  it("refines categorical ownership to every land cell without inventing cultures", () => {
    const width = 96;
    const height = 64;
    const field = buildAdaptiveCultureIndexField(
      width,
      height,
      (column, row) => (column * 2 + row < width ? 5 : 9),
    );

    expect(field.width).toBe(width);
    expect(field.height).toBe(height);
    expect(field.cultureIndices.byteLength).toBe(width * height);
    expect(field.sampleCount).toBeLessThan(width * height / 2);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        expect(field.cultureIndices[row * width + column]).toBe(
          column * 2 + row < width ? 5 : 9,
        );
      }
    }
  });

  it("places the vector delimiter at the interpolated culture boundary", () => {
    const field = {
      width: 2,
      height: 2,
      cultureIndices: new Uint8Array([5, 9, 5, 9]),
      winningMargins: new Float32Array([1, 3, 1, 3]),
    };
    const segments = cultureBoundarySegments(field, 100, 80);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.start.x).toBeCloseTo(25);
    expect(segments[0]!.end.x).toBeCloseTo(25);
    expect(
      [segments[0]!.start.y, segments[0]!.end.y].sort((a, b) => a - b),
    ).toEqual([0, 80]);
  });

  it("keeps both delimiters when three cultures cross one theater", () => {
    const field = buildCulturePresentationField(3, 2, (column) => ({
      cultureIndex: column + 3,
      winningMargin: 1,
    }));
    const segments = cultureBoundarySegments(field, 120, 80);

    const verticalCenters = segments
      .filter((segment) => segment.start.x === segment.end.x)
      .map((segment) => segment.start.x)
      .sort((first, second) => first - second);
    expect(verticalCenters).toEqual([30, 90]);
  });

});
