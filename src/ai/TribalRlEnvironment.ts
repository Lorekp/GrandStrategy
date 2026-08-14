import { GameSimulation } from "../core/GameSimulation";
import { WorldGrid } from "../core/WorldGrid";
import type {
  GameCommand,
  PlayerId,
  PlayerWorldSnapshot,
  ScenarioDefinition,
  WorldGridDefinition,
} from "../core/model";
import {
  legalActionCatalog,
  playerDecisionIsLegal,
  type LegalActionCatalog,
  type PlayerDecision,
} from "./LegalActions";
import {
  rewardSignals,
  rlAgentMetrics,
  tribalDevelopmentReward,
  type RlAgentMetrics,
  type RlRewardModel,
  type RlRewardSignals,
} from "./RewardModels";
import { createSelfPlayScenario } from "./SelfPlayScenario";

export const RL_OBSERVATION_SCHEMA_VERSION = 2;
export type RlAgentId = `player:${number}`;

export interface RlVisibleWorldGrid {
  readonly projectionDefinition: string;
  readonly extentWidthMeters: number;
  readonly extentHeightMeters: number;
  readonly width: number;
  readonly height: number;
  /** Sorted source-grid indices. No unexplored cell values are included. */
  readonly cellIndices: Uint32Array;
  readonly terrainCodes: Uint8Array;
  readonly vegetationCodes: Uint8Array;
  readonly moisture: Uint8Array;
  readonly riverCodes: Uint8Array;
  readonly elevationMeters: Int16Array;
}

export interface RlObservation {
  readonly schemaVersion: typeof RL_OBSERVATION_SCHEMA_VERSION;
  readonly state: PlayerWorldSnapshot;
  readonly visibleWorld: RlVisibleWorldGrid;
  readonly legalActions: LegalActionCatalog;
}

export type RlAgentAction =
  | { readonly type: "wait" }
  | { readonly type: "decision"; readonly decision: PlayerDecision };

export interface RlAgentInfo {
  readonly playerId: PlayerId;
  readonly controlledTribeIds: readonly number[];
  readonly ticksAdvanced: number;
  readonly rewardSignals: RlRewardSignals;
}

export interface RlResetResult {
  readonly observations: Readonly<Record<RlAgentId, RlObservation>>;
  readonly infos: Readonly<Record<RlAgentId, RlAgentInfo>>;
}

export type RlDoneFlags = Readonly<Record<RlAgentId, boolean>> & {
  readonly __all__: boolean;
};

export interface RlStepResult extends RlResetResult {
  readonly rewards: Readonly<Record<RlAgentId, number>>;
  readonly terminated: RlDoneFlags;
  readonly truncated: RlDoneFlags;
}

export interface TribalRlEnvironmentOptions {
  readonly scenarioFactory: (seed: number) => ScenarioDefinition;
  /** Fixed simulation ticks advanced after every simultaneous multi-agent decision. */
  readonly ticksPerDecision: number;
  /** Time limits are truncations, never game-rule defeats. */
  readonly maxEpisodeTicks: number;
  readonly rewardModel?: RlRewardModel;
  /** Converts every passive NPC Tribe into an independent agent. Defaults to true. */
  readonly selfPlay?: boolean;
}

const agentIdForPlayer = (playerId: PlayerId): RlAgentId => `player:${playerId}`;

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function zeroSignals(): RlRewardSignals {
  return {
    population: 0,
    warriors: 0,
    settlements: 0,
    villages: 0,
    influenceMeters: 0,
    completedTechnologies: 0,
    exploredCells: 0,
    combatStrength: 0,
    unitExperience: 0,
    routedUnits: 0,
  };
}

function visibleCellIndices(visibleCells: Uint32Array, cellCount: number): Uint32Array {
  let visibleCount = 0;
  for (let wordIndex = 0; wordIndex < visibleCells.length; wordIndex += 1) {
    let word = visibleCells[wordIndex]!;
    while (word !== 0) {
      const bit = 31 - Math.clz32((word & -word) >>> 0);
      if (wordIndex * 32 + bit < cellCount) visibleCount += 1;
      word &= word - 1;
    }
  }
  const indices = new Uint32Array(visibleCount);
  let outputIndex = 0;
  for (let wordIndex = 0; wordIndex < visibleCells.length; wordIndex += 1) {
    let word = visibleCells[wordIndex]!;
    while (word !== 0) {
      const bit = 31 - Math.clz32((word & -word) >>> 0);
      const cellIndex = wordIndex * 32 + bit;
      if (cellIndex < cellCount) indices[outputIndex++] = cellIndex;
      word &= word - 1;
    }
  }
  return indices;
}

export function createVisibleWorldObservation(
  grid: WorldGridDefinition,
  snapshot: PlayerWorldSnapshot,
): RlVisibleWorldGrid {
  const cellCount = grid.width * grid.height;
  const cellIndices = visibleCellIndices(snapshot.visibility.visibleCells, cellCount);
  const terrainCodes = new Uint8Array(cellIndices.length);
  const vegetationCodes = new Uint8Array(cellIndices.length);
  const moisture = new Uint8Array(cellIndices.length);
  const riverCodes = new Uint8Array(cellIndices.length);
  const elevationMeters = new Int16Array(cellIndices.length);
  for (let outputIndex = 0; outputIndex < cellIndices.length; outputIndex += 1) {
    const sourceIndex = cellIndices[outputIndex]!;
    terrainCodes[outputIndex] = grid.terrainCells[sourceIndex]!;
    vegetationCodes[outputIndex] = grid.vegetationCells[sourceIndex]!;
    moisture[outputIndex] = grid.moistureCells[sourceIndex]!;
    riverCodes[outputIndex] = grid.riverCells[sourceIndex]!;
    elevationMeters[outputIndex] = grid.elevationMeters[sourceIndex]!;
  }
  return {
    projectionDefinition: grid.projectionDefinition,
    extentWidthMeters: grid.extentWidthMeters,
    extentHeightMeters: grid.extentHeightMeters,
    width: grid.width,
    height: grid.height,
    cellIndices,
    terrainCodes,
    vegetationCodes,
    moisture,
    riverCodes,
    elevationMeters,
  };
}

function commandFromDecision(
  decision: PlayerDecision,
  playerId: PlayerId,
  sequence: number,
): GameCommand {
  return { ...decision, playerId, sequence } as GameCommand;
}

function doneFlags(agentIds: readonly RlAgentId[], value: boolean): RlDoneFlags {
  const flags: Record<string, boolean> = { __all__: value };
  for (const agentId of agentIds) flags[agentId] = value;
  return flags as RlDoneFlags;
}

export class TribalRlEnvironment {
  private readonly options: TribalRlEnvironmentOptions;
  private readonly rewardModel: RlRewardModel;
  private simulation: GameSimulation | undefined;
  private worldGrid: WorldGridDefinition | undefined;
  private semanticGrid: WorldGrid | undefined;
  private agentPlayers: readonly PlayerId[] = [];
  private sequenceByPlayer = new Map<PlayerId, number>();
  private previousMetrics = new Map<PlayerId, RlAgentMetrics>();
  private episodeTicks = 0;
  private episodeEnded = false;

  public constructor(options: TribalRlEnvironmentOptions) {
    assertPositiveInteger(options.ticksPerDecision, "ticksPerDecision");
    assertPositiveInteger(options.maxEpisodeTicks, "maxEpisodeTicks");
    this.options = options;
    this.rewardModel = options.rewardModel ?? tribalDevelopmentReward;
  }

  public get agents(): readonly RlAgentId[] {
    return this.agentPlayers.map(agentIdForPlayer);
  }

  /** Diagnostic replay checksum; deliberately excluded from every agent observation. */
  public get stateHash(): string {
    if (!this.simulation) throw new Error("Reset the RL environment before reading state");
    return this.simulation.snapshot().stateHash;
  }

  public reset(seed: number): RlResetResult {
    if (!Number.isInteger(seed)) throw new Error("RL reset seed must be an integer");
    const source = this.options.scenarioFactory(seed);
    const scenario = this.options.selfPlay === false
      ? source
      : createSelfPlayScenario(source);
    this.simulation = new GameSimulation(scenario);
    this.worldGrid = scenario.worldGrid;
    this.semanticGrid = new WorldGrid(scenario.worldGrid);
    this.agentPlayers = [
      ...new Set(
        scenario.tribes.flatMap((tribe) =>
          tribe.controllerPlayerId === null ? [] : [tribe.controllerPlayerId],
        ),
      ),
    ].sort((left, right) => left - right);
    if (this.agentPlayers.length === 0) {
      throw new Error("An RL episode requires at least one controlled Tribe");
    }
    this.sequenceByPlayer = new Map(this.agentPlayers.map((playerId) => [playerId, 0]));
    this.episodeTicks = 0;
    this.episodeEnded = false;
    const snapshots = this.simulation.playerSnapshots(this.agentPlayers);
    this.previousMetrics = new Map(
      snapshots.map((snapshot) => [snapshot.viewerPlayerId, rlAgentMetrics(snapshot)]),
    );
    return this.buildObservationsAndInfos(snapshots, 0, new Map());
  }

  public step(
    actions: Readonly<Record<RlAgentId, RlAgentAction>>,
  ): RlStepResult {
    const simulation = this.simulation;
    if (!simulation || !this.worldGrid || !this.semanticGrid) {
      throw new Error("Reset the RL environment before stepping");
    }
    if (this.episodeEnded) {
      throw new Error("Reset the RL environment before stepping a finished episode");
    }
    const agentIds = this.agents;
    const suppliedIds = Object.keys(actions).sort();
    const expectedIds = [...agentIds].sort();
    if (
      suppliedIds.length !== expectedIds.length ||
      suppliedIds.some((agentId, index) => agentId !== expectedIds[index])
    ) {
      throw new Error(`Expected actions for exactly: ${expectedIds.join(", ")}`);
    }

    const beforeSnapshots = simulation.playerSnapshots(this.agentPlayers);
    const beforeByPlayer = new Map(
      beforeSnapshots.map((snapshot) => [snapshot.viewerPlayerId, snapshot]),
    );
    const commands: GameCommand[] = [];
    for (const playerId of this.agentPlayers) {
      const agentId = agentIdForPlayer(playerId);
      const action = actions[agentId]!;
      if (action.type === "wait") continue;
      const snapshot = beforeByPlayer.get(playerId)!;
      const catalog = legalActionCatalog(snapshot);
      if (!playerDecisionIsLegal(catalog, action.decision)) {
        throw new Error(`Agent ${agentId} submitted an action outside its legal mask`);
      }
      if (
        action.decision.kind === "move-unit" &&
        this.semanticGrid.typeAt(action.decision.destination) === "water"
      ) {
        throw new Error(`Agent ${agentId} submitted a movement destination on water`);
      }
      const sequence = (this.sequenceByPlayer.get(playerId) ?? 0) + 1;
      this.sequenceByPlayer.set(playerId, sequence);
      commands.push(commandFromDecision(action.decision, playerId, sequence));
    }

    const ticksAdvanced = Math.min(
      this.options.ticksPerDecision,
      this.options.maxEpisodeTicks - this.episodeTicks,
    );
    for (let offset = 0; offset < ticksAdvanced; offset += 1) {
      simulation.advance({
        tick: simulation.tick,
        commands: offset === 0 ? commands : [],
      });
    }
    this.episodeTicks += ticksAdvanced;
    const truncated = this.episodeTicks >= this.options.maxEpisodeTicks;
    this.episodeEnded = truncated;
    const snapshots = simulation.playerSnapshots(this.agentPlayers);
    const rewards = new Map<PlayerId, number>();
    const signalsByPlayer = new Map<PlayerId, RlRewardSignals>();
    for (const snapshot of snapshots) {
      const playerId = snapshot.viewerPlayerId;
      const previous = this.previousMetrics.get(playerId)!;
      const current = rlAgentMetrics(snapshot);
      const signals = rewardSignals(previous, current);
      signalsByPlayer.set(playerId, signals);
      const reward = this.rewardModel({ previous, current, signals, ticksAdvanced });
      if (!Number.isFinite(reward)) {
        throw new Error(`Reward model returned a non-finite value for player ${playerId}`);
      }
      rewards.set(playerId, reward);
      this.previousMetrics.set(playerId, current);
    }
    const output = this.buildObservationsAndInfos(
      snapshots,
      ticksAdvanced,
      signalsByPlayer,
    );
    return {
      ...output,
      rewards: Object.fromEntries(
        this.agentPlayers.map((playerId) => [
          agentIdForPlayer(playerId),
          rewards.get(playerId) ?? 0,
        ]),
      ) as Record<RlAgentId, number>,
      terminated: doneFlags(this.agents, false),
      truncated: doneFlags(this.agents, truncated),
    };
  }

  private buildObservationsAndInfos(
    snapshots: readonly PlayerWorldSnapshot[],
    ticksAdvanced: number,
    signalsByPlayer: ReadonlyMap<PlayerId, RlRewardSignals>,
  ): RlResetResult {
    const grid = this.worldGrid!;
    const observations = {} as Record<RlAgentId, RlObservation>;
    const infos = {} as Record<RlAgentId, RlAgentInfo>;
    for (const snapshot of snapshots) {
      const playerId = snapshot.viewerPlayerId;
      const agentId = agentIdForPlayer(playerId);
      observations[agentId] = {
        schemaVersion: RL_OBSERVATION_SCHEMA_VERSION,
        state: snapshot,
        visibleWorld: createVisibleWorldObservation(grid, snapshot),
        legalActions: legalActionCatalog(snapshot),
      };
      infos[agentId] = {
        playerId,
        controlledTribeIds: snapshot.tribes
          .filter((tribe) => tribe.controllerPlayerId === playerId)
          .map((tribe) => tribe.id)
          .sort((left, right) => left - right),
        ticksAdvanced,
        rewardSignals: signalsByPlayer.get(playerId) ?? zeroSignals(),
      };
    }
    return { observations, infos };
  }
}
