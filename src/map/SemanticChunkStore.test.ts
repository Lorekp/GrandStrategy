import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegionalTheaterManifest } from "./RegionalTheater";
import { SemanticChunkStore } from "./SemanticChunkStore";

const theater = {
  formatVersion: 14,
  id: "chunk-test",
  name: "Chunk test",
  kind: "regional-theater",
  projection: {
    type: "azimuthal-equidistant",
    definition: "+proj=aeqd +lat_0=0 +lon_0=0 +ellps=WGS84 +units=m +no_defs",
    center: { longitudeE6: 0, latitudeE6: 0 },
  },
  extent: { widthMeters: 768_000, heightMeters: 768_000 },
  render: {
    width: 8_192, height: 8_192, metersPerPixel: 93.75, tileSize: 512, paletteColors: 48,
    levels: [
      { level: 0, width: 1_024, height: 1_024, columns: 2, rows: 2 },
      { level: 1, width: 2_048, height: 2_048, columns: 4, rows: 4 },
      { level: 2, width: 4_096, height: 4_096, columns: 8, rows: 8 },
      { level: 3, width: 8_192, height: 8_192, columns: 16, rows: 16 },
    ],
  },
  atlasPreview: {
    westLongitudeE6: -1, eastLongitudeE6: 1, southLatitudeE6: -1, northLatitudeE6: 1,
    width: 2_048, height: 2_048, tileSize: 512,
    levels: [
      { level: 0, width: 1_024, height: 1_024, columns: 2, rows: 2 },
      { level: 1, width: 2_048, height: 2_048, columns: 4, rows: 4 },
    ],
    tilePath: "atlas-preview",
  },
  semantic: {
    width: 256, height: 128, metersPerCell: 250, landMaskPath: "land-mask.png",
    chunkSize: 128, chunkColumns: 2, chunkRows: 1,
    chunkPath: "semantic/{column}_{row}.bin",
    chunkEncoding: "terrain-u8-vegetation-u8-moisture-u8-elevation-i16le-v2",
    moistureModelVersion: 1,
  },
  validation: { maximumEstimatedScaleErrorPercent: 0.12 },
  source: { name: "test", url: "test", format: "test", sourceZoom: 11 },
  naturalCoverSource: { name: "test", url: "test", format: "test" },
  physicalGeometrySource: { name: "test", url: "test", format: "test" },
  hydrographySource: {
    name: "test", url: "test", format: "test", snapshot: "test", normalizedHash: "test",
    normalizerVersion: 5,
    featureCount: 0, attribution: "test", license: "test", extracts: [],
    geometryPath: "waterways.bin", geometryEncoding: "projected-waterway-f32-v1",
    geometryFeatureCount: 0, geometryPointCount: 0,
  },
  moistureModel: {
    version: 1, meaning: "test", climateAdapter: "test", drainageAdapter: "test",
  },
} satisfies RegionalTheaterManifest;

function chunkFixture(
  terrain: number,
  vegetation: number,
  elevation: number,
  moisture = 128,
): ArrayBuffer {
  const cellCount = 128 * 128;
  const buffer = new ArrayBuffer(16 + cellCount * 5);
  const view = new DataView(buffer);
  for (const [index, character] of [..."GSSC"].entries()) {
    view.setUint8(index, character.charCodeAt(0));
  }
  view.setUint16(4, 2, true);
  view.setUint16(8, 128, true);
  view.setUint16(10, 128, true);
  new Uint8Array(buffer, 16, cellCount).fill(terrain);
  new Uint8Array(buffer, 16 + cellCount, cellCount).fill(vegetation);
  new Uint8Array(buffer, 16 + cellCount * 2, cellCount).fill(moisture);
  for (let index = 0; index < cellCount; index += 1) {
    view.setInt16(16 + cellCount * 3 + index * 2, elevation, true);
  }
  return buffer;
}

describe("SemanticChunkStore", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads only the addressed 32 km chunk for pointer sampling", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (path: string) => {
      requested.push(path);
      const secondChunk = path.includes("/1_0.bin");
      return new Response(chunkFixture(secondChunk ? 2 : 1, secondChunk ? 4 : 3, secondChunk ? 50 : 10));
    });
    const store = new SemanticChunkStore(theater);

    await expect(store.sampleAt({ x: 7_000, y: 4_000 })).resolves.toMatchObject({
      terrainCode: 2,
      vegetationCode: 4,
      moisture: 128,
      elevationMeters: 50,
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("/semantic/1_0.bin");
  });

  it("assembles the transferable worker grid without a monolithic asset", async () => {
    vi.stubGlobal("fetch", async (path: string) =>
      new Response(chunkFixture(path.includes("/1_0.bin") ? 2 : 1, 0, 20)),
    );
    const definition = await new SemanticChunkStore(theater).toSimulationDefinition();

    expect(definition.terrainCells[0]).toBe(1);
    expect(definition.terrainCells[255]).toBe(2);
    expect(definition.moistureCells[0]).toBe(128);
    expect(definition.elevationMeters[0]).toBe(20);
  });

  it("bounds long route prefetches to eight concurrent chunk requests", async () => {
    const largeTheater: RegionalTheaterManifest = {
      ...theater,
      semantic: {
        ...theater.semantic,
        width: 3_072,
        height: 3_072,
        chunkColumns: 24,
        chunkRows: 24,
      },
    };
    let active = 0;
    let maximumActive = 0;
    vi.stubGlobal("fetch", async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return new Response(chunkFixture(1, 0, 0));
    });

    await new SemanticChunkStore(largeTheater).prefetchCorridor(
      { x: 0, y: 0 },
      { x: 8_191, y: 8_191 },
    );

    expect(maximumActive).toBe(8);
  });
});
