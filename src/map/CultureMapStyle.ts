import { PRESENTATION_CONFIG, parseHexColor } from "../config/GameConfig";

/** Cartographic presentation constants for the static culture atlas overlay. */
export const CULTURE_MAP_STYLE = PRESENTATION_CONFIG.culture.mapStyle;
export const CULTURE_BORDER_COLOR = parseHexColor(
  CULTURE_MAP_STYLE.borderColor,
  "culture.mapStyle.borderColor",
);

/**
 * Smooths a categorical texture by blending the four neighboring cultures'
 * colors and coverage. Culture IDs themselves remain exact nearest samples.
 */
export function cultureBilinearGlsl(
  sampleFunction = "cultureAt",
  colorFunction = "cultureColor",
  inhabitedFunction = "isCulture",
): string {
  return `
struct CultureBlend {
  vec4 indices;
  vec4 weights;
};

CultureBlend cultureSampleBlend(vec2 uv) {
  vec2 grid = uv / uCultureTexelSize - vec2(0.5);
  vec2 originCell = floor(grid);
  vec2 fraction = smoothstep(vec2(0.0), vec2(1.0), fract(grid));
  vec2 originUV = (originCell + vec2(0.5)) * uCultureTexelSize;
  CultureBlend blend;
  blend.indices = vec4(
    ${sampleFunction}(originUV),
    ${sampleFunction}(originUV + vec2(uCultureTexelSize.x, 0.0)),
    ${sampleFunction}(originUV + vec2(0.0, uCultureTexelSize.y)),
    ${sampleFunction}(originUV + uCultureTexelSize)
  );
  blend.weights = vec4(
    (1.0 - fraction.x) * (1.0 - fraction.y),
    fraction.x * (1.0 - fraction.y),
    (1.0 - fraction.x) * fraction.y,
    fraction.x * fraction.y
  );
  return blend;
}

float cultureWeight(CultureBlend blend, float target) {
  return
    (abs(blend.indices.x - target) < 0.5 ? blend.weights.x : 0.0) +
    (abs(blend.indices.y - target) < 0.5 ? blend.weights.y : 0.0) +
    (abs(blend.indices.z - target) < 0.5 ? blend.weights.z : 0.0) +
    (abs(blend.indices.w - target) < 0.5 ? blend.weights.w : 0.0);
}

float cultureInhabitedWeight(CultureBlend blend) {
  return
    (${inhabitedFunction}(blend.indices.x) ? blend.weights.x : 0.0) +
    (${inhabitedFunction}(blend.indices.y) ? blend.weights.y : 0.0) +
    (${inhabitedFunction}(blend.indices.z) ? blend.weights.z : 0.0) +
    (${inhabitedFunction}(blend.indices.w) ? blend.weights.w : 0.0);
}

vec3 cultureBlendedColor(CultureBlend blend) {
  vec3 color = vec3(0.0);
  float total = 0.0;
  if (${inhabitedFunction}(blend.indices.x)) {
    color += ${colorFunction}(blend.indices.x) * blend.weights.x;
    total += blend.weights.x;
  }
  if (${inhabitedFunction}(blend.indices.y)) {
    color += ${colorFunction}(blend.indices.y) * blend.weights.y;
    total += blend.weights.y;
  }
  if (${inhabitedFunction}(blend.indices.z)) {
    color += ${colorFunction}(blend.indices.z) * blend.weights.z;
    total += blend.weights.z;
  }
  if (${inhabitedFunction}(blend.indices.w)) {
    color += ${colorFunction}(blend.indices.w) * blend.weights.w;
    total += blend.weights.w;
  }
  return total > 0.0001 ? color / total : vec3(0.0);
}

vec3 cultureBlendedColorExcept(CultureBlend blend, float excluded) {
  vec3 color = vec3(0.0);
  float total = 0.0;
  if (${inhabitedFunction}(blend.indices.x) && abs(blend.indices.x - excluded) >= 0.5) {
    color += ${colorFunction}(blend.indices.x) * blend.weights.x;
    total += blend.weights.x;
  }
  if (${inhabitedFunction}(blend.indices.y) && abs(blend.indices.y - excluded) >= 0.5) {
    color += ${colorFunction}(blend.indices.y) * blend.weights.y;
    total += blend.weights.y;
  }
  if (${inhabitedFunction}(blend.indices.z) && abs(blend.indices.z - excluded) >= 0.5) {
    color += ${colorFunction}(blend.indices.z) * blend.weights.z;
    total += blend.weights.z;
  }
  if (${inhabitedFunction}(blend.indices.w) && abs(blend.indices.w - excluded) >= 0.5) {
    color += ${colorFunction}(blend.indices.w) * blend.weights.w;
    total += blend.weights.w;
  }
  return total > 0.0001 ? color / total : vec3(0.0);
}
`;
}

/** Shared constant-cost feathered inner edge for both Culture Field shaders. */
export function cultureEdgeGlsl(
  sampleFunction = "cultureAt",
  inhabitedFunction = "isCulture",
  functionName = "cultureEdge",
): string {
  return `
float cultureDifference(float center, vec2 sampleUV) {
  float neighbor = ${sampleFunction}(sampleUV);
  return ${inhabitedFunction}(neighbor) && abs(neighbor - center) > 0.5
    ? 1.0
    : 0.0;
}

float cultureRingDifference(float center, vec2 uv, float radius) {
  vec2 offset = uCultureEdgeStep * radius;
  return max(
    max(
      cultureDifference(center, uv - vec2(offset.x, 0.0)),
      cultureDifference(center, uv + vec2(offset.x, 0.0))
    ),
    max(
      cultureDifference(center, uv - vec2(0.0, offset.y)),
      cultureDifference(center, uv + vec2(0.0, offset.y))
    )
  );
}

float ${functionName}(float center, vec2 uv) {
  float feather = (
    cultureRingDifference(center, uv, 0.2) +
    cultureRingDifference(center, uv, 0.4) +
    cultureRingDifference(center, uv, 0.6) +
    cultureRingDifference(center, uv, 0.8) +
    cultureRingDifference(center, uv, 1.0)
  ) * 0.2;
  return smoothstep(0.0, 1.0, feather);
}
`;
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

/**
 * Atlas-scale lines begin as fine printed boundaries and gain their full
 * interactive weight over the first two zoom doublings.
 */
export function cultureMapStrokeWidth(relativeZoom: number): number {
  const progress = Math.max(
    0,
    Math.min(1, Math.log2(Math.max(relativeZoom, 1)) / 2),
  );
  return mix(
    CULTURE_MAP_STYLE.fitBorderWidth,
    CULTURE_MAP_STYLE.borderWidth,
    progress,
  );
}
