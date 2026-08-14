import { describe, expect, it } from "vitest";
import { parseCultureBorderManifest } from "./CultureBorders";

describe("culture border manifest", () => {
  it("parses smoothed vector paths", () => {
    const manifest = parseCultureBorderManifest({
      formatVersion: 1,
      width: 4096,
      height: 2048,
      paths: [{ cultures: [2, 7], points: [0.25, 1, 3.75, 4] }],
    });
    expect(manifest.paths[0]?.cultures).toEqual([2, 7]);
    expect([...manifest.paths[0]!.points]).toEqual([0.25, 1, 3.75, 4]);
  });

  it("rejects odd or non-finite coordinate streams", () => {
    expect(() => parseCultureBorderManifest({
      formatVersion: 1,
      width: 4096,
      height: 2048,
      paths: [{ cultures: [1, 2], points: [0, 1, Number.NaN] }],
    })).toThrow(/invalid path/);
  });
});
