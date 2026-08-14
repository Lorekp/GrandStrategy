import { PRESENTATION_CONFIG } from "../config/GameConfig";
import type { WorldGridDefinition } from "../core/model";
import type { WorldGridCellSource } from "../core/WorldGrid";
import type { RegionalTheaterManifest, TheaterPoint } from "./RegionalTheater";
import { semanticCellIndex } from "./TheaterLandMask";

export interface SemanticCellSample {
  readonly cellIndex: number;
  readonly terrainCode: number;
  readonly vegetationCode: number;
  readonly moisture: number;
  readonly elevationMeters: number;
}

interface SemanticChunk {
  readonly column: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly vegetation: Uint8Array;
  readonly moisture: Uint8Array;
  readonly elevation: Int16Array;
  lastUsed: number;
}

const MAGIC = "GSSC";
const FORMAT_VERSION = 2;
const HEADER_BYTES = 16;
const DEFAULT_WARM_CHUNKS = PRESENTATION_CONFIG.performance.defaultWarmSemanticChunks;
const DENSE_LOAD_CONCURRENCY = PRESENTATION_CONFIG.performance.denseSemanticLoadConcurrency;

function ascii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}

function decodeChunk(
  buffer: ArrayBuffer,
  column: number,
  row: number,
): SemanticChunk {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < HEADER_BYTES ||
    ascii(view, 0, 4) !== MAGIC ||
    view.getUint16(4, true) !== FORMAT_VERSION
  ) {
    throw new Error("Unsupported semantic chunk");
  }
  const width = view.getUint16(8, true);
  const height = view.getUint16(10, true);
  const cellCount = width * height;
  const expectedBytes = HEADER_BYTES + cellCount * 5;
  if (width < 1 || height < 1 || buffer.byteLength !== expectedBytes) {
    throw new Error("Semantic chunk dimensions do not match its payload");
  }
  let offset = HEADER_BYTES;
  const terrain = new Uint8Array(buffer.slice(offset, offset + cellCount));
  offset += cellCount;
  const vegetation = new Uint8Array(buffer.slice(offset, offset + cellCount));
  offset += cellCount;
  const moisture = new Uint8Array(buffer.slice(offset, offset + cellCount));
  offset += cellCount;
  const elevation = new Int16Array(cellCount);
  for (let index = 0; index < cellCount; index += 1) {
    elevation[index] = view.getInt16(offset + index * 2, true);
  }
  return {
    column,
    row,
    width,
    height,
    terrain,
    vegetation,
    moisture,
    elevation,
    lastUsed: 0,
  };
}

/** Lazily loads fixed 32 km semantic chunks and can materialize one worker grid. */
export class SemanticChunkStore implements WorldGridCellSource {
  private readonly cached = new Map<string, SemanticChunk>();
  private readonly pending = new Map<string, Promise<SemanticChunk>>();
  private useCounter = 0;

  public constructor(
    private readonly theater: RegionalTheaterManifest,
    private readonly warmChunkLimit = DEFAULT_WARM_CHUNKS,
  ) {}

  public async sampleAt(
    point: TheaterPoint,
  ): Promise<SemanticCellSample | undefined> {
    const cellIndex = semanticCellIndex(
      point,
      this.theater.render.width,
      this.theater.render.height,
      this.theater.semantic.width,
      this.theater.semantic.height,
    );
    if (cellIndex === undefined) return undefined;
    const column = cellIndex % this.theater.semantic.width;
    const row = Math.floor(cellIndex / this.theater.semantic.width);
    const chunkColumn = Math.floor(column / this.theater.semantic.chunkSize);
    const chunkRow = Math.floor(row / this.theater.semantic.chunkSize);
    const chunk = await this.loadChunk(chunkColumn, chunkRow);
    const localColumn = column - chunkColumn * this.theater.semantic.chunkSize;
    const localRow = row - chunkRow * this.theater.semantic.chunkSize;
    const localIndex = localRow * chunk.width + localColumn;
    return {
      cellIndex,
      terrainCode: chunk.terrain[localIndex] ?? 0,
      vegetationCode: chunk.vegetation[localIndex] ?? 0,
      moisture: chunk.moisture[localIndex] ?? 0,
      elevationMeters: chunk.elevation[localIndex] ?? 0,
    };
  }

  public async prefetchCorridor(
    start: TheaterPoint,
    destination: TheaterPoint,
  ): Promise<void> {
    const scaleX = this.theater.semantic.width / this.theater.render.width;
    const scaleY = this.theater.semantic.height / this.theater.render.height;
    const startColumn = start.x * scaleX / this.theater.semantic.chunkSize;
    const startRow = start.y * scaleY / this.theater.semantic.chunkSize;
    const endColumn = destination.x * scaleX / this.theater.semantic.chunkSize;
    const endRow = destination.y * scaleY / this.theater.semantic.chunkSize;
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(endColumn - startColumn), Math.abs(endRow - startRow)) * 2),
    );
    const required = new Set<string>();
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      const centerColumn = Math.floor(startColumn + (endColumn - startColumn) * ratio);
      const centerRow = Math.floor(startRow + (endRow - startRow) * ratio);
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
          const column = centerColumn + columnOffset;
          const row = centerRow + rowOffset;
          if (
            column >= 0 &&
            row >= 0 &&
            column < this.theater.semantic.chunkColumns &&
            row < this.theater.semantic.chunkRows
          ) {
            required.add(`${column}:${row}`);
          }
        }
      }
    }
    const coordinates = [...required].map((key) => {
      const [column, row] = key.split(":").map(Number);
      return { column: column!, row: row! };
    });
    for (let start = 0; start < coordinates.length; start += DENSE_LOAD_CONCURRENCY) {
      await Promise.all(
        coordinates
          .slice(start, start + DENSE_LOAD_CONCURRENCY)
          .map(({ column, row }) => this.loadChunk(column, row)),
      );
    }
  }

  public terrainCodeAt(index: number): number {
    return this.cellValue(index, "terrain");
  }

  public vegetationCodeAt(index: number): number {
    return this.cellValue(index, "vegetation");
  }

  public elevationAt(index: number): number {
    return this.cellValue(index, "elevation");
  }

  public moistureAt(index: number): number {
    return this.cellValue(index, "moisture");
  }

  public riverCodeAt(_index: number): number {
    return 0;
  }

  public async toSimulationDefinition(): Promise<WorldGridDefinition> {
    const width = this.theater.semantic.width;
    const height = this.theater.semantic.height;
    const terrainCells = new Uint8Array(width * height);
    const vegetationCells = new Uint8Array(width * height);
    const moistureCells = new Uint8Array(width * height);
    const riverCells = new Uint8Array(width * height);
    const elevationMeters = new Int16Array(width * height);
    const coordinates: { column: number; row: number }[] = [];
    for (let row = 0; row < this.theater.semantic.chunkRows; row += 1) {
      for (let column = 0; column < this.theater.semantic.chunkColumns; column += 1) {
        coordinates.push({ column, row });
      }
    }
    for (let start = 0; start < coordinates.length; start += DENSE_LOAD_CONCURRENCY) {
      const batch = coordinates.slice(start, start + DENSE_LOAD_CONCURRENCY);
      const chunks = await Promise.all(
        batch.map(({ column, row }) => this.loadChunk(column, row)),
      );
      for (const chunk of chunks) {
        const left = chunk.column * this.theater.semantic.chunkSize;
        const top = chunk.row * this.theater.semantic.chunkSize;
        for (let localRow = 0; localRow < chunk.height; localRow += 1) {
          const sourceStart = localRow * chunk.width;
          const sourceEnd = sourceStart + chunk.width;
          const destinationStart = (top + localRow) * width + left;
          terrainCells.set(
            chunk.terrain.subarray(sourceStart, sourceEnd),
            destinationStart,
          );
          vegetationCells.set(
            chunk.vegetation.subarray(sourceStart, sourceEnd),
            destinationStart,
          );
          moistureCells.set(
            chunk.moisture.subarray(sourceStart, sourceEnd),
            destinationStart,
          );
          elevationMeters.set(
            chunk.elevation.subarray(sourceStart, sourceEnd),
            destinationStart,
          );
        }
      }
    }
    return {
      projectionDefinition: this.theater.projection.definition,
      extentWidthMeters: this.theater.extent.widthMeters,
      extentHeightMeters: this.theater.extent.heightMeters,
      width,
      height,
      terrainCells,
      vegetationCells,
      moistureCells,
      riverCells,
      elevationMeters,
    };
  }

  private async loadChunk(column: number, row: number): Promise<SemanticChunk> {
    const key = `${column}:${row}`;
    const cached = this.cached.get(key);
    if (cached) {
      cached.lastUsed = ++this.useCounter;
      return cached;
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = this.fetchChunk(column, row)
      .then((chunk) => {
        chunk.lastUsed = ++this.useCounter;
        this.cached.set(key, chunk);
        this.trimCache();
        return chunk;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private async fetchChunk(column: number, row: number): Promise<SemanticChunk> {
    const relativePath = this.theater.semantic.chunkPath
      .replace("{column}", String(column))
      .replace("{row}", String(row));
    const response = await fetch(
      `/maps/theaters/${this.theater.id}/${relativePath}?v=${this.theater.formatVersion}`,
    );
    if (!response.ok) {
      throw new Error(`Unable to load semantic chunk ${column}:${row}: ${response.status}`);
    }
    return decodeChunk(await response.arrayBuffer(), column, row);
  }

  private trimCache(): void {
    if (this.cached.size <= this.warmChunkLimit) return;
    const oldest = [...this.cached.entries()].sort(
      ([, left], [, right]) => left.lastUsed - right.lastUsed,
    );
    for (let index = 0; index < oldest.length - this.warmChunkLimit; index += 1) {
      const key = oldest[index]?.[0];
      if (key) this.cached.delete(key);
    }
  }

  private cellValue(
    index: number,
    field: "terrain" | "vegetation" | "moisture" | "elevation",
  ): number {
    if (index < 0 || index >= this.theater.semantic.width * this.theater.semantic.height) {
      throw new Error(`Semantic cell ${index} is outside the Theater`);
    }
    const column = index % this.theater.semantic.width;
    const row = Math.floor(index / this.theater.semantic.width);
    const chunkColumn = Math.floor(column / this.theater.semantic.chunkSize);
    const chunkRow = Math.floor(row / this.theater.semantic.chunkSize);
    const chunk = this.cached.get(`${chunkColumn}:${chunkRow}`);
    if (!chunk) {
      throw new Error(`Semantic chunk ${chunkColumn}:${chunkRow} was not prefetched`);
    }
    chunk.lastUsed = ++this.useCounter;
    const localColumn = column - chunkColumn * this.theater.semantic.chunkSize;
    const localRow = row - chunkRow * this.theater.semantic.chunkSize;
    return chunk[field][localRow * chunk.width + localColumn] ?? 0;
  }
}
