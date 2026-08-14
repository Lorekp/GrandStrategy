import type { TheaterPoint } from "./RegionalTheater";

export interface CulturePresentationField {
  readonly width: number;
  readonly height: number;
  /** Culture index per sample; 255 is reserved for uninhabited geography. */
  readonly cultureIndices: Uint8Array;
  /** Positive score advantage of each winning Culture Field over its runner-up. */
  readonly winningMargins: Float32Array;
}

export interface CulturePresentationSample {
  readonly cultureIndex: number;
  readonly winningMargin: number;
}

export interface AdaptiveCultureIndexField {
  readonly width: number;
  readonly height: number;
  /** One categorical culture index per semantic land cell. */
  readonly cultureIndices: Uint8Array;
  /** Number of expensive geographic classifications used to build the field. */
  readonly sampleCount: number;
}

export interface CultureBoundarySegment {
  readonly start: TheaterPoint;
  readonly end: TheaterPoint;
}

const MAX_CULTURE_TEXTURE_EDGE = 4_096;

export function cultureIndexFieldDimensions(
  renderWidth: number,
  renderHeight: number,
): { readonly width: number; readonly height: number } {
  if (
    !Number.isInteger(renderWidth) ||
    !Number.isInteger(renderHeight) ||
    renderWidth < 1 ||
    renderHeight < 1
  ) {
    throw new Error("Culture field render dimensions must be positive integers");
  }
  const scale = Math.min(
    1,
    MAX_CULTURE_TEXTURE_EDGE / Math.max(renderWidth, renderHeight),
  );
  return {
    width: Math.max(4, Math.floor(renderWidth * scale / 4) * 4),
    height: Math.max(1, Math.round(renderHeight * scale)),
  };
}

export function encodeCultureIndex(cultureIndex: number): number {
  return cultureIndex >= 0 && cultureIndex < 255 ? cultureIndex : 255;
}

export function buildCulturePresentationField(
  width: number,
  height: number,
  sample: (column: number, row: number) => CulturePresentationSample,
): CulturePresentationField {
  if (width < 2 || height < 2) {
    throw new Error("Culture margin field must contain at least two samples per edge");
  }
  const cultureIndices = new Uint8Array(width * height);
  const winningMargins = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const cell = row * width + column;
      const classification = sample(column, row);
      cultureIndices[cell] = encodeCultureIndex(classification.cultureIndex);
      winningMargins[cell] = Number.isFinite(classification.winningMargin)
        ? Math.max(0, classification.winningMargin)
        : 0;
    }
  }
  return { width, height, cultureIndices, winningMargins };
}

/**
 * Builds a full semantic-resolution categorical field while only evaluating
 * the low-frequency Culture Field densely near boundaries. Uniform areas are
 * filled in blocks, so texture resolution does not dictate classification cost.
 */
export function buildAdaptiveCultureIndexField(
  width: number,
  height: number,
  sample: (column: number, row: number) => number,
  maximumUniformSpan = 32,
): AdaptiveCultureIndexField {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isInteger(maximumUniformSpan) ||
    maximumUniformSpan < 1
  ) {
    throw new Error("Adaptive culture field dimensions must be positive integers");
  }

  const cultureIndices = new Uint8Array(width * height);
  const sampled = new Map<number, number>();
  let sampleCount = 0;

  const sampleAt = (column: number, row: number): number => {
    const cell = row * width + column;
    const cached = sampled.get(cell);
    if (cached !== undefined) return cached;
    const cultureIndex = encodeCultureIndex(sample(column, row));
    sampled.set(cell, cultureIndex);
    sampleCount += 1;
    return cultureIndex;
  };

  const fill = (
    left: number,
    top: number,
    right: number,
    bottom: number,
    cultureIndex: number,
  ): void => {
    for (let row = top; row < bottom; row += 1) {
      cultureIndices.fill(
        cultureIndex,
        row * width + left,
        row * width + right,
      );
    }
  };

  const visit = (
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void => {
    const blockWidth = right - left;
    const blockHeight = bottom - top;
    const middleColumn = left + Math.floor((blockWidth - 1) / 2);
    const middleRow = top + Math.floor((blockHeight - 1) / 2);
    const columns = [left, middleColumn, right - 1];
    const rows = [top, middleRow, bottom - 1];
    const firstCultureIndex = sampleAt(left, top);
    let uniform = true;
    let previousRow = -1;
    for (const row of rows) {
      if (row === previousRow) continue;
      previousRow = row;
      let previousColumn = -1;
      for (const column of columns) {
        if (column === previousColumn) continue;
        previousColumn = column;
        if (sampleAt(column, row) !== firstCultureIndex) uniform = false;
      }
    }

    if (
      uniform &&
      blockWidth <= maximumUniformSpan &&
      blockHeight <= maximumUniformSpan
    ) {
      fill(left, top, right, bottom, firstCultureIndex);
      return;
    }
    if (blockWidth === 1 && blockHeight === 1) {
      cultureIndices[top * width + left] = firstCultureIndex;
      return;
    }

    const splitColumn = left + Math.ceil(blockWidth / 2);
    const splitRow = top + Math.ceil(blockHeight / 2);
    if (top < splitRow && left < splitColumn) {
      visit(left, top, splitColumn, splitRow);
    }
    if (top < splitRow && splitColumn < right) {
      visit(splitColumn, top, right, splitRow);
    }
    if (splitRow < bottom && left < splitColumn) {
      visit(left, splitRow, splitColumn, bottom);
    }
    if (splitRow < bottom && splitColumn < right) {
      visit(splitColumn, splitRow, right, bottom);
    }
  };

  visit(0, 0, width, height);
  return { width, height, cultureIndices, sampleCount };
}

/** Multi-label marching squares: every adjacent Culture Field gets a delimiter. */
export function cultureBoundarySegments(
  field: CulturePresentationField,
  theaterWidth: number,
  theaterHeight: number,
): readonly CultureBoundarySegment[] {
  const segments: CultureBoundarySegment[] = [];
  const xScale = theaterWidth / (field.width - 1);
  const yScale = theaterHeight / (field.height - 1);
  const crossingAmount = (first: number, second: number): number => {
    const total = first + second;
    return total > 1e-12 ? first / total : 0.5;
  };
  for (let row = 0; row < field.height - 1; row += 1) {
    for (let column = 0; column < field.width - 1; column += 1) {
      const topLeftCell = row * field.width + column;
      const topRightCell = topLeftCell + 1;
      const bottomLeftCell = (row + 1) * field.width + column;
      const bottomRightCell = bottomLeftCell + 1;
      const topLeft = field.cultureIndices[topLeftCell]!;
      const topRight = field.cultureIndices[topRightCell]!;
      const bottomLeft = field.cultureIndices[bottomLeftCell]!;
      const bottomRight = field.cultureIndices[bottomRightCell]!;
      const edges = new Map<number, TheaterPoint>();
      if (topLeft !== topRight) {
        const crossing = crossingAmount(
          field.winningMargins[topLeftCell]!,
          field.winningMargins[topRightCell]!,
        );
        edges.set(0, {
          x: (column + crossing) * xScale,
          y: row * yScale,
        });
      }
      if (topRight !== bottomRight) {
        const crossing = crossingAmount(
          field.winningMargins[topRightCell]!,
          field.winningMargins[bottomRightCell]!,
        );
        edges.set(1, {
          x: (column + 1) * xScale,
          y: (row + crossing) * yScale,
        });
      }
      if (bottomLeft !== bottomRight) {
        const crossing = crossingAmount(
          field.winningMargins[bottomLeftCell]!,
          field.winningMargins[bottomRightCell]!,
        );
        edges.set(2, {
          x: (column + crossing) * xScale,
          y: (row + 1) * yScale,
        });
      }
      if (topLeft !== bottomLeft) {
        const crossing = crossingAmount(
          field.winningMargins[topLeftCell]!,
          field.winningMargins[bottomLeftCell]!,
        );
        edges.set(3, {
          x: column * xScale,
          y: (row + crossing) * yScale,
        });
      }
      const edgeNumbers = [...edges.keys()];
      if (edgeNumbers.length === 2) {
        segments.push({
          start: edges.get(edgeNumbers[0]!)!,
          end: edges.get(edgeNumbers[1]!)!,
        });
      } else if (edgeNumbers.length >= 3) {
        const crossings = edgeNumbers.map((edge) => edges.get(edge)!);
        const center = crossings.reduce(
          (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
          { x: 0, y: 0 },
        );
        const junction = {
          x: center.x / crossings.length,
          y: center.y / crossings.length,
        };
        for (const edge of edgeNumbers) {
          segments.push({ start: edges.get(edge)!, end: junction });
        }
      }
    }
  }
  return segments;
}
