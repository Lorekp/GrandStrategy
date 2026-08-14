import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRegionalTheaterManifest } from "./RegionalTheater";
import { TheaterSurface } from "./TheaterSurface";
import { WaterwayIndex } from "./WaterwayIndex";

describe("regional Theater surface", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("joins chunked terrain with sub-cell Nile waterway geometry", async () => {
    const assetRoot = new URL(
      "../../public/maps/theaters/world-r60-c79/",
      import.meta.url,
    );
    const manifest = parseRegionalTheaterManifest(
      JSON.parse(readFileSync(new URL("manifest.json", assetRoot), "utf8")),
    );
    vi.stubGlobal("fetch", async (path: string) => {
      const relativePath = path
        .split(`/maps/theaters/${manifest.id}/`)[1]!
        .split("?")[0]!;
      return new Response(readFileSync(new URL(relativePath, assetRoot)));
    });

    const geometryBytes = readFileSync(
      new URL(manifest.hydrographySource.geometryPath, assetRoot),
    );
    const geometry = WaterwayIndex.decode(
      geometryBytes.buffer.slice(
        geometryBytes.byteOffset,
        geometryBytes.byteOffset + geometryBytes.byteLength,
      ),
    );
    const nile = geometry.features.find(
      (feature) => feature.riverClass === "major",
    )!;
    const easting = nile.points[0]!;
    const northing = nile.points[1]!;
    const surface = await TheaterSurface.load(manifest);
    const sample = await surface.sampleAt({
      x:
        (easting + manifest.extent.widthMeters / 2) /
        manifest.render.metersPerPixel,
      y:
        (manifest.extent.heightMeters / 2 - northing) /
        manifest.render.metersPerPixel,
    });

    expect(sample).toMatchObject({
      river: "major",
    });
    expect(sample?.waterwayWidthMeters).toBeGreaterThan(0);
  });
});
