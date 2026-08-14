import {
  BufferImageSource,
  Container,
  GlProgram,
  Graphics,
  Mesh,
  MeshGeometry,
  Shader,
  Texture,
  UniformGroup,
} from "pixi.js";
import { PRESENTATION_CONFIG } from "../config/GameConfig";
import type { CultureInfluenceField } from "../culture/CultureInfluence";
import { culturePaletteGlsl } from "../culture/CulturePalette";
import type { CameraState } from "./CameraController";
import {
  CULTURE_BORDER_COLOR,
  CULTURE_MAP_STYLE,
  cultureBilinearGlsl,
  cultureEdgeGlsl,
  cultureMapStrokeWidth,
} from "./CultureMapStyle";
import {
  buildAdaptiveCultureIndexField,
  buildCulturePresentationField,
  cultureBoundarySegments,
  cultureIndexFieldDimensions,
  type CultureBoundarySegment,
} from "./TheaterCultureField";
import {
  RegionalTheaterProjection,
  type RegionalTheaterManifest,
} from "./RegionalTheater";

const FIELD_SAMPLES_PER_EDGE = PRESENTATION_CONFIG.performance.cultureFieldSamplesPerEdge;

const VERTEX_SHADER = `
in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;
out vec4 vColor;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;

void main(void) {
  vUV = aUV;
  vColor = uWorldColorAlpha * uColor;
  mat3 transform = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((transform * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
in vec2 vUV;
in vec4 vColor;

out vec4 finalColor;

uniform sampler2D uFieldTexture;
uniform sampler2D uLandTexture;
uniform float uSelectedIndex;
uniform float uHoveredIndex;
uniform vec2 uCultureEdgeStep;
uniform vec2 uCultureTexelSize;

${culturePaletteGlsl(
  "cultureColor",
  CULTURE_MAP_STYLE.culturePickerSaturation,
)}

float cultureAt(vec2 uv) {
  return floor(
    texture(uFieldTexture, clamp(uv, vec2(0.0), vec2(1.0))).r * 255.0 + 0.5
  );
}

bool isCulture(float value) {
  return value < 254.5;
}

${cultureEdgeGlsl()}
${cultureBilinearGlsl()}

void main(void) {
  float cultureIndex = cultureAt(vUV);
  float edge = cultureEdge(cultureIndex, vUV);
  CultureBlend blend = cultureSampleBlend(vUV);
  float inhabitedCoverage = cultureInhabitedWeight(blend);
  float selectedCoverage = cultureWeight(blend, uSelectedIndex);
  float rejectedCoverage = max(0.0, inhabitedCoverage - selectedCoverage);
  if (rejectedCoverage < 0.004) discard;

  float hoverStrength = uHoveredIndex >= 0.0
    ? clamp(cultureWeight(blend, uHoveredIndex) / rejectedCoverage, 0.0, 1.0)
    : 0.0;
  float land = smoothstep(0.04, 0.96, texture(uLandTexture, vUV).r);
  vec3 tint = cultureBlendedColorExcept(blend, uSelectedIndex);
  if (hoverStrength > 0.0) {
    tint = mix(
      tint,
      vec3(0.9333, 0.9059, 0.7608),
      hoverStrength * ${CULTURE_MAP_STYLE.hoverColorMix.toFixed(2)}
    );
  }
  tint = mix(
    tint,
    vec3(1.0),
    edge * ${CULTURE_MAP_STYLE.edgeColorMix.toFixed(2)}
  );
  float fillAlpha = mix(
    ${CULTURE_MAP_STYLE.regionalTheaterFillAlpha.toFixed(2)},
    ${CULTURE_MAP_STYLE.hoverFillAlpha.toFixed(2)},
    hoverStrength
  );
  fillAlpha = mix(
    fillAlpha,
    ${CULTURE_MAP_STYLE.edgeFillAlpha.toFixed(2)},
    edge
  );
  float alpha = land * fillAlpha * rejectedCoverage;
  finalColor = vec4(tint * alpha, alpha) * vColor;
}
`;

function sampleTheaterCultureField(
  theater: RegionalTheaterManifest,
  field: CultureInfluenceField,
) {
  const projection = new RegionalTheaterProjection(theater);
  return buildCulturePresentationField(
    FIELD_SAMPLES_PER_EDGE,
    FIELD_SAMPLES_PER_EDGE,
    (column, row) => {
      return field.classifyCulture(
        projection.toGeographic({
          x: column / (FIELD_SAMPLES_PER_EDGE - 1) * theater.render.width,
          y: row / (FIELD_SAMPLES_PER_EDGE - 1) * theater.render.height,
        }),
      );
    },
  );
}

function sampleTheaterCultureIndices(
  theater: RegionalTheaterManifest,
  field: CultureInfluenceField,
) {
  const projection = new RegionalTheaterProjection(theater);
  const dimensions = cultureIndexFieldDimensions(
    theater.render.width,
    theater.render.height,
  );
  return buildAdaptiveCultureIndexField(
    dimensions.width,
    dimensions.height,
    (column, row) =>
      field.classifyCulture(
        projection.toGeographic({
          x: (column + 0.5) / dimensions.width * theater.render.width,
          y: (row + 0.5) / dimensions.height * theater.render.height,
        }),
      ).cultureIndex,
  );
}

/** Static camp-pick overlay: rejected Culture Fields are tinted, never simulated. */
export class TheaterCultureFieldLayer {
  public readonly root = new Container();
  private readonly source: BufferImageSource;
  private readonly texture: Texture;
  private readonly shader: Shader;
  private readonly uniforms: UniformGroup;
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly delimiter = new Graphics();
  private readonly segments: readonly CultureBoundarySegment[];
  private readonly edgeStep: Float32Array;
  private readonly theaterWidth: number;
  private readonly theaterHeight: number;
  private cameraScale = 1;
  private relativeZoom = 1;
  private hoveredCultureId: string | undefined;

  public constructor(
    theater: RegionalTheaterManifest,
    field: CultureInfluenceField,
    selectedCultureId: string,
    landMaskTexture: Texture,
  ) {
    this.theaterWidth = theater.render.width;
    this.theaterHeight = theater.render.height;
    const presentationField = sampleTheaterCultureField(
      theater,
      field,
    );
    this.segments = cultureBoundarySegments(
      presentationField,
      theater.render.width,
      theater.render.height,
    );
    const indexField = sampleTheaterCultureIndices(
      theater,
      field,
    );
    if (indexField.width % 4 !== 0) {
      throw new Error("Semantic culture field width must preserve R8 row alignment");
    }
    this.source = new BufferImageSource({
      resource: indexField.cultureIndices,
      width: indexField.width,
      height: indexField.height,
      format: "r8unorm",
      alphaMode: "no-premultiply-alpha",
      scaleMode: "nearest",
      autoGenerateMipmaps: false,
      autoGarbageCollect: false,
      label: "regional-theater-culture-indices",
    });
    const landSource = landMaskTexture.source;
    this.texture = new Texture({
      source: this.source,
      label: "regional-theater-culture-field",
    });
    this.edgeStep = new Float32Array([
      CULTURE_MAP_STYLE.edgeWidthPixels / theater.render.width,
      CULTURE_MAP_STYLE.edgeWidthPixels / theater.render.height,
    ]);
    const texelSize = new Float32Array([
      1 / indexField.width,
      1 / indexField.height,
    ]);
    this.uniforms = new UniformGroup({
      uSelectedIndex: {
        value: field.indexOfCulture(selectedCultureId),
        type: "f32",
      },
      uHoveredIndex: { value: -1, type: "f32" },
      uCultureEdgeStep: {
        value: this.edgeStep,
        type: "vec2<f32>",
      },
      uCultureTexelSize: {
        value: texelSize,
        type: "vec2<f32>",
      },
    });
    this.shader = new Shader({
      glProgram: GlProgram.from({
        name: "regional-theater-culture-field",
        vertex: VERTEX_SHADER,
        fragment: FRAGMENT_SHADER,
        preferredFragmentPrecision: "highp",
      }),
      resources: {
        uFieldTexture: this.source,
        uFieldSampler: this.source.style,
        uLandTexture: landSource,
        uLandSampler: landSource.style,
        cultureFieldUniforms: this.uniforms,
      },
    });
    this.mesh = new Mesh<MeshGeometry, Shader>({
      texture: this.texture,
      shader: this.shader,
      geometry: new MeshGeometry({
        positions: new Float32Array([
          0, 0,
          theater.render.width, 0,
          theater.render.width, theater.render.height,
          0, theater.render.height,
        ]),
        uvs: new Float32Array([
          0, 0,
          1, 0,
          1, 1,
          0, 1,
        ]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      }),
    });
    this.mesh.eventMode = "none";
    this.delimiter.eventMode = "none";
    this.root.eventMode = "none";
    this.root.addChild(this.mesh, this.delimiter);
    this.drawDelimiter();
  }

  public setViewport(
    viewport: Pick<CameraState, "scale" | "relativeZoom">,
  ): void {
    if (
      viewport.scale === this.cameraScale &&
      viewport.relativeZoom === this.relativeZoom
    ) {
      return;
    }
    this.cameraScale = viewport.scale;
    this.relativeZoom = viewport.relativeZoom;
    this.edgeStep[0] = CULTURE_MAP_STYLE.edgeWidthPixels /
      (this.theaterWidth * viewport.scale);
    this.edgeStep[1] = CULTURE_MAP_STYLE.edgeWidthPixels /
      (this.theaterHeight * viewport.scale);
    this.drawDelimiter();
  }

  public setHoveredCulture(
    field: CultureInfluenceField,
    cultureId: string | undefined,
  ): boolean {
    if (cultureId === this.hoveredCultureId) return false;
    this.hoveredCultureId = cultureId;
    this.uniforms.uniforms.uHoveredIndex =
      cultureId === undefined ? -1 : field.indexOfCulture(cultureId);
    return true;
  }

  public destroy(): void {
    this.root.destroy({ children: true });
    this.shader.destroy(true);
    this.texture.destroy(true);
    this.source.destroy();
  }

  private drawDelimiter(): void {
    this.delimiter.clear();
    for (const segment of this.segments) {
      this.delimiter
        .moveTo(segment.start.x, segment.start.y)
        .lineTo(segment.end.x, segment.end.y);
    }
    if (this.segments.length === 0) return;
    this.delimiter.stroke({
      color: CULTURE_BORDER_COLOR,
      alpha: CULTURE_MAP_STYLE.borderAlpha,
      width: cultureMapStrokeWidth(this.relativeZoom) /
        Math.max(this.cameraScale, 0.0001),
      cap: "round",
      join: "round",
    });
  }
}
