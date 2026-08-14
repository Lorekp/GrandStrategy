import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CultureInfluenceField,
  parseCultureInfluenceManifest,
} from "../culture/CultureInfluence";
import {
  buildAdaptiveCultureIndexField,
  buildCulturePresentationField,
} from "./TheaterCultureField";

const GRID_SIZE = 4_096;

describe("land-resolution culture tint", () => {
  it("builds a real 4096-square regional field without brute-force sampling", () => {
    const manifest = parseCultureInfluenceManifest(
      JSON.parse(
        readFileSync("public/maps/cultures/manifest.json", "utf8"),
      ) as unknown,
    );
    const cultures = new CultureInfluenceField(manifest);
    const start = performance.now();
    const field = buildAdaptiveCultureIndexField(
      GRID_SIZE,
      GRID_SIZE,
      (column, row) =>
        cultures.classifyForSelectedCulture(
          {
            longitudeE6: Math.round(
              (5 + (column + 0.5) / GRID_SIZE * 11) * 1_000_000,
            ),
            latitudeE6: Math.round(
              (54 - (row + 0.5) / GRID_SIZE * 7) * 1_000_000,
            ),
          },
          "continental-germanic",
        ).cultureIndex,
    );
    const elapsed = performance.now() - start;

    expect(field.cultureIndices.byteLength).toBe(GRID_SIZE * GRID_SIZE);
    expect(field.sampleCount).toBeLessThan(250_000);
    expect(elapsed).toBeLessThan(1_000);
  });

  it("builds the score-weighted regional delimiter field during setup", () => {
    const manifest = parseCultureInfluenceManifest(
      JSON.parse(
        readFileSync("public/maps/cultures/manifest.json", "utf8"),
      ) as unknown,
    );
    const cultures = new CultureInfluenceField(manifest);
    const samplesPerEdge = 257;
    const start = performance.now();
    const field = buildCulturePresentationField(
      samplesPerEdge,
      samplesPerEdge,
      (column, row) => cultures.classifyCulture({
        longitudeE6: Math.round(
          (-12 + column / (samplesPerEdge - 1) * 30) * 1_000_000,
        ),
        latitudeE6: Math.round(
          (60 - row / (samplesPerEdge - 1) * 25) * 1_000_000,
        ),
      }),
    );
    const elapsed = performance.now() - start;

    expect(field.winningMargins.byteLength).toBe(
      samplesPerEdge * samplesPerEdge * Float32Array.BYTES_PER_ELEMENT,
    );
    expect(elapsed).toBeLessThan(1_000);
  });
});
