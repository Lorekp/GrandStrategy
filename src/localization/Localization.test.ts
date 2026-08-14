import { describe, expect, it } from "vitest";
import { Localization } from "./Localization";

describe("Localization", () => {
  it("interpolates typed messages and uses locale-aware numbers", () => {
    const german = new Localization("de");
    expect(german.text("setup.selectedCamp", { culture: "Nordisch" })).toContain(
      "Nordisch",
    );
    expect(german.number(1_250.5)).toBe("1.250,5");
  });

  it("formats campaign dates and durations without simulation-owned prose", () => {
    const english = new Localization("en");
    expect(
      english.worldDateTime({
        year: -9_999,
        month: 3,
        day: 2,
        hour: 0,
        minute: 0,
      }),
    ).toBe("2 Mar 10,000 BCE · 00:00");
    expect(english.worldDuration(1_505)).toBe("1d 1h 5m");
  });
});
