export function bitsetWordLength(cellCount: number): number {
  if (!Number.isInteger(cellCount) || cellCount < 0) {
    throw new Error("Bitset cell count must be a non-negative integer");
  }
  return Math.ceil(cellCount / 32);
}

export function createGridBitset(cellCount: number): Uint32Array {
  return new Uint32Array(bitsetWordLength(cellCount));
}

export function assertGridBitsetLength(
  cells: Uint32Array,
  cellCount: number,
  label: string,
): void {
  const expected = bitsetWordLength(cellCount);
  if (cells.length !== expected) {
    throw new Error(`${label} has ${cells.length} words; expected ${expected}`);
  }
}

export function gridBitIsSet(cells: Uint32Array, index: number): boolean {
  const word = cells[index >>> 5];
  return word !== undefined && (word & (1 << (index & 31))) !== 0;
}

export function setGridBit(cells: Uint32Array, index: number): boolean {
  const wordIndex = index >>> 5;
  const previous = cells[wordIndex];
  if (previous === undefined) {
    throw new Error(`Grid bit index ${index} is out of bounds`);
  }
  const next = previous | (1 << (index & 31));
  cells[wordIndex] = next;
  return next !== previous;
}

export function orGridBitsets(
  destination: Uint32Array,
  source: Uint32Array,
): boolean {
  if (destination.length !== source.length) {
    throw new Error("Cannot union grid bitsets with different lengths");
  }
  let changed = false;
  for (let index = 0; index < destination.length; index += 1) {
    const previous = destination[index] ?? 0;
    const next = previous | (source[index] ?? 0);
    destination[index] = next;
    changed ||= next !== previous;
  }
  return changed;
}
