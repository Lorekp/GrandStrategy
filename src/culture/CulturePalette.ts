import { PRESENTATION_CONFIG, parseHexColor } from "../config/GameConfig";

/** Shared cartographic colors for Culture Fields in Atlas and Theater views. */
export const CULTURE_PALETTE: readonly number[] =
  PRESENTATION_CONFIG.culture.palette.map((color, index) =>
    parseHexColor(color, `culture.palette[${index}]`),
  );

export function culturePaletteColor(cultureIndex: number): number {
  const paletteIndex =
    ((Math.trunc(cultureIndex) % CULTURE_PALETTE.length) +
      CULTURE_PALETTE.length) %
    CULTURE_PALETTE.length;
  return CULTURE_PALETTE[paletteIndex]!;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Raises chroma around perceptual luminance without changing the palette hue. */
export function saturateCultureColor(color: number, amount: number): number {
  const red = color >>> 16 & 0xff;
  const green = color >>> 8 & 0xff;
  const blue = color & 0xff;
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return (
    clampByte(luminance + (red - luminance) * amount) << 16 |
    clampByte(luminance + (green - luminance) * amount) << 8 |
    clampByte(luminance + (blue - luminance) * amount)
  );
}

function glslColor(color: number): string {
  const red = (color >>> 16 & 0xff) / 255;
  const green = (color >>> 8 & 0xff) / 255;
  const blue = (color & 0xff) / 255;
  return `vec3(${red.toFixed(6)}, ${green.toFixed(6)}, ${blue.toFixed(6)})`;
}

/** Generates one shader function so both map scales compile the same palette. */
export function culturePaletteGlsl(
  functionName = "cultureColor",
  saturation = 1,
): string {
  const lines = [
    `vec3 ${functionName}(float index) {`,
    `  float palette = mod(index, ${CULTURE_PALETTE.length}.0);`,
  ];
  for (let index = 0; index < CULTURE_PALETTE.length - 1; index += 1) {
    lines.push(
      `  if (palette < ${(index + 0.5).toFixed(1)}) return ${glslColor(saturateCultureColor(CULTURE_PALETTE[index]!, saturation))};`,
    );
  }
  lines.push(
    `  return ${glslColor(saturateCultureColor(CULTURE_PALETTE.at(-1)!, saturation))};`,
    "}",
  );
  return lines.join("\n");
}
