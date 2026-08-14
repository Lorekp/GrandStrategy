import { describe, expect, it } from "vitest";
import type { CameraState } from "./CameraController";
import type { TheaterLevel } from "./RegionalTheater";
import { tileAssetPath, tileRequestsForViewport } from "./TilePyramidLayer";

describe("tileAssetPath", () => {
  it("keys generated textures by their render format", () => {
    expect(tileAssetPath("/maps/theaters/test/tiles", 6, 2, 3, 4)).toBe(
      "/maps/theaters/test/tiles/2/3_4.png?v=6",
    );
  });
});

describe("tileRequestsForViewport", () => {
  const level: TheaterLevel = {
    level: 3,
    width: 8_192,
    height: 8_192,
    columns: 16,
    rows: 16,
  };
  const viewport: CameraState = {
    left: 3_200,
    top: 3_500,
    right: 4_480,
    bottom: 4_220,
    scale: 1,
    relativeZoom: 8,
  };

  it("keeps the working set independent of the full pyramid size", () => {
    const requests = tileRequestsForViewport(
      viewport,
      8_192,
      8_192,
      512,
      level,
    );
    expect(requests.length).toBe(25);
    expect(requests.length).toBeLessThan(level.columns * level.rows / 10);
  });

  it("prioritizes tiles nearest the viewport center", () => {
    const requests = tileRequestsForViewport(
      viewport,
      8_192,
      8_192,
      512,
      level,
    );
    expect(requests[0]).toMatchObject({ column: 7, row: 7 });
    expect(new Set(requests.map(({ key }) => key)).size).toBe(requests.length);
  });
});
