import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cultureRasterDimensions } from "./CultureRaster";

describe("cultureRasterDimensions", () => {
  it("keeps culture borders within two Atlas pixels at maximum detail", () => {
    const atlas = { width: 16_384, height: 8_192 };
    const raster = cultureRasterDimensions(atlas.width, atlas.height);
    expect(atlas.width / raster.width).toBeLessThanOrEqual(2);
    expect(atlas.height / raster.height).toBeLessThanOrEqual(2);
  });

  it("ships the compiled mask at the contracted resolution", () => {
    const png = readFileSync(resolve("public/maps/cultures/regions.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(8_192);
    expect(png.readUInt32BE(20)).toBe(4_096);
    expect(png.byteLength).toBeLessThan(2 * 1_024 * 1_024);
  });
});
