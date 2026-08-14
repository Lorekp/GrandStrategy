export type TribeId = number;
export type SettlementId = number;
export type PlayerId = number;
export type UnitId = number;
export type TechnologyId = string;

export interface GeographicPosition {
  /** Signed WGS84 longitude in millionths of a degree. */
  readonly longitudeE6: number;
  /** Signed WGS84 latitude in millionths of a degree. */
  readonly latitudeE6: number;
}

/** Astronomical year numbering: year 0 is 1 BCE, -1 is 2 BCE. */
export interface WorldDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export interface Tribe {
  readonly id: TribeId;
  readonly name: string;
  readonly cultureId: string;
  readonly terrainMovementModifiers: Readonly<
    Partial<Record<TerrainType, number>>
  >;
  readonly vegetationMovementModifiers: Readonly<
    Partial<Record<VegetationType, number>>
  >;
  readonly color: number;
  readonly controllerPlayerId: PlayerId | null;
  readonly warriors: number;
}

export type SettlementTier = "camp" | "village";
export type CampBuilding =
  | "scout-post"
  | "hearth"
  | "hunters-shelter"
  | "toolmakers-shelter"
  | "council-circle"
  | "drying-racks"
  | "rally-ground"
  | "lore-hut"
  | "granary"
  | "cultivated-fields"
  | "corral"
  | "pottery-kiln"
  | "weavers-hut"
  | "shrine"
  | "well"
  | "quarry"
  | "palisade"
  | "exchange-ground"
  | "specialist-workshop"
  | "copper-workshop";
export type SettlementAdministrator = "tribal-leader" | "elder" | "sage" | "steward";

export interface Settlement {
  readonly id: SettlementId;
  readonly tribeId: TribeId;
  readonly name: string;
  readonly position: GeographicPosition;
  readonly tier: SettlementTier;
  readonly population: number;
  readonly influenceRadiusMeters: number;
  readonly administrator: SettlementAdministrator;
  readonly buildings: readonly CampBuilding[];
}

export type TerrainType =
  | "water"
  | "plains"
  | "hills"
  | "mountains"
  | "desert"
  | "tundra"
  | "ice";

export type VegetationType = "none" | "forest" | "jungle";
export type VegetationDensity = "none" | "sparse" | "light" | "moderate" | "dense";
export type RiverClass = "none" | "minor" | "major";

export interface WorldGridDefinition {
  readonly projectionDefinition: string;
  readonly extentWidthMeters: number;
  readonly extentHeightMeters: number;
  readonly width: number;
  readonly height: number;
  readonly terrainCells: Uint8Array;
  /** Vegetation is an independent feature and may overlay any landform. */
  readonly vegetationCells: Uint8Array;
  /** Long-term plant-available moisture and freshwater access, 0 (dry) to 255 (wet). */
  readonly moistureCells: Uint8Array;
  /** 0 none, 1 minor river, 2 major river. Rivers remain land features. */
  readonly riverCells: Uint8Array;
  readonly elevationMeters: Int16Array;
}

/** Runtime-validated id from the generic or culture-specific military roster. */
export type UnitKind = string;

export type CombatRole = "close" | "ranged";
export type CombatDoctrine = "cautious" | "balanced" | "aggressive";
export type BattleFormation = "loose" | "line" | "guard" | "shock";
export type PursuitPolicy = "hold" | "controlled" | "all-out";

export interface CombatOrder {
  readonly targetUnitId: UnitId;
  readonly doctrine: CombatDoctrine;
  readonly formation: BattleFormation;
  readonly pursuit: PursuitPolicy;
  readonly issuedTick: number;
  /** Contact rounds already resolved against this target; used for opening tactics. */
  readonly engagementRounds: number;
}

export interface UnitCombatState {
  readonly strength: number;
  readonly maximumStrength: number;
  /** 0 is routed; 1,000 is fully confident. */
  readonly moralePermille: number;
  /** 0 is scattered; 1,000 is in perfect order. */
  readonly cohesionPermille: number;
  /** 0 is fresh; 1,000 is exhausted. */
  readonly fatiguePermille: number;
  /** Abstract ammunition and firing effort available in this encounter. */
  readonly missileReadinessPermille: number;
  readonly experience: number;
  readonly status: "ready" | "wavering" | "routed";
  readonly order: CombatOrder | null;
}

export interface Unit {
  readonly id: UnitId;
  readonly tribeId: TribeId;
  readonly homeSettlementId: SettlementId;
  readonly kind: UnitKind;
  readonly position: GeographicPosition;
  /** Ordered authoritative waypoints; the first position is the active target. */
  readonly route: readonly GeographicPosition[];
  readonly terrain: TerrainType;
  readonly vegetation: VegetationType;
  readonly vegetationDensity: VegetationDensity;
  readonly speedMetersPerHour: number;
  readonly slopeDegrees: number;
  readonly remainingTravelMinutes: number | null;
  readonly combat: UnitCombatState | null;
}

export interface SettlementIntelligence {
  readonly settlement: Settlement;
  readonly tribe: Tribe;
  readonly lastObservedTick: number;
}

export interface UnitIntelligence {
  readonly unit: Unit;
  readonly tribe: Tribe;
  readonly lastObservedTick: number;
}

export interface PlayerKnowledge {
  readonly playerId: PlayerId;
  readonly exploredCells: Uint32Array;
  readonly settlementIntelligence: readonly SettlementIntelligence[];
  readonly unitIntelligence: readonly UnitIntelligence[];
}

/** Persistent learned practices and the Tribe's current deliberate inquiry. */
export interface TribeResearch {
  readonly tribeId: TribeId;
  /** First entry is active; later entries continue automatically when legal. */
  readonly queuedTechnologyIds: readonly TechnologyId[];
  readonly completedTechnologyIds: readonly TechnologyId[];
  /** Invested Knowledge is stored as integer Knowledge-minutes for fixed-tick determinism. */
  readonly progress: readonly {
    readonly technologyId: TechnologyId;
    readonly investedKnowledgeMinutes: number;
  }[];
}

export type DiplomaticStance = "friendly" | "neutral" | "hostile" | "war";

export type DiplomaticAgreement =
  | "guest-right"
  | "safe-passage"
  | "non-aggression"
  | "exchange-pact"
  | "defensive-pact";

export type DiplomaticAction =
  | "send-envoys"
  | "insult"
  | "threaten"
  | "declare-war"
  | "propose-guest-right"
  | "propose-safe-passage"
  | "propose-non-aggression"
  | "propose-exchange-pact"
  | "propose-defensive-pact"
  | "offer-peace";

export interface TribeRelation {
  readonly firstTribeId: TribeId;
  readonly secondTribeId: TribeId;
  readonly stance: DiplomaticStance;
  readonly opinion: number;
  readonly trust: number;
  readonly tension: number;
  readonly agreements: readonly DiplomaticAgreement[];
  readonly lastInteractionTick: number;
}

export interface DiplomaticProposal {
  readonly id: number;
  readonly fromTribeId: TribeId;
  readonly toTribeId: TribeId;
  readonly action: DiplomaticAction;
  readonly createdTick: number;
  readonly expiresTick: number;
}

export type EventCategory =
  | "diplomatic"
  | "scout"
  | "camp"
  | "research"
  | "conflict"
  | "society";

export type GameEventStatus = "pending" | "resolved";

export interface GameEvent {
  readonly id: number;
  readonly definitionId: string;
  readonly category: EventCategory;
  readonly tribeId: TribeId;
  readonly targetTribeId: TribeId | null;
  readonly settlementId: SettlementId | null;
  readonly unitId: UnitId | null;
  readonly occurredTick: number;
  readonly status: GameEventStatus;
  readonly selectedChoiceId: string | null;
}

export interface ScenarioDefinition {
  readonly seed: number;
  readonly startWorldTime: WorldDateTime;
  readonly worldGrid: WorldGridDefinition;
  readonly tribes: readonly Tribe[];
  readonly settlements: readonly Settlement[];
  readonly units: readonly Unit[];
  readonly relations: readonly TribeRelation[];
  readonly diplomaticProposals: readonly DiplomaticProposal[];
  readonly events: readonly GameEvent[];
  readonly playerKnowledge: readonly PlayerKnowledge[];
  readonly research: readonly TribeResearch[];
}

export interface UpgradeCampCommand {
  readonly kind: "upgrade-camp";
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly settlementId: SettlementId;
}

export interface ConstructBuildingCommand {
  readonly kind: "construct-building";
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly settlementId: SettlementId;
  readonly building: CampBuilding;
}

export interface TrainUnitCommand {
  readonly kind: "train-unit";
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly settlementId: SettlementId;
  readonly unitKind: UnitKind;
}

export interface MoveUnitCommand {
  readonly kind: "move-unit";
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly unitId: UnitId;
  readonly destination: GeographicPosition;
  readonly mode: "replace" | "append";
}

export interface EngageUnitCommand {
  readonly kind: "engage-unit";
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly unitId: UnitId;
  readonly targetUnitId: UnitId;
  readonly doctrine: CombatDoctrine;
  readonly formation: BattleFormation;
  readonly pursuit: PursuitPolicy;
}

export interface SelectResearchCommand {
  readonly kind: "select-research";
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly tribeId: TribeId;
  readonly technologyId: TechnologyId;
}

export interface AssignAdministratorCommand {
  readonly kind: "assign-administrator";
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly settlementId: SettlementId;
  readonly administrator: SettlementAdministrator;
}

export interface TakeDiplomaticActionCommand {
  readonly kind: "take-diplomatic-action";
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly tribeId: TribeId;
  readonly targetTribeId: TribeId;
  readonly action: DiplomaticAction;
}

export interface RespondDiplomaticProposalCommand {
  readonly kind: "respond-diplomatic-proposal";
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly proposalId: number;
  readonly accept: boolean;
}

export interface ResolveEventCommand {
  readonly kind: "resolve-event";
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly eventId: number;
  readonly choiceId: string;
}

export type GameCommand =
  | UpgradeCampCommand
  | ConstructBuildingCommand
  | TrainUnitCommand
  | MoveUnitCommand
  | EngageUnitCommand
  | SelectResearchCommand
  | AssignAdministratorCommand
  | TakeDiplomaticActionCommand
  | RespondDiplomaticProposalCommand
  | ResolveEventCommand;

export interface TickInput {
  readonly tick: number;
  readonly commands: readonly GameCommand[];
}

export interface WorldSnapshot {
  readonly seed: number;
  readonly tick: number;
  readonly worldTime: WorldDateTime;
  readonly tribes: readonly Tribe[];
  readonly settlements: readonly Settlement[];
  readonly units: readonly Unit[];
  readonly relations: readonly TribeRelation[];
  readonly diplomaticProposals: readonly DiplomaticProposal[];
  readonly events: readonly GameEvent[];
  readonly playerKnowledge: readonly PlayerKnowledge[];
  readonly research: readonly TribeResearch[];
  readonly stateHash: string;
}

export interface PlayerVisibilityGrid {
  readonly width: number;
  readonly height: number;
  readonly revision: number;
  readonly visibleCells: Uint32Array;
  readonly exploredCells: Uint32Array;
}

export interface CurrentPlayerVisibility {
  readonly revision: number;
  readonly visibleCells: Uint32Array;
  readonly unitDetectableCells: Uint32Array;
  readonly campDetectableCells: Uint32Array;
  readonly villageDetectableCells: Uint32Array;
}

export type IntelligenceState = "controlled" | "observed" | "remembered";

export interface PlayerSettlement extends Settlement {
  readonly intelligence: IntelligenceState;
  readonly lastObservedTick: number;
}

export interface PlayerUnit extends Unit {
  readonly intelligence: IntelligenceState;
  readonly lastObservedTick: number;
}

/** A server-filtered snapshot containing only information visible to one player. */
export interface PlayerWorldSnapshot {
  readonly seed: number;
  readonly tick: number;
  readonly worldTime: WorldDateTime;
  readonly viewerPlayerId: PlayerId;
  readonly tribes: readonly Tribe[];
  readonly settlements: readonly PlayerSettlement[];
  readonly units: readonly PlayerUnit[];
  readonly relations: readonly TribeRelation[];
  readonly diplomaticProposals: readonly DiplomaticProposal[];
  readonly events: readonly GameEvent[];
  /** Research remains private to Tribes controlled by the viewing player. */
  readonly research: readonly TribeResearch[];
  readonly visibility: PlayerVisibilityGrid;
}
