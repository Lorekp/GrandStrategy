export interface CultureBorderPath {
  readonly cultures: readonly [number, number];
  readonly points: Float32Array;
}

export interface CultureBorderManifest {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly CultureBorderPath[];
}

interface SerializedCultureBorderManifest {
  readonly formatVersion?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly paths?: unknown;
}

export function parseCultureBorderManifest(
  value: unknown,
): CultureBorderManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Culture border manifest must be an object");
  }
  const manifest = value as SerializedCultureBorderManifest;
  if (
    manifest.formatVersion !== 1 ||
    !Number.isInteger(manifest.width) ||
    (manifest.width as number) <= 0 ||
    !Number.isInteger(manifest.height) ||
    (manifest.height as number) <= 0 ||
    !Array.isArray(manifest.paths)
  ) {
    throw new Error("Unsupported culture border manifest");
  }
  const paths = manifest.paths.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Culture border manifest contains an invalid path");
    }
    const path = candidate as { cultures?: unknown; points?: unknown };
    if (
      !Array.isArray(path.cultures) ||
      path.cultures.length !== 2 ||
      !path.cultures.every((culture) => Number.isInteger(culture) && culture >= 0) ||
      path.cultures[0] === path.cultures[1] ||
      !Array.isArray(path.points) ||
      path.points.length < 4 ||
      path.points.length % 2 !== 0 ||
      !path.points.every((coordinate) => Number.isFinite(coordinate))
    ) {
      throw new Error("Culture border manifest contains an invalid path");
    }
    return {
      cultures: [path.cultures[0], path.cultures[1]] as const,
      points: Float32Array.from(path.points),
    };
  });
  return {
    width: manifest.width as number,
    height: manifest.height as number,
    paths,
  };
}

export async function loadCultureBorderManifest(
  path: string,
): Promise<CultureBorderManifest> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Culture borders failed to load (${response.status})`);
  }
  return parseCultureBorderManifest(await response.json());
}
