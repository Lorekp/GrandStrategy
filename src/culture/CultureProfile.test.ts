import { describe, expect, it } from "vitest";
import profiles from "../../public/maps/cultures/profiles.json";
import cultures from "../../public/maps/cultures/manifest.json";
import { parseCultureProfileCatalog } from "./CultureProfile";

describe("culture profiles", () => {
  it("defines a complete, unique, mechanically bounded roster", () => {
    const catalog = parseCultureProfileCatalog(profiles);
    expect(catalog.profiles).toHaveLength(40);
    expect(new Set(catalog.profiles.map((profile) => profile.id)).size).toBe(40);
    expect(catalog.profiles.map((profile) => profile.id).sort()).toEqual(
      cultures.cultures.map((culture) => culture.id).sort(),
    );
    expect(
      catalog.profiles.every(
        (profile) =>
          profile.acclimatization.terrain.length > 0 &&
          profile.specialTechnology.unlock.length > 0,
      ),
    ).toBe(true);
  });
});
