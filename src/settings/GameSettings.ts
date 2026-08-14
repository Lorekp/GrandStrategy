import {
  PRESENTATION_CONFIG,
  type SupportedLanguage,
} from "../config/GameConfig";

export type InterfaceScale = 1 | 1.25 | 1.5 | 1.75;
export type MapDetail = "economy" | "balanced" | "detailed";

export interface GameSettings {
  readonly interfaceScale: InterfaceScale;
  readonly mapDetail: MapDetail;
  readonly showMapSurvey: boolean;
  readonly language: SupportedLanguage;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  interfaceScale: PRESENTATION_CONFIG.settings.defaultInterfaceScale as InterfaceScale,
  mapDetail: PRESENTATION_CONFIG.settings.defaultMapDetail as MapDetail,
  showMapSurvey: PRESENTATION_CONFIG.settings.defaultShowMapSurvey,
  language: PRESENTATION_CONFIG.settings.defaultLanguage as SupportedLanguage,
};

const STORAGE_KEY = PRESENTATION_CONFIG.settings.storageKey;
const INTERFACE_SCALES = new Set<number>(PRESENTATION_CONFIG.settings.interfaceScales);
const MAP_DETAILS = new Set<string>(PRESENTATION_CONFIG.settings.mapDetails);
const LANGUAGES = new Set<string>(PRESENTATION_CONFIG.settings.languages);

export function parseGameSettings(value: unknown): GameSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_GAME_SETTINGS;
  }
  const record = value as Record<string, unknown>;
  return {
    interfaceScale: INTERFACE_SCALES.has(record.interfaceScale as number)
      ? (record.interfaceScale as InterfaceScale)
      : DEFAULT_GAME_SETTINGS.interfaceScale,
    mapDetail: MAP_DETAILS.has(record.mapDetail as string)
      ? (record.mapDetail as MapDetail)
      : DEFAULT_GAME_SETTINGS.mapDetail,
    showMapSurvey:
      typeof record.showMapSurvey === "boolean"
        ? record.showMapSurvey
        : DEFAULT_GAME_SETTINGS.showMapSurvey,
    language: LANGUAGES.has(record.language as string)
      ? (record.language as SupportedLanguage)
      : DEFAULT_GAME_SETTINGS.language,
  };
}

export function loadGameSettings(storage: Storage): GameSettings {
  const stored = storage.getItem(STORAGE_KEY);
  if (!stored) {
    return DEFAULT_GAME_SETTINGS;
  }
  try {
    return parseGameSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_GAME_SETTINGS;
  }
}

export function saveGameSettings(
  storage: Storage,
  settings: GameSettings,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function applyGameSettings(
  root: HTMLElement,
  app: HTMLElement,
  settings: GameSettings,
): void {
  const inverseScalePercent = `${100 / settings.interfaceScale}%`;
  root.style.setProperty("--ui-scale", String(settings.interfaceScale));
  root.style.setProperty("--ui-inverse-scale", inverseScalePercent);
  root.style.setProperty(
    "--ui-viewport-height",
    `${100 / settings.interfaceScale}vh`,
  );
  app.dataset.mapSurvey = settings.showMapSurvey ? "visible" : "hidden";
}

export function mapDetailLevelBias(detail: MapDetail): number {
  return detail === "economy" ? -1 : detail === "detailed" ? 1 : 0;
}
