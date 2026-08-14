import type { RiverClass } from "../core/model";

export type WaterwayRegime =
  | "unknown"
  | "perennial"
  | "intermittent"
  | "seasonal";
export type WaterwayKind = "river" | "stream" | "tidal-channel";

export interface WaterwayFeature {
  readonly sourceId: bigint;
  readonly riverClass: Exclude<RiverClass, "none">;
  readonly regime: WaterwayRegime;
  readonly kind: WaterwayKind;
  readonly widthMeters: number;
  readonly name?: string;
  readonly points: Float32Array;
}

const MAGIC = "GSHY";
const FORMAT_VERSION = 1;
const HEADER_BYTES = 16;
const RECORD_HEADER_BYTES = 22;
const INDEX_CHUNK_METERS = 32_000;

const REGIMES: readonly WaterwayRegime[] = [
  "unknown",
  "perennial",
  "intermittent",
  "seasonal",
];
const KINDS: readonly (WaterwayKind | undefined)[] = [
  undefined,
  "river",
  "stream",
  "tidal-channel",
];

function ascii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}

function pointSegmentDistanceSquared(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (x - x1) ** 2 + (y - y1) ** 2;
  const ratio = Math.max(
    0,
    Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared),
  );
  const closestX = x1 + ratio * dx;
  const closestY = y1 + ratio * dy;
  return (x - closestX) ** 2 + (y - closestY) ** 2;
}

function bucketKey(column: number, row: number): string {
  return `${column}:${row}`;
}

/** Immutable projected centerlines with a compact 32 km spatial index. */
export class WaterwayIndex {
  private readonly buckets = new Map<string, number[]>();

  private constructor(public readonly features: readonly WaterwayFeature[]) {
    features.forEach((feature, index) => {
      let minimumX = Number.POSITIVE_INFINITY;
      let maximumX = Number.NEGATIVE_INFINITY;
      let minimumY = Number.POSITIVE_INFINITY;
      let maximumY = Number.NEGATIVE_INFINITY;
      for (let point = 0; point < feature.points.length; point += 2) {
        const x = feature.points[point]!;
        const y = feature.points[point + 1]!;
        minimumX = Math.min(minimumX, x);
        maximumX = Math.max(maximumX, x);
        minimumY = Math.min(minimumY, y);
        maximumY = Math.max(maximumY, y);
      }
      for (
        let row = Math.floor(minimumY / INDEX_CHUNK_METERS);
        row <= Math.floor(maximumY / INDEX_CHUNK_METERS);
        row += 1
      ) {
        for (
          let column = Math.floor(minimumX / INDEX_CHUNK_METERS);
          column <= Math.floor(maximumX / INDEX_CHUNK_METERS);
          column += 1
        ) {
          const key = bucketKey(column, row);
          const bucket = this.buckets.get(key);
          if (bucket) bucket.push(index);
          else this.buckets.set(key, [index]);
        }
      }
    });
  }

  public static decode(buffer: ArrayBuffer): WaterwayIndex {
    const view = new DataView(buffer);
    if (
      buffer.byteLength < HEADER_BYTES ||
      ascii(view, 0, 4) !== MAGIC ||
      view.getUint16(4, true) !== FORMAT_VERSION
    ) {
      throw new Error("Unsupported projected waterway geometry");
    }
    const featureCount = view.getUint32(8, true);
    const expectedPointCount = view.getUint32(12, true);
    const decoder = new TextDecoder();
    const features: WaterwayFeature[] = [];
    let offset = HEADER_BYTES;
    let decodedPointCount = 0;
    for (let index = 0; index < featureCount; index += 1) {
      if (offset + RECORD_HEADER_BYTES > buffer.byteLength) {
        throw new Error("Projected waterway geometry is truncated");
      }
      const sourceId = view.getBigUint64(offset, true);
      const riverClassCode = view.getUint8(offset + 8);
      const regime = REGIMES[view.getUint8(offset + 9)];
      const kind = KINDS[view.getUint8(offset + 10)];
      const widthMeters = view.getFloat32(offset + 12, true);
      const pointCount = view.getUint32(offset + 16, true);
      const nameLength = view.getUint16(offset + 20, true);
      offset += RECORD_HEADER_BYTES;
      const pointBytes = pointCount * 2 * Float32Array.BYTES_PER_ELEMENT;
      if (
        !regime ||
        !kind ||
        (riverClassCode !== 1 && riverClassCode !== 2) ||
        pointCount < 2 ||
        offset + nameLength + pointBytes > buffer.byteLength
      ) {
        throw new Error("Projected waterway record is invalid");
      }
      const name = nameLength
        ? decoder.decode(new Uint8Array(buffer, offset, nameLength))
        : undefined;
      offset += nameLength;
      const points = new Float32Array(pointCount * 2);
      for (let point = 0; point < points.length; point += 1) {
        points[point] = view.getFloat32(
          offset + point * Float32Array.BYTES_PER_ELEMENT,
          true,
        );
      }
      offset += pointBytes;
      decodedPointCount += pointCount;
      features.push({
        sourceId,
        riverClass: riverClassCode === 2 ? "major" : "minor",
        regime,
        kind,
        widthMeters,
        ...(name ? { name } : {}),
        points,
      });
    }
    if (offset !== buffer.byteLength || decodedPointCount !== expectedPointCount) {
      throw new Error("Projected waterway geometry does not match its header");
    }
    return new WaterwayIndex(features);
  }

  public featureAt(
    easting: number,
    northing: number,
    toleranceMeters: number,
  ): WaterwayFeature | undefined {
    const minimumColumn = Math.floor(
      (easting - toleranceMeters) / INDEX_CHUNK_METERS,
    );
    const maximumColumn = Math.floor(
      (easting + toleranceMeters) / INDEX_CHUNK_METERS,
    );
    const minimumRow = Math.floor(
      (northing - toleranceMeters) / INDEX_CHUNK_METERS,
    );
    const maximumRow = Math.floor(
      (northing + toleranceMeters) / INDEX_CHUNK_METERS,
    );
    const candidates = new Set<number>();
    for (let row = minimumRow; row <= maximumRow; row += 1) {
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        for (const index of this.buckets.get(bucketKey(column, row)) ?? []) {
          candidates.add(index);
        }
      }
    }
    let best: WaterwayFeature | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const index of candidates) {
      const feature = this.features[index];
      if (!feature) continue;
      const hitRadius = toleranceMeters + feature.widthMeters / 2;
      const hitRadiusSquared = hitRadius * hitRadius;
      for (let point = 0; point < feature.points.length - 2; point += 2) {
        const distance = pointSegmentDistanceSquared(
          easting,
          northing,
          feature.points[point]!,
          feature.points[point + 1]!,
          feature.points[point + 2]!,
          feature.points[point + 3]!,
        );
        if (
          distance <= hitRadiusSquared &&
          (distance < bestDistance ||
            (distance === bestDistance && feature.riverClass === "major"))
        ) {
          best = feature;
          bestDistance = distance;
        }
      }
    }
    return best;
  }
}
