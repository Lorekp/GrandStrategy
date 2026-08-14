import proj4 from "proj4";
import type { GeographicPosition } from "../core/model";

export const REGIONAL_THEATER_FORMAT_VERSION = 14;

export interface TheaterLevel {
  readonly level: number;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
}

export interface RegionalTheaterManifest {
  readonly formatVersion: typeof REGIONAL_THEATER_FORMAT_VERSION;
  readonly id: string;
  readonly name: string;
  readonly kind: "regional-theater";
  readonly projection: {
    readonly type: "azimuthal-equidistant";
    readonly definition: string;
    readonly center: GeographicPosition;
  };
  readonly extent: {
    readonly widthMeters: number;
    readonly heightMeters: number;
  };
  readonly render: {
    readonly width: number;
    readonly height: number;
    readonly metersPerPixel: number;
    readonly tileSize: number;
    readonly paletteColors: number;
    readonly levels: readonly TheaterLevel[];
  };
  /** Equirectangular, transparent derivative used only while choosing a Theater. */
  readonly atlasPreview: {
    readonly westLongitudeE6: number;
    readonly eastLongitudeE6: number;
    readonly southLatitudeE6: number;
    readonly northLatitudeE6: number;
    readonly width: number;
    readonly height: number;
    readonly tileSize: number;
    readonly levels: readonly TheaterLevel[];
    readonly tilePath: string;
  };
  readonly semantic: {
    readonly width: number;
    readonly height: number;
    readonly metersPerCell: number;
    readonly landMaskPath: string;
    readonly chunkSize: number;
    readonly chunkColumns: number;
    readonly chunkRows: number;
    readonly chunkPath: "semantic/{column}_{row}.bin";
    readonly chunkEncoding: "terrain-u8-vegetation-u8-moisture-u8-elevation-i16le-v2";
    readonly moistureModelVersion: 1;
  };
  readonly validation: {
    readonly maximumEstimatedScaleErrorPercent: number;
  };
  readonly source: {
    readonly name: string;
    readonly url: string;
    readonly format: string;
    readonly sourceZoom: number;
  };
  readonly naturalCoverSource: {
    readonly name: string;
    readonly url: string;
    readonly format: string;
  };
  readonly physicalGeometrySource: {
    readonly name: string;
    readonly url: string;
    readonly format: string;
  };
  readonly hydrographySource: {
    readonly name: string;
    readonly url: string;
    readonly format: string;
    readonly snapshot: string;
    readonly normalizerVersion: 5;
    readonly normalizedHash: string;
    readonly featureCount: number;
    readonly attribution: string;
    readonly license: string;
    readonly extracts: readonly {
      readonly id: string;
      readonly url: string;
      readonly md5: string;
    }[];
    readonly geometryPath: string;
    readonly geometryEncoding: "projected-waterway-f32-v1";
    readonly geometryFeatureCount: number;
    readonly geometryPointCount: number;
  };
  readonly moistureModel: {
    readonly version: 1;
    readonly meaning: string;
    readonly climateAdapter: string;
    readonly drainageAdapter: string;
  };
}

export interface TheaterPoint {
  readonly x: number;
  readonly y: number;
}

function assertManifest(value: unknown): asserts value is RegionalTheaterManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Regional Theater manifest is not an object");
  }
  const candidate = value as Partial<RegionalTheaterManifest>;
  if (
    candidate.formatVersion !== REGIONAL_THEATER_FORMAT_VERSION ||
    candidate.kind !== "regional-theater" ||
    !candidate.projection ||
    !candidate.extent ||
    !candidate.render ||
    !candidate.atlasPreview ||
    !candidate.semantic ||
    candidate.semantic.metersPerCell !== 250 ||
    candidate.semantic.chunkSize !== 128 ||
    candidate.semantic.chunkPath !== "semantic/{column}_{row}.bin" ||
    candidate.semantic.chunkEncoding !==
      "terrain-u8-vegetation-u8-moisture-u8-elevation-i16le-v2" ||
    candidate.semantic.moistureModelVersion !== 1 ||
    !candidate.naturalCoverSource ||
    !candidate.physicalGeometrySource ||
    !candidate.hydrographySource ||
    !candidate.hydrographySource.attribution ||
    !candidate.hydrographySource.snapshot ||
    candidate.hydrographySource.normalizerVersion !== 5 ||
    !candidate.hydrographySource.geometryPath ||
    candidate.hydrographySource.geometryEncoding !==
      "projected-waterway-f32-v1" ||
    candidate.moistureModel?.version !== 1 ||
    candidate.extent.widthMeters !== 768_000 ||
    candidate.extent.heightMeters !== 768_000 ||
    candidate.render.width !== 8_192 ||
    candidate.render.height !== 8_192 ||
    candidate.render.levels?.length !== 4 ||
    candidate.atlasPreview.levels?.length !== 2 ||
    candidate.atlasPreview.westLongitudeE6 >=
      candidate.atlasPreview.eastLongitudeE6 ||
    candidate.atlasPreview.southLatitudeE6 >=
      candidate.atlasPreview.northLatitudeE6 ||
    candidate.render.width * candidate.render.metersPerPixel !==
      candidate.extent.widthMeters
  ) {
    throw new Error(
      `Regional Theater manifest violates format version ${REGIONAL_THEATER_FORMAT_VERSION}`,
    );
  }
}

export function parseRegionalTheaterManifest(
  value: unknown,
): RegionalTheaterManifest {
  assertManifest(value);
  return value;
}

export async function loadRegionalTheater(
  manifestPath: string,
): Promise<RegionalTheaterManifest> {
  const response = await fetch(manifestPath);
  if (!response.ok) {
    throw new Error(`Unable to load Regional Theater: ${response.status}`);
  }
  return parseRegionalTheaterManifest(await response.json());
}

/** Project WGS84 simulation positions into one disposable local theater view. */
export class RegionalTheaterProjection {
  private readonly forward: proj4.Converter;

  public constructor(private readonly theater: RegionalTheaterManifest) {
    this.forward = proj4("EPSG:4326", theater.projection.definition);
  }

  public toTheater(position: GeographicPosition): TheaterPoint {
    const [easting, northing] = this.forward.forward([
      position.longitudeE6 / 1_000_000,
      position.latitudeE6 / 1_000_000,
    ]);
    return {
      x:
        (easting + this.theater.extent.widthMeters / 2) /
        this.theater.render.metersPerPixel,
      y:
        (this.theater.extent.heightMeters / 2 - northing) /
        this.theater.render.metersPerPixel,
    };
  }

  public toGeographic(point: TheaterPoint): GeographicPosition {
    const easting =
      point.x * this.theater.render.metersPerPixel -
      this.theater.extent.widthMeters / 2;
    const northing =
      this.theater.extent.heightMeters / 2 -
      point.y * this.theater.render.metersPerPixel;
    const [longitude, latitude] = this.forward.inverse([easting, northing]);
    return {
      longitudeE6: Math.round(longitude * 1_000_000),
      latitudeE6: Math.round(latitude * 1_000_000),
    };
  }
}
