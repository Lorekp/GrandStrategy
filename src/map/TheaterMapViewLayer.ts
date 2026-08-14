import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { PRESENTATION_CONFIG, parseHexColor } from "../config/GameConfig";
import type { WorldGridDefinition } from "../core/model";
import type { CameraState } from "./CameraController";
import type { RegionalTheaterManifest } from "./RegionalTheater";

export type TheaterMapViewMode =
  | "relief"
  | "height"
  | "moisture"
  | "resources";

export interface TheaterMapViewData {
  readonly width: number;
  readonly height: number;
  /** R: normalized height, G: moisture, B: vegetation code, A: terrain code. */
  readonly fields: Uint8Array;
}

export interface TheaterContourLabel {
  readonly x: number;
  readonly y: number;
  readonly elevationMeters: number;
}

type Rgb = readonly [red: number, green: number, blue: number];
type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

function rgb(value: string, path: string): Rgb {
  const color = parseHexColor(value, path);
  return [(color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff];
}

const viewConfig = PRESENTATION_CONFIG.mapViews;
const WATER = rgb(viewConfig.waterColor, "mapViews.waterColor");
const HEIGHT_LOW = rgb(viewConfig.heightLowColor, "mapViews.heightLowColor");
const HEIGHT_MID = rgb(viewConfig.heightMidColor, "mapViews.heightMidColor");
const HEIGHT_HIGH = rgb(viewConfig.heightHighColor, "mapViews.heightHighColor");
const CONTOUR_LINE_COLOR = parseHexColor(
  viewConfig.contourLineColor,
  "mapViews.contourLineColor",
);
const CONTOUR_LABEL_COLOR = parseHexColor(
  viewConfig.contourLabelColor,
  "mapViews.contourLabelColor",
);
const CONTOUR_LABEL_HALO = parseHexColor(
  viewConfig.contourLabelHaloColor,
  "mapViews.contourLabelHaloColor",
);
const MOISTURE_DRY = rgb(viewConfig.moistureDryColor, "mapViews.moistureDryColor");
const MOISTURE_MID = rgb(viewConfig.moistureMidColor, "mapViews.moistureMidColor");
const MOISTURE_WET = rgb(viewConfig.moistureWetColor, "mapViews.moistureWetColor");
const RESOURCE_BASE = rgb(viewConfig.resourceBaseColor, "mapViews.resourceBaseColor");
const FOREST = rgb(viewConfig.forestColor, "mapViews.forestColor");
const JUNGLE = rgb(viewConfig.jungleColor, "mapViews.jungleColor");

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mixColor(first: Rgb, second: Rgb, amount: number): Rgb {
  const ratio = clampUnit(amount);
  return [
    Math.round(first[0] + (second[0] - first[0]) * ratio),
    Math.round(first[1] + (second[1] - first[1]) * ratio),
    Math.round(first[2] + (second[2] - first[2]) * ratio),
  ];
}

function gradient(low: Rgb, middle: Rgb, high: Rgb, amount: number): Rgb {
  return amount < 0.5
    ? mixColor(low, middle, amount * 2)
    : mixColor(middle, high, (amount - 0.5) * 2);
}

/** Pure palette mapping kept separate from Pixi for deterministic tests. */
export function colorTheaterMapViewPixel(
  mode: Exclude<TheaterMapViewMode, "relief">,
  normalizedHeight: number,
  moisture: number,
  vegetationCode: number,
  terrainCode: number,
): Rgba {
  if (terrainCode === 0) return [...WATER, 255];
  if (mode === "height") {
    const color = gradient(
      HEIGHT_LOW,
      HEIGHT_MID,
      HEIGHT_HIGH,
      Math.sqrt(normalizedHeight / 255),
    );
    return [...color, 255];
  }
  if (mode === "moisture") {
    const color = gradient(
      MOISTURE_DRY,
      MOISTURE_MID,
      MOISTURE_WET,
      moisture / 255,
    );
    return [...color, 255];
  }

  const isForest = vegetationCode >= 1 && vegetationCode <= 4;
  const isJungle = vegetationCode >= 5 && vegetationCode <= 8;
  if (!isForest && !isJungle) return [...RESOURCE_BASE, 255];
  const density = isForest ? vegetationCode : vegetationCode - 4;
  const color = mixColor(
    RESOURCE_BASE,
    isForest ? FOREST : JUNGLE,
    0.35 + density * 0.1625,
  );
  return [...color, 255];
}

function buildPalette(
  mode: Exclude<TheaterMapViewMode, "relief">,
  size: number,
): Uint8Array {
  const palette = new Uint8Array(size * 4);
  for (let value = 0; value < size; value += 1) {
    const color = colorTheaterMapViewPixel(
      mode,
      mode === "height" ? value : 0,
      mode === "moisture" ? value : 0,
      mode === "resources" ? value : 0,
      1,
    );
    palette.set(color, value * 4);
  }
  return palette;
}

const HEIGHT_PALETTE = buildPalette("height", 256);
const MOISTURE_PALETTE = buildPalette("moisture", 256);
const RESOURCE_PALETTE = buildPalette("resources", 9);

const contourLabelStyle = new TextStyle({
  fontFamily: '"Cascadia Mono", Consolas, monospace',
  fontSize: viewConfig.contourLabelFontSize,
  fontWeight: "700",
  fill: CONTOUR_LABEL_COLOR,
  letterSpacing: 0.2,
  stroke: {
    color: CONTOUR_LABEL_HALO,
    width: 3,
    join: "round",
  },
});

interface ContourLabelCandidate extends TheaterContourLabel {
  readonly score: number;
}

function decodedElevation(fields: Uint8Array, pixelIndex: number): number {
  const normalized = fields[pixelIndex * 4] ?? 0;
  return (
    viewConfig.heightMinimumMeters +
    (normalized / 255) *
      (viewConfig.heightMaximumMeters - viewConfig.heightMinimumMeters)
  );
}

type ContourEdge = 0 | 1 | 2 | 3;
type ContourStrength = 1 | 2;
type ContourSegmentVisitor = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  elevationMeters: number,
  strength: ContourStrength,
) => void;

/** Edges are top, right, bottom, left. */
const CONTOUR_CASE_SEGMENTS: ReadonlyArray<
  readonly (readonly [ContourEdge, ContourEdge])[]
> = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [[3, 0], [1, 2]],
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[0, 2]],
  [[0, 1], [2, 3]],
  [[1, 2]],
  [[3, 1]],
  [[0, 1]],
  [[3, 0]],
  [],
];

function contourEdgeX(
  edge: ContourEdge,
  x: number,
  topT: number,
  bottomT: number,
): number {
  if (edge === 0) return x + topT;
  if (edge === 1) return x + 1;
  if (edge === 2) return x + bottomT;
  return x;
}

function contourEdgeY(
  edge: ContourEdge,
  y: number,
  rightT: number,
  leftT: number,
): number {
  if (edge === 0) return y;
  if (edge === 1) return y + rightT;
  if (edge === 2) return y + 1;
  return y + leftT;
}

function interpolateContourLevel(
  elevationMeters: number,
  first: number,
  second: number,
): number {
  return first === second
    ? 0.5
    : clampUnit((elevationMeters - first) / (second - first));
}

function emitContourSegment(
  visit: ContourSegmentVisitor,
  firstEdge: ContourEdge,
  secondEdge: ContourEdge,
  x: number,
  y: number,
  topT: number,
  rightT: number,
  bottomT: number,
  leftT: number,
  elevationMeters: number,
  strength: ContourStrength,
): void {
  visit(
    contourEdgeX(firstEdge, x, topT, bottomT),
    contourEdgeY(firstEdge, y, rightT, leftT),
    contourEdgeX(secondEdge, x, topT, bottomT),
    contourEdgeY(secondEdge, y, rightT, leftT),
    elevationMeters,
    strength,
  );
}

/**
 * Marching squares produces continuous sub-cell isolines instead of coloring
 * whole height-atlas cells. The visitor lets rendering consume each segment
 * immediately, without retaining a second map-sized contour buffer.
 */
export function traceTheaterContourSegments(
  data: Pick<TheaterMapViewData, "width" | "height" | "fields">,
  visit: ContourSegmentVisitor,
): void {
  const { fields, width, height } = data;
  const interval = viewConfig.contourIntervalMeters;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const topLeftIndex = y * width + x;
      const topRightIndex = topLeftIndex + 1;
      const bottomLeftIndex = topLeftIndex + width;
      const bottomRightIndex = bottomLeftIndex + 1;
      if (
        (fields[topLeftIndex * 4 + 3] ?? 0) === 0 ||
        (fields[topRightIndex * 4 + 3] ?? 0) === 0 ||
        (fields[bottomLeftIndex * 4 + 3] ?? 0) === 0 ||
        (fields[bottomRightIndex * 4 + 3] ?? 0) === 0
      ) {
        continue;
      }

      const topLeft = decodedElevation(fields, topLeftIndex);
      const topRight = decodedElevation(fields, topRightIndex);
      const bottomRight = decodedElevation(fields, bottomRightIndex);
      const bottomLeft = decodedElevation(fields, bottomLeftIndex);
      const minimum = Math.min(topLeft, topRight, bottomRight, bottomLeft);
      const maximum = Math.max(topLeft, topRight, bottomRight, bottomLeft);
      const firstContour = (Math.floor(minimum / interval) + 1) * interval;

      for (
        let elevationMeters = firstContour;
        elevationMeters <= maximum;
        elevationMeters += interval
      ) {
        const contourCase =
          (topLeft >= elevationMeters ? 1 : 0) |
          (topRight >= elevationMeters ? 2 : 0) |
          (bottomRight >= elevationMeters ? 4 : 0) |
          (bottomLeft >= elevationMeters ? 8 : 0);
        const segments = CONTOUR_CASE_SEGMENTS[contourCase] ?? [];
        if (segments.length === 0) continue;

        const topT = interpolateContourLevel(
          elevationMeters,
          topLeft,
          topRight,
        );
        const rightT = interpolateContourLevel(
          elevationMeters,
          topRight,
          bottomRight,
        );
        const bottomT = interpolateContourLevel(
          elevationMeters,
          bottomLeft,
          bottomRight,
        );
        const leftT = interpolateContourLevel(
          elevationMeters,
          topLeft,
          bottomLeft,
        );
        const strength: ContourStrength =
          elevationMeters % viewConfig.contourIndexIntervalMeters === 0 ? 2 : 1;
        for (const [firstEdge, secondEdge] of segments) {
          emitContourSegment(
            visit,
            firstEdge,
            secondEdge,
            x,
            y,
            topT,
            rightT,
            bottomT,
            leftT,
            elevationMeters,
            strength,
          );
        }
      }
    }
  }
}

export function buildTheaterContourPresentation(
  data: Pick<TheaterMapViewData, "width" | "height" | "fields">,
  visit?: ContourSegmentVisitor,
): readonly TheaterContourLabel[] {
  const { fields, width, height } = data;
  const maximumLabels = viewConfig.contourMaximumLabels;
  const aspectRatio = width / Math.max(1, height);
  const sectorColumns = Math.max(
    1,
    Math.min(width, Math.round(Math.sqrt(maximumLabels * aspectRatio))),
  );
  const sectorRows = Math.max(
    1,
    Math.min(height, Math.ceil(maximumLabels / sectorColumns)),
  );
  const sectorWidth = width / sectorColumns;
  const sectorHeight = height / sectorRows;
  const candidates: Array<ContourLabelCandidate | undefined> = new Array(
    sectorColumns * sectorRows,
  );
  const edgeMargin = Math.min(40, Math.floor(Math.min(width, height) / 12));

  const considerLabel = (
    x: number,
    y: number,
    elevationMeters: number,
    verticalLinePenalty: number,
  ): void => {
    if (
      x < edgeMargin ||
      y < edgeMargin ||
      x >= width - edgeMargin ||
      y >= height - edgeMargin
    ) {
      return;
    }
    const sectorColumn = Math.min(
      sectorColumns - 1,
      Math.floor(x / sectorWidth),
    );
    const sectorRow = Math.min(
      sectorRows - 1,
      Math.floor(y / sectorHeight),
    );
    const centerX = (sectorColumn + 0.5) * sectorWidth;
    const centerY = (sectorRow + 0.5) * sectorHeight;
    const score =
      Math.abs(x - centerX) / sectorWidth +
      Math.abs(y - centerY) / sectorHeight +
      verticalLinePenalty;
    const sectorIndex = sectorRow * sectorColumns + sectorColumn;
    if (!candidates[sectorIndex] || score < candidates[sectorIndex].score) {
      candidates[sectorIndex] = { x, y, elevationMeters, score };
    }
  };

  traceTheaterContourSegments(
    data,
    (x1, y1, x2, y2, elevationMeters, strength) => {
      visit?.(x1, y1, x2, y2, elevationMeters, strength);
      if (elevationMeters % viewConfig.contourLabelIntervalMeters !== 0) return;
      const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
      considerLabel(
        (x1 + x2) * 0.5,
        (y1 + y2) * 0.5,
        elevationMeters,
        horizontal ? 0 : 0.45,
      );
    },
  );

  const contourLabels = candidates
    .filter(
      (candidate): candidate is ContourLabelCandidate =>
        candidate !== undefined,
    )
    .sort((first, second) => first.y - second.y || first.x - second.x)
    .slice(0, maximumLabels)
    .map(({ x, y, elevationMeters }) => ({ x, y, elevationMeters }));
  return contourLabels;
}

/**
 * Packs the immutable semantic grid into one compact display atlas. Continuous
 * views use linear GPU sampling, so a 1536² source stays smooth without three
 * full-resolution textures or any per-frame work.
 */
export function buildTheaterMapViewData(
  definition: WorldGridDefinition,
  maximumDimension = viewConfig.textureMaximumDimension,
): TheaterMapViewData {
  const scale = Math.min(
    1,
    maximumDimension / Math.max(definition.width, definition.height),
  );
  const width = Math.max(1, Math.round(definition.width * scale));
  const height = Math.max(1, Math.round(definition.height * scale));
  const fields = new Uint8Array(width * height * 4);
  const heightRange =
    viewConfig.heightMaximumMeters - viewConfig.heightMinimumMeters;

  for (let row = 0; row < height; row += 1) {
    const sourceRow = Math.min(
      definition.height - 1,
      Math.floor(((row + 0.5) * definition.height) / height),
    );
    for (let column = 0; column < width; column += 1) {
      const sourceColumn = Math.min(
        definition.width - 1,
        Math.floor(((column + 0.5) * definition.width) / width),
      );
      const sourceIndex = sourceRow * definition.width + sourceColumn;
      const destination = (row * width + column) * 4;
      fields[destination] = Math.round(
        clampUnit(
          ((definition.elevationMeters[sourceIndex] ?? 0) -
            viewConfig.heightMinimumMeters) /
            heightRange,
        ) * 255,
      );
      fields[destination + 1] = definition.moistureCells[sourceIndex] ?? 0;
      fields[destination + 2] = definition.vegetationCells[sourceIndex] ?? 0;
      fields[destination + 3] = definition.terrainCells[sourceIndex] ?? 0;
    }
  }
  return {
    width,
    height,
    fields,
  };
}

export class TheaterMapViewLayer {
  public readonly root = new Container();
  private mode: TheaterMapViewMode = "relief";
  private data: TheaterMapViewData | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private context: CanvasRenderingContext2D | undefined;
  private imageData: ImageData | undefined;
  private texture: Texture | undefined;
  private sprite: Sprite | undefined;
  private readonly contourLines = new Container();
  private readonly labels = new Container();
  private readonly labelTexts: Text[] = [];
  private contourLabels: readonly TheaterContourLabel[] = [];
  private cameraScale = 1;
  private cameraRelativeZoom = 1;

  public constructor(private readonly theater: RegionalTheaterManifest) {
    this.root.eventMode = "none";
    this.root.visible = false;
    this.contourLines.eventMode = "none";
    this.labels.eventMode = "none";
    this.root.addChild(this.contourLines, this.labels);
  }

  public prepare(definition: WorldGridDefinition): void {
    this.destroyTexture();
    this.data = buildTheaterMapViewData(definition);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.data.width;
    this.canvas.height = this.data.height;
    this.context = this.canvas.getContext("2d", { alpha: true }) ?? undefined;
    if (!this.context) throw new Error("Map views require a 2D canvas context");
    this.imageData = this.context.createImageData(
      this.data.width,
      this.data.height,
    );
    this.createContourLines();
    this.createContourLabels();
    this.applyMode();
  }

  public setMode(mode: TheaterMapViewMode): boolean {
    if (mode === this.mode) return false;
    this.mode = mode;
    this.applyMode();
    return true;
  }

  public setViewport(
    viewport: Pick<CameraState, "scale" | "relativeZoom">,
  ): void {
    this.cameraScale = viewport.scale;
    this.cameraRelativeZoom = viewport.relativeZoom;
    this.updateContourLabels();
  }

  public destroy(): void {
    this.destroyTexture();
    this.data = undefined;
    this.imageData = undefined;
    this.context = undefined;
    this.canvas = undefined;
    this.contourLabels = [];
    this.root.destroy({ children: true });
  }

  private applyMode(): void {
    if (this.mode === "relief" || !this.data || !this.imageData || !this.context) {
      this.root.visible = false;
      return;
    }
    const output = this.imageData.data;
    const fields = this.data.fields;
    const palette =
      this.mode === "height"
        ? HEIGHT_PALETTE
        : this.mode === "moisture"
          ? MOISTURE_PALETTE
          : RESOURCE_PALETTE;
    for (let offset = 0; offset < fields.length; offset += 4) {
      if ((fields[offset + 3] ?? 0) === 0) {
        output[offset] = WATER[0];
        output[offset + 1] = WATER[1];
        output[offset + 2] = WATER[2];
        output[offset + 3] = 255;
        continue;
      }
      const value =
        this.mode === "height"
          ? (fields[offset] ?? 0)
          : this.mode === "moisture"
            ? (fields[offset + 1] ?? 0)
            : Math.min(8, fields[offset + 2] ?? 0);
      const colorOffset = value * 4;
      output[offset] = palette[colorOffset] ?? 0;
      output[offset + 1] = palette[colorOffset + 1] ?? 0;
      output[offset + 2] = palette[colorOffset + 2] ?? 0;
      output[offset + 3] = 255;
    }
    this.context.putImageData(this.imageData, 0, 0);
    if (!this.texture || !this.sprite || !this.canvas) {
      if (!this.canvas) return;
      this.texture = Texture.from(this.canvas);
      this.texture.source.scaleMode = "linear";
      this.sprite = new Sprite(this.texture);
      this.sprite.width = this.theater.render.width;
      this.sprite.height = this.theater.render.height;
      this.root.addChildAt(this.sprite, 0);
    } else {
      this.texture.source.update();
    }
    this.root.alpha = viewConfig.overlayAlpha;
    this.root.visible = true;
    this.contourLines.visible = this.mode === "height";
    this.updateContourLabels();
  }

  private createContourLines(): void {
    for (const child of this.contourLines.removeChildren()) child.destroy();
    if (!this.data) return;
    const regular = new Graphics();
    const index = new Graphics();
    const scaleX = this.theater.render.width / this.data.width;
    const scaleY = this.theater.render.height / this.data.height;
    this.contourLabels = buildTheaterContourPresentation(
      this.data,
      (x1, y1, x2, y2, _elevationMeters, strength) => {
        const target = strength === 2 ? index : regular;
        target
          .moveTo(x1 * scaleX, y1 * scaleY)
          .lineTo(x2 * scaleX, y2 * scaleY);
      },
    );
    const strokeBase = {
      color: CONTOUR_LINE_COLOR,
      pixelLine: true,
    };
    regular.stroke({ ...strokeBase, alpha: viewConfig.contourLineAlpha });
    index.stroke({ ...strokeBase, alpha: viewConfig.contourIndexAlpha });
    this.contourLines.addChild(regular, index);
  }

  private createContourLabels(): void {
    for (const label of this.labelTexts) label.destroy();
    this.labelTexts.length = 0;
    this.labels.removeChildren();
    if (!this.data) return;
    for (const contourLabel of this.contourLabels) {
      const elevation = contourLabel.elevationMeters;
      const text = new Text({
        text: `${elevation < 0 ? "−" : ""}${Math.abs(elevation)} m`,
        style: contourLabelStyle,
      });
      text.anchor.set(0.5);
      text.position.set(
        (contourLabel.x / this.data.width) * this.theater.render.width,
        (contourLabel.y / this.data.height) * this.theater.render.height,
      );
      this.labels.addChild(text);
      this.labelTexts.push(text);
    }
    this.updateContourLabels();
  }

  private updateContourLabels(): void {
    this.labels.visible =
      this.mode === "height" &&
      this.cameraRelativeZoom >= viewConfig.contourLabelMinimumRelativeZoom;
    const inverseScale = 1 / Math.max(this.cameraScale, 0.0001);
    for (const label of this.labelTexts) label.scale.set(inverseScale);
  }

  private destroyTexture(): void {
    if (this.sprite) {
      this.root.removeChild(this.sprite);
      this.sprite.destroy();
      this.sprite = undefined;
    }
    this.texture?.destroy(true);
    this.texture = undefined;
  }
}
