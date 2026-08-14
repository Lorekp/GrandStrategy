export interface CultureRasterDimensions {
  readonly width: number;
  readonly height: number;
}

/** Chooses the static culture-field texture dimensions for an Atlas. */
export function cultureRasterDimensions(
  atlasWidth: number,
  atlasHeight: number,
): CultureRasterDimensions {
  const width = Math.min(atlasWidth, 8_192);
  return {
    width,
    height: Math.round(width * atlasHeight / atlasWidth),
  };
}
