import type { RegionalTheaterManifest } from "./RegionalTheater";
import { loadRegionalTheater } from "./RegionalTheater";
import type { TheaterCandidate } from "./TheaterCatalog";

interface EnsureTheaterResponse {
  readonly manifestPath: string;
  readonly cached: boolean;
}

function assertEnsureResponse(value: unknown): asserts value is EnsureTheaterResponse {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Partial<EnsureTheaterResponse>).manifestPath !== "string" ||
    typeof (value as Partial<EnsureTheaterResponse>).cached !== "boolean"
  ) {
    throw new Error("Theater compiler returned an invalid response");
  }
}

/** Ensures one immutable Regional Theater derivative exists before play begins. */
export async function ensureTheaterAsset(
  candidate: TheaterCandidate,
): Promise<RegionalTheaterManifest> {
  const response = await fetch("/api/theaters/ensure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: candidate.id,
      name: `${candidate.cultureName} Regional Theater`,
      longitudeE6: candidate.center.longitudeE6,
      latitudeE6: candidate.center.latitudeE6,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { readonly error?: unknown };
      if (typeof parsed.error === "string") {
        message = parsed.error;
      }
    } catch {
      // A non-JSON proxy error is already the most useful message available.
    }
    throw new Error(message || `Unable to prepare Regional Theater: ${response.status}`);
  }
  const result: unknown = await response.json();
  assertEnsureResponse(result);
  return loadRegionalTheater(result.manifestPath);
}
