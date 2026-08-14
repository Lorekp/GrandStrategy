export type CampCultureClick =
  | { readonly kind: "uninhabited" }
  | {
      readonly kind: "current" | "switch";
      readonly cultureId: string;
    };

/** Resolves the exact Culture Field under a Camp-pick click. */
export function resolveCampCultureClick(
  currentCultureId: string,
  clickedCultureId: string | undefined,
): CampCultureClick {
  if (!clickedCultureId) return { kind: "uninhabited" };
  return {
    kind: clickedCultureId === currentCultureId ? "current" : "switch",
    cultureId: clickedCultureId,
  };
}

/** Only a different inhabited Culture Field receives the camp-picker hover. */
export function resolveCampCultureHover(
  currentCultureId: string,
  hoveredCultureId: string | undefined,
): string | undefined {
  return hoveredCultureId && hoveredCultureId !== currentCultureId
    ? hoveredCultureId
    : undefined;
}
