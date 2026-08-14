import { describe, expect, it } from "vitest";
import { deriveBiomeType } from "./Biome";

describe("derived biomes", () => {
  it("keeps wooded landforms and tropical vegetation distinct", () => {
    expect(deriveBiomeType("plains", "forest", "light")).toBe("woodland");
    expect(deriveBiomeType("hills", "forest", "dense")).toBe("forested-hills");
    expect(deriveBiomeType("plains", "jungle", "dense")).toBe("rainforest");
  });

  it("describes cold ground without storing another authoritative layer", () => {
    expect(deriveBiomeType("tundra", "none", "none")).toBe("tundra");
    expect(deriveBiomeType("tundra", "forest", "sparse")).toBe("taiga");
    expect(deriveBiomeType("ice", "none", "none")).toBe("permanent-ice");
  });
});
