import { describe, expect, it } from "vitest";
import { createGridBitset, setGridBit } from "../core/GridBitset";
import type { PlayerWorldSnapshot } from "../core/model";
import {
  buildExploredDistanceField,
  buildPresentationVisibilityRegion,
  FogOfWarLayer,
} from "./FogOfWarLayer";
import type { RegionalTheaterManifest } from "./RegionalTheater";

const GRID_SIZE = 3_072;
const GRID_CENTER = GRID_SIZE / 2;
const ONE_60_HZ_FRAME_MS = 1_000 / 60;

const theater: RegionalTheaterManifest = {
  formatVersion: 14,
  id: "performance-test",
  name: "Performance test",
  kind: "regional-theater",
  projection: {
    type: "azimuthal-equidistant",
    definition:
      "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs",
    center: { longitudeE6: 0, latitudeE6: 0 },
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
    width: GRID_SIZE,
    height: GRID_SIZE,
    metersPerCell: 250,
    landMaskPath: "land-mask.png",
    chunkSize: 128, chunkColumns: 24, chunkRows: 24,
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

describe("full theater fog revision", () => {
  it("builds the localized presentation regions within one frame", () => {
    const cells = createGridBitset(GRID_SIZE * GRID_SIZE);
    for (let row = GRID_CENTER - 72; row < GRID_CENTER + 72; row += 1) {
      for (let column = GRID_CENTER - 72; column < GRID_CENTER + 72; column += 1) {
        setGridBit(cells, row * GRID_SIZE + column);
      }
    }
    const start = performance.now();
    buildPresentationVisibilityRegion(cells, GRID_SIZE, GRID_SIZE);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(ONE_60_HZ_FRAME_MS);
  });

  it("builds the explored boundary distance field within one frame", () => {
    const cells = createGridBitset(GRID_SIZE * GRID_SIZE);
    for (let row = GRID_CENTER - 72; row < GRID_CENTER + 72; row += 1) {
      for (let column = GRID_CENTER - 72; column < GRID_CENTER + 72; column += 1) {
        setGridBit(cells, row * GRID_SIZE + column);
      }
    }
    const start = performance.now();
    buildExploredDistanceField(cells, GRID_SIZE, GRID_SIZE);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(ONE_60_HZ_FRAME_MS);
  });

  it("stays within one 60 Hz frame on the 3072-square knowledge grid", () => {
    const visibleCells = createGridBitset(GRID_SIZE * GRID_SIZE);
    const exploredCells = createGridBitset(GRID_SIZE * GRID_SIZE);
    for (let row = GRID_CENTER - 72; row < GRID_CENTER + 72; row += 1) {
      for (let column = GRID_CENTER - 72; column < GRID_CENTER + 72; column += 1) {
        const distance = (column - GRID_CENTER) ** 2 + (row - GRID_CENTER) ** 2;
        if (distance < 72 ** 2) setGridBit(exploredCells, row * GRID_SIZE + column);
        if (distance < 48 ** 2) setGridBit(visibleCells, row * GRID_SIZE + column);
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
        width: GRID_SIZE,
        height: GRID_SIZE,
        revision: 1,
        visibleCells,
        exploredCells,
      },
    };
    const layer = new FogOfWarLayer(theater);
    layer.setViewport({
      left: 0,
      top: 0,
      right: 8_192,
      bottom: 8_192,
      scale: 0.164,
      relativeZoom: 1,
    });

    const start = performance.now();
    layer.update(snapshot);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(ONE_60_HZ_FRAME_MS);
  });
});
