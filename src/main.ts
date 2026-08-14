import { Application } from "pixi.js";
import "./styles.css";
import {
  loadCultureProfiles,
  type CultureProfile,
} from "./culture/CultureProfile";
import {
  resolveCampCultureClick,
  resolveCampCultureHover,
} from "./culture/CampCultureSelection";
import {
  CultureInfluenceField,
  loadCultureInfluenceManifest,
  type CultureOverlap,
  type CultureOverlapDirection,
  type RegionalCulture,
} from "./culture/CultureInfluence";
import type {
  BattleFormation,
  CampBuilding,
  CombatDoctrine,
  DiplomaticAction,
  DiplomaticStance,
  GameEvent,
  GeographicPosition,
  PlayerVisibilityGrid,
  PlayerWorldSnapshot,
  PursuitPolicy,
  Settlement,
  SettlementAdministrator,
  TechnologyId,
  Tribe,
  TribeResearch,
  Unit,
  UnitKind,
} from "./core/model";
import {
  VILLAGE_ADMINISTRATION_TECHNOLOGY_ID,
  administrationRoleDefinition,
} from "./administration/TribalAdministration";
import {
  isDaytime,
  isScoutTravelMinute,
  scheduleScoutArrival,
} from "./core/WorldClock";
import { WORLD_MINUTES_PER_TICK } from "./core/constants";
import { flatScoutSpeedKilometersPerHour } from "./core/WorldGrid";
import { CameraController, type CameraState } from "./map/CameraController";
import { CultureMapLayer } from "./map/CultureMapLayer";
import { UNKNOWN_FOG_COLOR } from "./map/FogOfWarLayer";
import {
  loadAtlasManifest,
  TheaterPickerMap,
  type TheaterPreview,
  type TheaterSelection,
} from "./map/TheaterPickerMap";
import {
  loadGlobalTheaterCatalog,
} from "./map/TheaterCatalog";
import { ensureTheaterAsset } from "./map/TheaterAssetService";
import {
  surveyMapPoint,
  type MapSurveyInfo,
  type SurveyFeature,
  type SurveyNaturalFeature,
} from "./map/MapSurvey";
import {
  RegionalTheaterProjection,
  type RegionalTheaterManifest,
  type TheaterPoint,
} from "./map/RegionalTheater";
import { RegionalTheaterRenderer } from "./map/RegionalTheaterRenderer";
import { TheaterLandMask } from "./map/TheaterLandMask";
import type { TheaterMapViewMode } from "./map/TheaterMapViewLayer";
import { TheaterSurface } from "./map/TheaterSurface";
import { createHellenicTheaterScenario } from "./scenarios/hellenicTheater";
import {
  applyGameSettings,
  loadGameSettings,
  mapDetailLevelBias,
  parseGameSettings,
  saveGameSettings,
  type GameSettings,
} from "./settings/GameSettings";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker/protocol";
import {
  GAMEPLAY_CONFIG,
  PRESENTATION_CONFIG,
  parseHexColor,
  type SupportedLanguage,
} from "./config/GameConfig";
import {
  Localization,
  localizeDocument,
  type MessageKey,
} from "./localization/Localization";
import {
  TRIBAL_TECHNOLOGIES,
  cultureResearchAffinity,
  researchPlanForTarget,
  technologyActionState,
  technologyDefinition,
  technologyGameplayIsImplemented,
  technologyProgressFraction,
  tribeKnowledgePerWorldDay,
  type TechnologyActionState,
  type TechnologyBranch,
} from "./technology/TribalTechnology";
import {
  TRIBAL_BUILDINGS,
  tierMeetsMinimum,
  tribalBuildingDefinition,
} from "./tribal/TribalRoster";
import {
  TRIBAL_UNITS,
  cultureMilitaryTrait,
  tribalUnitDefinition,
  unitIsAvailableToCulture,
} from "./combat/MilitaryRoster";
import { veterancyRank } from "./combat/BattleResolver";
import {
  DIPLOMACY_CONFIG,
  DIPLOMATIC_ACTIONS,
  diplomaticActionDefinition,
} from "./diplomacy/TribalDiplomacy";
import {
  tribalEventDefinition,
  type TribalEventEffects,
} from "./events/TribalEvents";

function requiredElement<T extends Element>(id: string): T {
  const element = document.querySelector<T>(`#${id}`);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element;
}

function formatStance(stance: DiplomaticStance): string {
  return localization.text(`stance.${stance}` as MessageKey);
}

function formatCultureDirection(direction: CultureOverlapDirection): string {
  return localization.text(`direction.${direction}` as MessageKey);
}

function relationTo(
  snapshot: PlayerWorldSnapshot,
  firstTribeId: number,
  secondTribeId: number,
): DiplomaticStance {
  const lower = Math.min(firstTribeId, secondTribeId);
  const upper = Math.max(firstTribeId, secondTribeId);
  return (
    snapshot.relations.find(
      (relation) =>
        relation.firstTribeId === lower && relation.secondTribeId === upper,
    )?.stance ?? "neutral"
  );
}

function relationshipTo(
  snapshot: PlayerWorldSnapshot,
  firstTribeId: number,
  secondTribeId: number,
) {
  const lower = Math.min(firstTribeId, secondTribeId);
  const upper = Math.max(firstTribeId, secondTribeId);
  return snapshot.relations.find(
    (relation) =>
      relation.firstTribeId === lower && relation.secondTribeId === upper,
  );
}

function niceScaleDistance(rawMeters: number): number {
  const exponent = 10 ** Math.floor(Math.log10(rawMeters));
  const fraction = rawMeters / exponent;
  const niceFraction = fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1;
  return niceFraction * exponent;
}

interface SpawnChoice {
  readonly point: TheaterPoint;
  readonly position: GeographicPosition;
}

interface ActiveTheater {
  readonly manifest: RegionalTheaterManifest;
  readonly projection: RegionalTheaterProjection;
  readonly map: RegionalTheaterRenderer;
  readonly landMask: TheaterLandMask;
  readonly surface: TheaterSurface;
  readonly camera: CameraController;
  readonly openingRoll: number;
  culture: CultureProfile;
  cultureOverlap: CultureOverlap;
}

const appRoot = requiredElement<HTMLElement>("app");
const gameShell = requiredElement<HTMLElement>("game-shell");
const mainMenuView = requiredElement<HTMLElement>("main-menu-view");
const settingsView = requiredElement<HTMLElement>("settings-view");
const beginGameButton = requiredElement<HTMLButtonElement>("begin-game");
const beginGameLabel = (() => {
  const label = beginGameButton.querySelector<HTMLElement>("strong");
  if (!label) {
    throw new Error("Missing begin game label");
  }
  return label;
})();
const openSettingsButton = requiredElement<HTMLButtonElement>("open-settings");
const closeSettingsButton = requiredElement<HTMLButtonElement>("close-settings");
const menuButton = requiredElement<HTMLButtonElement>("menu-button");
const knowledgeButton = requiredElement<HTMLButtonElement>("knowledge-button");
const knowledgeButtonStatus = requiredElement<HTMLElement>("knowledge-button-status");
const diplomacyButton = requiredElement<HTMLButtonElement>("diplomacy-button");
const diplomacyButtonStatus = requiredElement<HTMLElement>("diplomacy-button-status");
const eventsButton = requiredElement<HTMLButtonElement>("events-button");
const eventsButtonStatus = requiredElement<HTMLElement>("events-button-status");
const diplomacyPanel = requiredElement<HTMLElement>("diplomacy-panel");
const closeDiplomacyButton = requiredElement<HTMLButtonElement>("close-diplomacy");
const diplomacyContacts = requiredElement<HTMLElement>("diplomacy-contacts");
const diplomacyCulture = requiredElement<HTMLElement>("diplomacy-culture");
const diplomacyTribeName = requiredElement<HTMLElement>("diplomacy-tribe-name");
const diplomacyStance = requiredElement<HTMLElement>("diplomacy-stance");
const relationMeters = requiredElement<HTMLElement>("relation-meters");
const diplomacyAgreements = requiredElement<HTMLElement>("diplomacy-agreements");
const diplomacyProposals = requiredElement<HTMLElement>("diplomacy-proposals");
const diplomacyActions = requiredElement<HTMLElement>("diplomacy-actions");
const diplomacyStatus = requiredElement<HTMLElement>("diplomacy-status");
const eventPanel = requiredElement<HTMLElement>("event-panel");
const closeEventsButton = requiredElement<HTMLButtonElement>("close-events");
const eventCategory = requiredElement<HTMLElement>("event-category");
const eventTitle = requiredElement<HTMLElement>("event-title");
const eventDescription = requiredElement<HTMLElement>("event-description");
const eventChoices = requiredElement<HTMLElement>("event-choices");
const eventPendingCount = requiredElement<HTMLElement>("event-pending-count");
const eventHistory = requiredElement<HTMLOListElement>("event-history");
const technologyPanel = requiredElement<HTMLElement>("technology-panel");
const closeTechnologyButton = requiredElement<HTMLButtonElement>("close-technology");
const knowledgeRate = requiredElement<HTMLElement>("knowledge-rate");
const technologyLinks = requiredElement<SVGSVGElement>("technology-links");
const technologyNodes = requiredElement<HTMLElement>("technology-nodes");
const technologyDetailBranch = requiredElement<HTMLElement>("technology-detail-branch");
const technologyDetailName = requiredElement<HTMLElement>("technology-detail-name");
const technologyDetailDescription = requiredElement<HTMLElement>("technology-detail-description");
const technologyDetailProgress = requiredElement<HTMLElement>("technology-detail-progress");
const technologyDetailCost = requiredElement<HTMLElement>("technology-detail-cost");
const technologyDetailPrerequisites = requiredElement<HTMLElement>("technology-detail-prerequisites");
const technologyDetailUnlocks = requiredElement<HTMLElement>("technology-detail-unlocks");
const technologyDetailNote = requiredElement<HTMLElement>("technology-detail-note");
const researchTechnologyButton = requiredElement<HTMLButtonElement>("research-technology");
const researchQueue = requiredElement<HTMLOListElement>("research-queue");
const researchQueueCount = requiredElement<HTMLElement>("research-queue-count");
const showMapSurveyInput = requiredElement<HTMLInputElement>("show-map-survey");
const settingsStatus = requiredElement<HTMLElement>("settings-status");
const interfaceScaleButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-interface-scale]"),
];
const mapDetailButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-map-detail]"),
];
const languageButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-language]"),
];
const gameHost = requiredElement<HTMLDivElement>("game");
const loading = requiredElement<HTMLDivElement>("loading");
const loadingLabel = requiredElement<HTMLElement>("loading-label");
const loadingNote = requiredElement<HTMLElement>("loading-note");
const loadingProgress = requiredElement<HTMLElement>("loading-progress");
const pauseButton = requiredElement<HTMLButtonElement>("pause-button");
const pauseLabel = requiredElement<HTMLSpanElement>("pause-label");
const fitButton = requiredElement<HTMLButtonElement>("fit-button");
const worldClockValue = requiredElement<HTMLElement>("world-clock-value");
const scaleValue = requiredElement<HTMLElement>("scale-value");
const scaleBar = requiredElement<HTMLDivElement>("scale-bar");
const scaleBarLabel = requiredElement<HTMLElement>("scale-bar-label");
const simulationState = requiredElement<HTMLElement>("simulation-state");
const theaterName = requiredElement<HTMLElement>("theater-name");
const theaterStats = requiredElement<HTMLElement>("theater-stats");
const selectedName = requiredElement<HTMLElement>("selected-name");
const selectedStatus = requiredElement<HTMLElement>("selected-status");
const selectedPopulation = requiredElement<HTMLElement>("selected-population");
const selectedWarriors = requiredElement<HTMLElement>("selected-warriors");
const selectedInfluence = requiredElement<HTMLElement>("selected-influence");
const tribeList = requiredElement<HTMLOListElement>("tribe-list");
const foundingPanel = requiredElement<HTMLElement>("founding-panel");
const foundingTitle = requiredElement<HTMLElement>("founding-title");
const foundingMessage = requiredElement<HTMLElement>("founding-message");
const foundingHelp = requiredElement<HTMLElement>("founding-help");
const theaterActions = requiredElement<HTMLElement>("theater-actions");
const rerollTheaterButton =
  requiredElement<HTMLButtonElement>("reroll-theater");
const phaseBackButton = requiredElement<HTMLButtonElement>("phase-back");
const phaseForwardButton = requiredElement<HTMLButtonElement>("phase-forward");
const constructionPanel = requiredElement<HTMLElement>("construction-panel");
const constructionTitle = requiredElement<HTMLElement>("construction-title");
const constructionStatus = requiredElement<HTMLElement>("construction-status");
const closeConstructionButton =
  requiredElement<HTMLButtonElement>("close-construction");
const upgradeVillageButton = requiredElement<HTMLButtonElement>("upgrade-village");
const villageAction = requiredElement<HTMLElement>("village-action");
const campBuildingOptions = requiredElement<HTMLElement>("camp-building-options");
const campUnitOptions = requiredElement<HTMLElement>("camp-unit-options");
const paceNote = requiredElement<HTMLElement>("pace-note");
const pacePlains = requiredElement<HTMLElement>("pace-plains");
const paceForest = requiredElement<HTMLElement>("pace-forest");
const paceJungle = requiredElement<HTMLElement>("pace-jungle");
const paceDesert = requiredElement<HTMLElement>("pace-desert");
const paceTundra = requiredElement<HTMLElement>("pace-tundra");
const paceIce = requiredElement<HTMLElement>("pace-ice");
const campWorksView = requiredElement<HTMLElement>("camp-works-view");
const campTrainView = requiredElement<HTMLElement>("camp-train-view");
const campAdministrationView = requiredElement<HTMLElement>("camp-administration-view");
const administrationCurrent = requiredElement<HTMLElement>("administration-current");
const administrationRoleButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-administration-role]"),
];
const campTabButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-camp-tab]"),
];
const unitPanel = requiredElement<HTMLElement>("unit-panel");
const unitTitle = requiredElement<HTMLElement>("unit-title");
const unitTerrain = requiredElement<HTMLElement>("unit-terrain");
const unitSlope = requiredElement<HTMLElement>("unit-slope");
const unitPace = requiredElement<HTMLElement>("unit-pace");
const unitArrival = requiredElement<HTMLElement>("unit-arrival");
const unitDetection = requiredElement<HTMLElement>("unit-detection");
const unitStrength = requiredElement<HTMLElement>("unit-strength");
const unitMorale = requiredElement<HTMLElement>("unit-morale");
const unitCohesion = requiredElement<HTMLElement>("unit-cohesion");
const unitFatigue = requiredElement<HTMLElement>("unit-fatigue");
const unitExperience = requiredElement<HTMLElement>("unit-experience");
const combatOrders = requiredElement<HTMLElement>("combat-orders");
const combatDoctrine = requiredElement<HTMLSelectElement>("combat-doctrine");
const combatFormation = requiredElement<HTMLSelectElement>("combat-formation");
const combatPursuit = requiredElement<HTMLSelectElement>("combat-pursuit");
const unitStatus = requiredElement<HTMLElement>("unit-status");
const mapSurvey = requiredElement<HTMLElement>("map-survey");
const mapViewToggle = requiredElement<HTMLButtonElement>("map-view-toggle");
const mapViewOptions = requiredElement<HTMLElement>("map-view-options");
const mapViewButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-map-view]"),
];
const surveyTitle = requiredElement<HTMLElement>("survey-title");
const surveyBiome = requiredElement<HTMLElement>("survey-biome");
const surveyTerrain = requiredElement<HTMLElement>("survey-terrain");
const surveyVegetation = requiredElement<HTMLElement>("survey-vegetation");
const surveyMoisture = requiredElement<HTMLElement>("survey-moisture");
const surveyNatural = requiredElement<HTMLElement>("survey-natural");
const surveyHeight = requiredElement<HTMLElement>("survey-height");
const surveyFeature = requiredElement<HTMLElement>("survey-feature");
const surveyBuildings = requiredElement<HTMLElement>("survey-buildings");
const surveyInfluence = requiredElement<HTMLElement>("survey-influence");
const surveyAllegiance = requiredElement<HTMLElement>("survey-allegiance");
const selectionBox = requiredElement<HTMLElement>("selection-box");
const theaterTooltip = requiredElement<HTMLElement>("theater-tooltip");
const tooltipKicker = requiredElement<HTMLElement>("tooltip-kicker");
const tooltipCulture = requiredElement<HTMLElement>("tooltip-culture");
const tooltipCultureFocus = requiredElement<HTMLElement>("tooltip-culture-focus");
const tooltipRegion = requiredElement<HTMLElement>("tooltip-region");
const tooltipWater = requiredElement<HTMLElement>("tooltip-water");
const tooltipPlains = requiredElement<HTMLElement>("tooltip-plains");
const tooltipForest = requiredElement<HTMLElement>("tooltip-forest");
const tooltipJungle = requiredElement<HTMLElement>("tooltip-jungle");
const tooltipHills = requiredElement<HTMLElement>("tooltip-hills");
const tooltipMountains = requiredElement<HTMLElement>("tooltip-mountains");
const tooltipDesert = requiredElement<HTMLElement>("tooltip-desert");
const tooltipTundra = requiredElement<HTMLElement>("tooltip-tundra");
const tooltipIce = requiredElement<HTMLElement>("tooltip-ice");
const cultureProfilePanel = requiredElement<HTMLElement>("culture-profile");
const cultureProfileName = requiredElement<HTMLElement>("culture-profile-name");
const cultureFocus = requiredElement<HTMLElement>("culture-focus");
const cultureLegacyName = requiredElement<HTMLElement>("culture-legacy-name");
const cultureLegacyEffect = requiredElement<HTMLElement>("culture-legacy-effect");
const cultureTradeoffName = requiredElement<HTMLElement>("culture-tradeoff-name");
const cultureTradeoffEffect = requiredElement<HTMLElement>("culture-tradeoff-effect");
const cultureAcclimatizationName = requiredElement<HTMLElement>("culture-acclimatization-name");
const cultureAcclimatizationEffect = requiredElement<HTMLElement>("culture-acclimatization-effect");
const cultureTechnologyName = requiredElement<HTMLElement>("culture-technology-name");
const cultureTechnologyEffect = requiredElement<HTMLElement>("culture-technology-effect");
const cultureTechnologyUnlock = requiredElement<HTMLElement>("culture-technology-unlock");
const speedControls = requiredElement<HTMLElement>("speed-controls");
const speedButtons = GAMEPLAY_CONFIG.simulation.speedOptions.map(
  (configuredSpeed) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "speed-button";
  button.dataset.speed = String(configuredSpeed);
  button.textContent = `${configuredSpeed}×`;
  button.classList.toggle(
    "is-active",
    configuredSpeed === GAMEPLAY_CONFIG.simulation.defaultSpeed,
  );
    speedControls.append(button);
    return button;
  },
);

function showLoading(label: string, note: string): void {
  loadingLabel.textContent = label;
  loadingNote.textContent = note;
  loadingProgress.setAttribute("aria-valuetext", note);
  loading.setAttribute("aria-busy", "true");
  loading.hidden = false;
}

function updateLoading(note: string): void {
  loadingNote.textContent = note;
  loadingProgress.setAttribute("aria-valuetext", note);
}

function hideLoading(): void {
  loading.hidden = true;
  loading.setAttribute("aria-busy", "false");
}

let settings = loadGameSettings(window.localStorage);
let localization = new Localization(settings.language);
localizeDocument(document, localization);
renderLocalizedConfiguration();
applyGameSettings(document.documentElement, appRoot, settings);

const app = new Application();
await app.init({
  resizeTo: window,
  preference: "webgl",
  preferWebGLVersion: 2,
  antialias: PRESENTATION_CONFIG.renderer.antialias,
  autoDensity: true,
  resolution: 1,
  powerPreference: "low-power",
  autoStart: false,
  background: UNKNOWN_FOG_COLOR,
});
gameHost.appendChild(app.canvas);

const [
  atlasManifest,
  theaterCatalog,
  cultureProfiles,
  cultureInfluenceManifest,
] = await Promise.all([
  loadAtlasManifest(PRESENTATION_CONFIG.assets.atlasManifest),
  loadGlobalTheaterCatalog(PRESENTATION_CONFIG.assets.theaterCatalog),
  loadCultureProfiles(PRESENTATION_CONFIG.assets.cultureProfiles),
  loadCultureInfluenceManifest(PRESENTATION_CONFIG.assets.cultureInfluence),
]);

type GamePhase = "culture-pick" | "theater-pick" | "camp-pick" | "playing";

let phase: GamePhase = "culture-pick";
let selectedCulture: CultureProfile | undefined;
let selectedTribeId = GAMEPLAY_CONFIG.openingScenario.playerTribeId;
let selectedConstructionSettlementId: number | undefined;
let selectedUnitIds = new Set<number>();
let latestSnapshot: PlayerWorldSnapshot | undefined;
let latestVisibility: PlayerVisibilityGrid | undefined;
let spawnChoice: SpawnChoice | undefined;
let commandSequence = 0;
let paused = GAMEPLAY_CONFIG.simulation.startPaused;
let speed = GAMEPLAY_CONFIG.simulation.defaultSpeed;
let campTab: "works" | "train" | "administration" = "works";
let mapViewMode: TheaterMapViewMode = "relief";
let pendingTrainedUnit:
  | {
      readonly settlementId: number;
      readonly unitKind: UnitKind;
      readonly knownUnitIds: ReadonlySet<number>;
    }
  | undefined;
let cameraScale = 1;
let hoveredPoint: TheaterPoint | undefined;
let surveyRequest = 0;
let activeTheater: ActiveTheater | undefined;
let theaterHoverFrame = 0;
let menuOpen = true;
let campaignStarted = false;
let technologyPanelOpen = false;
let selectedDiplomaticTribeId: number | undefined;
let displayedEventId: number | undefined;
let selectedTechnologyId: TechnologyId = "seasonal-lore";
let pendingResearchTechnologyId: TechnologyId | undefined;
const technologyNodeButtons = new Map<TechnologyId, HTMLButtonElement>();

const cultureField = new CultureInfluenceField(cultureInfluenceManifest);
const highestAtlasLevel = atlasManifest.levels.at(-1);
if (!highestAtlasLevel) throw new Error("Atlas tile pyramid has no levels");
updateLoading(localization.text("loading.paintingCultures"));
const cultureMapLayer = await CultureMapLayer.create(
  cultureField,
  PRESENTATION_CONFIG.assets.cultureRegions,
  PRESENTATION_CONFIG.assets.cultureCoastFade,
  PRESENTATION_CONFIG.assets.cultureBorders,
  highestAtlasLevel.width,
  highestAtlasLevel.height,
);
const theaterPicker = new TheaterPickerMap(
  atlasManifest,
  theaterCatalog,
  cultureField,
  cultureMapLayer,
  PRESENTATION_CONFIG.assets.atlasTileRoot,
  () => app.render(),
  () => mapDetailLevelBias(settings.mapDetail),
);
app.stage.addChild(theaterPicker.root);
const pickerCamera = new CameraController(
  app.canvas,
  theaterPicker.root,
  { width: theaterPicker.width, height: theaterPicker.height },
  (state) => {
    theaterPicker.setViewport(state);
    app.render();
    },
    () => !menuOpen && isAtlasPickPhase(),
    "contain",
  );

function isAtlasPickPhase(): boolean {
  return phase === "culture-pick" || phase === "theater-pick";
}

function updateScaleReadout(
  state: CameraState,
  theater: RegionalTheaterManifest,
): void {
  const metersPerScreenPixel = theater.render.metersPerPixel / state.scale;
  scaleValue.textContent = localization.text("format.metersPerPixel", {
    distance: localization.number(Math.round(metersPerScreenPixel)),
  });
  const distanceMeters = niceScaleDistance(
    metersPerScreenPixel * PRESENTATION_CONFIG.interaction.scaleBarTargetPixels,
  );
  scaleBar.style.width = `${distanceMeters / metersPerScreenPixel}px`;
  scaleBarLabel.textContent = localization.text(
    distanceMeters >= 1_000 ? "format.kilometers" : "format.meters",
    {
      distance: localization.number(
        distanceMeters >= 1_000 ? distanceMeters / 1_000 : distanceMeters,
      ),
    },
  );
}

function setMapViewMenuExpanded(expanded: boolean): void {
  mapViewToggle.setAttribute("aria-expanded", String(expanded));
  mapViewOptions.hidden = !expanded;
}

function selectMapView(mode: TheaterMapViewMode): void {
  mapViewMode = mode;
  for (const button of mapViewButtons) {
    const active = button.dataset.mapView === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  activeTheater?.map.setMapView(mode);
  app.render();
}

function colorHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

const TECHNOLOGY_MAP_WIDTH = 1_160;
const TECHNOLOGY_NODE_HALF_WIDTH = 88;
const TECHNOLOGY_NODE_HALF_HEIGHT = 30;
const technologyNodePosition = (technologyId: TechnologyId): { x: number; y: number } => {
  const technology = technologyDefinition(technologyId);
  return { x: 118 + technology.column * 230, y: 92 + technology.row * 82 };
};

function technologyMessage(
  technologyId: TechnologyId,
  field: "name" | "description" | "unlock",
): string {
  return localization.text(`technology.nodes.${technologyId}.${field}` as MessageKey);
}

function buildingMessage(
  building: CampBuilding,
  field: "name" | "description" | "effect",
): string {
  return localization.text(`roster.buildings.${building}.${field}` as MessageKey);
}

function unitMessage(
  unit: UnitKind,
  field: "name" | "plural" | "description" | "role",
): string {
  const definition = tribalUnitDefinition(unit);
  if (definition.name && definition.combat) {
    if (field === "name" || field === "plural") return definition.name;
    const trait = cultureMilitaryTrait(definition.combat.traitId).name;
    const archetype = definition.combat.archetypeId.replaceAll("-", " ");
    if (field === "description") {
      return localization.text("combat.unitDescription", { archetype, trait });
    }
    return localization.text("combat.unitRole", {
      people: definition.populationCost,
      role: localization.text(`combat.roles.${definition.combat.role}` as MessageKey),
      range: definition.combat.rangeMeters,
    });
  }
  return localization.text(`roster.units.${unit}.${field}` as MessageKey);
}

function renderTribalRosterOptions(): void {
  const buildingButtons = TRIBAL_BUILDINGS.map((building) => {
    const button = document.createElement("button");
    button.className = "build-option roster-option";
    button.type = "button";
    button.dataset.buildingId = building.id;
    const mark = document.createElement("span");
    mark.className = "roster-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = building.id
      .split("-")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = buildingMessage(building.id, "name");
    const description = document.createElement("small");
    description.textContent = buildingMessage(building.id, "description");
    const effect = document.createElement("em");
    effect.textContent = buildingMessage(building.id, "effect");
    copy.append(name, description, effect);
    const action = document.createElement("span");
    action.className = "roster-action";
    button.append(mark, copy, action);
    return button;
  });
  campBuildingOptions.replaceChildren(...buildingButtons);

  const unitButtons = TRIBAL_UNITS.map((unit) => {
    const button = document.createElement("button");
    button.className = "build-option roster-option";
    button.type = "button";
    button.dataset.unitKind = unit.id;
    const mark = document.createElement("span");
    mark.className = "roster-mark roster-mark--unit";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = unit.abbreviation;
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = unitMessage(unit.id, "name");
    const description = document.createElement("small");
    description.textContent = unitMessage(unit.id, "description");
    const role = document.createElement("em");
    role.textContent = unitMessage(unit.id, "role");
    copy.append(name, description, role);
    const action = document.createElement("span");
    action.className = "roster-action";
    button.append(mark, copy, action);
    return button;
  });
  campUnitOptions.replaceChildren(...unitButtons);
}

function technologyBranchName(branch: TechnologyBranch): string {
  return localization.text(`technology.branches.${branch}` as MessageKey);
}

function initializeTechnologyMap(): void {
  technologyNodeButtons.clear();
  technologyNodes.replaceChildren();
  technologyLinks.replaceChildren();
  for (const technology of TRIBAL_TECHNOLOGIES) {
    const position = technologyNodePosition(technology.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "technology-node";
    button.dataset.technologyId = technology.id;
    button.dataset.branch = technology.branch;
    button.style.left = `${position.x - TECHNOLOGY_NODE_HALF_WIDTH}px`;
    button.style.top = `${position.y - TECHNOLOGY_NODE_HALF_HEIGHT}px`;
    const branch = document.createElement("span");
    branch.textContent = technologyBranchName(technology.branch);
    const name = document.createElement("strong");
    name.textContent = technologyMessage(technology.id, "name");
    const state = document.createElement("small");
    state.className = "technology-node-state";
    button.append(branch, name, state);
    button.addEventListener("click", () => {
      selectedTechnologyId = technology.id;
      if (latestSnapshot) renderTechnologyUI(latestSnapshot);
    });
    technologyNodes.append(button);
    technologyNodeButtons.set(technology.id, button);
  }

  const addLink = (sourceId: TechnologyId, targetId: TechnologyId, alternative: boolean): void => {
    const source = technologyNodePosition(sourceId);
    const target = technologyNodePosition(targetId);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const sameColumn = source.x === target.x;
    const d = sameColumn
      ? `M ${source.x} ${source.y + TECHNOLOGY_NODE_HALF_HEIGHT} C ${source.x + 42} ${source.y + 58}, ${target.x + 42} ${target.y - 58}, ${target.x} ${target.y - TECHNOLOGY_NODE_HALF_HEIGHT}`
      : `M ${source.x + TECHNOLOGY_NODE_HALF_WIDTH} ${source.y} C ${source.x + 126} ${source.y}, ${target.x - 126} ${target.y}, ${target.x - TECHNOLOGY_NODE_HALF_WIDTH} ${target.y}`;
    path.setAttribute("d", d);
    path.classList.add("technology-link");
    if (alternative) path.classList.add("is-alternative");
    path.dataset.source = sourceId;
    path.dataset.target = targetId;
    technologyLinks.append(path);
  };
  for (const technology of TRIBAL_TECHNOLOGIES) {
    for (const prerequisite of technology.prerequisites) {
      addLink(prerequisite, technology.id, false);
    }
    for (const prerequisite of technology.alternativePrerequisites) {
      addLink(prerequisite, technology.id, true);
    }
  }
  technologyLinks.setAttribute("viewBox", `0 0 ${TECHNOLOGY_MAP_WIDTH} 760`);
}

function displayedResearch(research: TribeResearch): TribeResearch {
  if (!pendingResearchTechnologyId) return research;
  return {
    ...research,
    queuedTechnologyIds: researchPlanForTarget(research, pendingResearchTechnologyId),
  };
}

function researchPrerequisiteText(technologyId: TechnologyId): string {
  const technology = technologyDefinition(technologyId);
  const required = technology.prerequisites.map((id) => technologyMessage(id, "name"));
  if (technology.alternativePrerequisites.length > 0) {
    required.push(
      localization.text("technology.anyOneOf", {
        names: technology.alternativePrerequisites
          .map((id) => technologyMessage(id, "name"))
          .join(" / "),
      }),
    );
  }
  return required.length > 0
    ? required.join(" + ")
    : localization.text("technology.noPrerequisites");
}

function renderTechnologyUI(snapshot: PlayerWorldSnapshot): void {
  const tribe = snapshot.tribes.find(
    (candidate) => candidate.controllerPlayerId === snapshot.viewerPlayerId,
  );
  const authoritativeResearch = tribe
    ? snapshot.research.find((candidate) => candidate.tribeId === tribe.id)
    : undefined;
  if (!tribe || !authoritativeResearch) {
    knowledgeButtonStatus.textContent = localization.text("technology.chooseResearch");
    return;
  }
  if (
    pendingResearchTechnologyId &&
    authoritativeResearch.queuedTechnologyIds.includes(pendingResearchTechnologyId)
  ) {
    pendingResearchTechnologyId = undefined;
  }
  const research = displayedResearch(authoritativeResearch);
  const activeTechnologyId = research.queuedTechnologyIds[0] ?? null;
  const rate = tribeKnowledgePerWorldDay(
    tribe,
    snapshot.settlements,
    activeTechnologyId,
  );
  knowledgeRate.textContent = localization.number(rate);
  if (activeTechnologyId) {
    const percent = Math.floor(technologyProgressFraction(research, activeTechnologyId) * 100);
    knowledgeButtonStatus.textContent = `${technologyMessage(activeTechnologyId, "name")} · ${percent}%`;
  } else {
    knowledgeButtonStatus.textContent = localization.text("technology.chooseResearch");
  }

  const completed = new Set(research.completedTechnologyIds);
  const visibleFrontier = Math.min(
    4,
    Math.max(0, ...research.completedTechnologyIds.map((id) => technologyDefinition(id).column)) + 1,
  );
  for (const technology of TRIBAL_TECHNOLOGIES) {
    const state = technologyActionState(research, technology.id);
    const button = technologyNodeButtons.get(technology.id);
    if (!button) continue;
    button.dataset.state = state;
    button.classList.toggle("is-selected", technology.id === selectedTechnologyId);
    button.classList.toggle(
      "is-distant",
      state === "blocked" && technology.column > visibleFrontier,
    );
    button.style.setProperty(
      "--technology-progress",
      `${Math.floor(technologyProgressFraction(research, technology.id) * 100)}%`,
    );
    const stateElement = button.querySelector<HTMLElement>(".technology-node-state");
    if (stateElement) {
      stateElement.textContent = localization.text(`technology.states.${state}` as MessageKey);
    }
  }
  for (const link of technologyLinks.querySelectorAll<SVGPathElement>(".technology-link")) {
    const source = link.dataset.source;
    const target = link.dataset.target;
    const sourceComplete = source ? completed.has(source) : false;
    const targetComplete = target ? completed.has(target) : false;
    link.classList.toggle("is-mastered", sourceComplete && targetComplete);
    link.classList.toggle(
      "is-planned",
      Boolean(
        source &&
          target &&
          research.queuedTechnologyIds.includes(source) &&
          research.queuedTechnologyIds.includes(target),
      ),
    );
  }

  const selected = technologyDefinition(selectedTechnologyId);
  const selectedState: TechnologyActionState = technologyActionState(
    research,
    selected.id,
  );
  const fraction = technologyProgressFraction(research, selected.id);
  const invested =
    authoritativeResearch.progress.find((entry) => entry.technologyId === selected.id)
      ?.investedKnowledgeMinutes ?? 0;
  technologyDetailBranch.textContent = technologyBranchName(selected.branch);
  technologyDetailBranch.dataset.branch = selected.branch;
  technologyDetailName.textContent = technologyMessage(selected.id, "name");
  technologyDetailDescription.textContent = technologyMessage(selected.id, "description");
  technologyDetailProgress.textContent = localization.text("technology.progressValue", {
    percent: Math.floor(fraction * 100),
    invested: localization.number(Math.floor(invested / 1_440)),
    cost: localization.number(selected.cost),
  });
  technologyDetailCost.textContent = localization.text("technology.knowledgeCost", {
    cost: localization.number(selected.cost),
  });
  technologyDetailPrerequisites.textContent = researchPrerequisiteText(selected.id);
  technologyDetailUnlocks.textContent = technologyGameplayIsImplemented(selected)
    ? technologyMessage(selected.id, "unlock")
    : `${technologyMessage(selected.id, "unlock")} · ${localization.text("technology.futureSystem")}`;
  researchTechnologyButton.disabled =
    selectedState === "completed" || selectedState === "researching";
  researchTechnologyButton.textContent = localization.text(
    `technology.actions.${
      selectedState === "available"
        ? "select"
        : selectedState === "blocked"
          ? "plan"
          : selectedState === "queued"
            ? "change"
            : selectedState
    }` as MessageKey,
  );
  const affinity = cultureResearchAffinity(tribe.cultureId);
  technologyDetailNote.textContent =
    affinity === selected.branch
      ? localization.text("technology.affinity", {
          percent: GAMEPLAY_CONFIG.research.cultureAffinityPercent,
          branch: technologyBranchName(selected.branch),
        })
      : selectedState === "blocked"
        ? localization.text("technology.automaticPath")
        : pendingResearchTechnologyId && paused
          ? localization.text("technology.pausedQueued")
          : localization.text("technology.noAffinity");

  researchQueue.replaceChildren();
  research.queuedTechnologyIds.forEach((technologyId, index) => {
    const item = document.createElement("li");
    item.classList.toggle("is-active", index === 0);
    const order = document.createElement("span");
    order.textContent = String(index + 1).padStart(2, "0");
    const label = document.createElement("strong");
    label.textContent = technologyMessage(technologyId, "name");
    item.append(order, label);
    researchQueue.append(item);
  });
  researchQueueCount.textContent = localization.text("technology.queueCount", {
    count: research.queuedTechnologyIds.length,
  });
}

function openTechnologyPanel(): void {
  if (phase !== "playing" || !latestSnapshot) return;
  diplomacyPanel.hidden = true;
  eventPanel.hidden = true;
  technologyPanelOpen = true;
  technologyPanel.hidden = false;
  const research = latestSnapshot.research[0];
  selectedTechnologyId =
    pendingResearchTechnologyId ??
    research?.queuedTechnologyIds[0] ??
    selectedTechnologyId;
  renderTechnologyUI(latestSnapshot);
  closeTechnologyButton.focus();
}

function closeTechnologyPanel(): void {
  technologyPanelOpen = false;
  technologyPanel.hidden = true;
  knowledgeButton.focus();
}

function diplomacyActionMessage(
  action: DiplomaticAction,
  field: "name" | "description",
): string {
  return localization.text(
    `diplomacy.actionsById.${action}.${field}` as MessageKey,
  );
}

function agreementMessage(agreement: string): string {
  return localization.text(`diplomacy.agreementsById.${agreement}` as MessageKey);
}

function renderDiplomacyUI(snapshot: PlayerWorldSnapshot): void {
  const playerTribe = snapshot.tribes.find(
    (tribe) => tribe.controllerPlayerId === snapshot.viewerPlayerId,
  );
  const contacts = snapshot.tribes.filter(
    (tribe) => tribe.controllerPlayerId !== snapshot.viewerPlayerId,
  );
  diplomacyButtonStatus.textContent = contacts.length === 0
    ? localization.text("diplomacy.noContacts")
    : localization.text("diplomacy.contactCount", { count: contacts.length });
  if (!playerTribe) return;
  if (!contacts.some((tribe) => tribe.id === selectedDiplomaticTribeId)) {
    selectedDiplomaticTribeId = contacts[0]?.id;
  }
  diplomacyContacts.replaceChildren();
  for (const contact of contacts) {
    const relation = relationshipTo(snapshot, playerTribe.id, contact.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "diplomacy-contact";
    button.classList.toggle("is-active", contact.id === selectedDiplomaticTribeId);
    button.dataset.stance = relation?.stance ?? "neutral";
    const mark = document.createElement("i");
    mark.style.background = colorHex(contact.color);
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = contact.name;
    const stance = document.createElement("small");
    stance.textContent = formatStance(relation?.stance ?? "neutral");
    copy.append(name, stance);
    button.append(mark, copy);
    button.addEventListener("click", () => {
      selectedDiplomaticTribeId = contact.id;
      renderDiplomacyUI(snapshot);
    });
    diplomacyContacts.append(button);
  }
  const target = contacts.find((tribe) => tribe.id === selectedDiplomaticTribeId);
  const relation = target
    ? relationshipTo(snapshot, playerTribe.id, target.id)
    : undefined;
  if (!target || !relation) {
    diplomacyCulture.textContent = "—";
    diplomacyTribeName.textContent = localization.text("diplomacy.noContacts");
    diplomacyStance.textContent = "—";
    relationMeters.replaceChildren();
    diplomacyAgreements.textContent = localization.text("diplomacy.noAgreements");
    diplomacyProposals.textContent = localization.text("diplomacy.noIncoming");
    diplomacyActions.replaceChildren();
    return;
  }
  diplomacyCulture.textContent = target.cultureId;
  diplomacyTribeName.textContent = target.name;
  diplomacyStance.textContent = formatStance(relation.stance);
  diplomacyStance.dataset.stance = relation.stance;
  relationMeters.replaceChildren();
  const metrics = [
    ["opinion", relation.opinion, (relation.opinion + 100) / 2],
    ["trust", relation.trust, relation.trust],
    ["tension", relation.tension, relation.tension],
  ] as const;
  for (const [name, value, fraction] of metrics) {
    const meter = document.createElement("div");
    meter.dataset.metric = name;
    const label = document.createElement("span");
    label.textContent = localization.text(`diplomacy.${name}` as MessageKey);
    const bar = document.createElement("i");
    bar.style.setProperty("--relation-value", `${fraction}%`);
    const amount = document.createElement("strong");
    amount.textContent = value > 0 && name === "opinion" ? `+${value}` : String(value);
    meter.append(label, bar, amount);
    relationMeters.append(meter);
  }

  diplomacyAgreements.replaceChildren();
  if (relation.agreements.length === 0) {
    diplomacyAgreements.textContent = localization.text("diplomacy.noAgreements");
  } else {
    for (const agreement of relation.agreements) {
      const item = document.createElement("span");
      item.textContent = agreementMessage(agreement);
      diplomacyAgreements.append(item);
    }
  }

  diplomacyProposals.replaceChildren();
  const proposals = snapshot.diplomaticProposals.filter(
    (proposal) =>
      proposal.toTribeId === playerTribe.id &&
      proposal.fromTribeId === target.id,
  );
  const outgoing = snapshot.diplomaticProposals.filter(
    (proposal) =>
      proposal.fromTribeId === playerTribe.id &&
      proposal.toTribeId === target.id,
  );
  if (proposals.length === 0 && outgoing.length === 0) {
    diplomacyProposals.textContent = localization.text("diplomacy.noIncoming");
  }
  for (const proposal of proposals) {
    const row = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = diplomacyActionMessage(proposal.action, "name");
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = localization.text("diplomacy.accept");
    const reject = document.createElement("button");
    reject.type = "button";
    reject.textContent = localization.text("diplomacy.reject");
    const respond = (accepted: boolean): void => {
      postToWorker({
        type: "submit-command",
        command: {
          kind: "respond-diplomatic-proposal",
          playerId: snapshot.viewerPlayerId,
          sequence: ++commandSequence,
          proposalId: proposal.id,
          accept: accepted,
        },
      });
      diplomacyStatus.textContent = localization.text(
        accepted ? "diplomacy.accepted" : "diplomacy.rejected",
      );
    };
    accept.addEventListener("click", () => respond(true));
    reject.addEventListener("click", () => respond(false));
    row.append(label, accept, reject);
    diplomacyProposals.append(row);
  }
  for (const proposal of outgoing) {
    const row = document.createElement("div");
    row.className = "is-outgoing";
    row.textContent = localization.text("diplomacy.awaitingAnswer", {
      action: diplomacyActionMessage(proposal.action, "name"),
    });
    diplomacyProposals.append(row);
  }

  diplomacyActions.replaceChildren();
  const research = snapshot.research.find((entry) => entry.tribeId === playerTribe.id);
  const completed = new Set(research?.completedTechnologyIds ?? []);
  const cooldownTicks = Math.ceil(
    (DIPLOMACY_CONFIG.actionCooldownWorldDays * 1_440) /
      WORLD_MINUTES_PER_TICK,
  );
  const cooldownRemaining = relation.lastInteractionTick + cooldownTicks - snapshot.tick;
  for (const action of DIPLOMATIC_ACTIONS) {
    const missing = action.requiredTechnologyIds.filter(
      (technologyId) => !completed.has(technologyId),
    );
    const alreadyActive = Boolean(
      action.agreement && relation.agreements.includes(action.agreement),
    );
    const alreadyProposed = snapshot.diplomaticProposals.some(
      (proposal) =>
        proposal.fromTribeId === playerTribe.id &&
        proposal.toTribeId === target.id &&
        proposal.action === action.id,
    );
    const wrongWarState =
      (action.kind === "peace" && relation.stance !== "war") ||
      (action.kind !== "peace" && action.kind !== "war" && relation.stance === "war") ||
      (action.kind === "war" && relation.stance === "war");
    const button = document.createElement("button");
    button.type = "button";
    const name = document.createElement("strong");
    name.textContent = diplomacyActionMessage(action.id, "name");
    const description = document.createElement("small");
    description.textContent = diplomacyActionMessage(action.id, "description");
    button.append(name, description);
    button.disabled =
      missing.length > 0 ||
      alreadyActive ||
      alreadyProposed ||
      wrongWarState ||
      cooldownRemaining > 0;
    if (missing.length > 0) {
      button.title = localization.text("diplomacy.requiresKnowledge", {
        knowledge: missing.map((id) => technologyMessage(id, "name")).join(", "),
      });
    } else if (cooldownRemaining > 0) {
      button.title = localization.text("diplomacy.cooldown", {
        duration: localization.worldDuration(cooldownRemaining * WORLD_MINUTES_PER_TICK),
      });
    } else if (alreadyActive) {
      button.title = localization.text("diplomacy.alreadyActive");
    } else if (alreadyProposed) {
      button.title = localization.text("diplomacy.awaitingResponse");
    } else if (wrongWarState) {
      button.title = localization.text("diplomacy.wrongWarState");
    }
    button.addEventListener("click", () => {
      postToWorker({
        type: "submit-command",
        command: {
          kind: "take-diplomatic-action",
          playerId: snapshot.viewerPlayerId,
          sequence: ++commandSequence,
          tribeId: playerTribe.id,
          targetTribeId: target.id,
          action: action.id,
        },
      });
      diplomacyStatus.textContent = localization.text("diplomacy.actionSent", {
        action: diplomacyActionMessage(action.id, "name"),
      });
    });
    diplomacyActions.append(button);
  }
}

function openDiplomacyPanel(): void {
  if (phase !== "playing" || !latestSnapshot) return;
  closeTechnologyPanel();
  eventPanel.hidden = true;
  diplomacyPanel.hidden = false;
  renderDiplomacyUI(latestSnapshot);
  closeDiplomacyButton.focus();
}

function closeDiplomacyPanel(): void {
  diplomacyPanel.hidden = true;
  diplomacyButton.focus();
}

function eventVariables(snapshot: PlayerWorldSnapshot, event: GameEvent) {
  return {
    tribe: snapshot.tribes.find((tribe) => tribe.id === event.tribeId)?.name ?? "—",
    target: snapshot.tribes.find((tribe) => tribe.id === event.targetTribeId)?.name ?? localization.text("terms.unknown"),
    settlement: snapshot.settlements.find((settlement) => settlement.id === event.settlementId)?.name ?? localization.text("ui.camp"),
    unit: snapshot.units.find((unit) => unit.id === event.unitId)
      ? unitMessage(snapshot.units.find((unit) => unit.id === event.unitId)!.kind, "name")
      : localization.text("ui.fieldUnit"),
  };
}

function eventText(
  event: GameEvent,
  field: "title" | "body",
  snapshot: PlayerWorldSnapshot,
): string {
  return localization.text(
    `events.definitions.${event.definitionId}.${field}` as MessageKey,
    eventVariables(snapshot, event),
  );
}

function eventChoiceText(event: GameEvent, choiceId: string): string {
  return localization.text(
    `events.definitions.${event.definitionId}.choices.${choiceId}` as MessageKey,
  );
}

function eventEffectSummary(effects: TribalEventEffects): string {
  const parts: string[] = [];
  const signed = (value: number): string => value > 0 ? `+${value}` : String(value);
  for (const [key, value] of Object.entries(effects)) {
    if (!value) continue;
    parts.push(
      localization.text(`events.effects.${key}` as MessageKey, {
        value: signed(value),
      }),
    );
  }
  return parts.join(" · ");
}

function renderEventsUI(snapshot: PlayerWorldSnapshot): void {
  const pending = snapshot.events
    .filter((event) => event.status === "pending")
    .sort((left, right) => left.id - right.id);
  eventsButtonStatus.textContent = pending.length === 0
    ? localization.text("events.noPending")
    : localization.text("events.pendingCount", { count: pending.length });
  eventPendingCount.textContent = localization.text("events.pendingCount", {
    count: pending.length,
  });
  if (!snapshot.events.some((event) => event.id === displayedEventId)) {
    displayedEventId = pending[0]?.id ?? snapshot.events.at(-1)?.id;
  }
  const activeEvent = snapshot.events.find((event) => event.id === displayedEventId);
  eventChoices.replaceChildren();
  if (!activeEvent) {
    eventCategory.textContent = "—";
    eventTitle.textContent = localization.text("events.noEvents");
    eventDescription.textContent = localization.text("events.noEventsDescription");
  } else {
    eventCategory.textContent = localization.text(
      `events.categories.${activeEvent.category}` as MessageKey,
    );
    eventTitle.textContent = eventText(activeEvent, "title", snapshot);
    eventDescription.textContent = eventText(activeEvent, "body", snapshot);
    const definition = tribalEventDefinition(activeEvent.definitionId);
    if (activeEvent.status === "pending") {
      for (const choice of definition.choices) {
        const button = document.createElement("button");
        button.type = "button";
        const label = document.createElement("strong");
        label.textContent = eventChoiceText(activeEvent, choice.id);
        const effects = document.createElement("small");
        effects.textContent = eventEffectSummary(choice.effects);
        button.append(label, effects);
        button.addEventListener("click", () => {
          postToWorker({
            type: "submit-command",
            command: {
              kind: "resolve-event",
              playerId: snapshot.viewerPlayerId,
              sequence: ++commandSequence,
              eventId: activeEvent.id,
              choiceId: choice.id,
            },
          });
        });
        eventChoices.append(button);
      }
    } else if (activeEvent.selectedChoiceId) {
      const result = document.createElement("small");
      result.textContent = localization.text("events.chosen", {
        choice: eventChoiceText(activeEvent, activeEvent.selectedChoiceId),
      });
      eventChoices.append(result);
    }
  }
  eventHistory.replaceChildren();
  for (const historicEvent of [...snapshot.events].reverse().slice(0, 40)) {
    const item = document.createElement("li");
    item.classList.toggle("is-pending", historicEvent.status === "pending");
    item.classList.toggle("is-active", historicEvent.id === displayedEventId);
    const button = document.createElement("button");
    button.type = "button";
    const category = document.createElement("span");
    category.textContent = localization.text(
      `events.categories.${historicEvent.category}` as MessageKey,
    );
    const name = document.createElement("strong");
    name.textContent = eventText(historicEvent, "title", snapshot);
    const time = document.createElement("small");
    time.textContent = localization.text("format.simulationTick", {
      tick: localization.number(historicEvent.occurredTick),
    });
    button.append(category, name, time);
    button.addEventListener("click", () => {
      displayedEventId = historicEvent.id;
      renderEventsUI(snapshot);
    });
    item.append(button);
    eventHistory.append(item);
  }
}

function openEventPanel(): void {
  if (phase !== "playing" || !latestSnapshot) return;
  closeTechnologyPanel();
  diplomacyPanel.hidden = true;
  eventPanel.hidden = false;
  renderEventsUI(latestSnapshot);
  closeEventsButton.focus();
}

function closeEventPanel(): void {
  eventPanel.hidden = true;
  eventsButton.focus();
}

function selectDisplayedTechnology(): void {
  if (!latestSnapshot) return;
  const tribe = latestSnapshot.tribes.find(
    (candidate) => candidate.controllerPlayerId === latestSnapshot?.viewerPlayerId,
  );
  if (!tribe) return;
  pendingResearchTechnologyId = selectedTechnologyId;
  postToWorker({
    type: "submit-command",
    command: {
      kind: "select-research",
      playerId: latestSnapshot.viewerPlayerId,
      sequence: ++commandSequence,
      tribeId: tribe.id,
      technologyId: selectedTechnologyId,
    },
  });
  renderTechnologyUI(latestSnapshot);
}

const terrainSurveyColors: Record<string, number> = Object.fromEntries(
  Object.entries(PRESENTATION_CONFIG.survey.terrainColors).map(([terrain, color]) => [
    terrain,
    parseHexColor(color, `survey.terrainColors.${terrain}`),
  ]),
);

function formatSurveyFeature(feature: SurveyFeature | undefined): string | undefined {
  if (!feature) return undefined;
  const label =
    feature.kind === "unit"
      ? localization.text("format.unitFeature", {
          unit: unitMessage(feature.unitKind as UnitKind, "name"),
          tribe: feature.tribeName ?? localization.text("terms.unknown"),
        })
      : localization.text("format.settlementFeature", {
          name: feature.name,
          population: localization.number(feature.population),
        });
  return feature.intelligence === "remembered"
    ? localization.text("format.lastKnownFeature", { feature: label })
    : label;
}

function formatNaturalFeature(
  feature: SurveyNaturalFeature | undefined,
): string | undefined {
  if (!feature) return undefined;
  const name = localization.text(
    feature.riverClass === "major" ? "terms.majorRiver" : "terms.minorRiver",
  );
  return feature.regime === "intermittent" || feature.regime === "seasonal"
    ? localization.text("format.featureRegime", {
        feature: name,
        regime: localization.text(`terms.${feature.regime}` as MessageKey),
      })
    : name;
}

function formatSurveyAllegiance(info: MapSurveyInfo): string {
  if (!info.discovered) return localization.text("terms.unknown");
  if (!info.allegianceTribeName) return localization.text("terms.unclaimed");
  if (info.allegianceKind === "unclaimed") {
    return localization.text("terms.unclaimed");
  }
  if (info.allegianceKind === "player") {
    return localization.text("format.playerAllegiance", {
      tribe: info.allegianceTribeName,
    });
  }
  return localization.text("format.allegiance", {
    stance: formatStance(info.allegianceKind),
    tribe: info.allegianceTribeName,
  });
}

function renderSurvey(info: MapSurveyInfo | undefined): void {
  if (!info) {
    mapSurvey.dataset.discovered = "false";
    mapSurvey.dataset.allegiance = "unclaimed";
    surveyTitle.textContent = localization.text("survey.outsideTheater");
    surveyBiome.textContent = "—";
    surveyTerrain.textContent = "—";
    surveyVegetation.textContent = "—";
    surveyMoisture.textContent = "—";
    surveyNatural.textContent = "—";
    surveyHeight.textContent = "—";
    surveyFeature.textContent = "—";
    surveyBuildings.textContent = "—";
    surveyInfluence.textContent = localization.text("terms.unclaimed");
    surveyAllegiance.textContent = localization.text("terms.unknown");
    return;
  }
  mapSurvey.dataset.discovered = String(info.discovered);
  mapSurvey.dataset.allegiance = info.allegianceKind;
  const feature = formatSurveyFeature(info.feature);
  surveyTitle.textContent = info.discovered
    ? feature ??
      (info.biome
        ? localization.text(`biome.${info.biome}` as MessageKey)
        : localization.text("survey.surveyedLand"))
    : localization.text("survey.undiscovered");
  surveyBiome.textContent = info.biome
    ? localization.text(`biome.${info.biome}` as MessageKey)
    : localization.text("terms.unknown");
  surveyTerrain.textContent = info.terrain
    ? formatTerrain(info.terrain)
    : localization.text("terms.unknown");
  surveyVegetation.textContent = info.vegetation
    ? info.vegetation.type === "none"
      ? formatTerrain("none")
      : `${formatTerrain(info.vegetation.density)} ${formatTerrain(info.vegetation.type)}`
    : localization.text("terms.unknown");
  surveyMoisture.textContent =
    info.moisturePercent === undefined
      ? localization.text("terms.unknown")
      : `${localization.number(info.moisturePercent)}%`;
  surveyNatural.textContent = formatNaturalFeature(info.naturalFeature) ?? "—";
  surveyHeight.textContent =
    info.elevationMeters === undefined
      ? "—"
      : localization.text("format.meters", {
          distance: localization.number(info.elevationMeters),
        });
  surveyFeature.textContent = feature ?? "—";
  surveyBuildings.textContent = info.buildings
    ? info.buildings.length > 0
      ? info.buildings
          .map((building) => buildingMessage(building, "name"))
          .join(", ")
      : localization.text("terms.noPermanentWorks")
    : "—";
  surveyInfluence.textContent = info.discovered
    ? info.influenceTribeName
      ? localization.text("terms.influenceOf", {
          tribe: info.influenceTribeName,
        })
      : localization.text("terms.unclaimed")
    : localization.text("terms.unknown");
  surveyAllegiance.textContent = formatSurveyAllegiance(info);
  const surveyColor =
    info.color ?? (info.terrain ? terrainSurveyColors[info.terrain] : undefined);
  if (surveyColor === undefined) {
    mapSurvey.style.removeProperty("--survey-color");
  } else {
    mapSurvey.style.setProperty("--survey-color", colorHex(surveyColor));
  }
}

async function updateSurvey(point: TheaterPoint | undefined): Promise<void> {
  const request = ++surveyRequest;
  hoveredPoint = point;
  const active = activeTheater;
  const info = point && active
    ? await surveyMapPoint(
        point,
        latestSnapshot,
        active.surface,
        active.projection,
        active.manifest.render.metersPerPixel,
        (PRESENTATION_CONFIG.survey.entityHitRadiusScreenPixels *
          Math.min(
            PRESENTATION_CONFIG.markers.maximumCampScreenScale,
            Math.max(
              PRESENTATION_CONFIG.markers.minimumCampScreenScale,
              cameraScale,
            ),
          )) /
          cameraScale,
      )
    : undefined;
  if (request !== surveyRequest) return;
  renderSurvey(info);
}

function cultureForId(cultureId: string): CultureProfile {
  const culture = cultureProfiles.get(cultureId);
  if (!culture) {
    throw new Error(`Missing culture profile ${cultureId}`);
  }
  return culture;
}

function renderCultureProfile(profile: CultureProfile): void {
  cultureProfilePanel.hidden = false;
  cultureProfileName.textContent = profile.name;
  cultureFocus.textContent = profile.focus.join(" · ");
  cultureLegacyName.textContent = profile.legacy.name;
  cultureLegacyEffect.textContent = profile.legacy.effect;
  cultureTradeoffName.textContent = profile.tradeoff.name;
  cultureTradeoffEffect.textContent = profile.tradeoff.effect;
  cultureAcclimatizationName.textContent = profile.acclimatization.name;
  const movement = profile.acclimatization.terrain
    .map(
      ({ terrain, movementBonusPercent }) =>
        localization.text("format.paceBonus", {
          percent: localization.number(movementBonusPercent),
          terrain: formatTerrain(terrain),
        }),
    )
    .join(" · ");
  cultureAcclimatizationEffect.textContent =
    `${profile.acclimatization.description} ${movement}.`;
  cultureTechnologyName.textContent = profile.specialTechnology.name;
  cultureTechnologyEffect.textContent = profile.specialTechnology.effect;
  cultureTechnologyUnlock.textContent = localization.text("format.unlock", {
    name: profile.specialTechnology.unlock,
  });
}

function renderLocalizedConfiguration(): void {
  const formatPace = (kilometersPerHour: number): string =>
    localization.text("format.kilometersPerHour", {
      speed: localization.number(Number(kilometersPerHour.toFixed(1))),
    });
  renderTribalRosterOptions();
  const scout = tribalUnitDefinition("scout");
  unitDetection.textContent = localization.text("format.kilometers", {
    distance: localization.number(
      scout.detectionRadiusMeters / 1_000,
    ),
  });
  pacePlains.textContent = formatPace(flatScoutSpeedKilometersPerHour("plains"));
  paceForest.textContent = formatPace(
    flatScoutSpeedKilometersPerHour("plains", "forest", "moderate"),
  );
  paceJungle.textContent = formatPace(
    flatScoutSpeedKilometersPerHour("plains", "jungle", "dense"),
  );
  paceDesert.textContent = formatPace(flatScoutSpeedKilometersPerHour("desert"));
  paceTundra.textContent = formatPace(flatScoutSpeedKilometersPerHour("tundra"));
  paceIce.textContent = formatPace(flatScoutSpeedKilometersPerHour("ice"));
  paceNote.textContent = localization.text("ui.paceNote", {
    start: `${String(GAMEPLAY_CONFIG.scout.marchStartHour).padStart(2, "0")}:00`,
    end: `${String(GAMEPLAY_CONFIG.scout.marchEndHour).padStart(2, "0")}:00`,
  });
}

function syncSettingsControls(): void {
  for (const button of interfaceScaleButtons) {
    button.classList.toggle(
      "is-active",
      Number(button.dataset.interfaceScale) === settings.interfaceScale,
    );
  }
  for (const button of mapDetailButtons) {
    button.classList.toggle(
      "is-active",
      button.dataset.mapDetail === settings.mapDetail,
    );
  }
  for (const button of languageButtons) {
    button.classList.toggle(
      "is-active",
      button.dataset.language === settings.language,
    );
  }
  showMapSurveyInput.checked = settings.showMapSurvey;
  settingsStatus.textContent = localization.text("settings.mapDetailStatus", {
    detail: localization.text(`ui.${settings.mapDetail}` as MessageKey),
  });
}

function updateSettings(next: GameSettings): void {
  const languageChanged = settings.language !== next.language;
  settings = next;
  saveGameSettings(window.localStorage, settings);
  applyGameSettings(document.documentElement, appRoot, settings);
  if (languageChanged) {
    localization = new Localization(settings.language);
    localizeDocument(document, localization);
    renderLocalizedConfiguration();
    initializeTechnologyMap();
    if (selectedCulture) renderCultureProfile(selectedCulture);
  }
  syncSettingsControls();
  if (latestSnapshot) renderSnapshot(latestSnapshot);
  else if (phase === "culture-pick") showCulturePickPhase();
  else if (phase === "theater-pick") showTheaterPickPhase();
  else if (phase === "camp-pick") refreshCampPickPhase();
  if (hoveredPoint) void updateSurvey(hoveredPoint);
  if (isAtlasPickPhase()) {
    pickerCamera.handleResize();
  } else {
    activeTheater?.camera.handleResize();
  }
  app.render();
}

function showMainMenu(): void {
  menuOpen = true;
  technologyPanelOpen = false;
  technologyPanel.hidden = true;
  gameShell.hidden = false;
  mainMenuView.hidden = false;
  settingsView.hidden = true;
  beginGameLabel.textContent = localization.text(
    campaignStarted ? "ui.resumeCampaign" : "ui.beginCampaign",
  );
  hideTheaterTooltip();
  syncSettingsControls();
  requestAnimationFrame(() => beginGameButton.focus());
}

function closeMainMenu(): void {
  menuOpen = false;
  campaignStarted = true;
  gameShell.hidden = true;
  mainMenuView.hidden = false;
  settingsView.hidden = true;
  beginGameLabel.textContent = localization.text("ui.resumeCampaign");
  app.render();
}

function showSettings(): void {
  mainMenuView.hidden = true;
  settingsView.hidden = false;
  syncSettingsControls();
  requestAnimationFrame(() => closeSettingsButton.focus());
}

const worker = new Worker(new URL("./worker/simulation.worker.ts", import.meta.url), {
  type: "module",
});

function postToWorker(message: SimulationWorkerRequest): void {
  worker.postMessage(message);
}

function hideTheaterTooltip(): void {
  theaterTooltip.hidden = true;
}

function positionTheaterTooltip(clientX: number, clientY: number): void {
  theaterTooltip.hidden = false;
  const bounds = theaterTooltip.getBoundingClientRect();
  const panelBounds = foundingPanel.getBoundingClientRect();
  const {
    panelOverlapPaddingPixels,
    screenMarginPixels,
    tooltipGapPixels,
  } = PRESENTATION_CONFIG.interaction;
  let left = Math.max(
    screenMarginPixels,
    Math.min(
      clientX + tooltipGapPixels,
      window.innerWidth - bounds.width - screenMarginPixels,
    ),
  );
  const overlapsPanelHorizontally =
    left + bounds.width > panelBounds.left - panelOverlapPaddingPixels &&
    left < panelBounds.right + panelOverlapPaddingPixels;
  const overlapsPanelVertically =
    clientY + tooltipGapPixels + bounds.height >
      panelBounds.top - panelOverlapPaddingPixels &&
    clientY + tooltipGapPixels < panelBounds.bottom + panelOverlapPaddingPixels;
  if (overlapsPanelHorizontally && overlapsPanelVertically) {
    left = Math.max(
      screenMarginPixels,
      clientX - bounds.width - tooltipGapPixels,
    );
  }
  const top = Math.max(
    screenMarginPixels,
    Math.min(
      clientY + tooltipGapPixels,
      window.innerHeight - bounds.height - screenMarginPixels,
    ),
  );
  theaterTooltip.style.left = `${left}px`;
  theaterTooltip.style.top = `${top}px`;
}

function showCultureTooltip(
  culture: RegionalCulture,
  clientX: number,
  clientY: number,
): void {
  const profile = cultureForId(culture.id);
  theaterTooltip.dataset.mode = "culture";
  tooltipKicker.textContent = localization.text("terms.regionalCulture");
  tooltipCulture.textContent = profile.name;
  tooltipCultureFocus.textContent = profile.focus.join(" · ");
  tooltipRegion.textContent = localization.text("setup.broadTradition");
  positionTheaterTooltip(clientX, clientY);
}

function showTheaterTooltip(
  preview: TheaterPreview,
  clientX: number,
  clientY: number,
): void {
  const candidate = preview.candidate;
  const localCulture = cultureForId(candidate.cultureId);
  theaterTooltip.dataset.mode = "theater";
  tooltipKicker.textContent = localization.text("terms.regionalTheater");
  tooltipCulture.textContent = candidate.cultureName;
  tooltipCultureFocus.textContent = localCulture.focus.join(" · ");
  const selectedName =
    selectedCulture?.name ?? localization.text("setup.selectedCulture");
  tooltipRegion.textContent = preview.eligible
    ? localization.text("setup.eligibleTooltip", {
        culture: selectedName,
        percent: Math.round(preview.cultureOverlap.landSharePermille / 10),
        direction: formatCultureDirection(preview.cultureOverlap.direction),
      })
    : localization.text("setup.ineligibleTooltip", { culture: selectedName });
  const percent = (value: number): string =>
    `${(value / 10).toFixed(value % 10 === 0 ? 0 : 1)}%`;
  tooltipWater.textContent = percent(candidate.terrainPermille.water);
  tooltipPlains.textContent = percent(candidate.terrainPermille.plains);
  tooltipForest.textContent = percent(candidate.vegetationPermille.forest);
  tooltipJungle.textContent = percent(candidate.vegetationPermille.jungle);
  tooltipHills.textContent = percent(candidate.terrainPermille.hills);
  tooltipMountains.textContent = percent(candidate.terrainPermille.mountains);
  tooltipDesert.textContent = percent(candidate.terrainPermille.desert);
  tooltipTundra.textContent = percent(candidate.terrainPermille.tundra);
  tooltipIce.textContent = percent(candidate.terrainPermille.ice);
  positionTheaterTooltip(clientX, clientY);
}

function previewAtlasAt(clientX: number, clientY: number): void {
  const point = pickerCamera.toWorldPoint(clientX, clientY);
  if (phase === "culture-pick") {
    const culture = theaterPicker.hoverCultureAt(point);
    if (culture) showCultureTooltip(culture, clientX, clientY);
    else hideTheaterTooltip();
    return;
  }
  if (phase !== "theater-pick" || !selectedCulture) {
    hideTheaterTooltip();
    return;
  }
  const preview = theaterPicker.hoverTheaterAt(point, selectedCulture.id);
  if (preview) showTheaterTooltip(preview, clientX, clientY);
  else hideTheaterTooltip();
}

function previewCampCultureAt(clientX: number, clientY: number): void {
  const active = activeTheater;
  if (!active || phase !== "camp-pick") return;
  const point = active.camera.toWorldPoint(clientX, clientY);
  const culture = cultureField.cultureAt(active.projection.toGeographic(point));
  const hoveredCultureId = resolveCampCultureHover(
    active.culture.id,
    culture?.id,
  );
  active.map.setCampCultureHover(hoveredCultureId);
  if (hoveredCultureId && culture) {
    showCultureTooltip(culture, clientX, clientY);
  } else {
    hideTheaterTooltip();
  }
}

function selectCultureAt(point: TheaterPoint): void {
  if (phase !== "culture-pick") return;
  const regionalCulture = theaterPicker.cultureAt(point);
  if (!regionalCulture) {
    foundingMessage.textContent = localization.text("setup.chooseCultureInvalid");
    return;
  }
  const nextCulture = cultureForId(regionalCulture.id);
  theaterPicker.setSelectedCulture(nextCulture.id);
  selectedCulture = nextCulture;
  renderCultureProfile(nextCulture);
  theaterName.textContent = nextCulture.name;
  foundingMessage.textContent = localization.text("setup.cultureSelected", {
    culture: nextCulture.name,
  });
  phaseForwardButton.disabled = false;
  app.render();
}

function showTheaterSelection(selection: TheaterSelection): void {
  if (!selectedCulture) return;
  const candidate = selection.candidate;
  theaterName.textContent = localization.text("setup.cultureFrontier", {
    culture: selectedCulture.name,
  });
  foundingTitle.textContent = localization.text("setup.chooseTheaterTitle");
  foundingMessage.textContent = localization.text("setup.theaterSummary", {
    center: candidate.cultureName,
    culture: selectedCulture.name,
    percent: Math.round(selection.cultureOverlap.landSharePermille / 10),
    direction: formatCultureDirection(selection.cultureOverlap.direction),
    restriction: localization.text("setup.culturalReach"),
  });
  phaseForwardButton.disabled = false;
  rerollTheaterButton.disabled = false;
  app.render();
}

function selectTheaterAt(point: TheaterPoint): void {
  if (phase !== "theater-pick" || !selectedCulture) return;
  const selection = theaterPicker.selectTheaterAt(point, selectedCulture.id);
  if (!selection) {
    foundingMessage.textContent = localization.text("setup.invalidTheater", {
      culture: selectedCulture.name,
    });
    return;
  }
  showTheaterSelection(selection);
}

function rerollTheater(): void {
  if (phase !== "theater-pick" || !selectedCulture) return;
  phaseForwardButton.disabled = true;
  rerollTheaterButton.disabled = true;
  const selection = theaterPicker.reroll(selectedCulture.id);
  showTheaterSelection(selection);
}

function showCulturePickPhase(): void {
  phase = "culture-pick";
  appRoot.dataset.phase = phase;
  theaterPicker.root.visible = true;
  theaterPicker.setMode("culture");
  theaterActions.hidden = true;
  phaseBackButton.disabled = true;
  phaseForwardButton.textContent = localization.text("setup.chooseTheater");
  phaseForwardButton.disabled = !selectedCulture;
  foundingTitle.textContent = localization.text("setup.chooseCultureTitle");
  foundingMessage.textContent = selectedCulture
    ? localization.text("setup.cultureStillSelected", {
        culture: selectedCulture.name,
      })
    : localization.text("setup.chooseCultureMessage");
  foundingHelp.textContent = localization.text("setup.chooseCultureHelp");
  theaterName.textContent =
    selectedCulture?.name ?? localization.text("terms.culturalAtlas");
  theaterStats.textContent = localization.text("setup.cultureCount", {
    count: localization.number(cultureField.cultures.length),
  });
  if (selectedCulture) renderCultureProfile(selectedCulture);
  hideTheaterTooltip();
  syncClock();
  app.render();
}

function showTheaterPickPhase(): void {
  if (!selectedCulture) return;
  phase = "theater-pick";
  appRoot.dataset.phase = phase;
  theaterPicker.root.visible = true;
  theaterPicker.setMode("theater");
  theaterActions.hidden = false;
  phaseBackButton.disabled = false;
  phaseForwardButton.textContent = localization.text("setup.enterTheater");
  foundingTitle.textContent = localization.text("setup.chooseTheaterTitle");
  foundingHelp.textContent = localization.text("setup.chooseCultureHelp");
  theaterStats.textContent = localization.text("format.landTheaters", {
    count: localization.number(theaterCatalog.candidateCount),
  });
  renderCultureProfile(selectedCulture);
  const selection = theaterPicker.currentSelection();
  if (selection) showTheaterSelection(selection);
  else {
    theaterName.textContent = localization.text("setup.cultureReach", {
      culture: selectedCulture.name,
    });
    foundingMessage.textContent = localization.text("setup.surveyTheaters", {
      culture: selectedCulture.name,
    });
    rerollTheaterButton.disabled = true;
    phaseForwardButton.disabled = true;
  }
  hideTheaterTooltip();
  syncClock();
  app.render();
}

async function enterSelectedTheater(): Promise<void> {
  const selection = theaterPicker.currentSelection();
  if (!selection || phase !== "theater-pick" || !selectedCulture) {
    return;
  }
  phaseForwardButton.disabled = true;
  rerollTheaterButton.disabled = true;
  showLoading(
    localization.text("loading.theaterPreparing", {
      theater: selectedCulture.name,
    }),
    localization.text("loading.prepareTheater"),
  );
  let theater;
  try {
    theater = await ensureTheaterAsset(selection.candidate);
  } catch (error) {
    hideLoading();
    phaseForwardButton.disabled = false;
    rerollTheaterButton.disabled = false;
    foundingMessage.textContent =
      error instanceof Error
        ? localization.text("loading.theaterFailedReason", {
            reason: error.message,
          })
        : localization.text("loading.theaterFailed");
    return;
  }
  updateLoading(localization.text("loading.loadingRelief"));
  const map = new RegionalTheaterRenderer(
    theater,
    () => app.render(),
    selectSettlement,
    selectUnit,
    () => mapDetailLevelBias(settings.mapDetail),
  );
  map.setCampCultureField(cultureField, selectedCulture.id);
  map.setFogVisible(false);
  app.stage.addChild(map.root);
  const [, landMask, surface] = await Promise.all([
    map.initialize(),
    TheaterLandMask.load(theater),
    TheaterSurface.load(theater),
  ]);
  hideTheaterTooltip();
  theaterPicker.root.visible = false;
  const projection = new RegionalTheaterProjection(theater);
  const camera = new CameraController(
    app.canvas,
    map.root,
    {
      width: theater.render.width,
      height: theater.render.height,
    },
    (state) => {
      cameraScale = state.scale;
      map.setViewport(state);
      updateScaleReadout(state, theater);
      if (hoveredPoint) {
        updateSurvey(hoveredPoint);
      }
      app.render();
      },
      () => !menuOpen && (phase === "camp-pick" || phase === "playing"),
      "edge-to-center",
    );
  activeTheater = {
    manifest: theater,
    projection,
    map,
    landMask,
    surface,
    camera,
    openingRoll: selection.roll,
    culture: selectedCulture,
    cultureOverlap: selection.cultureOverlap,
  };
  phase = "camp-pick";
  appRoot.dataset.phase = phase;
  refreshCampPickPhase();
  hideLoading();
  syncClock();
  app.render();
}

function refreshCampPickPhase(): void {
  const active = activeTheater;
  if (!active || phase !== "camp-pick") return;
  theaterName.textContent = active.manifest.name;
  theaterStats.textContent = localization.text("format.chooseKilometerTheater", {
    distance: localization.number(active.manifest.extent.widthMeters / 1_000),
  });
  foundingTitle.textContent = localization.text("setup.chooseCampTitle");
  foundingMessage.textContent = spawnChoice
    ? localization.text("setup.selectedCamp", { culture: active.culture.name })
    : localization.text("setup.chooseCampReach", {
        culture: active.culture.name,
        direction: formatCultureDirection(active.cultureOverlap.direction),
      });
  foundingHelp.textContent = localization.text("setup.chooseCampHelp");
  theaterActions.hidden = true;
  phaseBackButton.disabled = false;
  phaseForwardButton.textContent = localization.text("setup.foundCamp");
  phaseForwardButton.disabled = !spawnChoice;
}

function chooseSpawn(point: TheaterPoint): void {
  const active = activeTheater;
  if (!active || phase !== "camp-pick") {
    return;
  }
  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x >= active.manifest.render.width ||
    point.y >= active.manifest.render.height
  ) {
    foundingMessage.textContent = localization.text("setup.chooseCampMessage");
    app.render();
    return;
  }
  if (!active.landMask.isLand(point)) {
    spawnChoice = undefined;
    active.map.setSpawnCandidate(undefined);
    phaseForwardButton.disabled = true;
    foundingMessage.textContent = localization.text("setup.waterCamp");
    app.render();
    return;
  }

  const position = active.projection.toGeographic(point);
  const siteCulture = theaterPicker.cultureAtGeographic(position);
  const cultureClick = resolveCampCultureClick(
    active.culture.id,
    siteCulture?.id,
  );
  if (cultureClick.kind === "uninhabited") {
    spawnChoice = undefined;
    active.map.setSpawnCandidate(undefined);
    phaseForwardButton.disabled = true;
    foundingMessage.textContent = localization.text("setup.uninhabitedCamp");
    app.render();
    return;
  }
  let switchedCulture = false;
  if (cultureClick.kind === "switch") {
    const nextCulture = cultureForId(cultureClick.cultureId);
    const selection = theaterPicker.adoptCultureForCurrentTheater(
      nextCulture.id,
    );
    selectedCulture = nextCulture;
    active.culture = nextCulture;
    if (selection) active.cultureOverlap = selection.cultureOverlap;
    active.map.setCampCultureField(cultureField, nextCulture.id);
    renderCultureProfile(nextCulture);
    switchedCulture = true;
  }
  spawnChoice = { point, position };
  active.map.setSpawnCandidate(point);
  phaseForwardButton.disabled = false;
  foundingMessage.textContent =
    switchedCulture
      ? localization.text("setup.switchedCamp", { culture: active.culture.name })
      : localization.text("setup.selectedCamp", { culture: active.culture.name });
  app.render();
}

async function confirmSpawn(): Promise<void> {
  const active = activeTheater;
  if (!spawnChoice || phase !== "camp-pick" || !active) {
    return;
  }
  phaseForwardButton.disabled = true;
  showLoading(
    localization.text("loading.prepareSurface", {
      resolution: localization.number(active.manifest.semantic.metersPerCell),
    }),
    localization.text("loading.assembleSurface"),
  );
  let grid: Awaited<ReturnType<typeof active.surface.toSimulationDefinition>>;
  try {
    grid = await active.surface.toSimulationDefinition();
  } catch (error) {
    hideLoading();
    phaseForwardButton.disabled = false;
    foundingMessage.textContent =
      error instanceof Error
        ? localization.text("loading.surfaceFailedReason", {
            reason: error.message,
          })
        : localization.text("loading.surfaceFailed");
    app.render();
    return;
  }
  active.map.prepareMapViews(grid);
  active.map.setMapView(mapViewMode);
  phase = "playing";
  appRoot.dataset.phase = phase;
  foundingPanel.hidden = true;
  pickerCamera.destroy();
  app.stage.removeChild(theaterPicker.root);
  theaterPicker.destroy();
  active.map.setSpawnCandidate(undefined);
  active.map.setCampCultureFieldVisible(false);
  active.map.setFogVisible(true);
  const scenario = createHellenicTheaterScenario(
    spawnChoice.position,
    grid,
    active.openingRoll,
    active.culture,
  );
  worker.postMessage({
    type: "initialize",
    scenario,
    viewPlayerId: GAMEPLAY_CONFIG.openingScenario.playerId,
  } satisfies SimulationWorkerRequest, [
    grid.terrainCells.buffer,
    grid.vegetationCells.buffer,
    grid.moistureCells.buffer,
    grid.riverCells.buffer,
    grid.elevationMeters.buffer,
  ]);
  hideLoading();
  syncClock();
  app.render();
}

function returnToTheaterPickPhase(): void {
  const active = activeTheater;
  if (phase !== "camp-pick" || !active) return;
  phase = "theater-pick";
  appRoot.dataset.phase = phase;
  spawnChoice = undefined;
  active.map.setSpawnCandidate(undefined);
  active.camera.destroy();
  app.stage.removeChild(active.map.root);
  active.map.destroy();
  activeTheater = undefined;
  hoveredPoint = undefined;
  renderSurvey(undefined);
  theaterPicker.root.visible = true;
  foundingPanel.hidden = false;
  showTheaterPickPhase();
  pickerCamera.handleResize();
}

function goBackSetupPhase(): void {
  if (phase === "theater-pick") showCulturePickPhase();
  else if (phase === "camp-pick") returnToTheaterPickPhase();
}

async function goForwardSetupPhase(): Promise<void> {
  if (phase === "culture-pick") showTheaterPickPhase();
  else if (phase === "theater-pick") await enterSelectedTheater();
  else if (phase === "camp-pick") await confirmSpawn();
}

function updateSelectedPanel(
  snapshot: PlayerWorldSnapshot,
  tribe: Tribe,
  settlement: Settlement,
): void {
  const playerTribe = snapshot.tribes.find(
    (candidate) => candidate.controllerPlayerId === snapshot.viewerPlayerId,
  );
  const stance = playerTribe
    ? relationTo(snapshot, playerTribe.id, tribe.id)
    : "neutral";
  const playerControlled = tribe.controllerPlayerId === snapshot.viewerPlayerId;
  selectedName.textContent = tribe.name;
  selectedStatus.textContent = playerControlled
    ? localization.text("terms.yourTribe")
    : localization.text("format.rivalStatus", { stance: formatStance(stance) });
  selectedStatus.dataset.stance = playerControlled ? "player" : stance;
  selectedPopulation.textContent = localization.number(settlement.population);
  selectedWarriors.textContent = localization.number(tribe.warriors);
  selectedInfluence.textContent = localization.text("format.influenceKilometers", {
    distance: localization.number(settlement.influenceRadiusMeters / 1_000),
  });
}

function updateTribeList(snapshot: PlayerWorldSnapshot): void {
  const playerTribe = snapshot.tribes.find(
    (tribe) => tribe.controllerPlayerId === snapshot.viewerPlayerId,
  );
  const settlementByTribe = new Map(
    snapshot.settlements.map((settlement) => [settlement.tribeId, settlement]),
  );
  const stanceByTribe = new Map<number, DiplomaticStance>();
  if (playerTribe) {
    for (const relation of snapshot.relations) {
      if (relation.firstTribeId === playerTribe.id) {
        stanceByTribe.set(relation.secondTribeId, relation.stance);
      } else if (relation.secondTribeId === playerTribe.id) {
        stanceByTribe.set(relation.firstTribeId, relation.stance);
      }
    }
  }
  tribeList.replaceChildren();
  for (const tribe of snapshot.tribes) {
    const settlement = settlementByTribe.get(tribe.id);
    if (!settlement) {
      continue;
    }
    const stance = stanceByTribe.get(tribe.id) ?? "neutral";
    const item = document.createElement("li");
    const button = document.createElement("button");
    const swatch = document.createElement("span");
    const name = document.createElement("span");
    const strength = document.createElement("span");
    button.type = "button";
    button.className = "tribe-row";
    button.classList.toggle("is-selected", tribe.id === selectedTribeId);
    button.dataset.stance =
      tribe.controllerPlayerId === snapshot.viewerPlayerId ? "player" : stance;
    button.addEventListener("click", () => selectTribe(tribe.id));
    swatch.className = "tribe-swatch";
    swatch.style.backgroundColor = `#${tribe.color.toString(16).padStart(6, "0")}`;
    name.className = "tribe-name";
    name.textContent = tribe.name;
    strength.className = "tribe-strength";
    strength.textContent = localization.number(tribe.warriors);
    button.append(swatch, name, strength);
    item.append(button);
    tribeList.append(item);
  }
}

function closeConstruction(): void {
  selectedConstructionSettlementId = undefined;
  constructionPanel.hidden = true;
}

function administratorMessage(
  administrator: SettlementAdministrator,
  part: "name" | "description" | "effect",
): string {
  return localization.text(
    `administration.roles.${administrator}.${part}` as MessageKey,
  );
}

function selectCampTab(nextTab: "works" | "train" | "administration"): void {
  campTab = nextTab;
  campWorksView.hidden = campTab !== "works";
  campTrainView.hidden = campTab !== "train";
  campAdministrationView.hidden = campTab !== "administration";
  for (const button of campTabButtons) {
    button.classList.toggle("is-active", button.dataset.campTab === campTab);
  }
  if (latestSnapshot) {
    updateConstructionPanel(latestSnapshot);
  }
}

function updateConstructionPanel(snapshot: PlayerWorldSnapshot): void {
  if (selectedConstructionSettlementId === undefined) {
    return;
  }
  const settlement = snapshot.settlements.find(
    (candidate) => candidate.id === selectedConstructionSettlementId,
  );
  const tribe = settlement
    ? snapshot.tribes.find((candidate) => candidate.id === settlement.tribeId)
    : undefined;
  if (!settlement || tribe?.controllerPlayerId !== snapshot.viewerPlayerId) {
    closeConstruction();
    return;
  }

  const research = snapshot.research.find(
    (candidate) => candidate.tribeId === settlement.tribeId,
  );
  const completedTechnologyIds = new Set(
    research?.completedTechnologyIds ?? [],
  );
  const villagePlanningUnlocked = completedTechnologyIds.has("village-planning");
  const villageAdministrationUnlocked = completedTechnologyIds.has(
    VILLAGE_ADMINISTRATION_TECHNOLOGY_ID,
  );
  constructionTitle.textContent = settlement.name;
  upgradeVillageButton.disabled =
    settlement.tier === "village" || !villagePlanningUnlocked;
  villageAction.textContent = localization.text(
    settlement.tier === "village"
      ? "construction.established"
      : villagePlanningUnlocked
        ? "construction.upgrade"
        : "administration.locked",
  );
  for (const button of campBuildingOptions.querySelectorAll<HTMLButtonElement>(
    "[data-building-id]",
  )) {
    const building = button.dataset.buildingId as CampBuilding;
    const definition = tribalBuildingDefinition(building);
    const built = settlement.buildings.includes(building);
    const tierLocked = !tierMeetsMinimum(settlement.tier, definition.minimumTier);
    const technologyLocked = Boolean(
      definition.requiredTechnologyId &&
        !completedTechnologyIds.has(definition.requiredTechnologyId),
    );
    button.disabled = built || tierLocked || technologyLocked;
    button.dataset.state = built
      ? "completed"
      : tierLocked || technologyLocked
        ? "locked"
        : "available";
    const action = button.querySelector<HTMLElement>(".roster-action");
    if (action) {
      action.textContent = built
        ? localization.text("construction.built")
        : tierLocked
          ? localization.text("roster.requiresVillage")
          : definition.requiredTechnologyId && technologyLocked
            ? localization.text("roster.requiresTechnology", {
                technology: technologyMessage(
                  definition.requiredTechnologyId,
                  "name",
                ),
              })
            : localization.text("construction.build");
    }
  }
  for (const button of campUnitOptions.querySelectorAll<HTMLButtonElement>(
    "[data-unit-kind]",
  )) {
    const unitKind = button.dataset.unitKind as UnitKind;
    const definition = tribalUnitDefinition(unitKind);
    const cultureAvailable = unitIsAvailableToCulture(definition, tribe.cultureId);
    button.hidden = !cultureAvailable;
    const trainedCount = snapshot.units.filter(
      (unit) =>
        unit.homeSettlementId === settlement.id && unit.kind === unitKind,
    ).length;
    const atCapacity = trainedCount >= definition.maximumPerSettlement;
    const tierLocked = !tierMeetsMinimum(settlement.tier, definition.minimumTier);
    const missingTechnology = definition.requiredTechnologyIds.find(
      (technologyId) => !completedTechnologyIds.has(technologyId),
    );
    const missingBuilding =
      definition.requiredBuildingId &&
      !settlement.buildings.includes(definition.requiredBuildingId)
        ? definition.requiredBuildingId
        : null;
    const insufficientPopulation =
      settlement.population <
      definition.populationCost + definition.minimumPopulationAfterTraining;
    button.disabled =
      !cultureAvailable ||
      atCapacity ||
      tierLocked ||
      Boolean(missingTechnology) ||
      Boolean(missingBuilding) ||
      insufficientPopulation;
    button.dataset.state = atCapacity
      ? "completed"
      : tierLocked || missingTechnology || missingBuilding
        ? "locked"
        : insufficientPopulation
          ? "unavailable"
          : "available";
    const action = button.querySelector<HTMLElement>(".roster-action");
    if (action) {
      action.textContent = atCapacity
        ? localization.text("roster.capacity", {
            count: localization.number(trainedCount),
            maximum: localization.number(definition.maximumPerSettlement),
          })
        : tierLocked
          ? localization.text("roster.requiresVillage")
          : missingTechnology
            ? localization.text("roster.requiresTechnology", {
                technology: technologyMessage(missingTechnology, "name"),
              })
            : missingBuilding
              ? localization.text("roster.requiresBuilding", {
                  building: buildingMessage(missingBuilding, "name"),
                })
              : insufficientPopulation
                ? localization.text("roster.needsPopulation", {
                    count: localization.number(
                      definition.populationCost +
                        definition.minimumPopulationAfterTraining,
                    ),
                  })
                : localization.text("roster.trainCost", {
                    count: localization.number(definition.populationCost),
                    trained: localization.number(trainedCount),
                    maximum: localization.number(definition.maximumPerSettlement),
                  });
    }
  }
  administrationCurrent.textContent = administratorMessage(
    settlement.administrator,
    "name",
  );
  for (const button of administrationRoleButtons) {
    const administrator = button.dataset
      .administrationRole as SettlementAdministrator;
    const role = administrationRoleDefinition(administrator);
    const assigned = settlement.administrator === administrator;
    const locked =
      role.villageOnly &&
      (settlement.tier !== "village" || !villageAdministrationUnlocked);
    button.disabled = assigned || locked;
    button.dataset.state = assigned ? "assigned" : locked ? "locked" : "available";
    const state = button.querySelector<HTMLElement>(".administration-role-state");
    if (state) {
      state.textContent = localization.text(
        assigned
          ? "administration.assigned"
          : locked
            ? "administration.locked"
            : "administration.assign",
      );
    }
  }
  constructionStatus.textContent =
    campTab === "administration"
      ? settlement.tier !== "village"
        ? localization.text("administration.requiresVillage")
        : !villageAdministrationUnlocked
          ? localization.text("administration.requiresTechnology")
          : localization.text("administration.chooseRole")
      : campTab === "train"
        ? localization.text("roster.chooseUnit")
        : localization.text("roster.chooseBuilding");
}

function clearUnitSelection(): void {
  if (selectedUnitIds.size === 0) {
    return;
  }
  selectedUnitIds = new Set();
  activeTheater?.map.setSelectedUnits(selectedUnitIds);
  unitPanel.hidden = true;
  app.render();
}

function updateUnitPanel(snapshot: PlayerWorldSnapshot): void {
  const selected = snapshot.units.filter((unit) => selectedUnitIds.has(unit.id));
  if (selected.length === 0) {
    selectedUnitIds = new Set();
    activeTheater?.map.setSelectedUnits(selectedUnitIds);
    unitPanel.hidden = true;
    return;
  }
  unitPanel.hidden = false;
  const selectedKinds = new Set(selected.map((unit) => unit.kind));
  unitTitle.textContent =
    selected.length === 1
      ? unitMessage(selected[0]!.kind, "name")
      : selectedKinds.size === 1
        ? localization.text("combat.groupCount", {
            count: localization.number(selected.length),
            name: unitMessage(selected[0]!.kind, "plural"),
          })
        : localization.text("roster.mixedUnits", {
          count: localization.number(selected.length),
        });
  const groundNames = new Set(
    selected.map((unit) => {
      const terrain = formatTerrain(unit.terrain);
      return unit.vegetation === "none"
        ? terrain
        : `${formatTerrain(unit.vegetationDensity)} ${formatTerrain(unit.vegetation)} · ${terrain}`;
    }),
  );
  const movementPaces = new Set(selected.map((unit) => unit.speedMetersPerHour));
  const slopes = new Set(selected.map((unit) => unit.slopeDegrees));
  unitTerrain.textContent =
    groundNames.size === 1
      ? [...groundNames][0]!
        : localization.text("terms.mixed");
  unitSlope.textContent =
    slopes.size === 1
      ? selected[0]!.slopeDegrees > 0.05
        ? localization.text("terms.uphill", {
            degrees: localization.number(
              Number(selected[0]!.slopeDegrees.toFixed(1)),
            ),
          })
        : selected[0]!.slopeDegrees < -0.05
          ? localization.text("terms.downhill", {
              degrees: localization.number(
                Number(selected[0]!.slopeDegrees.toFixed(1)),
              ),
            })
          : localization.text("terms.level")
      : localization.text("terms.mixed");
  unitPace.textContent =
    movementPaces.size === 1
      ? localization.text("format.kilometersPerHour", {
          speed: localization.number(
            Number((selected[0]!.speedMetersPerHour / 1_000).toFixed(1)),
          ),
        })
      : localization.text("terms.mixed");
  const detectionRanges = new Set(
    selected.map(
      (unit) => tribalUnitDefinition(unit.kind).detectionRadiusMeters,
    ),
  );
  unitDetection.textContent =
    detectionRanges.size === 1
      ? localization.text("format.kilometers", {
          distance: localization.number([...detectionRanges][0]! / 1_000),
        })
      : localization.text("terms.mixed");
  const combatStates = selected
    .map((unit) => unit.combat)
    .filter((combat) => combat !== null);
  const onlyCombat = selected.length === 1 ? selected[0]!.combat : null;
  unitStrength.textContent = combatStates.length === 0
    ? "—"
    : `${combatStates.reduce((sum, combat) => sum + combat.strength, 0)}/${combatStates.reduce((sum, combat) => sum + combat.maximumStrength, 0)}`;
  unitMorale.textContent = onlyCombat ? `${Math.round(onlyCombat.moralePermille / 10)}%` : "—";
  unitCohesion.textContent = onlyCombat ? `${Math.round(onlyCombat.cohesionPermille / 10)}%` : "—";
  unitFatigue.textContent = onlyCombat ? `${Math.round(onlyCombat.fatiguePermille / 10)}%` : "—";
  unitExperience.textContent = onlyCombat
    ? localization.text("combat.experienceValue", {
        rank: localization.text(`combat.ranks.${veterancyRank(onlyCombat.experience)}` as MessageKey),
        experience: localization.number(onlyCombat.experience),
      })
    : "—";
  combatOrders.hidden = !onlyCombat;
  if (onlyCombat) {
    const definition = tribalUnitDefinition(selected[0]!.kind).combat!;
    combatFormation.replaceChildren(...definition.formations.map((formation) => {
      const option = document.createElement("option");
      option.value = formation;
      option.textContent = localization.text(`combat.formations.${formation}` as MessageKey);
      return option;
    }));
    combatDoctrine.value = onlyCombat.order?.doctrine ?? "balanced";
    combatFormation.value = onlyCombat.order?.formation ?? definition.formations[0]!;
    combatPursuit.value = onlyCombat.order?.pursuit ?? "controlled";
  }
  const arrivals = selected.map((unit) =>
    unit.route.length > 0 && unit.remainingTravelMinutes !== null
      ? scheduleScoutArrival(snapshot.worldTime, unit.remainingTravelMinutes)
      : null,
  );
  unitArrival.textContent =
    arrivals.length === 1 && arrivals[0]
      ? localization.worldDateTime(arrivals[0].arrival)
      : arrivals.some(Boolean)
        ? localization.text("terms.mixed")
        : "—";
  const moving = selected.some((unit) => unit.route.length > 0);
  unitStatus.textContent = moving
    ? paused
      ? localization.text("orders.pausedOrder")
      : isScoutTravelMinute(snapshot.worldTime)
        ? localization.text("orders.travelling")
        : localization.text("orders.resting", {
            time: `${String(GAMEPLAY_CONFIG.scout.marchStartHour).padStart(2, "0")}:00`,
          })
    : localization.text("orders.instructions");
}

function formatTerrain(terrainType: string): string {
  return localization.text(`terrain.${terrainType}` as MessageKey);
}

function selectUnit(unitId: number): void {
  const active = activeTheater;
  if (!latestSnapshot || !active) {
    return;
  }
  const unit = latestSnapshot.units.find((candidate) => candidate.id === unitId);
  const tribe = unit
    ? latestSnapshot.tribes.find((candidate) => candidate.id === unit.tribeId)
    : undefined;
  if (!unit) {
    return;
  }
  if (tribe?.controllerPlayerId !== latestSnapshot.viewerPlayerId) {
    const attacker = latestSnapshot.units.find(
      (candidate) => selectedUnitIds.has(candidate.id) && candidate.combat !== null,
    );
    if (!attacker || !unit.combat || unit.intelligence !== "observed") return;
    if (relationTo(latestSnapshot, attacker.tribeId, unit.tribeId) !== "war") {
      unitStatus.textContent = localization.text("combat.requiresWar");
      return;
    }
    postToWorker({
      type: "submit-command",
      command: {
        kind: "engage-unit",
        playerId: latestSnapshot.viewerPlayerId,
        sequence: ++commandSequence,
        unitId: attacker.id,
        targetUnitId: unit.id,
        doctrine: combatDoctrine.value as CombatDoctrine,
        formation: combatFormation.value as BattleFormation,
        pursuit: combatPursuit.value as PursuitPolicy,
      },
    });
    unitStatus.textContent = localization.text("combat.orderIssued", {
      target: unitMessage(unit.kind, "name"),
    });
    return;
  }
  selectedUnitIds = new Set([unit.id]);
  active.map.setSelectedUnits(selectedUnitIds);
  closeConstruction();
  updateUnitPanel(latestSnapshot);
  active.map.update(latestSnapshot);
  app.render();
}

function selectTribe(tribeId: number): void {
  const active = activeTheater;
  if (!active) {
    return;
  }
  selectedTribeId = tribeId;
  active.map.setSelectedTribe(tribeId);
  clearUnitSelection();
  closeConstruction();
  if (latestSnapshot) {
    renderSnapshot(latestSnapshot);
  }
}

function selectSettlement(settlementId: number, tribeId: number): void {
  const active = activeTheater;
  if (!active) {
    return;
  }
  selectedTribeId = tribeId;
  active.map.setSelectedTribe(tribeId);
  clearUnitSelection();
  if (!latestSnapshot) {
    return;
  }
  const tribe = latestSnapshot.tribes.find((candidate) => candidate.id === tribeId);
  if (tribe?.controllerPlayerId !== latestSnapshot.viewerPlayerId) {
    closeConstruction();
    renderSnapshot(latestSnapshot);
    return;
  }
  selectedConstructionSettlementId = settlementId;
  selectCampTab("works");
  constructionPanel.hidden = false;
  updateConstructionPanel(latestSnapshot);
  renderSnapshot(latestSnapshot);
}

function upgradeVillage(): void {
  if (!latestSnapshot || selectedConstructionSettlementId === undefined) {
    return;
  }
  const settlement = latestSnapshot.settlements.find(
    (candidate) => candidate.id === selectedConstructionSettlementId,
  );
  if (!settlement || settlement.tier === "village") return;
  upgradeVillageButton.disabled = true;
  villageAction.textContent = localization.text("construction.queued");
  constructionStatus.textContent = localization.text("construction.villageQueued");
  postToWorker({
    type: "submit-command",
    command: {
      kind: "upgrade-camp",
      playerId: latestSnapshot.viewerPlayerId,
      sequence: ++commandSequence,
      settlementId: settlement.id,
    },
  });
}

function constructTribalBuilding(building: CampBuilding): void {
  if (!latestSnapshot || selectedConstructionSettlementId === undefined) {
    return;
  }
  const settlement = latestSnapshot.settlements.find(
    (candidate) => candidate.id === selectedConstructionSettlementId,
  );
  if (!settlement || settlement.buildings.includes(building)) {
    return;
  }
  for (const button of campBuildingOptions.querySelectorAll<HTMLButtonElement>(
    "[data-building-id]",
  )) {
    button.disabled = true;
  }
  constructionStatus.textContent = localization.text("roster.buildingQueued", {
    building: buildingMessage(building, "name"),
  });
  postToWorker({
    type: "submit-command",
    command: {
      kind: "construct-building",
      building,
      playerId: latestSnapshot.viewerPlayerId,
      sequence: ++commandSequence,
      settlementId: settlement.id,
    },
  });
}

function trainTribalUnit(unitKind: UnitKind): void {
  if (!latestSnapshot || selectedConstructionSettlementId === undefined) {
    return;
  }
  const settlement = latestSnapshot.settlements.find(
    (candidate) => candidate.id === selectedConstructionSettlementId,
  );
  if (!settlement) {
    return;
  }
  const knownUnitIds = new Set(latestSnapshot.units.map((unit) => unit.id));
  for (const button of campUnitOptions.querySelectorAll<HTMLButtonElement>(
    "[data-unit-kind]",
  )) {
    button.disabled = true;
  }
  constructionStatus.textContent = localization.text("roster.trainingQueued", {
    unit: unitMessage(unitKind, "name"),
  });
  pendingTrainedUnit = {
    settlementId: settlement.id,
    unitKind,
    knownUnitIds,
  };
  postToWorker({
    type: "submit-command",
    command: {
      kind: "train-unit",
      unitKind,
      playerId: latestSnapshot.viewerPlayerId,
      sequence: ++commandSequence,
      settlementId: settlement.id,
    },
  });
}

function assignAdministrator(administrator: SettlementAdministrator): void {
  if (!latestSnapshot || selectedConstructionSettlementId === undefined) {
    return;
  }
  const settlement = latestSnapshot.settlements.find(
    (candidate) => candidate.id === selectedConstructionSettlementId,
  );
  if (!settlement || settlement.administrator === administrator) return;
  for (const button of administrationRoleButtons) button.disabled = true;
  constructionStatus.textContent = localization.text("administration.assignmentQueued", {
    role: administratorMessage(administrator, "name"),
  });
  postToWorker({
    type: "submit-command",
    command: {
      kind: "assign-administrator",
      playerId: latestSnapshot.viewerPlayerId,
      sequence: ++commandSequence,
      settlementId: settlement.id,
      administrator,
    },
  });
}

function renderSnapshot(snapshot: PlayerWorldSnapshot): void {
  const active = activeTheater;
  if (!active) {
    return;
  }
  const previousPendingIds = new Set(
    latestSnapshot?.events
      .filter((event) => event.status === "pending")
      .map((event) => event.id) ?? [],
  );
  latestSnapshot = snapshot;
  const newPendingEvent = snapshot.events.find(
    (event) => event.status === "pending" && !previousPendingIds.has(event.id),
  );
  if (pendingTrainedUnit) {
    const trainedUnit = snapshot.units.find(
      (unit) =>
        unit.homeSettlementId === pendingTrainedUnit?.settlementId &&
        unit.kind === pendingTrainedUnit.unitKind &&
        !pendingTrainedUnit.knownUnitIds.has(unit.id),
    );
    if (trainedUnit) {
      selectedUnitIds = new Set([trainedUnit.id]);
      active.map.setSelectedUnits(selectedUnitIds);
      pendingTrainedUnit = undefined;
      closeConstruction();
    }
  }
  const playerTribe = snapshot.tribes.find(
    (candidate) => candidate.controllerPlayerId === snapshot.viewerPlayerId,
  );
  if (!snapshot.tribes.some((tribe) => tribe.id === selectedTribeId) && playerTribe) {
    selectedTribeId = playerTribe.id;
    active.map.setSelectedTribe(playerTribe.id);
  }
  const mapChanged = active.map.update(snapshot);
  const daylight = isDaytime(snapshot.worldTime);
  worldClockValue.textContent = `${localization.worldDateTime(snapshot.worldTime)} · ${localization.text(daylight ? "terms.day" : "terms.night")}`;
  worldClockValue.dataset.period = daylight ? "day" : "night";
  worldClockValue.title = localization.text("format.simulationTick", {
    tick: localization.number(snapshot.tick),
  });
  const rivalCount = snapshot.tribes.filter(
    (tribe) => tribe.controllerPlayerId !== snapshot.viewerPlayerId,
  ).length;
  theaterStats.textContent = localization.text(
    rivalCount === 1 ? "format.oneRivalInSight" : "format.rivalsInSight",
    {
      count: localization.number(rivalCount),
      distance: localization.number(active.manifest.extent.widthMeters / 1_000),
    },
  );
  const tribe = snapshot.tribes.find((candidate) => candidate.id === selectedTribeId);
  const settlement = snapshot.settlements.find(
    (candidate) => candidate.tribeId === selectedTribeId,
  );
  if (tribe && settlement) {
    updateSelectedPanel(snapshot, tribe, settlement);
  }
  updateTribeList(snapshot);
  updateConstructionPanel(snapshot);
  updateUnitPanel(snapshot);
  renderTechnologyUI(snapshot);
  const contactCount = snapshot.tribes.filter(
    (candidate) => candidate.controllerPlayerId !== snapshot.viewerPlayerId,
  ).length;
  diplomacyButtonStatus.textContent = contactCount === 0
    ? localization.text("diplomacy.noContacts")
    : localization.text("diplomacy.contactCount", { count: contactCount });
  const pendingEventCount = snapshot.events.filter(
    (event) => event.status === "pending",
  ).length;
  eventsButtonStatus.textContent = pendingEventCount === 0
    ? localization.text("events.noPending")
    : localization.text("events.pendingCount", { count: pendingEventCount });
  if (!diplomacyPanel.hidden) renderDiplomacyUI(snapshot);
  if (!eventPanel.hidden) renderEventsUI(snapshot);
  if (hoveredPoint) {
    updateSurvey(hoveredPoint);
  }
  if (mapChanged) {
    app.render();
  }
  if (newPendingEvent) {
    displayedEventId = newPendingEvent.id;
    if (!paused) {
      paused = true;
      syncClock();
    }
    openEventPanel();
  }
}

function syncClock(): void {
  if (phase === "playing") {
    postToWorker({ type: "set-clock", paused, speed });
  }
  pauseButton.setAttribute("aria-pressed", paused.toString());
  pauseLabel.textContent = localization.text(paused ? "terms.play" : "terms.pause");
  if (phase === "culture-pick") {
    simulationState.textContent = localization.text("terms.cultureSelection");
  } else if (phase === "theater-pick") {
    simulationState.textContent = localization.text("terms.theaterSelection");
  } else if (phase === "camp-pick") {
    simulationState.textContent = localization.text("terms.campFounding");
  } else {
    simulationState.textContent = paused
      ? localization.text("terms.paused")
      : localization.text("terms.running", { speed });
  }
  simulationState.classList.toggle("is-running", phase === "playing" && !paused);
  if (latestSnapshot) {
    updateUnitPanel(latestSnapshot);
  }
}

function togglePaused(): void {
  if (phase !== "playing") {
    return;
  }
  paused = !paused;
  syncClock();
}

function selectSpeed(nextSpeed: number): void {
  if (phase !== "playing") {
    return;
  }
  speed = nextSpeed;
  for (const button of speedButtons) {
    button.classList.toggle("is-active", Number(button.dataset.speed) === speed);
  }
  syncClock();
}

worker.addEventListener("message", (event: MessageEvent<SimulationWorkerResponse>) => {
  if (event.data.visibility) {
    latestVisibility = event.data.visibility;
  }
  if (
    !latestVisibility ||
    latestVisibility.revision !== event.data.frame.visibilityRevision
  ) {
    throw new Error("Simulation frame arrived without its visibility revision");
  }
  const { visibilityRevision: _visibilityRevision, ...frame } = event.data.frame;
  renderSnapshot({ ...frame, visibility: latestVisibility });
});

let spawnPointer:
  | { readonly pointerId: number; readonly x: number; readonly y: number }
  | undefined;
let selectionPointer:
  | {
      readonly pointerId: number;
      readonly x: number;
      readonly y: number;
      readonly world: TheaterPoint;
    }
  | undefined;
app.canvas.addEventListener("pointerdown", (event) => {
  if ((isAtlasPickPhase() || phase === "camp-pick") && event.button === 0) {
    spawnPointer = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  } else if (phase === "playing" && event.button === 0) {
    const active = activeTheater;
    if (!active) {
      return;
    }
    selectionPointer = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      world: active.camera.toWorldPoint(event.clientX, event.clientY),
    };
    selectionBox.hidden = true;
  }
});

window.addEventListener("pointermove", (event) => {
  if (event.pointerId !== selectionPointer?.pointerId) {
    return;
  }
  const moved = Math.hypot(
    event.clientX - selectionPointer.x,
    event.clientY - selectionPointer.y,
  );
  if (moved <= PRESENTATION_CONFIG.interaction.pointerDragThresholdPixels) {
    return;
  }
  const left = Math.min(selectionPointer.x, event.clientX);
  const top = Math.min(selectionPointer.y, event.clientY);
  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${Math.abs(event.clientX - selectionPointer.x)}px`;
  selectionBox.style.height = `${Math.abs(event.clientY - selectionPointer.y)}px`;
  selectionBox.hidden = false;
});

app.canvas.addEventListener("pointermove", (event) => {
  if (isAtlasPickPhase()) {
    cancelAnimationFrame(theaterHoverFrame);
    theaterHoverFrame = requestAnimationFrame(() =>
      previewAtlasAt(event.clientX, event.clientY),
    );
  } else if (activeTheater) {
    updateSurvey(activeTheater.camera.toWorldPoint(event.clientX, event.clientY));
    if (phase === "camp-pick") {
      cancelAnimationFrame(theaterHoverFrame);
      theaterHoverFrame = requestAnimationFrame(() =>
        previewCampCultureAt(event.clientX, event.clientY),
      );
    }
  }
});

app.canvas.addEventListener("pointerleave", () => {
  cancelAnimationFrame(theaterHoverFrame);
  if (isAtlasPickPhase()) theaterPicker.clearHover();
  activeTheater?.map.setCampCultureHover(undefined);
  hideTheaterTooltip();
  updateSurvey(undefined);
});

window.addEventListener("pointerup", (event) => {
  if (event.button !== 0) {
    return;
  }
  if (
    (isAtlasPickPhase() || phase === "camp-pick") &&
    event.pointerId === spawnPointer?.pointerId
  ) {
    const moved = Math.hypot(
      event.clientX - spawnPointer.x,
      event.clientY - spawnPointer.y,
    );
    spawnPointer = undefined;
    if (moved <= PRESENTATION_CONFIG.interaction.pointerDragThresholdPixels) {
      if (phase === "culture-pick") {
        selectCultureAt(
          pickerCamera.toWorldPoint(event.clientX, event.clientY),
        );
      } else if (phase === "theater-pick") {
        selectTheaterAt(
          pickerCamera.toWorldPoint(event.clientX, event.clientY),
        );
      } else if (activeTheater) {
        chooseSpawn(
          activeTheater.camera.toWorldPoint(event.clientX, event.clientY),
        );
      }
    }
    return;
  }
  if (phase === "playing" && event.pointerId === selectionPointer?.pointerId) {
    const moved = Math.hypot(
      event.clientX - selectionPointer.x,
      event.clientY - selectionPointer.y,
    );
    if (moved > PRESENTATION_CONFIG.interaction.pointerDragThresholdPixels) {
      const active = activeTheater;
      if (!active) {
        return;
      }
      selectUnitsInBox(
        selectionPointer.world,
        active.camera.toWorldPoint(event.clientX, event.clientY),
      );
    }
    selectionPointer = undefined;
    selectionBox.hidden = true;
  }
});

function selectUnitsInBox(start: TheaterPoint, end: TheaterPoint): void {
  const active = activeTheater;
  if (!latestSnapshot || !active) {
    return;
  }
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const controlledTribeIds = new Set(
    latestSnapshot.tribes
      .filter(
        (tribe) => tribe.controllerPlayerId === latestSnapshot?.viewerPlayerId,
      )
      .map((tribe) => tribe.id),
  );
  selectedUnitIds = new Set(
    latestSnapshot.units
      .filter((unit) => controlledTribeIds.has(unit.tribeId))
      .filter((unit) => {
        const point = active.projection.toTheater(unit.position);
        return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
      })
      .map((unit) => unit.id),
  );
  active.map.setSelectedUnits(selectedUnitIds);
  closeConstruction();
  updateUnitPanel(latestSnapshot);
  active.map.update(latestSnapshot);
  app.render();
}

async function moveSelectedUnits(point: TheaterPoint, append: boolean): Promise<void> {
  const active = activeTheater;
  if (!latestSnapshot || selectedUnitIds.size === 0 || !active) {
    return;
  }
  if (!(await active.surface.isPassable(point))) {
    unitStatus.textContent = localization.text("orders.waterImpassable");
    return;
  }
  const destination = active.projection.toGeographic(point);
  const previewRoutes = active.map.previewUnitOrders(
    selectedUnitIds,
    destination,
    append,
  );
  const estimates: number[] = [];
  for (const unitId of selectedUnitIds) {
    const unit = latestSnapshot.units.find((candidate) => candidate.id === unitId);
    const tribe = unit
      ? latestSnapshot.tribes.find((candidate) => candidate.id === unit.tribeId)
      : undefined;
    if (unit && tribe) {
      let position = unit.position;
      let total = 0;
      let traversable = true;
      for (const waypoint of previewRoutes.get(unitId) ?? []) {
        const estimate = await active.surface.estimateScoutTravelMinutes(
          position,
          waypoint,
          tribe.terrainMovementModifiers,
          tribe.vegetationMovementModifiers,
        );
        if (estimate === null) {
          traversable = false;
          break;
        }
        total += estimate;
        position = waypoint;
      }
      if (traversable) estimates.push(total);
    }
    postToWorker({
      type: "submit-command",
      command: {
        kind: "move-unit",
        playerId: latestSnapshot.viewerPlayerId,
        sequence: ++commandSequence,
        unitId,
        destination,
        mode: append ? "append" : "replace",
      },
    });
  }
  if (estimates.length === selectedUnitIds.size && estimates.length > 0) {
    const longest = Math.max(...estimates);
    const schedule = scheduleScoutArrival(latestSnapshot.worldTime, longest);
    unitStatus.textContent = localization.text("format.arrivalOrder", {
      order: localization.text(
        append ? "orders.waypointQueued" : "orders.orderSet",
      ),
      duration: localization.worldDuration(schedule.elapsedClockMinutes),
      arrival: localization.worldDateTime(schedule.arrival),
    });
  } else {
    unitStatus.textContent = localization.text("orders.orderImpassable");
  }
}

app.canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (phase === "playing" && activeTheater) {
    void moveSelectedUnits(
      activeTheater.camera.toWorldPoint(event.clientX, event.clientY),
      event.ctrlKey,
    );
  }
});

beginGameButton.addEventListener("click", closeMainMenu);
menuButton.addEventListener("click", showMainMenu);
knowledgeButton.addEventListener("click", openTechnologyPanel);
closeTechnologyButton.addEventListener("click", closeTechnologyPanel);
diplomacyButton.addEventListener("click", openDiplomacyPanel);
closeDiplomacyButton.addEventListener("click", closeDiplomacyPanel);
eventsButton.addEventListener("click", openEventPanel);
closeEventsButton.addEventListener("click", closeEventPanel);
researchTechnologyButton.addEventListener("click", selectDisplayedTechnology);
openSettingsButton.addEventListener("click", showSettings);
closeSettingsButton.addEventListener("click", showMainMenu);
mapViewToggle.addEventListener("click", () => {
  setMapViewMenuExpanded(mapViewToggle.getAttribute("aria-expanded") !== "true");
});
for (const button of mapViewButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.mapView as TheaterMapViewMode | undefined;
    if (mode) selectMapView(mode);
  });
}
for (const button of interfaceScaleButtons) {
  button.addEventListener("click", () => {
    updateSettings(
      parseGameSettings({
        ...settings,
        interfaceScale: Number(button.dataset.interfaceScale),
      }),
    );
  });
}
for (const button of mapDetailButtons) {
  button.addEventListener("click", () => {
    updateSettings(
      parseGameSettings({
        ...settings,
        mapDetail: button.dataset.mapDetail,
      }),
    );
  });
}
for (const button of languageButtons) {
  button.addEventListener("click", () => {
    updateSettings(
      parseGameSettings({
        ...settings,
        language: button.dataset.language as SupportedLanguage,
      }),
    );
  });
}
showMapSurveyInput.addEventListener("change", () => {
  updateSettings(
    parseGameSettings({
      ...settings,
      showMapSurvey: showMapSurveyInput.checked,
    }),
  );
});
rerollTheaterButton.addEventListener("click", () => void rerollTheater());
phaseBackButton.addEventListener("click", goBackSetupPhase);
phaseForwardButton.addEventListener("click", () => void goForwardSetupPhase());
closeConstructionButton.addEventListener("click", closeConstruction);
upgradeVillageButton.addEventListener("click", upgradeVillage);
campBuildingOptions.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "[data-building-id]",
  );
  if (button && !button.disabled) {
    constructTribalBuilding(button.dataset.buildingId as CampBuilding);
  }
});
campUnitOptions.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "[data-unit-kind]",
  );
  if (button && !button.disabled) {
    trainTribalUnit(button.dataset.unitKind as UnitKind);
  }
});
for (const button of campTabButtons) {
  button.addEventListener("click", () => {
    const tab = button.dataset.campTab;
    selectCampTab(
      tab === "train" ? "train" : tab === "administration" ? "administration" : "works",
    );
  });
}
for (const button of administrationRoleButtons) {
  button.addEventListener("click", () => {
    assignAdministrator(
      button.dataset.administrationRole as SettlementAdministrator,
    );
  });
}
pauseButton.addEventListener("click", togglePaused);
fitButton.addEventListener("click", () => {
  if (isAtlasPickPhase()) {
    pickerCamera.fitWorld();
  } else {
    activeTheater?.camera.fitWorld();
  }
});
for (const button of speedButtons) {
  button.addEventListener("click", () => selectSpeed(Number(button.dataset.speed)));
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    if (technologyPanelOpen) {
      closeTechnologyPanel();
    } else if (!menuOpen) {
      showMainMenu();
    } else if (!settingsView.hidden) {
      showMainMenu();
    } else {
      closeMainMenu();
    }
    return;
  }
  if (menuOpen) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    togglePaused();
    return;
  }
  const speedIndex = Number(event.key) - 1;
  const keyboardSpeed = GAMEPLAY_CONFIG.simulation.speedOptions[speedIndex];
  if (keyboardSpeed !== undefined) {
    selectSpeed(keyboardSpeed);
  } else if (event.key.toLowerCase() === "f") {
    if (isAtlasPickPhase()) {
      pickerCamera.fitWorld();
    } else {
      activeTheater?.camera.fitWorld();
    }
  }
});

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if (isAtlasPickPhase()) {
      pickerCamera.handleResize();
    } else {
      activeTheater?.camera.handleResize();
    }
    app.render();
  });
});

initializeTechnologyMap();
appRoot.dataset.phase = phase;
theaterName.textContent = localization.text("terms.culturalAtlas");
theaterStats.textContent = localization.text("format.landTheaters", {
  count: localization.number(theaterCatalog.candidateCount),
});
showCulturePickPhase();
hideLoading();
app.render();
showMainMenu();
