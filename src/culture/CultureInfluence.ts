import proj4 from "proj4";
import { GAMEPLAY_CONFIG } from "../config/GameConfig";
import type { GeographicPosition } from "../core/model";

const EARTH_RADIUS_KM = GAMEPLAY_CONFIG.world.earthMeanRadiusMeters / 1_000;
const UNINHABITED_SOUTH_LATITUDE = GAMEPLAY_CONFIG.world.minimumInhabitedLatitude;

export interface CultureInfluenceAnchor {
  readonly longitudeE6: number;
  readonly latitudeE6: number;
  readonly radiusKm: number;
  readonly weight: number;
}

export interface RegionalCulture {
  readonly id: string;
  readonly displayName: string;
  readonly anchors: readonly CultureInfluenceAnchor[];
}

export interface CultureInfluenceManifest {
  readonly formatVersion: 1;
  readonly coordinateSystem: "WGS84";
  readonly kind: "regional-culture-influence-anchors";
  readonly cultures: readonly RegionalCulture[];
}

export interface CultureOverlap {
  readonly cultureId: string;
  readonly landSamples: number;
  readonly matchingLandSamples: number;
  readonly landSharePermille: number;
  readonly direction: CultureOverlapDirection;
}

export type CultureOverlapDirection =
  | "central"
  | "west"
  | "east"
  | "north"
  | "south"
  | "north-west"
  | "north-east"
  | "south-west"
  | "south-east"
  | "outside";

export interface SelectedCultureClassification {
  readonly cultureIndex: number;
  readonly margin: number;
}

export interface CultureClassification {
  readonly cultureIndex: number;
  /** Positive score advantage over the runner-up Culture Field. */
  readonly winningMargin: number;
}

interface PreparedAnchor {
  readonly cultureIndex: number;
  readonly longitudeRadians: number;
  readonly latitudeRadians: number;
  readonly sinLatitude: number;
  readonly cosLatitude: number;
  readonly influenceKm: number;
  readonly influenceRadians: number;
}

function isFiniteInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number.isFinite(value);
}

export function parseCultureInfluenceManifest(
  value: unknown,
): CultureInfluenceManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Culture influence manifest must be an object");
  }
  const manifest = value as Partial<CultureInfluenceManifest>;
  if (
    manifest.formatVersion !== 1 ||
    manifest.coordinateSystem !== "WGS84" ||
    manifest.kind !== "regional-culture-influence-anchors" ||
    !Array.isArray(manifest.cultures) ||
    manifest.cultures.length === 0
  ) {
    throw new Error("Unsupported culture influence manifest");
  }

  const ids = new Set<string>();
  for (const culture of manifest.cultures) {
    if (
      !culture ||
      typeof culture.id !== "string" ||
      culture.id.length === 0 ||
      typeof culture.displayName !== "string" ||
      culture.displayName.length === 0 ||
      ids.has(culture.id) ||
      !Array.isArray(culture.anchors) ||
      culture.anchors.length === 0 ||
      culture.anchors.some(
        (anchor: CultureInfluenceAnchor) =>
          !isFiniteInteger(anchor.longitudeE6) ||
          anchor.longitudeE6 < -180_000_000 ||
          anchor.longitudeE6 > 180_000_000 ||
          !isFiniteInteger(anchor.latitudeE6) ||
          anchor.latitudeE6 < -90_000_000 ||
          anchor.latitudeE6 > 90_000_000 ||
          !Number.isFinite(anchor.radiusKm) ||
          anchor.radiusKm <= 0 ||
          !Number.isFinite(anchor.weight) ||
          anchor.weight <= 0,
      )
    ) {
      throw new Error("Culture influence manifest contains invalid cultures");
    }
    ids.add(culture.id);
  }
  return manifest as CultureInfluenceManifest;
}

export async function loadCultureInfluenceManifest(
  path: string,
): Promise<CultureInfluenceManifest> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Culture influence failed to load (${response.status})`);
  }
  return parseCultureInfluenceManifest(await response.json());
}

function normalizedLongitudeRadians(delta: number): number {
  if (delta > Math.PI) return delta - Math.PI * 2;
  if (delta < -Math.PI) return delta + Math.PI * 2;
  return delta;
}

function overlapDirection(
  eastMeters: number,
  northMeters: number,
  extent: number,
): CultureOverlapDirection {
  const threshold = extent * 0.12;
  const horizontal = Math.abs(eastMeters) < threshold
    ? ""
    : eastMeters < 0
      ? "west"
      : "east";
  const vertical = Math.abs(northMeters) < threshold
    ? ""
    : northMeters < 0
      ? "south"
      : "north";
  if (!horizontal && !vertical) return "central";
  if (horizontal && vertical) {
    return `${vertical}-${horizontal}` as CultureOverlapDirection;
  }
  return (horizontal || vertical) as CultureOverlapDirection;
}

/** Deterministic nearest-normalized-anchor field shared by UI and spawn rules. */
export class CultureInfluenceField {
  public readonly cultures: readonly RegionalCulture[];
  private readonly anchors: readonly PreparedAnchor[];
  private readonly cultureIndexById = new Map<string, number>();

  public constructor(manifest: CultureInfluenceManifest) {
    this.cultures = manifest.cultures;
    const anchors: PreparedAnchor[] = [];
    for (let cultureIndex = 0; cultureIndex < this.cultures.length; cultureIndex += 1) {
      const culture = this.cultures[cultureIndex]!;
      this.cultureIndexById.set(culture.id, cultureIndex);
      for (const anchor of culture.anchors) {
        const latitudeRadians = anchor.latitudeE6 / 1_000_000 * Math.PI / 180;
        const influenceKm = anchor.radiusKm * anchor.weight;
        anchors.push({
          cultureIndex,
          longitudeRadians: anchor.longitudeE6 / 1_000_000 * Math.PI / 180,
          latitudeRadians,
          sinLatitude: Math.sin(latitudeRadians),
          cosLatitude: Math.cos(latitudeRadians),
          influenceKm,
          influenceRadians: influenceKm / EARTH_RADIUS_KM,
        });
      }
    }
    this.anchors = anchors;
  }

  public cultureById(id: string): RegionalCulture | undefined {
    const index = this.cultureIndexById.get(id);
    return index === undefined ? undefined : this.cultures[index];
  }

  public indexOfCulture(id: string): number {
    const index = this.cultureIndexById.get(id);
    if (index === undefined) {
      throw new Error(`Unknown regional culture ${id}`);
    }
    return index;
  }

  public cultureAt(position: GeographicPosition): RegionalCulture | undefined {
    const classification = this.classifyCulture(position);
    return classification.cultureIndex < 0
      ? undefined
      : this.cultures[classification.cultureIndex];
  }

  /** Resolves the winning Culture Field and its advantage over the runner-up. */
  public classifyCulture(position: GeographicPosition): CultureClassification {
    const latitude = position.latitudeE6 / 1_000_000;
    if (latitude < UNINHABITED_SOUTH_LATITUDE) {
      return { cultureIndex: -1, winningMargin: 0 };
    }
    const latitudeRadians = latitude * Math.PI / 180;
    const longitudeRadians = position.longitudeE6 / 1_000_000 * Math.PI / 180;
    const sinLatitude = Math.sin(latitudeRadians);
    const cosLatitude = Math.cos(latitudeRadians);
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    let secondIndex = -1;
    let secondScore = Number.POSITIVE_INFINITY;
    let currentCultureIndex = -1;
    let currentCultureScore = Number.POSITIVE_INFINITY;
    for (let anchorIndex = 0; anchorIndex <= this.anchors.length; anchorIndex += 1) {
      const anchor = this.anchors[anchorIndex];
      if (!anchor || anchor.cultureIndex !== currentCultureIndex) {
        if (currentCultureIndex >= 0) {
          const cultureId = this.cultures[currentCultureIndex]!.id;
          const bestCultureId = bestIndex < 0
            ? ""
            : this.cultures[bestIndex]!.id;
          if (
            currentCultureScore < bestScore - 1e-12 ||
            (Math.abs(currentCultureScore - bestScore) <= 1e-12 &&
              cultureId < bestCultureId)
          ) {
            secondIndex = bestIndex;
            secondScore = bestScore;
            bestIndex = currentCultureIndex;
            bestScore = currentCultureScore;
          } else {
            const secondCultureId = secondIndex < 0
              ? ""
              : this.cultures[secondIndex]!.id;
            if (
              currentCultureScore < secondScore - 1e-12 ||
              (Math.abs(currentCultureScore - secondScore) <= 1e-12 &&
                cultureId < secondCultureId)
            ) {
              secondIndex = currentCultureIndex;
              secondScore = currentCultureScore;
            }
          }
        }
        if (!anchor) break;
        currentCultureIndex = anchor.cultureIndex;
        currentCultureScore = Number.POSITIVE_INFINITY;
      }
      const longitudeDelta = normalizedLongitudeRadians(
        longitudeRadians - anchor.longitudeRadians,
      );
      const cosine = Math.min(
        1,
        Math.max(
          -1,
          sinLatitude * anchor.sinLatitude +
            cosLatitude * anchor.cosLatitude * Math.cos(longitudeDelta),
        ),
      );
      const score = Math.acos(cosine) * EARTH_RADIUS_KM / anchor.influenceKm;
      currentCultureScore = Math.min(currentCultureScore, score);
    }
    const margin = secondScore - bestScore;
    return {
      cultureIndex: bestIndex,
      winningMargin: Number.isFinite(margin) ? Math.max(1e-12, margin) : 0,
    };
  }

  /**
   * Positive inside the selected Culture Field, negative outside it. The zero
   * contour is presentation geometry; authoritative founding still calls
   * cultureAt at the exact clicked position.
   */
  public cultureMarginAt(
    position: GeographicPosition,
    selectedCultureId: string,
  ): number {
    return this.classifyForSelectedCulture(position, selectedCultureId).margin;
  }

  /** Scores one sample once for both colored ownership and selected contour. */
  public classifyForSelectedCulture(
    position: GeographicPosition,
    selectedCultureId: string,
  ): SelectedCultureClassification {
    const selectedIndex = this.indexOfCulture(selectedCultureId);
    const latitude = position.latitudeE6 / 1_000_000;
    if (latitude < UNINHABITED_SOUTH_LATITUDE) {
      return {
        cultureIndex: -1,
        margin: Number.NEGATIVE_INFINITY,
      };
    }
    const latitudeRadians = latitude * Math.PI / 180;
    const longitudeRadians = position.longitudeE6 / 1_000_000 * Math.PI / 180;
    const sinLatitude = Math.sin(latitudeRadians);
    const cosLatitude = Math.cos(latitudeRadians);
    let selectedScore = Number.POSITIVE_INFINITY;
    let otherScore = Number.POSITIVE_INFINITY;
    let otherCultureIndex = -1;
    let otherCultureId = "";
    for (const anchor of this.anchors) {
      const longitudeDelta = normalizedLongitudeRadians(
        longitudeRadians - anchor.longitudeRadians,
      );
      const cosine = Math.min(
        1,
        Math.max(
          -1,
          sinLatitude * anchor.sinLatitude +
            cosLatitude * anchor.cosLatitude * Math.cos(longitudeDelta),
        ),
      );
      const score =
        Math.acos(cosine) * EARTH_RADIUS_KM / anchor.influenceKm;
      if (anchor.cultureIndex === selectedIndex) {
        selectedScore = Math.min(selectedScore, score);
        continue;
      }
      const cultureId = this.cultures[anchor.cultureIndex]!.id;
      if (
        score < otherScore - 1e-12 ||
        (Math.abs(score - otherScore) <= 1e-12 &&
          cultureId < otherCultureId)
      ) {
        otherScore = score;
        otherCultureIndex = anchor.cultureIndex;
        otherCultureId = cultureId;
      }
    }
    const margin = otherScore - selectedScore;
    const resolvedMargin = Math.abs(margin) > 1e-12
      ? margin
      : selectedCultureId < otherCultureId
        ? 1e-12
        : -1e-12;
    return {
      cultureIndex: resolvedMargin >= 0 ? selectedIndex : otherCultureIndex,
      margin: resolvedMargin,
    };
  }

  /** Builds the low-frequency display field once; exact lookups remain authoritative. */
  public rasterize(width: number, height: number, landAlpha: Uint8Array): Uint8Array {
    if (landAlpha.length !== width * height) {
      throw new Error("Culture raster land mask dimensions do not match");
    }
    const result = new Uint8Array(width * height);
    result.fill(255);
    for (let y = 0; y < height; y += 1) {
      const latitude = 90 - (y + 0.5) / height * 180;
      if (latitude < UNINHABITED_SOUTH_LATITUDE) continue;
      const latitudeRadians = latitude * Math.PI / 180;
      const cosLatitude = Math.cos(latitudeRadians);
      for (let x = 0; x < width; x += 1) {
        const cell = y * width + x;
        if (landAlpha[cell]! < 128) continue;
        const longitudeRadians = ((x + 0.5) / width * 360 - 180) * Math.PI / 180;
        const bestIndex = this.approximateCultureIndex(
          longitudeRadians,
          latitudeRadians,
          cosLatitude,
        );
        if (bestIndex >= 0) result[cell] = bestIndex;
      }
    }
    return result;
  }

  public overlap(
    center: GeographicPosition,
    extentMeters: number,
    cultureId: string,
    isLand: (position: GeographicPosition) => boolean,
    samplesPerEdge = 13,
  ): CultureOverlap {
    if (!this.cultureIndexById.has(cultureId)) {
      throw new Error(`Unknown regional culture ${cultureId}`);
    }
    const projection = proj4(
      "EPSG:4326",
      `+proj=aeqd +lat_0=${center.latitudeE6 / 1_000_000} +lon_0=${center.longitudeE6 / 1_000_000} +ellps=WGS84 +units=m +no_defs`,
    );
    const half = extentMeters / 2;
    let landSamples = 0;
    let matchingLandSamples = 0;
    let matchingEast = 0;
    let matchingNorth = 0;
    for (let row = 0; row < samplesPerEdge; row += 1) {
      const north = half - (row + 0.5) / samplesPerEdge * extentMeters;
      for (let column = 0; column < samplesPerEdge; column += 1) {
        const east = -half + (column + 0.5) / samplesPerEdge * extentMeters;
        const [longitude, latitude] = projection.inverse([east, north]);
        const position = {
          longitudeE6: Math.round(longitude * 1_000_000),
          latitudeE6: Math.round(latitude * 1_000_000),
        };
        if (!isLand(position)) continue;
        landSamples += 1;
        if (this.cultureAt(position)?.id === cultureId) {
          matchingLandSamples += 1;
          matchingEast += east;
          matchingNorth += north;
        }
      }
    }
    return {
      cultureId,
      landSamples,
      matchingLandSamples,
      landSharePermille:
        landSamples === 0 ? 0 : Math.round(matchingLandSamples / landSamples * 1_000),
      direction:
        matchingLandSamples === 0
          ? "outside"
          : overlapDirection(
              matchingEast / matchingLandSamples,
              matchingNorth / matchingLandSamples,
              extentMeters,
            ),
    };
  }

  private approximateCultureIndex(
    longitudeRadians: number,
    latitudeRadians: number,
    cosLatitude: number,
  ): number {
    if (latitudeRadians * 180 / Math.PI < UNINHABITED_SOUTH_LATITUDE) return -1;
    let bestIndex = -1;
    let bestScoreSquared = Number.POSITIVE_INFINITY;
    for (const anchor of this.anchors) {
      const longitudeDelta = normalizedLongitudeRadians(
        longitudeRadians - anchor.longitudeRadians,
      );
      const latitudeDelta = latitudeRadians - anchor.latitudeRadians;
      const east = longitudeDelta * cosLatitude;
      const scoreSquared =
        (latitudeDelta * latitudeDelta + east * east) /
        (anchor.influenceRadians * anchor.influenceRadians);
      const bestCultureId = bestIndex < 0 ? "" : this.cultures[bestIndex]!.id;
      const cultureId = this.cultures[anchor.cultureIndex]!.id;
      if (
        scoreSquared < bestScoreSquared - 1e-12 ||
        (Math.abs(scoreSquared - bestScoreSquared) <= 1e-12 &&
          cultureId < bestCultureId)
      ) {
        bestIndex = anchor.cultureIndex;
        bestScoreSquared = scoreSquared;
      }
    }
    return bestIndex;
  }
}
