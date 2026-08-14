import { describe, expect, it } from "vitest";
import { semanticCellIndex } from "./TheaterLandMask";

describe("theater land-mask addressing", () => {
  it("maps render points into the semantic grid and rejects outside points", () => {
    expect(semanticCellIndex({ x: 2_048, y: 2_048 }, 4_096, 4_096, 1_024, 1_024)).toBe(
      512 * 1_024 + 512,
    );
    expect(semanticCellIndex({ x: -1, y: 10 }, 4_096, 4_096, 1_024, 1_024)).toBe(
      undefined,
    );
  });
});
