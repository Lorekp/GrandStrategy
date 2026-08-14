import { Container, Graphics } from "pixi.js";
import type { PlayerWorldSnapshot } from "../core/model";
import type { CameraState } from "./CameraController";
import type { RegionalTheaterManifest } from "./RegionalTheater";
import { PRESENTATION_CONFIG, parseHexColor } from "../config/GameConfig";

const fogPresentation = PRESENTATION_CONFIG.fog;
export const UNKNOWN_FOG_COLOR = parseHexColor(fogPresentation.unknownColor);

const PATTERN_SPACING_SCREEN_PIXELS = fogPresentation.patternSpacingScreenPixels;
const PATTERN_OVERDRAW_SCREEN_PIXELS = fogPresentation.patternOverdrawScreenPixels;
const PATTERN_CACHE_MARGIN_SCREEN_PIXELS = fogPresentation.patternCacheMarginScreenPixels;
const DISTANCE_INFINITY = 0xffff;
const ORTHOGONAL_DISTANCE = 3;
const DIAGONAL_DISTANCE = 4;
const MAXIMUM_PATTERN_DISTANCE_CELLS = fogPresentation.maximumPatternDistanceCells;

interface FogSurface {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly scale: number;
}

interface CellBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface ExploredDistanceField {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly distances: Uint16Array;
}

/** Two-pass chamfer field used for the crisp pixel-pattern fade. */
export function buildExploredDistanceField(
  exploredCells: Uint32Array,
  width: number,
  height: number,
): ExploredDistanceField {
  const setBounds = findSetCellBounds(exploredCells, width, height);
  return buildExploredDistanceFieldWithinBounds(
    exploredCells,
    width,
    height,
    setBounds,
  );
}

function buildExploredDistanceFieldWithinBounds(
  exploredCells: Uint32Array,
  width: number,
  height: number,
  setBounds: CellBounds | undefined,
): ExploredDistanceField {
  if (!setBounds) {
    return { left: 0, top: 0, width: 0, height: 0, distances: new Uint16Array() };
  }
  const left = Math.max(0, setBounds.left - MAXIMUM_PATTERN_DISTANCE_CELLS);
  const top = Math.max(0, setBounds.top - MAXIMUM_PATTERN_DISTANCE_CELLS);
  const right = Math.min(width - 1, setBounds.right + MAXIMUM_PATTERN_DISTANCE_CELLS);
  const bottom = Math.min(
    height - 1,
    setBounds.bottom + MAXIMUM_PATTERN_DISTANCE_CELLS,
  );
  const fieldWidth = right - left + 1;
  const fieldHeight = bottom - top + 1;
  const distances = new Uint16Array(fieldWidth * fieldHeight);
  distances.fill(DISTANCE_INFINITY);
  for (let row = top; row <= bottom; row += 1) {
    const sourceRowStart = row * width;
    const destinationRowStart = (row - top) * fieldWidth;
    for (let column = left; column <= right; column += 1) {
      const sourceIndex = sourceRowStart + column;
      if (
        (exploredCells[sourceIndex >>> 5]! & (1 << (sourceIndex & 31))) !==
        0
      ) {
        distances[destinationRowStart + column - left] = 0;
      }
    }
  }

  for (let row = 0; row < fieldHeight; row += 1) {
    const rowStart = row * fieldWidth;
    for (let column = 0; column < fieldWidth; column += 1) {
      const index = rowStart + column;
      let distance = distances[index]!;
      if (column > 0) {
        distance = Math.min(
          distance,
          distances[index - 1]! + ORTHOGONAL_DISTANCE,
        );
      }
      if (row > 0) {
        distance = Math.min(
          distance,
          distances[index - fieldWidth]! + ORTHOGONAL_DISTANCE,
        );
        if (column > 0) {
          distance = Math.min(
            distance,
            distances[index - fieldWidth - 1]! + DIAGONAL_DISTANCE,
          );
        }
        if (column + 1 < fieldWidth) {
          distance = Math.min(
            distance,
            distances[index - fieldWidth + 1]! + DIAGONAL_DISTANCE,
          );
        }
      }
      distances[index] = distance;
    }
  }
  for (let row = fieldHeight - 1; row >= 0; row -= 1) {
    const rowStart = row * fieldWidth;
    for (let column = fieldWidth - 1; column >= 0; column -= 1) {
      const index = rowStart + column;
      let distance = distances[index]!;
      if (column + 1 < fieldWidth) {
        distance = Math.min(
          distance,
          distances[index + 1]! + ORTHOGONAL_DISTANCE,
        );
      }
      if (row + 1 < fieldHeight) {
        distance = Math.min(
          distance,
          distances[index + fieldWidth]! + ORTHOGONAL_DISTANCE,
        );
        if (column + 1 < fieldWidth) {
          distance = Math.min(
            distance,
            distances[index + fieldWidth + 1]! + DIAGONAL_DISTANCE,
          );
        }
        if (column > 0) {
          distance = Math.min(
            distance,
            distances[index + fieldWidth - 1]! + DIAGONAL_DISTANCE,
          );
        }
      }
      distances[index] = distance;
    }
  }
  return { left, top, width: fieldWidth, height: fieldHeight, distances };
}

export function exploredDistanceAt(
  field: ExploredDistanceField,
  column: number,
  row: number,
): number {
  const localColumn = column - field.left;
  const localRow = row - field.top;
  if (
    localColumn < 0 ||
    localRow < 0 ||
    localColumn >= field.width ||
    localRow >= field.height
  ) {
    return DISTANCE_INFINITY;
  }
  return (
    field.distances[localRow * field.width + localColumn] ?? DISTANCE_INFINITY
  );
}

/** Quantized density keeps the boundary fade crisp instead of blurred. */
export function unknownPatternLevel(distanceScreenPixels: number): 0 | 1 | 2 | 3 {
  if (distanceScreenPixels < 8) return 0;
  if (distanceScreenPixels < 26) return 1;
  if (distanceScreenPixels < 50) return 2;
  return 3;
}

function shouldDrawPatternMark(
  level: 0 | 1 | 2 | 3,
  row: number,
  column: number,
): boolean {
  const phase = ((row * 3 + column * 5) % 4 + 4) % 4;
  return (
    level === 3 ||
    (level === 2 && phase % 2 === 0) ||
    (level === 1 && phase === 0)
  );
}

export interface PresentationVisibilityRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;
}

export const PRESENTATION_VISIBILITY_SCALE = fogPresentation.presentationVisibilityScale;

function scale2xBinaryCells(
  source: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const outputWidth = width * 2;
  const output = new Uint8Array(outputWidth * height * 2);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = row * width;
    const northRow = row === 0 ? sourceRow : sourceRow - width;
    const southRow = row + 1 === height ? sourceRow : sourceRow + width;
    const outputRow = row * 2 * outputWidth;
    for (let column = 0; column < width; column += 1) {
      const center = source[sourceRow + column]!;
      const north = source[northRow + column]!;
      const west = source[sourceRow + (column === 0 ? 0 : column - 1)]!;
      const east =
        source[sourceRow + (column + 1 === width ? column : column + 1)]!;
      const south = source[southRow + column]!;
      const outputIndex = outputRow + column * 2;
      output[outputIndex] =
        west === north && west !== south && north !== east ? west : center;
      output[outputIndex + 1] =
        north === east && north !== west && east !== south ? east : center;
      output[outputIndex + outputWidth] =
        west === south && west !== north && south !== east ? west : center;
      output[outputIndex + outputWidth + 1] =
        south === east && west !== south && north !== east ? east : center;
    }
  }
  return output;
}

function findSetCellBounds(
  cells: Uint32Array,
  width: number,
  height: number,
): CellBounds | undefined {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  const cellCount = width * height;
  for (let wordIndex = 0; wordIndex < cells.length; wordIndex += 1) {
    let word = cells[wordIndex] ?? 0;
    while (word !== 0) {
      const bit = 31 - Math.clz32(word & -word);
      const index = wordIndex * 32 + bit;
      if (index < cellCount) {
        const column = index % width;
        const row = Math.floor(index / width);
        left = Math.min(left, column);
        top = Math.min(top, row);
        right = Math.max(right, column);
        bottom = Math.max(bottom, row);
      }
      word &= word - 1;
    }
  }
  return right < 0 ? undefined : { left, top, right, bottom };
}

/**
 * Refines the 500 m simulation mask twice into a crisp 125 m display mask.
 * Each Scale2x pass only bevels unambiguous diagonal corners, so it softens
 * stair-steps without introducing blur or changing straight boundaries.
 */
export function buildPresentationVisibilityRegion(
  sourceCells: Uint32Array,
  width: number,
  height: number,
): PresentationVisibilityRegion {
  const setBounds = findSetCellBounds(sourceCells, width, height);
  return buildPresentationVisibilityRegionWithinBounds(
    sourceCells,
    width,
    height,
    setBounds,
  );
}

function buildPresentationVisibilityRegionWithinBounds(
  sourceCells: Uint32Array,
  width: number,
  height: number,
  setBounds: CellBounds | undefined,
): PresentationVisibilityRegion {
  if (!setBounds) {
    return { left: 0, top: 0, width: 0, height: 0, cells: new Uint8Array() };
  }
  const sourceLeft = Math.max(0, setBounds.left - 1);
  const sourceTop = Math.max(0, setBounds.top - 1);
  const sourceRight = Math.min(width - 1, setBounds.right + 1);
  const sourceBottom = Math.min(height - 1, setBounds.bottom + 1);
  const sourceWidth = sourceRight - sourceLeft + 1;
  const sourceHeight = sourceBottom - sourceTop + 1;
  const presentationWidth = sourceWidth * 2;
  const presentationHeight = sourceHeight * 2;
  const cells = new Uint8Array(presentationWidth * presentationHeight);

  for (let row = sourceTop; row <= sourceBottom; row += 1) {
    const sourceRow = row * width;
    const northRow = row === 0 ? sourceRow : sourceRow - width;
    const southRow = row + 1 === height ? sourceRow : sourceRow + width;
    for (let column = sourceLeft; column <= sourceRight; column += 1) {
      const sourceIndex = sourceRow + column;
      const center =
        (sourceCells[sourceIndex >>> 5]! >>> (sourceIndex & 31)) & 1;
      const northIndex = northRow + column;
      const westIndex = sourceRow + (column === 0 ? 0 : column - 1);
      const eastIndex =
        sourceRow + (column + 1 === width ? column : column + 1);
      const southIndex = southRow + column;
      const north =
        (sourceCells[northIndex >>> 5]! >>> (northIndex & 31)) & 1;
      const west =
        (sourceCells[westIndex >>> 5]! >>> (westIndex & 31)) & 1;
      const east =
        (sourceCells[eastIndex >>> 5]! >>> (eastIndex & 31)) & 1;
      const south =
        (sourceCells[southIndex >>> 5]! >>> (southIndex & 31)) & 1;
      const outputRow = (row - sourceTop) * 2;
      const outputColumn = (column - sourceLeft) * 2;
      const outputIndex = outputRow * presentationWidth + outputColumn;

      cells[outputIndex] =
        west === north && west !== south && north !== east ? west : center;
      cells[outputIndex + 1] =
        north === east && north !== west && east !== south ? east : center;
      cells[outputIndex + presentationWidth] =
        west === south && west !== north && south !== east ? west : center;
      cells[outputIndex + presentationWidth + 1] =
        south === east && west !== south && north !== east ? east : center;
    }
  }

  const refinedCells = scale2xBinaryCells(
    cells,
    presentationWidth,
    presentationHeight,
  );
  return {
    left: sourceLeft * PRESENTATION_VISIBILITY_SCALE,
    top: sourceTop * PRESENTATION_VISIBILITY_SCALE,
    width: presentationWidth * 2,
    height: presentationHeight * 2,
    cells: refinedCells,
  };
}

/** Draws unknown, remembered, and currently visible terrain as distinct states. */
export class FogOfWarLayer {
  public readonly root = new Container();
  private readonly rememberedLayer = new Container();
  private readonly rememberedFog = new Graphics();
  private readonly unknownLayer = new Container();
  private readonly unknownFog = new Graphics();
  private readonly unknownPattern = new Graphics();
  private readonly visibleMask = new Graphics();
  private readonly exploredMask = new Graphics();
  private exploredDistances: ExploredDistanceField;
  private surface: FogSurface;
  private revision = -1;

  public constructor(private readonly theater: RegionalTheaterManifest) {
    this.surface = {
      left: 0,
      top: 0,
      right: theater.render.width,
      bottom: theater.render.height,
      scale: 1,
    };
    this.exploredDistances = {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      distances: new Uint16Array(),
    };
    this.root.eventMode = "none";
    this.rememberedLayer.addChild(this.rememberedFog);
    this.unknownLayer.addChild(this.unknownFog, this.unknownPattern);
    this.rememberedLayer.setMask({ mask: this.visibleMask, inverse: true });
    this.unknownLayer.setMask({ mask: this.exploredMask, inverse: true });
    this.root.addChild(
      this.rememberedLayer,
      this.unknownLayer,
      this.visibleMask,
      this.exploredMask,
    );
  }

  public setViewport(viewport: CameraState): boolean {
    if (this.surfaceContains(viewport)) return false;

    const overdraw = PATTERN_OVERDRAW_SCREEN_PIXELS / viewport.scale;
    this.surface = {
      left: viewport.left - overdraw,
      top: viewport.top - overdraw,
      right: viewport.right + overdraw,
      bottom: viewport.bottom + overdraw,
      scale: viewport.scale,
    };
    this.drawUnknownSurface();
    return true;
  }

  public update(snapshot: PlayerWorldSnapshot): boolean {
    const visibility = snapshot.visibility;
    if (
      visibility.width !== this.theater.semantic.width ||
      visibility.height !== this.theater.semantic.height
    ) {
      throw new Error("Fog grid dimensions do not match the Regional Theater");
    }
    if (visibility.revision === this.revision) return false;

    this.revision = visibility.revision;
    const visibleBounds = findSetCellBounds(
      visibility.visibleCells,
      visibility.width,
      visibility.height,
    );
    const exploredBounds = findSetCellBounds(
      visibility.exploredCells,
      visibility.width,
      visibility.height,
    );
    this.drawGridMask(this.visibleMask, visibility.visibleCells, visibleBounds);
    this.drawGridMask(this.exploredMask, visibility.exploredCells, exploredBounds);
    this.exploredDistances = buildExploredDistanceFieldWithinBounds(
      visibility.exploredCells,
      visibility.width,
      visibility.height,
      exploredBounds,
    );
    this.drawFog(this.rememberedFog, 0x48534b, 0.52, {
      left: 0,
      top: 0,
      right: this.theater.render.width,
      bottom: this.theater.render.height,
    });
    this.drawUnknownSurface();
    return true;
  }

  private surfaceContains(viewport: CameraState): boolean {
    if (Math.abs(viewport.scale - this.surface.scale) > 0.000_1) return false;
    const margin = PATTERN_CACHE_MARGIN_SCREEN_PIXELS / viewport.scale;
    return (
      viewport.left >= this.surface.left + margin &&
      viewport.top >= this.surface.top + margin &&
      viewport.right <= this.surface.right - margin &&
      viewport.bottom <= this.surface.bottom - margin
    );
  }

  private drawFog(
    graphics: Graphics,
    color: number,
    alpha: number,
    bounds: Pick<FogSurface, "left" | "top" | "right" | "bottom">,
  ): void {
    graphics
      .clear()
      .rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
      .fill({ color, alpha });
  }

  private drawGridMask(
    graphics: Graphics,
    cells: Uint32Array,
    setBounds: CellBounds | undefined,
  ): void {
    graphics.clear();
    const presentation = buildPresentationVisibilityRegionWithinBounds(
      cells,
      this.theater.semantic.width,
      this.theater.semantic.height,
      setBounds,
    );
    const { width, height } = presentation;
    const cellWidth =
      this.theater.render.width /
      (this.theater.semantic.width * PRESENTATION_VISIBILITY_SCALE);
    const cellHeight =
      this.theater.render.height /
      (this.theater.semantic.height * PRESENTATION_VISIBILITY_SCALE);
    let hasRuns = false;
    for (let row = 0; row < height; row += 1) {
      let column = 0;
      while (column < width) {
        const rowStart = row * width;
        if (presentation.cells[rowStart + column] === 0) {
          column += 1;
          continue;
        }
        const runStart = column;
        while (
          column < width &&
          presentation.cells[rowStart + column] !== 0
        ) {
          column += 1;
        }
        graphics.rect(
          (presentation.left + runStart) * cellWidth,
          (presentation.top + row) * cellHeight,
          (column - runStart) * cellWidth,
          cellHeight,
        );
        hasRuns = true;
      }
    }
    if (hasRuns) graphics.fill(0xffffff);
  }

  private drawUnknownSurface(): void {
    this.drawFog(this.unknownFog, UNKNOWN_FOG_COLOR, 1, {
      left: Math.min(0, this.surface.left),
      top: Math.min(0, this.surface.top),
      right: Math.max(this.theater.render.width, this.surface.right),
      bottom: Math.max(this.theater.render.height, this.surface.bottom),
    });
    this.drawUnknownPattern();
  }

  private distanceFromExplored(pointX: number, pointY: number): number {
    const column = Math.floor(
      (pointX / this.theater.render.width) * this.theater.semantic.width,
    );
    const row = Math.floor(
      (pointY / this.theater.render.height) * this.theater.semantic.height,
    );
    if (
      column < 0 ||
      row < 0 ||
      column >= this.theater.semantic.width ||
      row >= this.theater.semantic.height
    ) {
      return Number.POSITIVE_INFINITY;
    }
    const distance = exploredDistanceAt(this.exploredDistances, column, row);
    if (distance === DISTANCE_INFINITY) return Number.POSITIVE_INFINITY;
    const cellPixels =
      (this.theater.render.width / this.theater.semantic.width +
        this.theater.render.height / this.theater.semantic.height) /
      2;
    return (distance / ORTHOGONAL_DISTANCE) * cellPixels;
  }

  private drawUnknownPattern(): void {
    const graphics = this.unknownPattern.clear();
    const scale = Math.max(this.surface.scale, 0.000_1);
    const spacing = PATTERN_SPACING_SCREEN_PIXELS / scale;
    const pixel = 1 / scale;
    const firstColumn = Math.floor(this.surface.left / spacing);
    const lastColumn = Math.ceil(this.surface.right / spacing);
    const firstRow = Math.floor(this.surface.top / spacing);
    const lastRow = Math.ceil(this.surface.bottom / spacing);
    let markCount = 0;

    for (let row = firstRow; row <= lastRow; row += 1) {
      const rowOffset = (row & 1) * spacing * 0.5;
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const pointX = column * spacing + rowOffset;
        const pointY = row * spacing;
        const level = unknownPatternLevel(
          this.distanceFromExplored(pointX, pointY) * scale,
        );
        if (!shouldDrawPatternMark(level, row, column)) continue;

        graphics
          .rect(pointX, pointY + pixel * 2, pixel * 2, pixel)
          .rect(pointX + pixel * 2, pointY + pixel, pixel * 2, pixel)
          .rect(pointX + pixel * 4, pointY, pixel * 2, pixel);
        markCount += 1;
      }
    }
    if (markCount > 0) {
      graphics.fill({ color: 0x6a706d, alpha: 0.42 });
    }
  }
}
