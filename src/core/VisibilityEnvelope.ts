import {
  createGridBitset,
  gridBitIsSet,
  setGridBit,
} from "./GridBitset";
import type { GridCell } from "./WorldGrid";
import { GAMEPLAY_CONFIG } from "../config/GameConfig";

const envelope = GAMEPLAY_CONFIG.visibility.envelope;
export const VISIBILITY_NEAR_FIELD_METERS = envelope.nearFieldMeters;
export const VISIBILITY_MID_FIELD_METERS = envelope.midFieldMeters;
export const VISIBILITY_MID_SUPPORT_FRACTION = envelope.midSupportFraction;
export const VISIBILITY_FAR_SUPPORT_FRACTION = envelope.farSupportFraction;
export const MINIMUM_VISIBLE_COMPONENT_CELLS = envelope.minimumVisibleComponentCells;

export interface GridBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface VisibilityEnvelopeInput {
  readonly rawVisibleCells: Uint32Array;
  readonly observerSupport: Uint16Array;
  readonly protectedCells: Uint32Array;
  readonly width: number;
  readonly height: number;
  readonly cellSizeMeters: number;
  readonly observerCell: GridCell;
  readonly supportSampleCount: number;
  readonly bounds: GridBounds;
}

function dilateCross(
  cells: Uint32Array,
  width: number,
  height: number,
  bounds: GridBounds,
): Uint32Array {
  const result = createGridBitset(width * height);
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      const index = row * width + column;
      if (!gridBitIsSet(cells, index)) continue;
      setGridBit(result, index);
      if (column > 0) setGridBit(result, index - 1);
      if (column + 1 < width) setGridBit(result, index + 1);
      if (row > 0) setGridBit(result, index - width);
      if (row + 1 < height) setGridBit(result, index + width);
    }
  }
  return result;
}

function erodeCross(
  cells: Uint32Array,
  width: number,
  height: number,
  bounds: GridBounds,
): Uint32Array {
  const result = createGridBitset(width * height);
  const top = Math.max(1, bounds.top);
  const bottom = Math.min(height - 2, bounds.bottom);
  const left = Math.max(1, bounds.left);
  const right = Math.min(width - 2, bounds.right);
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const index = row * width + column;
      if (
        gridBitIsSet(cells, index) &&
        gridBitIsSet(cells, index - 1) &&
        gridBitIsSet(cells, index + 1) &&
        gridBitIsSet(cells, index - width) &&
        gridBitIsSet(cells, index + width)
      ) {
        setGridBit(result, index);
      }
    }
  }
  return result;
}

/** Fills single-cell holes and narrow cuts without blurring the pixel boundary. */
export function closeVisibilityMask(
  cells: Uint32Array,
  width: number,
  height: number,
  bounds: GridBounds,
): Uint32Array {
  return erodeCross(
    dilateCross(cells, width, height, bounds),
    width,
    height,
    bounds,
  );
}

/** Keeps meaningful visible regions and removes detached raster flecks. */
export function removeSmallVisibilityComponents(
  cells: Uint32Array,
  protectedCells: Uint32Array,
  width: number,
  height: number,
  bounds: GridBounds,
): Uint32Array {
  const cellCount = width * height;
  const visited = new Uint8Array(cellCount);
  const queue = new Int32Array(
    (bounds.right - bounds.left + 1) * (bounds.bottom - bounds.top + 1),
  );
  const result = createGridBitset(cellCount);

  for (let seedRow = bounds.top; seedRow <= bounds.bottom; seedRow += 1) {
    for (
      let seedColumn = bounds.left;
      seedColumn <= bounds.right;
      seedColumn += 1
    ) {
      const seed = seedRow * width + seedColumn;
      if (visited[seed] !== 0 || !gridBitIsSet(cells, seed)) continue;
      let head = 0;
      let tail = 1;
      let protectedComponent = gridBitIsSet(protectedCells, seed);
      queue[0] = seed;
      visited[seed] = 1;

      while (head < tail) {
        const index = queue[head] ?? 0;
        head += 1;
        const column = index % width;
        const row = Math.floor(index / width);
        for (let direction = 0; direction < 4; direction += 1) {
          if (
            (direction === 0 && row === bounds.top) ||
            (direction === 1 && column === bounds.left) ||
            (direction === 2 && column === bounds.right) ||
            (direction === 3 && row === bounds.bottom)
          ) {
            continue;
          }
          const neighborIndex =
            direction === 0
              ? index - width
              : direction === 1
                ? index - 1
                : direction === 2
                  ? index + 1
                  : index + width;
          if (
            visited[neighborIndex] !== 0 ||
            !gridBitIsSet(cells, neighborIndex)
          ) {
            continue;
          }
          visited[neighborIndex] = 1;
          queue[tail] = neighborIndex;
          tail += 1;
          protectedComponent ||= gridBitIsSet(protectedCells, neighborIndex);
        }
      }

      if (protectedComponent || tail >= MINIMUM_VISIBLE_COMPONENT_CELLS) {
        for (let index = 0; index < tail; index += 1) {
          setGridBit(result, queue[index] ?? 0);
        }
      }
    }
  }
  return result;
}

/** Converts strict physical LOS into the stable, art-directed gameplay mask. */
export function shapeVisibilityEnvelope(
  input: VisibilityEnvelopeInput,
): Uint32Array {
  const {
    rawVisibleCells,
    observerSupport,
    protectedCells,
    width,
    height,
    cellSizeMeters,
    observerCell,
    supportSampleCount,
    bounds,
  } = input;
  if (observerSupport.length !== width * height || supportSampleCount < 1) {
    throw new Error("Visibility envelope support does not match its grid");
  }

  const supported = createGridBitset(width * height);
  const midSupport = Math.max(
    1,
    Math.ceil(supportSampleCount * VISIBILITY_MID_SUPPORT_FRACTION),
  );
  const farSupport = Math.max(
    1,
    Math.ceil(supportSampleCount * VISIBILITY_FAR_SUPPORT_FRACTION),
  );
  const nearDistanceCells = VISIBILITY_NEAR_FIELD_METERS / cellSizeMeters;
  const midDistanceCells = VISIBILITY_MID_FIELD_METERS / cellSizeMeters;
  const nearDistanceSquared = nearDistanceCells * nearDistanceCells;
  const midDistanceSquared = midDistanceCells * midDistanceCells;

  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      const index = row * width + column;
      if (!gridBitIsSet(rawVisibleCells, index)) continue;
      const dx = column - observerCell.column;
      const dy = row - observerCell.row;
      const distanceSquared = dx * dx + dy * dy;
      const requiredSupport =
        distanceSquared <= nearDistanceSquared
          ? 0
          : distanceSquared <= midDistanceSquared
            ? midSupport
            : farSupport;
      if ((observerSupport[index] ?? 0) >= requiredSupport) {
        setGridBit(supported, index);
      }
    }
  }

  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      const index = row * width + column;
      if (gridBitIsSet(protectedCells, index)) setGridBit(supported, index);
    }
  }
  const closed = closeVisibilityMask(supported, width, height, bounds);
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      const index = row * width + column;
      if (gridBitIsSet(protectedCells, index)) setGridBit(closed, index);
    }
  }
  return removeSmallVisibilityComponents(
    closed,
    protectedCells,
    width,
    height,
    bounds,
  );
}
