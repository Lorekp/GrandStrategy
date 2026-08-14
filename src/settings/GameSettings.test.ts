import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_SETTINGS,
  mapDetailLevelBias,
  parseGameSettings,
} from "./GameSettings";

describe("GameSettings", () => {
  it("keeps valid settings and repairs invalid fields independently", () => {
    expect(
      parseGameSettings({
        interfaceScale: 1.25,
        mapDetail: "cinematic",
        showMapSurvey: false,
        language: "de",
      }),
    ).toEqual({
      interfaceScale: 1.25,
      mapDetail: DEFAULT_GAME_SETTINGS.mapDetail,
      showMapSurvey: false,
      language: "de",
    });
  });

  it("maps detail preferences to one bounded LOD step", () => {
    expect(mapDetailLevelBias("economy")).toBe(-1);
    expect(mapDetailLevelBias("balanced")).toBe(0);
    expect(mapDetailLevelBias("detailed")).toBe(1);
  });
});
