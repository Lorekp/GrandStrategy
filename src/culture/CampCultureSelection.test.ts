import { describe, expect, it } from "vitest";
import {
  resolveCampCultureClick,
  resolveCampCultureHover,
} from "./CampCultureSelection";

describe("Camp culture selection", () => {
  it("can adopt every Culture Field in a multi-culture Theater", () => {
    let selectedCultureId = "norse";

    for (const cultureId of ["germanic", "baltic", "finnic", "norse"]) {
      const click = resolveCampCultureClick(selectedCultureId, cultureId);
      expect(click).toEqual({ kind: "switch", cultureId });
      if (click.kind !== "uninhabited") selectedCultureId = click.cultureId;
    }

    expect(resolveCampCultureClick(selectedCultureId, selectedCultureId)).toEqual({
      kind: "current",
      cultureId: "norse",
    });
  });

  it("keeps uninhabited land distinct from a Culture Field", () => {
    expect(resolveCampCultureClick("norse", undefined)).toEqual({
      kind: "uninhabited",
    });
  });

  it("highlights a different Culture Field without highlighting the current one", () => {
    expect(resolveCampCultureHover("norse", "germanic")).toBe("germanic");
    expect(resolveCampCultureHover("norse", "norse")).toBeUndefined();
    expect(resolveCampCultureHover("norse", undefined)).toBeUndefined();
  });
});
