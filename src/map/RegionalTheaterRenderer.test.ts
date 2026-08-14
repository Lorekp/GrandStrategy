import { Container, Graphics } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createGridBitset } from "../core/GridBitset";
import type { PlayerWorldSnapshot } from "../core/model";
import type { RegionalTheaterManifest } from "./RegionalTheater";
import { RegionalTheaterRenderer } from "./RegionalTheaterRenderer";

const theater: RegionalTheaterManifest = {
  formatVersion: 14,
  id: "preview-test",
  name: "Preview test",
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
    levels: [{ level: 0, width: 1_000, height: 1_000, columns: 2, rows: 2 }],
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

const snapshot: PlayerWorldSnapshot = {
  seed: 1,
  tick: 4,
  worldTime: { year: -9_999, month: 3, day: 1, hour: 6, minute: 4 },
  viewerPlayerId: 1,
  tribes: [
    {
      id: 1,
      name: "Attic",
      cultureId: "hellenic-balkan",
      terrainMovementModifiers: { hills: 25 },
      vegetationMovementModifiers: {},
      color: 0xd8c76f,
      controllerPlayerId: 1,
      warriors: 0,
    },
  ],
  settlements: [],
  units: [
    {
      id: 1,
      tribeId: 1,
      homeSettlementId: 1,
      kind: "scout",
      position: { longitudeE6: 0, latitudeE6: 0 },
      route: [],
      terrain: "plains",
      vegetation: "none",
      vegetationDensity: "none",
      speedMetersPerHour: 4_474,
      slopeDegrees: 0,
      remainingTravelMinutes: null,
      combat: null,
      intelligence: "controlled",
      lastObservedTick: 4,
    },
  ],
  relations: [],
  diplomaticProposals: [],
  events: [],
  research: [
    { tribeId: 1, queuedTechnologyIds: [], completedTechnologyIds: [], progress: [] },
  ],
  visibility: {
    width: 200,
    height: 200,
    revision: 1,
    visibleCells: createGridBitset(40_000),
    exploredCells: createGridBitset(40_000),
  },
};

describe("unit order preview", () => {
  it("redraws a replacement destination before a simulation tick arrives", () => {
    const requestRender = vi.fn();
    const renderer = new RegionalTheaterRenderer(
      theater,
      requestRender,
      vi.fn(),
      vi.fn(),
      () => 0,
    );
    renderer.setSelectedUnits(new Set([1]));
    renderer.update(snapshot);
    const unitOrders = (
      renderer as unknown as { readonly unitOrders: Graphics }
    ).unitOrders;
    expect(unitOrders.context.instructions).toHaveLength(0);

    renderer.previewUnitOrders(
      new Set([1]),
      { longitudeE6: 100_000, latitudeE6: 100_000 },
      false,
    );

    expect(
      unitOrders.context.instructions.some(
        (instruction) => instruction.action === "stroke",
      ),
    ).toBe(true);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it("keeps the queued route above unexplored fog", () => {
    const renderer = new RegionalTheaterRenderer(
      theater,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      () => 0,
    );
    const layers = renderer as unknown as {
      readonly fogOfWar: { readonly root: Container };
      readonly unitOrders: Graphics;
    };
    expect(renderer.root.getChildIndex(layers.unitOrders)).toBeGreaterThan(
      renderer.root.getChildIndex(layers.fogOfWar.root),
    );
  });

  it("keeps secondary clicks available for move orders instead of selecting markers", () => {
    const onSelectUnit = vi.fn();
    const renderer = new RegionalTheaterRenderer(
      theater,
      vi.fn(),
      vi.fn(),
      onSelectUnit,
      () => 0,
    );
    renderer.update(snapshot);
    const marker = (
      renderer as unknown as {
        readonly markerByUnit: Map<number, { readonly root: Container }>;
      }
    ).markerByUnit.get(1);
    expect(marker).toBeDefined();

    marker?.root.emit("pointertap", { button: 2 } as never);
    expect(onSelectUnit).not.toHaveBeenCalled();

    marker?.root.emit("pointertap", { button: 0 } as never);
    expect(onSelectUnit).toHaveBeenCalledWith(1);
  });
});
