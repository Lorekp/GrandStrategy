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
import type { GeographicPosition } from "../core/model";
import type { CultureInfluenceField } from "../culture/CultureInfluence";
import { culturePaletteGlsl } from "../culture/CulturePalette";
import type { TheaterPoint } from "./RegionalTheater";
import type { CameraState } from "./CameraController";
import {
  loadCultureBorderManifest,
  type CultureBorderManifest,
  type CultureBorderPath,
} from "./CultureBorders";
import {
  CULTURE_BORDER_COLOR,
  CULTURE_MAP_STYLE,
  cultureBilinearGlsl,
  cultureEdgeGlsl,
  cultureMapStrokeWidth,
} from "./CultureMapStyle";
import { cultureRasterDimensions } from "./CultureRaster";

const WATER_INDEX = 255;

const CULTURE_VERTEX_SHADER = `
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

const CULTURE_FRAGMENT_SHADER = `
in vec2 vUV;
in vec4 vColor;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uCoastTexture;
uniform float uSelectedIndex;
uniform float uHoveredIndex;
uniform float uMode;
uniform vec2 uCultureEdgeStep;
uniform vec2 uCultureTexelSize;

float cultureAt(vec2 uv) {
  return floor(texture(uTexture, clamp(uv, vec2(0.0), vec2(1.0))).r * 255.0 + 0.5);
}

bool isCulture(float value) {
  return value < 254.5;
}

${culturePaletteGlsl(
  "cultureColor",
  CULTURE_MAP_STYLE.culturePickerSaturation,
)}

${cultureEdgeGlsl()}
${cultureBilinearGlsl()}

void main(void) {
  float center = cultureAt(vUV);
  float edge = cultureEdge(center, vUV);
  float coastFade = texture(uCoastTexture, vUV).r;
  CultureBlend blend = cultureSampleBlend(vUV);
  float inhabitedCoverage = cultureInhabitedWeight(blend);
  float selectedCoverage = uSelectedIndex >= 0.0
    ? cultureWeight(blend, uSelectedIndex)
    : 0.0;
  float coverage = uMode > 0.5 ? selectedCoverage : inhabitedCoverage;
  if (coverage < 0.004 || coastFade < 0.004) discard;

  float selectedStrength = selectedCoverage / max(inhabitedCoverage, 0.0001);
  float hoverStrength = uMode < 0.5 && uHoveredIndex >= 0.0
    ? cultureWeight(blend, uHoveredIndex) / max(inhabitedCoverage, 0.0001)
    : 0.0;
  vec3 color = uMode > 0.5
    ? cultureColor(uSelectedIndex)
    : cultureBlendedColor(blend);
  if (hoverStrength > 0.0) {
    color = mix(
      color,
      vec3(0.9333, 0.9059, 0.7608),
      hoverStrength * ${CULTURE_MAP_STYLE.hoverColorMix.toFixed(2)}
    );
  }
  color = mix(
    color,
    vec3(1.0),
    edge * ${CULTURE_MAP_STYLE.edgeColorMix.toFixed(2)}
  );
  float fillAlpha = uMode > 0.5
    ? ${CULTURE_MAP_STYLE.theaterFillAlpha.toFixed(2)}
    : mix(
      mix(
        ${CULTURE_MAP_STYLE.fillAlpha.toFixed(2)},
        ${CULTURE_MAP_STYLE.selectedFillAlpha.toFixed(2)},
        selectedStrength
      ),
      ${CULTURE_MAP_STYLE.hoverFillAlpha.toFixed(2)},
      hoverStrength
    );
  fillAlpha = mix(
    fillAlpha,
    ${CULTURE_MAP_STYLE.edgeFillAlpha.toFixed(2)},
    edge
  );
  float alpha = fillAlpha * coastFade * coverage;

  vec4 premultiplied = vec4(color * alpha, alpha);
  finalColor = premultiplied * vColor;
}
`;

export type CultureMapMode = "culture" | "theater";

interface CultureRaster {
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;
  readonly landAlpha: Uint8Array;
  readonly coastFade: Uint8Array;
}

async function decodeRaster(path: string, label: string): Promise<ImageData> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${label} failed to load (${response.status})`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error(`Unable to create ${label} canvas`);
  context.imageSmoothingEnabled = false;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = 1;
  canvas.height = 1;
  return pixels;
}

async function loadCultureRaster(
  path: string,
  coastFadePath: string,
): Promise<CultureRaster> {
  const [regions, coast] = await Promise.all([
    decodeRaster(path, "Culture raster"),
    decodeRaster(coastFadePath, "Culture coast fade raster"),
  ]);
  if (regions.width !== coast.width || regions.height !== coast.height) {
    throw new Error("Culture raster dimensions do not match coast fade field");
  }
  const cellCount = regions.width * regions.height;
  const cells = new Uint8Array(cellCount);
  const landAlpha = new Uint8Array(cellCount);
  const coastFade = new Uint8Array(cellCount);
  for (let cell = 0; cell < cellCount; cell += 1) {
    const source = cell * 4;
    cells[cell] = regions.data[source]!;
    landAlpha[cell] = regions.data[source + 3]!;
    coastFade[cell] = coast.data[source]!;
  }
  return {
    width: regions.width,
    height: regions.height,
    cells,
    landAlpha,
    coastFade,
  };
}

/** A static one-byte culture mask recolored by one GPU draw call. */
export class CultureMapLayer {
  public readonly root = new Container();
  private readonly texture: Texture;
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly shader: Shader;
  private readonly uniforms: UniformGroup;
  private readonly borderLayer = new Graphics();
  private readonly cultureGrid: Uint8Array;
  private readonly landAlpha: Uint8Array;
  private readonly coastSource: BufferImageSource;
  private readonly edgeStep: Float32Array;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private mode: CultureMapMode = "culture";
  private selectedCultureId: string | undefined;
  private hoveredCultureId: string | undefined;
  private viewportScale = 1;
  private relativeZoom = 1;

  private constructor(
    private readonly field: CultureInfluenceField,
    raster: CultureRaster,
    private readonly borders: CultureBorderManifest,
    atlasWidth: number,
    atlasHeight: number,
  ) {
    this.mapWidth = atlasWidth;
    this.mapHeight = atlasHeight;
    this.cultureGrid = raster.cells;
    this.landAlpha = raster.landAlpha;
    const source = new BufferImageSource({
      resource: this.cultureGrid,
      width: raster.width,
      height: raster.height,
      format: "r8unorm",
      alphaMode: "no-premultiply-alpha",
      scaleMode: "nearest",
      autoGenerateMipmaps: false,
      autoGarbageCollect: false,
      label: "high-resolution-culture-regions",
    });
    this.texture = new Texture({ source, label: "culture-regions" });
    this.coastSource = new BufferImageSource({
      resource: raster.coastFade,
      width: raster.width,
      height: raster.height,
      format: "r8unorm",
      alphaMode: "no-premultiply-alpha",
      scaleMode: "linear",
      autoGenerateMipmaps: false,
      autoGarbageCollect: false,
      label: "culture-coast-fade",
    });
    this.edgeStep = new Float32Array([
      CULTURE_MAP_STYLE.edgeWidthPixels / atlasWidth,
      CULTURE_MAP_STYLE.edgeWidthPixels / atlasHeight,
    ]);
    const texelSize = new Float32Array([
      1 / raster.width,
      1 / raster.height,
    ]);
    this.uniforms = new UniformGroup({
      uSelectedIndex: { value: -1, type: "f32" },
      uHoveredIndex: { value: -1, type: "f32" },
      uMode: { value: 0, type: "f32" },
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
        name: "culture-map",
        vertex: CULTURE_VERTEX_SHADER,
        fragment: CULTURE_FRAGMENT_SHADER,
        preferredFragmentPrecision: "highp",
      }),
      resources: {
        uTexture: source,
        uSampler: source.style,
        uCoastTexture: this.coastSource,
        uCoastSampler: this.coastSource.style,
        cultureUniforms: this.uniforms,
      },
    });
    this.mesh = new Mesh<MeshGeometry, Shader>({
      texture: this.texture,
      shader: this.shader,
      geometry: new MeshGeometry({
        positions: new Float32Array([
          0, 0,
          atlasWidth, 0,
          atlasWidth, atlasHeight,
          0, atlasHeight,
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
    this.borderLayer.eventMode = "none";
    this.borderLayer.scale.set(
      atlasWidth / borders.width,
      atlasHeight / borders.height,
    );
    this.root.eventMode = "none";
    this.root.addChild(this.mesh, this.borderLayer);
    this.drawBaseBorders();
  }

  public static async create(
    field: CultureInfluenceField,
    cultureRasterPath: string,
    coastFadeRasterPath: string,
    borderPath: string,
    atlasWidth: number,
    atlasHeight: number,
  ): Promise<CultureMapLayer> {
    const [raster, borders] = await Promise.all([
      loadCultureRaster(cultureRasterPath, coastFadeRasterPath),
      loadCultureBorderManifest(borderPath),
    ]);
    const expected = cultureRasterDimensions(atlasWidth, atlasHeight);
    if (raster.width !== expected.width || raster.height !== expected.height) {
      throw new Error(
        `Culture raster is ${raster.width}x${raster.height}; expected ${expected.width}x${expected.height}`,
      );
    }
    if (borders.width !== raster.width || borders.height !== raster.height) {
      throw new Error("Culture border and raster dimensions do not match");
    }
    if (borders.paths.some(
      (path) => path.cultures.some((index) => index >= field.cultures.length),
    )) {
      throw new Error("Culture borders reference an unknown culture");
    }
    return new CultureMapLayer(field, raster, borders, atlasWidth, atlasHeight);
  }

  public setPresentation(
    mode: CultureMapMode,
    selectedCultureId: string | undefined,
    hoveredCultureId: string | undefined,
  ): void {
    const baseChanged =
      this.mode !== mode || this.selectedCultureId !== selectedCultureId;
    const hoverChanged = this.hoveredCultureId !== hoveredCultureId ||
      this.mode !== mode;
    if (!baseChanged && !hoverChanged) {
      return;
    }
    this.mode = mode;
    this.selectedCultureId = selectedCultureId;
    this.hoveredCultureId = hoveredCultureId;
    this.uniforms.uniforms.uMode = mode === "culture" ? 0 : 1;
    this.uniforms.uniforms.uSelectedIndex = this.cultureIndex(selectedCultureId);
    this.uniforms.uniforms.uHoveredIndex = this.cultureIndex(hoveredCultureId);
    if (baseChanged) this.drawBaseBorders();
  }

  public setViewport(
    viewport: Pick<CameraState, "scale" | "relativeZoom">,
  ): void {
    if (
      !Number.isFinite(viewport.scale) ||
      viewport.scale <= 0 ||
      !Number.isFinite(viewport.relativeZoom) ||
      viewport.relativeZoom <= 0 ||
      (viewport.scale === this.viewportScale &&
        viewport.relativeZoom === this.relativeZoom)
    ) {
      return;
    }
    this.viewportScale = viewport.scale;
    this.relativeZoom = viewport.relativeZoom;
    this.edgeStep[0] = CULTURE_MAP_STYLE.edgeWidthPixels /
      (this.mapWidth * viewport.scale);
    this.edgeStep[1] = CULTURE_MAP_STYLE.edgeWidthPixels /
      (this.mapHeight * viewport.scale);
    this.drawBaseBorders();
  }

  public cultureIdAt(
    point: TheaterPoint,
    atlasWidth: number,
    atlasHeight: number,
  ): string | undefined {
    const cultureIndex = this.cellAt(
      point.x / atlasWidth,
      point.y / atlasHeight,
    );
    return !this.landAt(point.x / atlasWidth, point.y / atlasHeight) ||
      cultureIndex === WATER_INDEX
      ? undefined
      : this.field.cultures[cultureIndex]?.id;
  }

  public isLand(position: GeographicPosition): boolean {
    const longitude = position.longitudeE6 / 1_000_000;
    const latitude = position.latitudeE6 / 1_000_000;
    return this.landAt((longitude + 180) / 360, (90 - latitude) / 180);
  }

  public destroy(): void {
    this.root.destroy({ children: true });
    this.shader.destroy(true);
    this.texture.destroy(true);
    this.coastSource.destroy();
  }

  private cultureIndex(cultureId: string | undefined): number {
    return cultureId
      ? this.field.cultures.findIndex((culture) => culture.id === cultureId)
      : -1;
  }

  private drawBaseBorders(): void {
    const selectedIndex = this.cultureIndex(this.selectedCultureId);
    this.drawBorders(
      this.borderLayer,
      (path) => this.mode === "culture" || path.cultures.includes(selectedIndex),
      CULTURE_BORDER_COLOR,
      CULTURE_MAP_STYLE.borderAlpha,
      cultureMapStrokeWidth(this.relativeZoom),
    );
  }

  private drawBorders(
    target: Graphics,
    include: (path: CultureBorderPath) => boolean,
    color: number,
    alpha: number,
    width: number,
  ): void {
    target.clear();
    let drewPath = false;
    for (const path of this.borders.paths) {
      if (!include(path)) continue;
      const points = path.points;
      target.moveTo(points[0]!, points[1]!);
      for (let index = 2; index < points.length; index += 2) {
        target.lineTo(points[index]!, points[index + 1]!);
      }
      drewPath = true;
    }
    if (drewPath) {
      const localToScreen = this.borderLayer.scale.x * this.viewportScale;
      target.stroke({
        color,
        alpha,
        width: width / localToScreen,
        cap: "round",
        join: "round",
      });
    }
  }

  private cellAt(normalizedX: number, normalizedY: number): number {
    const width = this.texture.source.pixelWidth;
    const height = this.texture.source.pixelHeight;
    const x = Math.max(0, Math.min(width - 1, Math.floor(normalizedX * width)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(normalizedY * height)));
    return this.cultureGrid[y * width + x]!;
  }

  private landAt(normalizedX: number, normalizedY: number): boolean {
    const width = this.texture.source.pixelWidth;
    const height = this.texture.source.pixelHeight;
    const x = Math.max(0, Math.min(width - 1, Math.floor(normalizedX * width)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(normalizedY * height)));
    return this.landAlpha[y * width + x]! >= 128;
  }
}
