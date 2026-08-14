import { Assets, Container, Sprite, type Texture } from "pixi.js";
import { PRESENTATION_CONFIG } from "../config/GameConfig";
import type { CameraState } from "./CameraController";
import type { TheaterLevel } from "./RegionalTheater";

interface Tile {
  readonly key: string;
  readonly path: string;
  readonly sprite: Sprite;
  lastUsed: number;
}

export interface TileRequest {
  readonly key: string;
  readonly level: TheaterLevel;
  readonly column: number;
  readonly row: number;
  readonly tileWorldWidth: number;
  readonly tileWorldHeight: number;
}

const VIEWPORT_HALO_TILES = PRESENTATION_CONFIG.performance.viewportHaloTiles;
const DEFAULT_WARM_TILE_LIMIT = PRESENTATION_CONFIG.performance.defaultWarmTileLimit;

export function levelForZoom(
  relativeZoom: number,
  levels: readonly TheaterLevel[],
  levelBias: number,
): TheaterLevel {
  const naturalLevel = Math.round(Math.log2(Math.max(1, relativeZoom)));
  const requestedLevel = Math.max(
    0,
    Math.min(levels.length - 1, naturalLevel + levelBias),
  );
  const level = levels[requestedLevel];
  if (!level) {
    throw new Error("Tile pyramid has no levels");
  }
  return level;
}

export function tileAssetPath(
  basePath: string,
  assetVersion: number,
  level: number,
  column: number,
  row: number,
): string {
  return `${basePath}/${level}/${column}_${row}.png?v=${assetVersion}`;
}

/** Returns the visible tiles plus a one-tile halo, nearest to the viewport centre first. */
export function tileRequestsForViewport(
  viewport: CameraState,
  worldWidth: number,
  worldHeight: number,
  tileSize: number,
  level: TheaterLevel,
): readonly TileRequest[] {
  const tileWorldWidth = (worldWidth / level.width) * tileSize;
  const tileWorldHeight = (worldHeight / level.height) * tileSize;
  const firstColumn = Math.max(
    0,
    Math.floor(viewport.left / tileWorldWidth) - VIEWPORT_HALO_TILES,
  );
  const lastColumn = Math.min(
    level.columns - 1,
    Math.floor((viewport.right - 1) / tileWorldWidth) + VIEWPORT_HALO_TILES,
  );
  const firstRow = Math.max(
    0,
    Math.floor(viewport.top / tileWorldHeight) - VIEWPORT_HALO_TILES,
  );
  const lastRow = Math.min(
    level.rows - 1,
    Math.floor((viewport.bottom - 1) / tileWorldHeight) + VIEWPORT_HALO_TILES,
  );
  const centerColumn = (viewport.left + viewport.right) / 2 / tileWorldWidth;
  const centerRow = (viewport.top + viewport.bottom) / 2 / tileWorldHeight;
  const requests: TileRequest[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      requests.push({
        key: `${level.level}:${column}:${row}`,
        level,
        column,
        row,
        tileWorldWidth,
        tileWorldHeight,
      });
    }
  }
  requests.sort((left, right) => {
    const leftDistance =
      (left.column + 0.5 - centerColumn) ** 2 +
      (left.row + 0.5 - centerRow) ** 2;
    const rightDistance =
      (right.column + 0.5 - centerColumn) ** 2 +
      (right.row + 0.5 - centerRow) ** 2;
    return (
      leftDistance - rightDistance ||
      left.row - right.row ||
      left.column - right.column
    );
  });
  return requests;
}

/**
 * Streams a bounded raster working set. Tiles arrive progressively, obsolete
 * requests dispose themselves, and a small warm LRU avoids pan-back churn.
 */
export class TilePyramidLayer {
  public readonly root = new Container();
  private readonly tiles = new Map<string, Tile>();
  private readonly pending = new Map<string, Promise<Tile | undefined>>();
  private required = new Set<string>();
  private generation = 0;
  private useCounter = 0;
  private destroyed = false;

  public constructor(
    private readonly basePath: string,
    private readonly worldWidth: number,
    private readonly worldHeight: number,
    private readonly tileSize: number,
    private readonly levels: readonly TheaterLevel[],
    private readonly requestRender: () => void,
    private readonly getLevelBias: () => number,
    private readonly assetVersion: number,
    private readonly warmTileLimit = DEFAULT_WARM_TILE_LIMIT,
  ) {}

  public async setViewport(viewport: CameraState): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.generation;
    const level = levelForZoom(
      viewport.relativeZoom,
      this.levels,
      this.getLevelBias(),
    );
    const requests = tileRequestsForViewport(
      viewport,
      this.worldWidth,
      this.worldHeight,
      this.tileSize,
      level,
    );
    this.required = new Set(requests.map(({ key }) => key));

    for (const request of requests) {
      const cached = this.tiles.get(request.key);
      if (cached) {
        cached.lastUsed = ++this.useCounter;
        cached.sprite.visible = true;
      }
    }

    const loads = requests
      .filter(({ key }) => !this.tiles.has(key))
      .map((request) =>
        this.loadTile(request).then((tile) => {
          if (!tile) return;
          if (this.destroyed) {
            this.disposeTile(tile);
            return;
          }
          if (generation !== this.generation) {
            if (!this.required.has(tile.key)) this.disposeTile(tile);
            return;
          }
          if (!this.required.has(tile.key)) {
            this.disposeTile(tile);
            return;
          }
          tile.lastUsed = ++this.useCounter;
          this.tiles.set(tile.key, tile);
          this.root.addChild(tile.sprite);
          this.requestRender();
        }),
      );

    await Promise.allSettled(loads);
    if (this.destroyed || generation !== this.generation) return;

    for (const [key, tile] of this.tiles) {
      tile.sprite.visible = this.required.has(key);
    }
    this.trimWarmCache();
    this.requestRender();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.required.clear();
    const paths = new Set([...this.tiles.values()].map((tile) => tile.path));
    this.tiles.clear();
    this.root.destroy({ children: true });
    for (const path of paths) void Assets.unload(path);
  }

  private loadTile(request: TileRequest): Promise<Tile | undefined> {
    const existing = this.pending.get(request.key);
    if (existing) return existing;
    const path = tileAssetPath(
      this.basePath,
      this.assetVersion,
      request.level.level,
      request.column,
      request.row,
    );
    const promise = Assets.load<Texture>(path)
      .then((texture): Tile | undefined => {
        texture.source.scaleMode = "nearest";
        const sprite = new Sprite(texture);
        sprite.position.set(
          request.column * request.tileWorldWidth,
          request.row * request.tileWorldHeight,
        );
        sprite.scale.set(
          request.tileWorldWidth / this.tileSize,
          request.tileWorldHeight / this.tileSize,
        );
        if (this.destroyed) {
          sprite.destroy();
          void Assets.unload(path);
          return undefined;
        }
        return { key: request.key, path, sprite, lastUsed: 0 };
      })
      .finally(() => {
        this.pending.delete(request.key);
      });
    this.pending.set(request.key, promise);
    return promise;
  }

  private trimWarmCache(): void {
    const warm = [...this.tiles.values()]
      .filter(({ key }) => !this.required.has(key))
      .sort((left, right) => left.lastUsed - right.lastUsed);
    const removeCount = Math.max(0, warm.length - this.warmTileLimit);
    for (let index = 0; index < removeCount; index += 1) {
      const tile = warm[index];
      if (!tile) continue;
      this.tiles.delete(tile.key);
      this.disposeTile(tile);
    }
  }

  private disposeTile(tile: Tile): void {
    if (tile.sprite.parent) tile.sprite.parent.removeChild(tile.sprite);
    tile.sprite.destroy();
    void Assets.unload(tile.path);
  }
}
