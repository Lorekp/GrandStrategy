import { GAMEPLAY_CONFIG } from "../config/GameConfig";

/** The deterministic simulation rate. Rendering is independent of this value. */
export const TICKS_PER_SECOND = GAMEPLAY_CONFIG.simulation.ticksPerSecond;
export const TICK_DURATION_MS = 1_000 / TICKS_PER_SECOND;
/** One deterministic simulation tick advances the campaign by one world minute. */
export const WORLD_MINUTES_PER_TICK = GAMEPLAY_CONFIG.simulation.worldMinutesPerTick;

export const MIN_SETTLEMENT_INFLUENCE_METERS = GAMEPLAY_CONFIG.settlements.minimumInfluenceMeters;
export const MAX_SETTLEMENT_INFLUENCE_METERS = GAMEPLAY_CONFIG.settlements.maximumInfluenceMeters;
export const SETTLEMENT_GROWTH_INTERVAL_TICKS =
  (GAMEPLAY_CONFIG.settlements.growthIntervalWorldDays * 24 * 60) /
  WORLD_MINUTES_PER_TICK;

export const EARTH_RADIUS_METERS = GAMEPLAY_CONFIG.world.earthMeanRadiusMeters;
export const TERRAIN_VISIBILITY_REFRACTION_COEFFICIENT = GAMEPLAY_CONFIG.visibility.terrainRefractionCoefficient;
export const TERRAIN_VISIBILITY_LIMIT_METERS = GAMEPLAY_CONFIG.visibility.terrainLimitMeters;

export const HUMAN_OBSERVER_HEIGHT_METERS = GAMEPLAY_CONFIG.visibility.humanObserverHeightMeters;
export const VILLAGE_OBSERVER_HEIGHT_METERS = GAMEPLAY_CONFIG.visibility.villageObserverHeightMeters;
export const VISION_FOOTPRINT_RADIUS_METERS = GAMEPLAY_CONFIG.visibility.footprintRadiusMeters;
export const VISION_FOOTPRINT_PERIMETER_SAMPLE_COUNT = GAMEPLAY_CONFIG.visibility.footprintPerimeterSamples;

/** Identification ranges are shorter than the physical terrain viewshed. */
export const UNIT_DETECTION_RADIUS_METERS = GAMEPLAY_CONFIG.visibility.unitDetectionRadiusMeters;
export const CAMP_DETECTION_RADIUS_METERS = GAMEPLAY_CONFIG.visibility.campDetectionRadiusMeters;
export const VILLAGE_DETECTION_RADIUS_METERS = GAMEPLAY_CONFIG.visibility.villageDetectionRadiusMeters;
/** Night reduces both terrain sight and entity identification without hiding occupied ground. */
export const NIGHT_VISION_MULTIPLIER = GAMEPLAY_CONFIG.visibility.nightMultiplier;
