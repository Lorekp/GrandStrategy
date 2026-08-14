import { describe, expect, it } from "vitest";
import {
  geographicToAtlas,
  GlobalTheaterCatalog,
  parseGlobalTheaterCatalog,
  type GlobalTheaterCatalogManifest,
} from "./TheaterCatalog";

const manifest: GlobalTheaterCatalogManifest = {
  formatVersion: 5,
  kind: "global-theater-catalog",
  theaterExtentMeters: 768_000,
  centerSpacingMeters: 384_000,
  minimumLandRatioPermille: 100,
  candidateCount: 2,
  candidates: [
    {
      index: 0,
      id: "world-r0-c0",
      center: { longitudeE6: 23_720_000, latitudeE6: 37_980_000 },
      landRatioPermille: 720,
      terrainPermille: {
        water: 280,
        plains: 460,
        hills: 130,
        mountains: 60,
        desert: 50,
        tundra: 15,
        ice: 5,
      },
      vegetationPermille: { forest: 160, jungle: 0 },
      cultureId: "hellenic",
      cultureName: "Hellenic",
    },
    {
      index: 1,
      id: "world-r0-c1",
      center: { longitudeE6: 26_500_000, latitudeE6: 37_980_000 },
      landRatioPermille: 510,
      terrainPermille: {
        water: 490,
        plains: 320,
        hills: 90,
        mountains: 40,
        desert: 50,
        tundra: 8,
        ice: 2,
      },
      vegetationPermille: { forest: 100, jungle: 0 },
      cultureId: "hellenic",
      cultureName: "Hellenic",
    },
  ],
};

describe("GlobalTheaterCatalog", () => {
  it("finds the hovered Theater through its spatial index", () => {
    const catalog = new GlobalTheaterCatalog(manifest);
    const point = geographicToAtlas(manifest.candidates[0]!.center, 8_192, 4_096);
    expect(catalog.candidateAt(point, 8_192, 4_096)?.id).toBe("world-r0-c0");
  });

  it("re-dices to a nearby Theater accepted by the active setup rule", () => {
    const catalog = new GlobalTheaterCatalog(manifest);
    expect(
      catalog.rerollNeighbor(
        manifest.candidates[0]!,
        0.5,
        (candidate) => candidate.id === "world-r0-c1",
      ).id,
    ).toBe("world-r0-c1");
  });

  it("keeps the current Theater when no nearby candidate is eligible", () => {
    const catalog = new GlobalTheaterCatalog(manifest);
    expect(
      catalog.rerollNeighbor(manifest.candidates[0]!, 0.5, () => false).id,
    ).toBe("world-r0-c0");
  });

  it("rejects ocean-heavy candidates at or below ten percent land", () => {
    expect(() =>
      parseGlobalTheaterCatalog({
        ...manifest,
        candidates: [
          { ...manifest.candidates[0], index: 0, landRatioPermille: 100 },
        ],
        candidateCount: 1,
      }),
    ).toThrow(/format version 5/);
  });

  it("rejects incomplete terrain summaries", () => {
    expect(() =>
      parseGlobalTheaterCatalog({
        ...manifest,
        candidates: [
          {
            ...manifest.candidates[0],
            index: 0,
            terrainPermille: {
              ...manifest.candidates[0]!.terrainPermille,
              plains: -1,
            },
          },
        ],
        candidateCount: 1,
      }),
    ).toThrow(/format version 5/);
  });
});
