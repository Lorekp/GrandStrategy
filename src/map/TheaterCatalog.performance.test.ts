import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { describe, expect, test } from "vitest";
import {
  GlobalTheaterCatalog,
  parseGlobalTheaterCatalog,
} from "./TheaterCatalog";

describe("global Theater hover lookup", () => {
  test("keeps repeated pointer queries far below a frame on the full catalog", () => {
    const manifest = parseGlobalTheaterCatalog(
      JSON.parse(
        readFileSync("public/maps/theaters/catalog.json", "utf8"),
      ) as unknown,
    );
    const catalog = new GlobalTheaterCatalog(manifest);
    const start = performance.now();
    let hits = 0;
    for (let index = 0; index < 2_000; index += 1) {
      const candidate = catalog.candidateAt(
        {
          x: (index * 811) % 4_096,
          y: (index * 313) % 2_048,
        },
        4_096,
        2_048,
      );
      hits += candidate ? 1 : 0;
    }
    const elapsed = performance.now() - start;

    expect(hits).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(100);
  });
});
