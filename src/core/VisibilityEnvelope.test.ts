import { describe, expect, it } from "vitest";
import { createGridBitset, gridBitIsSet, setGridBit } from "./GridBitset";
import {
  closeVisibilityMask,
  removeSmallVisibilityComponents,
  shapeVisibilityEnvelope,
} from "./VisibilityEnvelope";

function setSquare(
  cells: Uint32Array,
  support: Uint16Array,
  width: number,
  centerColumn: number,
  centerRow: number,
  supportValue: number,
): void {
  for (let row = centerRow - 8; row <= centerRow + 8; row += 1) {
    for (
      let column = centerColumn - 8;
      column <= centerColumn + 8;
      column += 1
    ) {
      const index = row * width + column;
      setGridBit(cells, index);
      support[index] = supportValue;
    }
  }
}

describe("art-directed visibility envelope", () => {
  it("fills a single-cell hole without producing a blurred boundary", () => {
    const width = 7;
    const cells = createGridBitset(width * width);
    for (let row = 2; row <= 4; row += 1) {
      for (let column = 2; column <= 4; column += 1) {
        if (row !== 3 || column !== 3) setGridBit(cells, row * width + column);
      }
    }

    const closed = closeVisibilityMask(cells, width, width, {
      left: 0,
      top: 0,
      right: width - 1,
      bottom: width - 1,
    });
    expect(gridBitIsSet(closed, 3 * width + 3)).toBe(true);
    expect(gridBitIsSet(closed, 1 * width + 1)).toBe(false);
  });

  it("removes floating flecks but preserves substantial or observer regions", () => {
    const width = 32;
    const height = 24;
    const cells = createGridBitset(width * height);
    const protectedCells = createGridBitset(width * height);
    setGridBit(cells, 2 * width + 2);
    setGridBit(protectedCells, 2 * width + 2);
    setGridBit(cells, 2 * width + 8);
    setGridBit(cells, 2 * width + 9);
    for (let row = 7; row < 23; row += 1) {
      for (let column = 5; column < 21; column += 1) {
        setGridBit(cells, row * width + column);
      }
    }

    const filtered = removeSmallVisibilityComponents(
      cells,
      protectedCells,
      width,
      height,
      { left: 0, top: 0, right: width - 1, bottom: height - 1 },
    );
    expect(gridBitIsSet(filtered, 2 * width + 2)).toBe(true);
    expect(gridBitIsSet(filtered, 2 * width + 8)).toBe(false);
    expect(gridBitIsSet(filtered, 7 * width + 5)).toBe(true);
  });

  it("requires stronger observer support as distance increases", () => {
    const width = 180;
    const height = 37;
    const rawVisibleCells = createGridBitset(width * height);
    const protectedCells = createGridBitset(width * height);
    const observerSupport = new Uint16Array(width * height);
    const observerCell = { column: 5, row: 18, index: 18 * width + 5 };
    setGridBit(protectedCells, observerCell.index);
    setGridBit(rawVisibleCells, observerCell.index);
    observerSupport[observerCell.index] = 360;
    setSquare(rawVisibleCells, observerSupport, width, 10, 18, 1);
    setSquare(rawVisibleCells, observerSupport, width, 35, 18, 35);
    setSquare(rawVisibleCells, observerSupport, width, 55, 18, 36);
    setSquare(rawVisibleCells, observerSupport, width, 85, 18, 89);
    setSquare(rawVisibleCells, observerSupport, width, 135, 18, 90);

    const shaped = shapeVisibilityEnvelope({
      rawVisibleCells,
      observerSupport,
      protectedCells,
      width,
      height,
      cellSizeMeters: 500,
      observerCell,
      supportSampleCount: 360,
      bounds: { left: 0, top: 0, right: width - 1, bottom: height - 1 },
    });
    expect(gridBitIsSet(shaped, 18 * width + 10)).toBe(true);
    expect(gridBitIsSet(shaped, 18 * width + 35)).toBe(false);
    expect(gridBitIsSet(shaped, 18 * width + 55)).toBe(true);
    expect(gridBitIsSet(shaped, 18 * width + 85)).toBe(false);
    expect(gridBitIsSet(shaped, 18 * width + 135)).toBe(true);
  });
});
