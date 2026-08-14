import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import type { RegionalTheaterManifest } from "./RegionalTheater";
import {
  parseRegionalTheaterManifest,
  RegionalTheaterProjection,
} from "./RegionalTheater";

const theater: RegionalTheaterManifest = {
  formatVersion: 14,
  id: "test",
  name: "Test theater",
  kind: "regional-theater",
  projection: {
    type: "azimuthal-equidistant",
    definition: "+proj=aeqd +lat_0=37.98 +lon_0=23.72 +ellps=WGS84 +units=m +no_defs +type=crs",
    center: { longitudeE6: 23_720_000, latitudeE6: 37_980_000 },
  },
  extent: { widthMeters: 768_000, heightMeters: 768_000 },
  render: {
    width: 8_192,
    height: 8_192,
    metersPerPixel: 93.75,
    tileSize: 512,
    paletteColors: 48,
    levels: [
      { level: 0, width: 1_024, height: 1_024, columns: 2, rows: 2 },
      { level: 1, width: 2_048, height: 2_048, columns: 4, rows: 4 },
      { level: 2, width: 4_096, height: 4_096, columns: 8, rows: 8 },
      { level: 3, width: 8_192, height: 8_192, columns: 16, rows: 16 },
    ],
  },
  atlasPreview: {
    westLongitudeE6: 20_711_443,
    eastLongitudeE6: 26_728_557,
    southLatitudeE6: 35_638_749,
    northLatitudeE6: 40_285_931,
    width: 2_048,
    height: 2_048,
    tileSize: 512,
    levels: [
      { level: 0, width: 1_024, height: 1_024, columns: 2, rows: 2 },
      { level: 1, width: 2_048, height: 2_048, columns: 4, rows: 4 },
    ],
    tilePath: "atlas-preview",
  },
  semantic: {
    width: 3_072,
    height: 3_072,
    metersPerCell: 250,
    landMaskPath: "land-mask.png",
    chunkSize: 128,
    chunkColumns: 24,
    chunkRows: 24,
    chunkPath: "semantic/{column}_{row}.bin",
    chunkEncoding: "terrain-u8-vegetation-u8-moisture-u8-elevation-i16le-v2",
    moistureModelVersion: 1,
  },
  validation: { maximumEstimatedScaleErrorPercent: 0.0538 },
  source: { name: "test", url: "test", format: "test", sourceZoom: 10 },
  naturalCoverSource: { name: "test", url: "test", format: "test" },
  physicalGeometrySource: { name: "test", url: "test", format: "test" },
  hydrographySource: {
    name: "OpenStreetMap", url: "test", format: "test", snapshot: "2026-08-01T00:00:00Z",
    normalizedHash: "sha256:test", normalizerVersion: 5, featureCount: 1,
    attribution: "© OpenStreetMap contributors", license: "ODbL 1.0",
    extracts: [{ id: "test", url: "test", md5: "test" }],
    geometryPath: "waterways.bin", geometryEncoding: "projected-waterway-f32-v1",
    geometryFeatureCount: 1, geometryPointCount: 2,
  },
  moistureModel: {
    version: 1, meaning: "test", climateAdapter: "test", drainageAdapter: "test",
  },
};

describe("RegionalTheaterProjection", () => {
  it("invalidates generated tiles from the previous render format", () => {
    const current = parseRegionalTheaterManifest({
      ...theater,
      formatVersion: 14,
    });
    expect(current.formatVersion).toBe(14);
    expect(() =>
      parseRegionalTheaterManifest({ ...theater, formatVersion: 12 }),
    ).toThrow("format version 14");
  });

  it("places the projection center at the render center", () => {
    const projection = new RegionalTheaterProjection(theater);
    expect(projection.toTheater(theater.projection.center)).toEqual({
      x: 4_096,
      y: 4_096,
    });
  });

  it("round-trips geodetic positions within one microdegree", () => {
    const projection = new RegionalTheaterProjection(theater);
    const source = { longitudeE6: 22_430_000, latitudeE6: 37_070_000 };
    const result = projection.toGeographic(projection.toTheater(source));
    expect(result.longitudeE6).toBeCloseTo(source.longitudeE6, 0);
    expect(result.latitudeE6).toBeCloseTo(source.latitudeE6, 0);
  });

  it("validates the generated theater and its semantic grid", () => {
    const assetRoot = new URL(
      "../../public/maps/theaters/world-r60-c79/",
      import.meta.url,
    );
    const generated = parseRegionalTheaterManifest(
      JSON.parse(readFileSync(new URL("manifest.json", assetRoot), "utf8")),
    );
    expect(generated.render.width).toBe(8_192);
    expect(generated.render.metersPerPixel).toBe(93.75);
    expect(generated.atlasPreview.levels).toHaveLength(2);
    expect(generated.validation.maximumEstimatedScaleErrorPercent).toBeLessThan(0.13);
    expect(statSync(new URL("semantic/0_0.bin", assetRoot)).size).toBe(81_936);
    expect(statSync(new URL(generated.hydrographySource.geometryPath, assetRoot)).size).toBeGreaterThan(16);
  });
});
