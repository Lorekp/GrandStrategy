import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CultureInfluenceField,
  parseCultureInfluenceManifest,
} from "./CultureInfluence";

const manifest = parseCultureInfluenceManifest(
  JSON.parse(readFileSync("public/maps/cultures/manifest.json", "utf8")) as unknown,
);

describe("CultureInfluenceField", () => {
  it("assigns every culture anchor to its own learned tradition", () => {
    const field = new CultureInfluenceField(manifest);
    for (const culture of manifest.cultures) {
      for (const anchor of culture.anchors) {
        expect(field.cultureAt(anchor)?.id).toBe(culture.id);
      }
    }
  });

  it("leaves the Antarctic tribal-era start uninhabited", () => {
    const field = new CultureInfluenceField(manifest);
    expect(
      field.cultureAt({ longitudeE6: 20_000_000, latitudeE6: -70_000_000 }),
    ).toBeUndefined();
  });

  it("measures partial culture overlap within a mixed Regional Theater", () => {
    const field = new CultureInfluenceField(manifest);
    const overlap = field.overlap(
      { longitudeE6: 25_000_000, latitudeE6: 41_000_000 },
      768_000,
      "hellenic-balkan",
      () => true,
    );
    expect(overlap.landSamples).toBe(169);
    expect(overlap.matchingLandSamples).toBeGreaterThan(0);
    expect(overlap.landSharePermille).toBeGreaterThan(0);
    expect(overlap.landSharePermille).toBeLessThanOrEqual(1_000);
    expect(overlap.direction).not.toBe("outside");
  });

  it("keeps ocean cells outside the static culture raster", () => {
    const field = new CultureInfluenceField(manifest);
    const land = new Uint8Array([0, 255]);
    const raster = field.rasterize(2, 1, land);
    expect(raster[0]).toBe(255);
    expect(raster[1]).not.toBe(255);
  });

  it("returns a signed display margin consistent with the authoritative field", () => {
    const field = new CultureInfluenceField(manifest);
    const position = { longitudeE6: 25_000_000, latitudeE6: 41_000_000 };
    const localCulture = field.cultureAt(position);
    expect(localCulture).toBeDefined();
    expect(field.cultureMarginAt(position, localCulture!.id)).toBeGreaterThan(0);
    expect(
      field.classifyForSelectedCulture(position, localCulture!.id).cultureIndex,
    ).toBe(field.indexOfCulture(localCulture!.id));
    const otherCulture = manifest.cultures.find(
      (culture) => culture.id !== localCulture!.id,
    );
    expect(otherCulture).toBeDefined();
    expect(field.cultureMarginAt(position, otherCulture!.id)).toBeLessThan(0);
    expect(
      field.classifyForSelectedCulture(position, otherCulture!.id).cultureIndex,
    ).toBe(field.indexOfCulture(localCulture!.id));
    const classification = field.classifyCulture(position);
    expect(classification.cultureIndex).toBe(field.indexOfCulture(localCulture!.id));
    expect(classification.winningMargin).toBeCloseTo(
      field.classifyForSelectedCulture(position, localCulture!.id).margin,
    );
  });
});
