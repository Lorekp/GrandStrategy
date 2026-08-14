import gameplaySource from "./gameplay.json";
import presentationSource from "./presentation.json";

export type SupportedLanguage = "en" | "de";
export type ConfiguredMapDetail = "economy" | "balanced" | "detailed";

function assertFinitePositive(value: number, path: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a positive finite number`);
  }
}

function assertFraction(value: number, path: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be between zero and one`);
  }
}

function assertPositiveInteger(value: number, path: string): void {
  assertFinitePositive(value, path);
  if (!Number.isInteger(value)) throw new Error(`${path} must be an integer`);
}

export function parseHexColor(value: string, path = "color"): number {
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${path} must use #rrggbb notation`);
  }
  return Number.parseInt(value.slice(1), 16);
}

function validateConfiguration(): void {
  assertFinitePositive(gameplaySource.simulation.ticksPerSecond, "simulation.ticksPerSecond");
  assertFinitePositive(gameplaySource.simulation.worldMinutesPerTick, "simulation.worldMinutesPerTick");
  if (!gameplaySource.simulation.speedOptions.includes(gameplaySource.simulation.defaultSpeed)) {
    throw new Error("simulation.defaultSpeed must be a configured speed option");
  }
  for (const [index, speed] of gameplaySource.simulation.speedOptions.entries()) {
    assertPositiveInteger(speed, `simulation.speedOptions[${index}]`);
  }
  assertFinitePositive(gameplaySource.world.earthMeanRadiusMeters, "world.earthMeanRadiusMeters");
  assertPositiveInteger(
    gameplaySource.research.baseKnowledgePerWorldDay,
    "research.baseKnowledgePerWorldDay",
  );
  assertPositiveInteger(
    gameplaySource.research.populationPerAdditionalKnowledge,
    "research.populationPerAdditionalKnowledge",
  );
  assertPositiveInteger(
    gameplaySource.research.villageKnowledgePerWorldDay,
    "research.villageKnowledgePerWorldDay",
  );
  assertPositiveInteger(
    gameplaySource.research.cultureAffinityPercent,
    "research.cultureAffinityPercent",
  );
  assertPositiveInteger(
    gameplaySource.settlements.populationGrowthPerInterval,
    "settlements.populationGrowthPerInterval",
  );
  assertPositiveInteger(
    gameplaySource.settlements.influenceGrowthMetersPerInterval,
    "settlements.influenceGrowthMetersPerInterval",
  );
  if (
    gameplaySource.world.minimumInhabitedLatitude < -90 ||
    gameplaySource.world.minimumInhabitedLatitude > 90
  ) {
    throw new Error("world.minimumInhabitedLatitude must be a latitude");
  }
  assertFinitePositive(gameplaySource.visibility.footprintPerimeterSamples, "visibility.footprintPerimeterSamples");
  assertFinitePositive(gameplaySource.visibility.unitDetectionRadiusMeters, "visibility.unitDetectionRadiusMeters");
  assertFinitePositive(gameplaySource.visibility.campDetectionRadiusMeters, "visibility.campDetectionRadiusMeters");
  assertFinitePositive(gameplaySource.visibility.villageDetectionRadiusMeters, "visibility.villageDetectionRadiusMeters");
  assertFraction(gameplaySource.visibility.nightMultiplier, "visibility.nightMultiplier");
  assertFraction(gameplaySource.visibility.envelope.midSupportFraction, "visibility.envelope.midSupportFraction");
  assertFraction(gameplaySource.visibility.envelope.farSupportFraction, "visibility.envelope.farSupportFraction");
  if (gameplaySource.scout.marchStartHour >= gameplaySource.scout.marchEndHour) {
    throw new Error("scout march hours must define a non-empty daytime window");
  }
  if (gameplaySource.openingScenario.friendlyChance + gameplaySource.openingScenario.hostileChance > 1) {
    throw new Error("opening diplomacy probabilities cannot exceed one");
  }
  assertFraction(gameplaySource.openingScenario.friendlyChance, "openingScenario.friendlyChance");
  assertFraction(gameplaySource.openingScenario.hostileChance, "openingScenario.hostileChance");
  assertPositiveInteger(gameplaySource.openingScenario.playerId, "openingScenario.playerId");
  assertPositiveInteger(
    gameplaySource.openingScenario.playerTribeId,
    "openingScenario.playerTribeId",
  );
  assertPositiveInteger(
    gameplaySource.openingScenario.playerSettlementId,
    "openingScenario.playerSettlementId",
  );
  assertPositiveInteger(
    gameplaySource.openingScenario.firstRivalTribeId,
    "openingScenario.firstRivalTribeId",
  );
  const firstRivalId = gameplaySource.openingScenario.firstRivalTribeId;
  const lastRivalId =
    firstRivalId + gameplaySource.openingScenario.rivalCampCount - 1;
  const collidesWithRivals = (id: number): boolean =>
    id >= firstRivalId && id <= lastRivalId;
  if (
    collidesWithRivals(gameplaySource.openingScenario.playerTribeId) ||
    collidesWithRivals(gameplaySource.openingScenario.playerSettlementId)
  ) {
    throw new Error("opening player and rival ids must be distinct");
  }
  if (
    !presentationSource.settings.interfaceScales.includes(
      presentationSource.settings.defaultInterfaceScale,
    ) ||
    !presentationSource.settings.mapDetails.includes(
      presentationSource.settings.defaultMapDetail,
    ) ||
    !presentationSource.settings.languages.includes(
      presentationSource.settings.defaultLanguage,
    )
  ) {
    throw new Error("settings defaults must be present in their configured options");
  }
  for (const [name, path] of Object.entries(presentationSource.assets)) {
    if (!path.startsWith("/")) throw new Error(`assets.${name} must be root-relative`);
  }
  for (const [index, color] of presentationSource.culture.palette.entries()) {
    parseHexColor(color, `culture.palette[${index}]`);
  }
  assertFinitePositive(
    presentationSource.culture.mapStyle.culturePickerSaturation,
    "culture.mapStyle.culturePickerSaturation",
  );
  assertFraction(
    presentationSource.markers.rememberedIntelligenceAlpha,
    "markers.rememberedIntelligenceAlpha",
  );
  assertPositiveInteger(
    presentationSource.mapViews.textureMaximumDimension,
    "mapViews.textureMaximumDimension",
  );
  assertFraction(
    presentationSource.mapViews.overlayAlpha,
    "mapViews.overlayAlpha",
  );
  assertFinitePositive(
    presentationSource.mapViews.heightMaximumMeters -
      presentationSource.mapViews.heightMinimumMeters,
    "mapViews height range",
  );
  assertPositiveInteger(
    presentationSource.mapViews.contourIntervalMeters,
    "mapViews.contourIntervalMeters",
  );
  assertPositiveInteger(
    presentationSource.mapViews.contourIndexIntervalMeters,
    "mapViews.contourIndexIntervalMeters",
  );
  assertPositiveInteger(
    presentationSource.mapViews.contourLabelIntervalMeters,
    "mapViews.contourLabelIntervalMeters",
  );
  if (
    presentationSource.mapViews.contourIndexIntervalMeters %
      presentationSource.mapViews.contourIntervalMeters !==
      0 ||
    presentationSource.mapViews.contourLabelIntervalMeters %
      presentationSource.mapViews.contourIntervalMeters !==
      0
  ) {
    throw new Error(
      "mapViews index and label contour intervals must be multiples of the base contour interval",
    );
  }
  assertFraction(
    presentationSource.mapViews.contourLineAlpha,
    "mapViews.contourLineAlpha",
  );
  assertFraction(
    presentationSource.mapViews.contourIndexAlpha,
    "mapViews.contourIndexAlpha",
  );
  assertPositiveInteger(
    presentationSource.mapViews.contourMaximumLabels,
    "mapViews.contourMaximumLabels",
  );
  assertFinitePositive(
    presentationSource.mapViews.contourLabelMinimumRelativeZoom,
    "mapViews.contourLabelMinimumRelativeZoom",
  );
  assertPositiveInteger(
    presentationSource.mapViews.contourLabelFontSize,
    "mapViews.contourLabelFontSize",
  );
  for (const [name, color] of Object.entries(presentationSource.mapViews)) {
    if (name.endsWith("Color")) {
      parseHexColor(String(color), `mapViews.${name}`);
    }
  }
  parseHexColor(presentationSource.fog.unknownColor, "fog.unknownColor");
  for (const [terrain, color] of Object.entries(presentationSource.survey.terrainColors)) {
    parseHexColor(color, `survey.terrainColors.${terrain}`);
  }
  for (const [name, color] of Object.entries(presentationSource.theaterPicker)) {
    if (name.toLowerCase().includes("color")) {
      parseHexColor(String(color), `theaterPicker.${name}`);
    }
  }
  for (const [name, value] of Object.entries(presentationSource.performance)) {
    assertPositiveInteger(value, `performance.${name}`);
  }
  for (const language of presentationSource.settings.languages) {
    if (language !== "en" && language !== "de") {
      throw new Error(`Unsupported configured language ${language}`);
    }
  }
}

validateConfiguration();

export const GAMEPLAY_CONFIG = gameplaySource;
export const PRESENTATION_CONFIG = presentationSource;
