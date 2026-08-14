import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import { createGridBitset, setGridBit } from "../core/GridBitset";
import type { PlayerWorldSnapshot } from "../core/model";
import {
  buildExploredDistanceField,
  buildPresentationVisibilityRegion,
  exploredDistanceAt,
  FogOfWarLayer,
  UNKNOWN_FOG_COLOR,
  unknownPatternLevel,
} from "./FogOfWarLayer";
import type { RegionalTheaterManifest } from "./RegionalTheater";

const theater: RegionalTheaterManifest = {
  formatVersion: 14,
  id: "fog-test",
  name: "Fog test",
  kind: "regional-theater",
  projection: {
    type: "azimuthal-equidistant",
    definition: "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs",
    center: { longitudeE6: 0, latitudeE6: 0 },
  },
  extent: { widthMeters: 100_000, heightMeters: 100_000 },
  render: {
    width: 1_000,
    height: 1_000,
    metersPerPixel: 100,
    tileSize: 500,
    paletteColors: 48,
    levels: [
      { level: 0, width: 250, height: 250, columns: 1, rows: 1 },
      { level: 1, width: 500, height: 500, columns: 1, rows: 1 },
      { level: 2, width: 1_000, height: 1_000, columns: 2, rows: 2 },
    ],
  },
  atlasPreview: {
    westLongitudeE6: -1_000_000,
    eastLongitudeE6: 1_000_000,
    southLatitudeE6: -1_000_000,
    northLatitudeE6: 1_000_000,
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
    width: 200,
    height: 200,
    metersPerCell: 250,
    landMaskPath: "land-mask.png",
    chunkSize: 128, chunkColumns: 2, chunkRows: 2,
    chunkPath: "semantic/{column}_{row}.bin",
    chunkEncoding: "terrain-u8-vegetation-u8-moisture-u8-elevation-i16le-v2",
    moistureModelVersion: 1,
  },
  validation: { maximumEstimatedScaleErrorPercent: 0.001 },
  source: { name: "test", url: "test", format: "test", sourceZoom: 1 },
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
  moistureModel: { version: 1, meaning: "test", climateAdapter: "test", drainageAdapter: "test" },
};

describe("unknown fog pattern", () => {
  it("uses a neutral charcoal field instead of ocean blue", () => {
    expect(UNKNOWN_FOG_COLOR).toBe(0x2b2d2c);
  });

  it("increases pattern density in crisp bands away from explored terrain", () => {
    expect(unknownPatternLevel(0)).toBe(0);
    expect(unknownPatternLevel(7.99)).toBe(0);
    expect(unknownPatternLevel(8)).toBe(1);
    expect(unknownPatternLevel(25.99)).toBe(1);
    expect(unknownPatternLevel(26)).toBe(2);
    expect(unknownPatternLevel(49.99)).toBe(2);
    expect(unknownPatternLevel(50)).toBe(3);
    expect(unknownPatternLevel(Number.POSITIVE_INFINITY)).toBe(3);
  });

  it("builds distance from the union of all explored cells", () => {
    const explored = createGridBitset(25);
    setGridBit(explored, 6);
    setGridBit(explored, 18);
    const distance = buildExploredDistanceField(explored, 5, 5);

    expect(exploredDistanceAt(distance, 1, 1)).toBe(0);
    expect(exploredDistanceAt(distance, 3, 3)).toBe(0);
    expect(exploredDistanceAt(distance, 2, 2)).toBe(4);
    expect(exploredDistanceAt(distance, 0, 0)).toBe(4);
  });
});

describe("presentation visibility contour", () => {
  it("refines 500 m cells into crisp 125 m cells and bevels diagonal corners", () => {
    const source = createGridBitset(3 * 3);
    setGridBit(source, 1);
    setGridBit(source, 3);

    const presentation = buildPresentationVisibilityRegion(source, 3, 3);

    expect(presentation.left).toBe(0);
    expect(presentation.top).toBe(0);
    expect(presentation.width).toBe(12);
    expect(presentation.height).toBe(12);
    expect(presentation.cells[4 * 12 + 4]).toBe(1);
    expect(presentation.cells[5 * 12 + 5]).toBe(0);
    expect(presentation.cells.every((cell) => cell === 0 || cell === 1)).toBe(
      true,
    );
  });
});

describe("overlapping visibility composition", () => {
  it("renders the union as one positive mask with no destructive holes", () => {
    const visibleCells = createGridBitset(200 * 200);
    const exploredCells = createGridBitset(200 * 200);
    for (let row = 80; row < 120; row += 1) {
      for (let column = 70; column < 130; column += 1) {
        const first = (column - 85) ** 2 + (row - 100) ** 2 < 20 ** 2;
        const second = (column - 110) ** 2 + (row - 100) ** 2 < 16 ** 2;
        if (first || second) {
          setGridBit(visibleCells, row * 200 + column);
          setGridBit(exploredCells, row * 200 + column);
        }
      }
    }
    const snapshot: PlayerWorldSnapshot = {
      seed: 1,
      tick: 1,
      worldTime: { year: -9_999, month: 3, day: 1, hour: 6, minute: 1 },
      viewerPlayerId: 1,
      tribes: [],
      settlements: [],
      units: [],
      relations: [],
      diplomaticProposals: [],
      events: [],
      research: [],
      visibility: {
        width: 200,
        height: 200,
        revision: 1,
        visibleCells,
        exploredCells,
      },
    };
    const layer = new FogOfWarLayer(theater);
    layer.update(snapshot);
    const unknownFog = (
      layer as unknown as { readonly unknownFog: Graphics }
    ).unknownFog;
    const exploredMask = (
      layer as unknown as { readonly exploredMask: Graphics }
    ).exploredMask;

    expect(
      unknownFog.context.instructions.some(
        (instruction) =>
          instruction.action === "fill" && instruction.data.hole !== undefined,
      ),
    ).toBe(false);
    expect(
      exploredMask.context.instructions.filter(
        (instruction) => instruction.action === "fill",
      ),
    ).toHaveLength(1);
  });
});
