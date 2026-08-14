import proj4 from "proj4";
import type { GeographicPosition } from "../core/model";
import type { TheaterPoint } from "./RegionalTheater";

const BUCKET_DEGREES = 5;
const METERS_PER_LATITUDE_DEGREE = 111_132;
const METERS_PER_LONGITUDE_DEGREE = 111_320;

export interface TerrainCompositionPermille {
  readonly water: number;
  readonly plains: number;
  readonly hills: number;
  readonly mountains: number;
  readonly desert: number;
  readonly tundra: number;
  readonly ice: number;
}

export interface VegetationCompositionPermille {
  readonly forest: number;
  readonly jungle: number;
}

export interface TheaterCandidate {
  readonly index: number;
  readonly id: string;
  readonly center: GeographicPosition;
  readonly landRatioPermille: number;
  readonly terrainPermille: TerrainCompositionPermille;
  readonly vegetationPermille: VegetationCompositionPermille;
  readonly cultureId: string;
  readonly cultureName: string;
}

export interface GlobalTheaterCatalogManifest {
  readonly formatVersion: 5;
  readonly kind: "global-theater-catalog";
  readonly theaterExtentMeters: number;
  readonly centerSpacingMeters: number;
  readonly minimumLandRatioPermille: number;
  readonly candidateCount: number;
  readonly candidates: readonly TheaterCandidate[];
}

const TERRAIN_COMPOSITION_KEYS: readonly (keyof TerrainCompositionPermille)[] = [
  "water",
  "plains",
  "hills",
  "mountains",
  "desert",
  "tundra",
  "ice",
];

function validTerrainComposition(
  value: TerrainCompositionPermille | undefined,
): boolean {
  return Boolean(
    value &&
      TERRAIN_COMPOSITION_KEYS.every(
        (key) => Number.isInteger(value[key]) && value[key] >= 0,
      ) &&
      TERRAIN_COMPOSITION_KEYS.reduce((sum, key) => sum + value[key], 0) ===
        1_000,
  );
}

function validVegetationComposition(
  value: VegetationCompositionPermille | undefined,
  landRatioPermille: number,
): boolean {
  return Boolean(
    value &&
      Number.isInteger(value.forest) &&
      Number.isInteger(value.jungle) &&
      value.forest >= 0 &&
      value.jungle >= 0 &&
      value.forest + value.jungle <= landRatioPermille,
  );
}

function assertCatalogManifest(
  value: unknown,
): asserts value is GlobalTheaterCatalogManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Global Theater catalog is not an object");
  }
  const candidate = value as Partial<GlobalTheaterCatalogManifest>;
  if (
    candidate.formatVersion !== 5 ||
    candidate.kind !== "global-theater-catalog" ||
    !candidate.theaterExtentMeters ||
    !candidate.centerSpacingMeters ||
    candidate.centerSpacingMeters > candidate.theaterExtentMeters ||
    candidate.minimumLandRatioPermille !== 100 ||
    candidate.candidateCount !== candidate.candidates?.length ||
    !candidate.candidates ||
    candidate.candidates.some(
      (region, index) =>
        region.index !== index ||
        !region.id ||
        !region.center ||
        region.landRatioPermille <= candidate.minimumLandRatioPermille! ||
        !validTerrainComposition(region.terrainPermille) ||
        !validVegetationComposition(
          region.vegetationPermille,
          region.landRatioPermille,
        ) ||
        region.landRatioPermille !== 1_000 - region.terrainPermille.water ||
        !region.cultureId ||
        !region.cultureName,
    )
  ) {
    throw new Error("Global Theater catalog violates format version 5");
  }
}

export function parseGlobalTheaterCatalog(
  value: unknown,
): GlobalTheaterCatalogManifest {
  assertCatalogManifest(value);
  return value;
}

export async function loadGlobalTheaterCatalog(
  path: string,
): Promise<GlobalTheaterCatalogManifest> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Unable to load global Theater catalog: ${response.status}`);
  }
  return parseGlobalTheaterCatalog(await response.json());
}

export function geographicToAtlas(
  position: GeographicPosition,
  atlasWidth: number,
  atlasHeight: number,
): TheaterPoint {
  return {
    x: ((position.longitudeE6 / 1_000_000 + 180) / 360) * atlasWidth,
    y: ((90 - position.latitudeE6 / 1_000_000) / 180) * atlasHeight,
  };
}

export function atlasToGeographic(
  point: TheaterPoint,
  atlasWidth: number,
  atlasHeight: number,
): GeographicPosition {
  return {
    longitudeE6: Math.round((point.x / atlasWidth * 360 - 180) * 1_000_000),
    latitudeE6: Math.round((90 - point.y / atlasHeight * 180) * 1_000_000),
  };
}

function normalizedLongitudeDelta(longitude: number, origin: number): number {
  let delta = longitude - origin;
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  return delta;
}

function localOffsetMeters(
  position: GeographicPosition,
  center: GeographicPosition,
): { readonly east: number; readonly north: number } {
  const longitude = position.longitudeE6 / 1_000_000;
  const latitude = position.latitudeE6 / 1_000_000;
  const centerLongitude = center.longitudeE6 / 1_000_000;
  const centerLatitude = center.latitudeE6 / 1_000_000;
  const meanLatitudeRadians = ((latitude + centerLatitude) / 2) * Math.PI / 180;
  return {
    east:
      normalizedLongitudeDelta(longitude, centerLongitude) *
      METERS_PER_LONGITUDE_DEGREE *
      Math.max(0.05, Math.cos(meanLatitudeRadians)),
    north: (latitude - centerLatitude) * METERS_PER_LATITUDE_DEGREE,
  };
}

function bucketKey(longitude: number, latitude: number): string {
  const column = Math.floor((longitude + 180) / BUCKET_DEGREES);
  const row = Math.floor((latitude + 90) / BUCKET_DEGREES);
  return `${column}:${row}`;
}

function neighboringBucketKeys(position: GeographicPosition): string[] {
  const longitude = position.longitudeE6 / 1_000_000;
  const latitude = position.latitudeE6 / 1_000_000;
  const centerColumn = Math.floor((longitude + 180) / BUCKET_DEGREES);
  const centerRow = Math.floor((latitude + 90) / BUCKET_DEGREES);
  const keys: string[] = [];
  for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
    for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
      const column = (centerColumn + columnOffset + 72) % 72;
      keys.push(`${column}:${centerRow + rowOffset}`);
    }
  }
  return keys;
}

export function candidateProjectionDefinition(
  candidate: TheaterCandidate,
): string {
  return `+proj=aeqd +lat_0=${candidate.center.latitudeE6 / 1_000_000} +lon_0=${candidate.center.longitudeE6 / 1_000_000} +ellps=WGS84 +units=m +no_defs`;
}

/** Spatially indexes the global catalog; pointer lookup never scans all regions. */
export class GlobalTheaterCatalog {
  public readonly candidates: readonly TheaterCandidate[];
  public readonly theaterExtentMeters: number;
  private readonly buckets = new Map<string, TheaterCandidate[]>();

  public constructor(manifest: GlobalTheaterCatalogManifest) {
    this.candidates = manifest.candidates;
    this.theaterExtentMeters = manifest.theaterExtentMeters;
    for (const candidate of this.candidates) {
      const longitude = candidate.center.longitudeE6 / 1_000_000;
      const latitude = candidate.center.latitudeE6 / 1_000_000;
      const key = bucketKey(longitude, latitude);
      const bucket = this.buckets.get(key);
      if (bucket) {
        bucket.push(candidate);
      } else {
        this.buckets.set(key, [candidate]);
      }
    }
  }

  public candidateAt(
    point: TheaterPoint,
    atlasWidth: number,
    atlasHeight: number,
  ): TheaterCandidate | undefined {
    const position = atlasToGeographic(point, atlasWidth, atlasHeight);
    const halfExtent = this.theaterExtentMeters / 2;
    let nearest: TheaterCandidate | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const key of neighboringBucketKeys(position)) {
      for (const candidate of this.buckets.get(key) ?? []) {
        const offset = localOffsetMeters(position, candidate.center);
        if (Math.abs(offset.east) > halfExtent || Math.abs(offset.north) > halfExtent) {
          continue;
        }
        const distance = offset.east * offset.east + offset.north * offset.north;
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      }
    }
    return nearest;
  }

  public rerollNeighbor(
    current: TheaterCandidate,
    randomValue: number,
    accepts: (candidate: TheaterCandidate) => boolean = () => true,
  ): TheaterCandidate {
    const neighbors: { candidate: TheaterCandidate; distance: number }[] = [];
    for (const key of neighboringBucketKeys(current.center)) {
      for (const candidate of this.buckets.get(key) ?? []) {
        if (candidate.id === current.id || !accepts(candidate)) {
          continue;
        }
        const offset = localOffsetMeters(candidate.center, current.center);
        const distance = Math.hypot(offset.east, offset.north);
        if (distance <= this.theaterExtentMeters * 1.35) {
          neighbors.push({ candidate, distance });
        }
      }
    }
    neighbors.sort((left, right) => left.distance - right.distance || left.candidate.id.localeCompare(right.candidate.id));
    if (neighbors.length === 0) {
      return current;
    }
    return neighbors[Math.floor(randomValue * neighbors.length) % neighbors.length]!.candidate;
  }
}

export function theaterFootprint(
  candidate: TheaterCandidate,
  extentMeters: number,
  atlasWidth: number,
  atlasHeight: number,
  samplesPerEdge = 24,
): readonly TheaterPoint[] {
  const projection = proj4("EPSG:4326", candidateProjectionDefinition(candidate));
  const half = extentMeters / 2;
  const localPoints: [number, number][] = [];
  for (let index = 0; index < samplesPerEdge; index += 1) {
    const offset = -half + (index / samplesPerEdge) * extentMeters;
    localPoints.push([offset, half]);
  }
  for (let index = 0; index < samplesPerEdge; index += 1) {
    localPoints.push([half, half - (index / samplesPerEdge) * extentMeters]);
  }
  for (let index = 0; index < samplesPerEdge; index += 1) {
    localPoints.push([half - (index / samplesPerEdge) * extentMeters, -half]);
  }
  for (let index = 0; index < samplesPerEdge; index += 1) {
    const offset = -half + (index / samplesPerEdge) * extentMeters;
    localPoints.push([-half, offset]);
  }
  const centerX = geographicToAtlas(candidate.center, atlasWidth, atlasHeight).x;
  return localPoints.map((localPoint) => {
    const [longitude, latitude] = projection.inverse(localPoint);
    const result = geographicToAtlas(
      {
        longitudeE6: Math.round(longitude * 1_000_000),
        latitudeE6: Math.round(latitude * 1_000_000),
      },
      atlasWidth,
      atlasHeight,
    );
    let x = result.x;
    while (x - centerX > atlasWidth / 2) {
      x -= atlasWidth;
    }
    while (x - centerX < -atlasWidth / 2) {
      x += atlasWidth;
    }
    return { x, y: result.y };
  });
}
