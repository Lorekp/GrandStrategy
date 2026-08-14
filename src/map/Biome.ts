import type {
  TerrainType,
  VegetationDensity,
  VegetationType,
} from "../core/model";

export type BiomeType =
  | "open-water"
  | "permanent-ice"
  | "taiga"
  | "tundra"
  | "desert"
  | "desert-scrub"
  | "jungle-highlands"
  | "forested-mountains"
  | "mountains"
  | "jungle-hills"
  | "forested-hills"
  | "open-hills"
  | "rainforest"
  | "tropical-woodland"
  | "forest"
  | "woodland"
  | "grassland";

/** Derive a locale-independent ecological classification. */
export function deriveBiomeType(
  terrain: TerrainType,
  vegetation: VegetationType,
  density: VegetationDensity,
): BiomeType {
  if (terrain === "water") return "open-water";
  if (terrain === "ice") return "permanent-ice";
  if (terrain === "tundra") {
    return vegetation === "forest" ? "taiga" : "tundra";
  }
  if (terrain === "desert") {
    return vegetation === "none" ? "desert" : "desert-scrub";
  }
  if (terrain === "mountains") {
    if (vegetation === "jungle") return "jungle-highlands";
    if (vegetation === "forest") return "forested-mountains";
    return "mountains";
  }
  if (terrain === "hills") {
    if (vegetation === "jungle") return "jungle-hills";
    if (vegetation === "forest") return "forested-hills";
    return "open-hills";
  }
  if (vegetation === "jungle") {
    return density === "moderate" || density === "dense"
      ? "rainforest"
      : "tropical-woodland";
  }
  if (vegetation === "forest") {
    return density === "moderate" || density === "dense"
      ? "forest"
      : "woodland";
  }
  return "grassland";
}
