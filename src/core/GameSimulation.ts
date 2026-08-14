import {
  MAX_SETTLEMENT_INFLUENCE_METERS,
  MIN_SETTLEMENT_INFLUENCE_METERS,
  NIGHT_VISION_MULTIPLIER,
  SETTLEMENT_GROWTH_INTERVAL_TICKS,
  WORLD_MINUTES_PER_TICK,
} from "./constants";
import { assertGridBitsetLength, orGridBitsets } from "./GridBitset";
import { hashWorldState } from "./hash";
import { refreshPlayerIntelligence } from "./Intelligence";
import { createPlayerWorldSnapshot } from "./PlayerView";
import {
  settlementVisionObserver,
  unitVisionObserver,
  VisibilitySystem,
  type VisionObserver,
} from "./Visibility";
import {
  advanceWorldMinutes,
  assertWorldDateTime,
  isDaytime,
  isScoutTravelMinute,
} from "./WorldClock";
import { WorldGrid } from "./WorldGrid";
import type {
  AssignAdministratorCommand,
  ConstructBuildingCommand,
  CurrentPlayerVisibility,
  DiplomaticAgreement,
  DiplomaticProposal,
  GameCommand,
  GameEvent,
  EngageUnitCommand,
  MoveUnitCommand,
  PlayerKnowledge,
  PlayerWorldSnapshot,
  ScenarioDefinition,
  SelectResearchCommand,
  Settlement,
  TakeDiplomaticActionCommand,
  TerrainType,
  TickInput,
  TrainUnitCommand,
  Tribe,
  TribeRelation,
  TribeResearch,
  Unit,
  VegetationType,
  UpgradeCampCommand,
  RespondDiplomaticProposalCommand,
  ResolveEventCommand,
  WorldDateTime,
  WorldSnapshot,
} from "./model";
import { geographicDistanceMeters } from "./Geography";
import { GAMEPLAY_CONFIG } from "../config/GameConfig";
import {
  DEFAULT_SETTLEMENT_ADMINISTRATOR,
  VILLAGE_ADMINISTRATION_TECHNOLOGY_ID,
  administrationRoleDefinition,
} from "../administration/TribalAdministration";
import {
  tierMeetsMinimum,
  tribalBuildingDefinition,
  tribalBuildingEffects,
} from "../tribal/TribalRoster";
import {
  tribalUnitDefinition,
  unitIsAvailableToCulture,
} from "../combat/MilitaryRoster";
import {
  BATTLE_CONFIG,
  recoverCombatState,
  resolveGroupBattleRound,
} from "../combat/BattleResolver";
import {
  cloneTribeResearch,
  knowledgePerWorldDay,
  nextNpcTechnology,
  researchPlanForTarget,
  technologyDefinition,
  technologyIsAvailable,
} from "../technology/TribalTechnology";
import {
  DIPLOMACY_CONFIG,
  applyRelationshipDelta,
  diplomaticActionDefinition,
  orderedTribePair,
  proposalAcceptanceScore,
} from "../diplomacy/TribalDiplomacy";
import {
  TRIBAL_EVENT_CONFIG,
  TRIBAL_EVENTS,
  chooseWeightedEvent,
  deterministicEventRoll,
  eventAlreadyRepresentsContact,
  eventIsEligible,
  tribalEventDefinition,
  type TribalEventEffects,
} from "../events/TribalEvents";

const MINIMUM_LONGITUDE_E6 = -180_000_000;
const MAXIMUM_LONGITUDE_E6 = 180_000_000;
const MINIMUM_LATITUDE_E6 = -90_000_000;
const MAXIMUM_LATITUDE_E6 = 90_000_000;

export class GameSimulation {
  private tickValue = 0;
  private worldTimeValue: WorldDateTime;
  private readonly seed: number;
  private readonly worldGrid: WorldGrid;
  private readonly visibilitySystem: VisibilitySystem;
  private readonly tribes = new Map<number, Tribe>();
  private readonly settlements = new Map<number, Settlement>();
  private readonly units = new Map<number, Unit>();
  private readonly relations: TribeRelation[];
  private readonly diplomaticProposals: DiplomaticProposal[];
  private readonly events: GameEvent[];
  private readonly playerKnowledge: PlayerKnowledge[];
  private readonly researchByTribe = new Map<number, TribeResearch>();
  private readonly visibilityByPlayer = new Map<number, CurrentPlayerVisibility>();
  private readonly observerKeyByPlayer = new Map<number, string>();
  private nextUnitId = 1;
  private nextProposalId = 1;
  private nextEventId = 1;

  public constructor(scenario: ScenarioDefinition) {
    this.seed = scenario.seed >>> 0;
    assertWorldDateTime(scenario.startWorldTime);
    this.worldTimeValue = { ...scenario.startWorldTime };
    this.worldGrid = new WorldGrid(scenario.worldGrid);
    this.visibilitySystem = new VisibilitySystem(this.worldGrid);
    for (const tribe of [...scenario.tribes].sort((a, b) => a.id - b.id)) {
      this.assertTribe(tribe);
      if (this.tribes.has(tribe.id)) {
        throw new Error(`Duplicate tribe id ${tribe.id}`);
      }
      this.tribes.set(tribe.id, { ...tribe });
    }
    for (const settlement of [...scenario.settlements].sort((a, b) => a.id - b.id)) {
      this.assertSettlement(settlement);
      if (this.settlements.has(settlement.id)) {
        throw new Error(`Duplicate settlement id ${settlement.id}`);
      }
      this.settlements.set(settlement.id, {
        ...settlement,
        position: { ...settlement.position },
        buildings: [...settlement.buildings],
      });
    }
    for (const unit of [...scenario.units].sort((a, b) => a.id - b.id)) {
      this.assertUnit(unit);
      if (this.units.has(unit.id)) {
        throw new Error(`Duplicate unit id ${unit.id}`);
      }
      const terrain = this.worldGrid.typeAt(unit.position);
      const destination = unit.route[0] ?? null;
      const metrics = this.worldGrid.scoutTravelMetrics(
        unit.position,
        destination,
        this.tribes.get(unit.tribeId)?.terrainMovementModifiers ?? {},
        this.tribes.get(unit.tribeId)?.vegetationMovementModifiers ?? {},
      );
      this.units.set(unit.id, {
        ...unit,
        position: { ...unit.position },
        route: unit.route.map((waypoint) => ({ ...waypoint })),
        terrain,
        vegetation: metrics.vegetation,
        vegetationDensity: metrics.vegetationDensity,
        speedMetersPerHour: metrics.speedMetersPerHour,
        slopeDegrees: metrics.slopeDegrees,
        remainingTravelMinutes: this.estimateRouteTravelMinutes(
          unit.position,
          unit.route,
          this.tribes.get(unit.tribeId)?.terrainMovementModifiers ?? {},
          this.tribes.get(unit.tribeId)?.vegetationMovementModifiers ?? {},
        ),
        combat: unit.combat
          ? {
              ...unit.combat,
              order: unit.combat.order ? { ...unit.combat.order } : null,
            }
          : null,
      });
      this.nextUnitId = Math.max(this.nextUnitId, unit.id + 1);
    }
    this.relations = [...scenario.relations]
      .sort(
        (left, right) =>
          left.firstTribeId - right.firstTribeId ||
          left.secondTribeId - right.secondTribeId,
      )
      .map((relation) => ({ ...relation, agreements: [...relation.agreements] }));
    const relationKeys = new Set<string>();
    for (const relation of this.relations) {
      this.assertRelation(relation);
      const key = `${relation.firstTribeId}:${relation.secondTribeId}`;
      if (relationKeys.has(key)) throw new Error(`Duplicate diplomatic relation ${key}`);
      relationKeys.add(key);
    }
    this.diplomaticProposals = [...scenario.diplomaticProposals]
      .sort((left, right) => left.id - right.id)
      .map((proposal) => ({ ...proposal }));
    const proposalIds = new Set<number>();
    for (const proposal of this.diplomaticProposals) {
      this.assertDiplomaticProposal(proposal);
      if (proposalIds.has(proposal.id)) {
        throw new Error(`Duplicate diplomatic proposal id ${proposal.id}`);
      }
      proposalIds.add(proposal.id);
      this.nextProposalId = Math.max(this.nextProposalId, proposal.id + 1);
    }
    this.events = [...scenario.events]
      .sort((left, right) => left.id - right.id)
      .map((event) => ({ ...event }));
    const eventIds = new Set<number>();
    for (const event of this.events) {
      this.assertEvent(event);
      if (eventIds.has(event.id)) throw new Error(`Duplicate event id ${event.id}`);
      eventIds.add(event.id);
      this.nextEventId = Math.max(this.nextEventId, event.id + 1);
    }
    this.playerKnowledge = [...scenario.playerKnowledge]
      .sort((left, right) => left.playerId - right.playerId)
      .map((knowledge) => ({
        playerId: knowledge.playerId,
        exploredCells: knowledge.exploredCells.slice(),
        settlementIntelligence: knowledge.settlementIntelligence.map((record) => ({
          settlement: {
            ...record.settlement,
            position: { ...record.settlement.position },
            buildings: [...record.settlement.buildings],
          },
          tribe: {
            ...record.tribe,
            terrainMovementModifiers: { ...record.tribe.terrainMovementModifiers },
            vegetationMovementModifiers: { ...record.tribe.vegetationMovementModifiers },
          },
          lastObservedTick: record.lastObservedTick,
        })),
        unitIntelligence: knowledge.unitIntelligence.map((record) => ({
          unit: {
            ...record.unit,
            position: { ...record.unit.position },
            route: record.unit.route.map((waypoint) => ({ ...waypoint })),
            combat: record.unit.combat
              ? {
                  ...record.unit.combat,
                  order: record.unit.combat.order ? { ...record.unit.combat.order } : null,
                }
              : null,
          },
          tribe: {
            ...record.tribe,
            terrainMovementModifiers: { ...record.tribe.terrainMovementModifiers },
            vegetationMovementModifiers: { ...record.tribe.vegetationMovementModifiers },
          },
          lastObservedTick: record.lastObservedTick,
        })),
      }));
    for (const knowledge of this.playerKnowledge) {
      if (
        ![...this.tribes.values()].some(
          (tribe) => tribe.controllerPlayerId === knowledge.playerId,
        )
      ) {
        throw new Error(`Knowledge references unknown player ${knowledge.playerId}`);
      }
      assertGridBitsetLength(
        knowledge.exploredCells,
        this.worldGrid.cellCount,
        `Exploration for player ${knowledge.playerId}`,
      );
    }
    for (const research of [...scenario.research].sort((left, right) => left.tribeId - right.tribeId)) {
      this.assertResearch(research);
      if (this.researchByTribe.has(research.tribeId)) {
        throw new Error(`Duplicate Research state for Tribe ${research.tribeId}`);
      }
      this.researchByTribe.set(research.tribeId, cloneTribeResearch(research));
    }
    for (const tribeId of this.tribes.keys()) {
      if (!this.researchByTribe.has(tribeId)) {
        throw new Error(`Tribe ${tribeId} has no Research state`);
      }
    }
    this.updatePlayerVisibility();
  }

  public get tick(): number {
    return this.tickValue;
  }

  public step(input: TickInput): WorldSnapshot {
    this.advance(input);
    return this.snapshot();
  }

  /** Advances authoritative state without serializing or hashing an unused frame. */
  public advance(input: TickInput): void {
    if (input.tick !== this.tickValue) {
      throw new Error(`Expected tick ${this.tickValue}, received ${input.tick}`);
    }

    this.expireDiplomaticProposals();
    const commands = [...input.commands].sort(
      (a, b) => a.playerId - b.playerId || a.sequence - b.sequence,
    );
    for (let index = 1; index < commands.length; index += 1) {
      const previous = commands[index - 1];
      const current = commands[index];
      if (
        previous &&
        current &&
        previous.playerId === current.playerId &&
        previous.sequence === current.sequence
      ) {
        throw new Error(
          `Duplicate command sequence ${current.sequence} for player ${current.playerId}`,
        );
      }
    }
    for (const command of commands) {
      this.applyCommand(command);
    }

    if (isScoutTravelMinute(this.worldTimeValue)) {
      this.updateCombatRoutes();
      this.moveUnits();
    }
    const combatRoundTicks = BATTLE_CONFIG.roundWorldMinutes / WORLD_MINUTES_PER_TICK;
    if ((this.tickValue + 1) % combatRoundTicks === 0) {
      this.resolveCombatRounds();
    }
    this.advanceResearch();
    this.tickValue += 1;
    this.worldTimeValue = advanceWorldMinutes(
      this.worldTimeValue,
      WORLD_MINUTES_PER_TICK,
    );
    if (this.tickValue % SETTLEMENT_GROWTH_INTERVAL_TICKS === 0) {
      this.growSettlements();
    }
    this.updatePlayerVisibility();
    this.generatePeriodicEvents();
  }

  public snapshot(): WorldSnapshot {
    const tribes = [...this.tribes.values()]
      .sort((a, b) => a.id - b.id)
      .map((tribe) => ({ ...tribe }));
    const settlements = [...this.settlements.values()]
      .sort((a, b) => a.id - b.id)
      .map((settlement) => ({
        ...settlement,
        position: { ...settlement.position },
        buildings: [...settlement.buildings],
      }));
    const units = [...this.units.values()]
      .sort((a, b) => a.id - b.id)
      .map((unit) => ({
        ...unit,
        position: { ...unit.position },
        route: unit.route.map((waypoint) => ({ ...waypoint })),
        combat: unit.combat
          ? {
              ...unit.combat,
              order: unit.combat.order ? { ...unit.combat.order } : null,
            }
          : null,
      }));
    const relations = this.relations.map((relation) => ({
      ...relation,
      agreements: [...relation.agreements],
    }));
    const diplomaticProposals = this.diplomaticProposals.map((proposal) => ({
      ...proposal,
    }));
    const events = this.events.map((event) => ({ ...event }));
    const playerKnowledge = this.playerKnowledge.map((knowledge) => ({
      playerId: knowledge.playerId,
      exploredCells: knowledge.exploredCells.slice(),
      settlementIntelligence: knowledge.settlementIntelligence.map((record) => ({
        settlement: {
          ...record.settlement,
          position: { ...record.settlement.position },
          buildings: [...record.settlement.buildings],
        },
        tribe: {
          ...record.tribe,
          terrainMovementModifiers: { ...record.tribe.terrainMovementModifiers },
          vegetationMovementModifiers: { ...record.tribe.vegetationMovementModifiers },
        },
        lastObservedTick: record.lastObservedTick,
      })),
      unitIntelligence: knowledge.unitIntelligence.map((record) => ({
        unit: {
          ...record.unit,
          position: { ...record.unit.position },
          route: record.unit.route.map((waypoint) => ({ ...waypoint })),
          combat: record.unit.combat
            ? {
                ...record.unit.combat,
                order: record.unit.combat.order ? { ...record.unit.combat.order } : null,
              }
            : null,
        },
        tribe: {
          ...record.tribe,
          terrainMovementModifiers: { ...record.tribe.terrainMovementModifiers },
          vegetationMovementModifiers: { ...record.tribe.vegetationMovementModifiers },
        },
        lastObservedTick: record.lastObservedTick,
      })),
    }));
    const research = [...this.researchByTribe.values()]
      .sort((left, right) => left.tribeId - right.tribeId)
      .map(cloneTribeResearch);
    return {
      seed: this.seed,
      tick: this.tickValue,
      worldTime: { ...this.worldTimeValue },
      tribes,
      settlements,
      units,
      relations,
      diplomaticProposals,
      events,
      playerKnowledge,
      research,
      stateHash: hashWorldState(
        this.seed,
        this.tickValue,
        this.worldTimeValue,
        tribes,
        settlements,
        units,
        relations,
        diplomaticProposals,
        events,
        playerKnowledge,
        research,
      ),
    };
  }

  public playerSnapshot(playerId: number): PlayerWorldSnapshot {
    return this.playerSnapshots([playerId])[0]!;
  }

  /** Builds several fog-filtered views from one immutable World snapshot/hash pass. */
  public playerSnapshots(playerIds: readonly number[]): readonly PlayerWorldSnapshot[] {
    const world = this.snapshot();
    return playerIds.map((playerId) => {
      const visibility = this.visibilityByPlayer.get(playerId);
      if (!visibility) {
        throw new Error(`Player ${playerId} has no visibility state`);
      }
      return createPlayerWorldSnapshot(world, playerId, this.worldGrid, visibility);
    });
  }

  private applyCommand(command: GameCommand): void {
    switch (command.kind) {
      case "upgrade-camp":
        this.upgradeCamp(command);
        return;
      case "construct-building":
        this.constructBuilding(command);
        return;
      case "train-unit":
        this.trainUnit(command);
        return;
      case "move-unit":
        this.moveUnit(command);
        return;
      case "engage-unit":
        this.engageUnit(command);
        return;
      case "select-research":
        this.selectResearch(command);
        return;
      case "assign-administrator":
        this.assignAdministrator(command);
        return;
      case "take-diplomatic-action":
        this.takeDiplomaticAction(command);
        return;
      case "respond-diplomatic-proposal":
        this.respondDiplomaticProposal(command);
        return;
      case "resolve-event":
        this.resolveEvent(command);
        return;
    }
  }

  private takeDiplomaticAction(command: TakeDiplomaticActionCommand): void {
    const tribe = this.tribes.get(command.tribeId);
    const target = this.tribes.get(command.targetTribeId);
    if (!tribe || tribe.controllerPlayerId !== command.playerId) {
      throw new Error(`Player ${command.playerId} does not control this Tribe`);
    }
    if (!target || !this.playerKnowsTribe(command.playerId, target.id)) {
      throw new Error("Diplomatic action requires contact with the target Tribe");
    }
    const action = diplomaticActionDefinition(command.action);
    for (const technologyId of action.requiredTechnologyIds) {
      if (!this.tribeHasTechnology(tribe.id, technologyId)) {
        throw new Error(`${action.id} requires ${technologyId}`);
      }
    }
    const relation = this.relationBetween(tribe.id, target.id);
    const cooldownTicks = Math.ceil(
      (DIPLOMACY_CONFIG.actionCooldownWorldDays * 1_440) /
        WORLD_MINUTES_PER_TICK,
    );
    if (this.tickValue - relation.lastInteractionTick < cooldownTicks) {
      throw new Error("Diplomatic envoys are still occupied by the last interaction");
    }
    if (action.kind === "war") {
      if (relation.stance === "war") throw new Error("These Tribes are already at war");
      this.replaceRelation({
        ...applyRelationshipDelta(relation, action, this.tickValue),
        stance: "war",
        tension: DIPLOMACY_CONFIG.maximumTension,
        agreements: [],
      });
      this.removeProposalsBetween(tribe.id, target.id);
      this.createEvent("war-declared", tribe.id, target.id);
      this.createEvent("war-declared", target.id, tribe.id);
      return;
    }
    if (action.kind === "unilateral") {
      if (relation.stance === "war") {
        throw new Error("Only a peace offer is available during war");
      }
      this.replaceRelation(applyRelationshipDelta(relation, action, this.tickValue));
      return;
    }
    if (action.kind === "peace" && relation.stance !== "war") {
      throw new Error("A peace offer requires an active war");
    }
    if (action.kind === "proposal" && relation.stance === "war") {
      throw new Error("Pacts cannot be proposed during war");
    }
    if (action.agreement && relation.agreements.includes(action.agreement)) {
      throw new Error(`The ${action.agreement} agreement is already active`);
    }
    if (
      this.diplomaticProposals.some(
        (proposal) =>
          proposal.fromTribeId === tribe.id &&
          proposal.toTribeId === target.id &&
          proposal.action === command.action,
      )
    ) {
      throw new Error("This proposal is already awaiting an answer");
    }
    const proposal: DiplomaticProposal = {
      id: this.nextProposalId,
      fromTribeId: tribe.id,
      toTribeId: target.id,
      action: command.action,
      createdTick: this.tickValue,
      expiresTick:
        this.tickValue +
        Math.ceil(
          (DIPLOMACY_CONFIG.proposalExpiryWorldDays * 1_440) /
            WORLD_MINUTES_PER_TICK,
        ),
    };
    this.nextProposalId += 1;
    this.diplomaticProposals.push(proposal);
    this.replaceRelation({ ...relation, lastInteractionTick: this.tickValue });
    if (target.controllerPlayerId === null) {
      this.settleDiplomaticProposal(
        proposal,
        proposalAcceptanceScore(relation) >= action.acceptanceThreshold,
      );
    } else {
      this.createEvent("proposal-received", target.id, tribe.id);
    }
  }

  private respondDiplomaticProposal(
    command: RespondDiplomaticProposalCommand,
  ): void {
    const proposal = this.diplomaticProposals.find(
      (candidate) => candidate.id === command.proposalId,
    );
    if (!proposal) throw new Error(`Unknown diplomatic proposal ${command.proposalId}`);
    const target = this.tribes.get(proposal.toTribeId);
    if (!target || target.controllerPlayerId !== command.playerId) {
      throw new Error(`Player ${command.playerId} cannot answer this proposal`);
    }
    this.settleDiplomaticProposal(proposal, command.accept);
  }

  private settleDiplomaticProposal(
    proposal: DiplomaticProposal,
    accepted: boolean,
  ): void {
    const proposalIndex = this.diplomaticProposals.findIndex(
      (candidate) => candidate.id === proposal.id,
    );
    if (proposalIndex < 0) return;
    this.diplomaticProposals.splice(proposalIndex, 1);
    const action = diplomaticActionDefinition(proposal.action);
    const relation = this.relationBetween(
      proposal.fromTribeId,
      proposal.toTribeId,
    );
    if (!accepted) {
      this.replaceRelation(
        applyRelationshipDelta(
          relation,
          { opinionDelta: -3, trustDelta: -4, tensionDelta: 2 },
          this.tickValue,
        ),
      );
      this.createEvent(
        "proposal-refused",
        proposal.fromTribeId,
        proposal.toTribeId,
      );
      return;
    }
    if (action.kind === "peace") {
      this.replaceRelation(
        applyRelationshipDelta(
          { ...relation, stance: "neutral" },
          action,
          this.tickValue,
        ),
      );
    } else {
      const agreements = action.agreement
        ? [...new Set([...relation.agreements, action.agreement])].sort()
        : [...relation.agreements];
      this.replaceRelation({
        ...applyRelationshipDelta(relation, action, this.tickValue),
        agreements: agreements as DiplomaticAgreement[],
      });
    }
    this.createEvent(
      "pact-sealed",
      proposal.fromTribeId,
      proposal.toTribeId,
    );
    this.createEvent(
      "pact-sealed",
      proposal.toTribeId,
      proposal.fromTribeId,
    );
  }

  private expireDiplomaticProposals(): void {
    for (const proposal of [...this.diplomaticProposals]) {
      if (proposal.expiresTick <= this.tickValue) {
        this.settleDiplomaticProposal(proposal, false);
      }
    }
  }

  private removeProposalsBetween(firstTribeId: number, secondTribeId: number): void {
    const [first, second] = orderedTribePair(firstTribeId, secondTribeId);
    for (let index = this.diplomaticProposals.length - 1; index >= 0; index -= 1) {
      const proposal = this.diplomaticProposals[index];
      if (!proposal) continue;
      const pair = orderedTribePair(proposal.fromTribeId, proposal.toTribeId);
      if (pair[0] === first && pair[1] === second) {
        this.diplomaticProposals.splice(index, 1);
      }
    }
  }

  private relationBetween(firstTribeId: number, secondTribeId: number): TribeRelation {
    const [first, second] = orderedTribePair(firstTribeId, secondTribeId);
    const relation = this.relations.find(
      (candidate) =>
        candidate.firstTribeId === first && candidate.secondTribeId === second,
    );
    if (!relation) throw new Error(`No diplomatic relation exists for Tribes ${first} and ${second}`);
    return relation;
  }

  private replaceRelation(relation: TribeRelation): void {
    const index = this.relations.findIndex(
      (candidate) =>
        candidate.firstTribeId === relation.firstTribeId &&
        candidate.secondTribeId === relation.secondTribeId,
    );
    if (index < 0) throw new Error("Cannot replace an unknown diplomatic relation");
    this.assertRelation(relation);
    this.relations[index] = {
      ...relation,
      agreements: [...relation.agreements],
    };
  }

  private playerKnowsTribe(playerId: number, tribeId: number): boolean {
    if (
      this.tribes.get(tribeId)?.controllerPlayerId === playerId
    ) return true;
    const knowledge = this.playerKnowledge.find(
      (candidate) => candidate.playerId === playerId,
    );
    return Boolean(
      knowledge &&
        [...knowledge.settlementIntelligence, ...knowledge.unitIntelligence].some(
          (record) => record.tribe.id === tribeId,
        ),
    );
  }

  private resolveEvent(command: ResolveEventCommand): void {
    const eventIndex = this.events.findIndex(
      (candidate) => candidate.id === command.eventId,
    );
    const event = this.events[eventIndex];
    if (!event) throw new Error(`Unknown event ${command.eventId}`);
    const tribe = this.tribes.get(event.tribeId);
    if (!tribe || tribe.controllerPlayerId !== command.playerId) {
      throw new Error(`Player ${command.playerId} cannot resolve this event`);
    }
    if (event.status !== "pending") throw new Error("This event is already resolved");
    const definition = tribalEventDefinition(event.definitionId);
    const choice = definition.choices.find(
      (candidate) => candidate.id === command.choiceId,
    );
    if (!choice) throw new Error(`Unknown choice ${command.choiceId}`);
    this.applyEventEffects(event, choice.effects);
    this.events[eventIndex] = {
      ...event,
      status: "resolved",
      selectedChoiceId: choice.id,
    };
  }

  private applyEventEffects(event: GameEvent, effects: TribalEventEffects): void {
    const settlement =
      (event.settlementId ? this.settlements.get(event.settlementId) : undefined) ??
      [...this.settlements.values()]
        .filter((candidate) => candidate.tribeId === event.tribeId)
        .sort((left, right) => left.id - right.id)[0];
    if (settlement && (effects.populationDelta || effects.influenceDelta)) {
      this.settlements.set(settlement.id, {
        ...settlement,
        population: Math.max(1, settlement.population + (effects.populationDelta ?? 0)),
        influenceRadiusMeters: Math.min(
          MAX_SETTLEMENT_INFLUENCE_METERS,
          Math.max(
            MIN_SETTLEMENT_INFLUENCE_METERS,
            settlement.influenceRadiusMeters + (effects.influenceDelta ?? 0),
          ),
        ),
      });
    }
    const tribe = this.tribes.get(event.tribeId);
    if (tribe && effects.warriorsDelta) {
      this.tribes.set(tribe.id, {
        ...tribe,
        warriors: Math.max(0, tribe.warriors + effects.warriorsDelta),
      });
    }
    if (
      event.targetTribeId &&
      (effects.opinionDelta || effects.trustDelta || effects.tensionDelta)
    ) {
      this.replaceRelation(
        applyRelationshipDelta(
          this.relationBetween(event.tribeId, event.targetTribeId),
          effects,
          this.tickValue,
        ),
      );
    }
    if (effects.researchKnowledge) {
      const research = this.researchByTribe.get(event.tribeId);
      const activeTechnologyId = research?.queuedTechnologyIds[0];
      if (research && activeTechnologyId) {
        const progress = new Map(
          research.progress.map((entry) => [entry.technologyId, entry.investedKnowledgeMinutes]),
        );
        progress.set(
          activeTechnologyId,
          (progress.get(activeTechnologyId) ?? 0) + effects.researchKnowledge * 1_440,
        );
        this.researchByTribe.set(event.tribeId, {
          ...research,
          progress: [...progress]
            .map(([technologyId, investedKnowledgeMinutes]) => ({
              technologyId,
              investedKnowledgeMinutes,
            }))
            .sort((left, right) => left.technologyId.localeCompare(right.technologyId)),
        });
      }
    }
  }

  private createEvent(
    definitionId: string,
    tribeId: number,
    targetTribeId: number | null = null,
    settlementId: number | null = null,
    unitId: number | null = null,
  ): GameEvent {
    const definition = tribalEventDefinition(definitionId);
    const event: GameEvent = {
      id: this.nextEventId,
      definitionId,
      category: definition.category,
      tribeId,
      targetTribeId,
      settlementId,
      unitId,
      occurredTick: this.tickValue,
      status: definition.choices.length > 0 ? "pending" : "resolved",
      selectedChoiceId: null,
    };
    this.nextEventId += 1;
    this.events.push(event);
    this.trimEventHistory(tribeId);
    return event;
  }

  private trimEventHistory(tribeId: number): void {
    const resolved = this.events
      .filter((event) => event.tribeId === tribeId && event.status === "resolved")
      .sort((left, right) => left.id - right.id);
    const excess = resolved.length - TRIBAL_EVENT_CONFIG.maximumHistoryPerTribe;
    if (excess <= 0) return;
    const removed = new Set(resolved.slice(0, excess).map((event) => event.id));
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (removed.has(this.events[index]?.id ?? -1)) this.events.splice(index, 1);
    }
  }

  private generatePeriodicEvents(): void {
    const pulseTicks = Math.max(
      1,
      Math.ceil(
        (TRIBAL_EVENT_CONFIG.pulseWorldDays * 1_440) /
          WORLD_MINUTES_PER_TICK,
      ),
    );
    if (this.tickValue % pulseTicks !== 0) return;
    for (const tribe of this.tribes.values()) {
      if (tribe.controllerPlayerId === null) continue;
      const pendingCount = this.events.filter(
        (event) => event.tribeId === tribe.id && event.status === "pending",
      ).length;
      if (pendingCount >= TRIBAL_EVENT_CONFIG.maximumPendingPerTribe) continue;
      const roll = deterministicEventRoll(this.seed, this.tickValue, tribe.id, "chance");
      if (roll % 100 >= TRIBAL_EVENT_CONFIG.periodicChancePercent) continue;
      const knowledge = this.playerKnowledge.find(
        (candidate) => candidate.playerId === tribe.controllerPlayerId,
      );
      const knownTribeIds = [
        ...new Set(
          [
            ...(knowledge?.settlementIntelligence ?? []),
            ...(knowledge?.unitIntelligence ?? []),
          ]
            .map((record) => record.tribe.id)
            .filter((tribeId) => tribeId !== tribe.id),
        ),
      ].sort((left, right) => left - right);
      const settlements = [...this.settlements.values()]
        .filter((settlement) => settlement.tribeId === tribe.id)
        .sort((left, right) => left.id - right.id);
      const units = [...this.units.values()]
        .filter((unit) => unit.tribeId === tribe.id)
        .sort((left, right) => left.id - right.id);
      const context = {
        tribe,
        settlements,
        units,
        research: this.researchByTribe.get(tribe.id),
        knownTribeIds,
      };
      const eligible = TRIBAL_EVENTS.filter((definition) =>
        eventIsEligible(definition, context),
      );
      const recentIds = new Set(
        this.events
          .filter((event) => event.tribeId === tribe.id)
          .slice(-8)
          .map((event) => event.definitionId),
      );
      const fresh = eligible.filter((definition) => !recentIds.has(definition.id));
      const definition = chooseWeightedEvent(
        fresh.length > 0 ? fresh : eligible,
        deterministicEventRoll(this.seed, this.tickValue, tribe.id, "definition"),
      );
      if (!definition) continue;
      const targetTribeId = definition.conditions.requiresKnownTribe && knownTribeIds.length > 0
        ? knownTribeIds[
            deterministicEventRoll(this.seed, this.tickValue, tribe.id, "target") %
              knownTribeIds.length
          ] ?? null
        : null;
      const unit = definition.conditions.requiresScout
        ? units.find((candidate) => candidate.kind === "scout")
        : units[0];
      this.createEvent(
        definition.id,
        tribe.id,
        targetTribeId,
        settlements[0]?.id ?? null,
        unit?.id ?? null,
      );
    }
  }

  private selectResearch(command: SelectResearchCommand): void {
    const tribe = this.tribes.get(command.tribeId);
    if (!tribe || tribe.controllerPlayerId !== command.playerId) {
      throw new Error(`Player ${command.playerId} does not control this Tribe`);
    }
    const research = this.researchByTribe.get(tribe.id);
    if (!research) throw new Error(`Tribe ${tribe.id} has no Research state`);
    if (research.completedTechnologyIds.includes(command.technologyId)) {
      throw new Error(`${command.technologyId} is already complete`);
    }
    const plan = researchPlanForTarget(research, command.technologyId);
    if (plan.length === 0) throw new Error("Research plan contains no unfinished Technology");
    this.researchByTribe.set(tribe.id, {
      ...research,
      queuedTechnologyIds: plan,
    });
  }

  private assignAdministrator(command: AssignAdministratorCommand): void {
    const settlement = this.settlements.get(command.settlementId);
    if (!settlement) {
      throw new Error(`Unknown settlement id ${command.settlementId}`);
    }
    const tribe = this.tribes.get(settlement.tribeId);
    if (!tribe || tribe.controllerPlayerId !== command.playerId) {
      throw new Error(`Player ${command.playerId} does not control this Settlement`);
    }
    const role = administrationRoleDefinition(command.administrator);
    if (role.villageOnly && settlement.tier !== "village") {
      throw new Error(`${command.administrator} can only administer a Village`);
    }
    if (
      role.villageOnly &&
      !this.tribeHasTechnology(
        settlement.tribeId,
        VILLAGE_ADMINISTRATION_TECHNOLOGY_ID,
      )
    ) {
      throw new Error("Village Administration is required to assign this role");
    }
    this.settlements.set(settlement.id, {
      ...settlement,
      administrator: command.administrator,
    });
  }

  private upgradeCamp(command: UpgradeCampCommand): void {
    const settlement = this.settlements.get(command.settlementId);
    if (!settlement) {
      throw new Error(`Unknown settlement id ${command.settlementId}`);
    }
    const tribe = this.tribes.get(settlement.tribeId);
    if (!tribe || tribe.controllerPlayerId !== command.playerId) {
      throw new Error(`Player ${command.playerId} does not control this Camp`);
    }
    if (settlement.tier !== "camp") {
      throw new Error(`${settlement.name} is already a Village`);
    }
    if (!this.tribeHasTechnology(settlement.tribeId, "village-planning")) {
      throw new Error("Village Planning is required to upgrade a Camp");
    }
    this.settlements.set(settlement.id, { ...settlement, tier: "village" });
    this.createEvent("work-completed", settlement.tribeId, null, settlement.id);
  }

  private constructBuilding(command: ConstructBuildingCommand): void {
    const settlement = this.settlements.get(command.settlementId);
    if (!settlement) {
      throw new Error(`Unknown settlement id ${command.settlementId}`);
    }
    const tribe = this.tribes.get(settlement.tribeId);
    if (!tribe || tribe.controllerPlayerId !== command.playerId) {
      throw new Error(`Player ${command.playerId} does not control this Settlement`);
    }
    if (settlement.buildings.includes(command.building)) {
      throw new Error(`${settlement.name} already has a ${command.building}`);
    }
    const definition = tribalBuildingDefinition(command.building);
    if (!tierMeetsMinimum(settlement.tier, definition.minimumTier)) {
      throw new Error(`${definition.id} requires a ${definition.minimumTier}`);
    }
    if (
      definition.requiredTechnologyId &&
      !this.tribeHasTechnology(tribe.id, definition.requiredTechnologyId)
    ) {
      throw new Error(`${definition.id} requires ${definition.requiredTechnologyId}`);
    }
    this.settlements.set(settlement.id, {
      ...settlement,
      buildings: [...settlement.buildings, command.building].sort(),
    });
    this.createEvent("work-completed", settlement.tribeId, null, settlement.id);
  }

  private trainUnit(command: TrainUnitCommand): void {
    const settlement = this.settlements.get(command.settlementId);
    if (!settlement) {
      throw new Error(`Unknown settlement id ${command.settlementId}`);
    }
    const tribe = this.tribes.get(settlement.tribeId);
    if (!tribe || tribe.controllerPlayerId !== command.playerId) {
      throw new Error(`Player ${command.playerId} does not control this Settlement`);
    }
    const definition = tribalUnitDefinition(command.unitKind);
    if (!unitIsAvailableToCulture(definition, tribe.cultureId)) {
      throw new Error(`${definition.id} is not available to ${tribe.cultureId}`);
    }
    if (!tierMeetsMinimum(settlement.tier, definition.minimumTier)) {
      throw new Error(`${definition.id} requires a ${definition.minimumTier}`);
    }
    for (const technologyId of definition.requiredTechnologyIds) {
      if (!this.tribeHasTechnology(tribe.id, technologyId)) {
        throw new Error(`${definition.id} requires ${technologyId}`);
      }
    }
    if (
      definition.requiredBuildingId &&
      !settlement.buildings.includes(definition.requiredBuildingId)
    ) {
      throw new Error(`${definition.id} requires ${definition.requiredBuildingId}`);
    }
    const trainedCount = [...this.units.values()].filter(
      (unit) =>
        unit.homeSettlementId === settlement.id && unit.kind === command.unitKind,
    ).length;
    if (trainedCount >= definition.maximumPerSettlement) {
      throw new Error(`${settlement.name} has reached its ${definition.id} capacity`);
    }
    const populationCost = definition.populationCost;
    if (
      settlement.population <
      populationCost + definition.minimumPopulationAfterTraining
    ) {
      throw new Error(`${settlement.name} has no available population to train`);
    }

    const terrain = this.worldGrid.typeAt(settlement.position);
    const metrics = this.worldGrid.scoutTravelMetrics(
      settlement.position,
      null,
      tribe.terrainMovementModifiers,
      tribe.vegetationMovementModifiers,
    );
    const unit: Unit = {
      id: this.nextUnitId,
      tribeId: settlement.tribeId,
      homeSettlementId: settlement.id,
      kind: command.unitKind,
      position: { ...settlement.position },
      route: [],
      terrain,
      vegetation: metrics.vegetation,
      vegetationDensity: metrics.vegetationDensity,
      speedMetersPerHour: metrics.speedMetersPerHour,
      slopeDegrees: metrics.slopeDegrees,
      remainingTravelMinutes: null,
      combat: definition.combat
        ? {
            strength: definition.warriors,
            maximumStrength: definition.warriors,
            moralePermille: 1_000,
            cohesionPermille: 1_000,
            fatiguePermille: 0,
            missileReadinessPermille: 1_000,
            experience: 0,
            status: "ready",
            order: null,
          }
        : null,
    };
    this.nextUnitId += 1;
    this.units.set(unit.id, unit);
    this.tribes.set(tribe.id, {
      ...tribe,
      warriors: tribe.warriors + definition.warriors,
    });
    this.settlements.set(settlement.id, {
      ...settlement,
      population: settlement.population - populationCost,
    });
    this.createEvent("unit-trained", settlement.tribeId, null, settlement.id, unit.id);
  }

  private moveUnit(command: MoveUnitCommand): void {
    const unit = this.units.get(command.unitId);
    if (!unit) {
      throw new Error(`Unknown unit id ${command.unitId}`);
    }
    const tribe = this.tribes.get(unit.tribeId);
    if (!tribe || tribe.controllerPlayerId !== command.playerId) {
      throw new Error(`Player ${command.playerId} does not control this Unit`);
    }
    this.assertGeographicPosition(command.destination, "Unit destination");
    if (this.worldGrid.typeAt(command.destination) === "water") {
      throw new Error("Unit destination must be on land");
    }
    const route =
      command.mode === "append"
        ? [...unit.route, { ...command.destination }]
        : [{ ...command.destination }];
    this.units.set(unit.id, {
      ...unit,
      route,
      combat: unit.combat
        ? { ...unit.combat, order: null }
        : null,
      remainingTravelMinutes: this.estimateRouteTravelMinutes(
        unit.position,
        route,
        tribe.terrainMovementModifiers,
        tribe.vegetationMovementModifiers,
      ),
    });
  }

  private engageUnit(command: EngageUnitCommand): void {
    const unit = this.units.get(command.unitId);
    const target = this.units.get(command.targetUnitId);
    if (!unit || !target) throw new Error("Combat order references an unknown Unit");
    const tribe = this.tribes.get(unit.tribeId);
    if (!tribe || tribe.controllerPlayerId !== command.playerId) {
      throw new Error(`Player ${command.playerId} does not control this Unit`);
    }
    const definition = tribalUnitDefinition(unit.kind);
    if (!definition.combat || !unit.combat || unit.combat.status === "routed") {
      throw new Error(`${unit.kind} cannot engage an enemy`);
    }
    if (!definition.combat.formations.includes(command.formation)) {
      throw new Error(`${unit.kind} cannot use ${command.formation}`);
    }
    if (unit.tribeId === target.tribeId || !target.combat) {
      throw new Error("Combat requires an opposing combat Unit");
    }
    if (this.relationBetween(unit.tribeId, target.tribeId).stance !== "war") {
      throw new Error("Units may engage only during war");
    }
    if (!this.playerCurrentlyObservesUnit(command.playerId, target.id)) {
      throw new Error("Combat orders require a currently observed target");
    }
    this.units.set(unit.id, {
      ...unit,
      combat: {
        ...unit.combat,
        order: {
          targetUnitId: target.id,
          doctrine: command.doctrine,
          formation: command.formation,
          pursuit: command.pursuit,
          issuedTick: this.tickValue,
          engagementRounds: 0,
        },
      },
      route: [{ ...target.position }],
      remainingTravelMinutes: this.estimateRouteTravelMinutes(
        unit.position,
        [target.position],
        tribe.terrainMovementModifiers,
        tribe.vegetationMovementModifiers,
      ),
    });
  }

  private playerCurrentlyObservesUnit(playerId: number, unitId: number): boolean {
    return this.playerKnowledge
      .find((knowledge) => knowledge.playerId === playerId)
      ?.unitIntelligence.some(
        (record) => record.unit.id === unitId && record.lastObservedTick === this.tickValue,
      ) ?? false;
  }

  /** Pursuit follows only live intelligence; losing sight never leaks a hidden route. */
  private updateCombatRoutes(): void {
    for (const [id, unit] of [...this.units].sort((left, right) => left[0] - right[0])) {
      const order = unit.combat?.order;
      if (!order) continue;
      const tribe = this.tribes.get(unit.tribeId);
      const target = this.units.get(order.targetUnitId);
      if (
        !tribe ||
        !target ||
        !target.combat ||
        target.combat.status === "routed" ||
        this.relationBetween(unit.tribeId, target.tribeId).stance !== "war" ||
        (tribe.controllerPlayerId !== null &&
          !this.playerCurrentlyObservesUnit(tribe.controllerPlayerId, target.id))
      ) {
        this.units.set(id, {
          ...unit,
          route: [],
          remainingTravelMinutes: null,
          combat: { ...unit.combat!, order: null },
        });
        continue;
      }
      const rangeMeters = tribalUnitDefinition(unit.kind).combat?.rangeMeters ?? 0;
      const distanceMeters = geographicDistanceMeters(unit.position, target.position);
      const route = distanceMeters <= rangeMeters ? [] : [{ ...target.position }];
      this.units.set(id, {
        ...unit,
        route,
        remainingTravelMinutes: route.length === 0
          ? null
          : this.estimateRouteTravelMinutes(
              unit.position,
              route,
              tribe.terrainMovementModifiers,
              tribe.vegetationMovementModifiers,
            ),
      });
    }
  }

  private resolveCombatRounds(): void {
    const engaged = new Set<number>();
    const orderedAttackers = [...this.units.values()]
      .filter((unit) => unit.combat?.order)
      .sort((left, right) => left.id - right.id);
    for (const attacker of orderedAttackers) {
      const order = attacker.combat?.order;
      const currentAttacker = this.units.get(attacker.id);
      const defender = order ? this.units.get(order.targetUnitId) : undefined;
      if (
        !order ||
        !currentAttacker?.combat ||
        !defender?.combat ||
        engaged.has(currentAttacker.id) ||
        engaged.has(defender.id) ||
        this.relationBetween(currentAttacker.tribeId, defender.tribeId).stance !== "war"
      ) continue;
      const distanceMeters = geographicDistanceMeters(currentAttacker.position, defender.position);
      const attackerDefinition = tribalUnitDefinition(currentAttacker.kind).combat!;
      const defenderDefinition = tribalUnitDefinition(defender.kind).combat!;
      if (distanceMeters > Math.max(attackerDefinition.rangeMeters, defenderDefinition.rangeMeters)) {
        continue;
      }
      const attackerGroup = [...this.units.values()]
        .filter(
          (unit) =>
            unit.tribeId === currentAttacker.tribeId &&
            unit.combat?.status !== "routed" &&
            !engaged.has(unit.id) &&
            geographicDistanceMeters(unit.position, currentAttacker.position) <=
              BATTLE_CONFIG.supportRadiusMeters,
        )
        .sort((left, right) => left.id - right.id);
      const defenderGroup = [...this.units.values()]
        .filter(
          (unit) =>
            unit.tribeId === defender.tribeId &&
            unit.combat?.status !== "routed" &&
            !engaged.has(unit.id) &&
            geographicDistanceMeters(unit.position, defender.position) <=
              BATTLE_CONFIG.supportRadiusMeters,
        )
        .sort((left, right) => left.id - right.id);
      const attackerResearch = new Set(
        this.researchByTribe.get(currentAttacker.tribeId)?.completedTechnologyIds ?? [],
      );
      const defenderResearch = new Set(
        this.researchByTribe.get(defender.tribeId)?.completedTechnologyIds ?? [],
      );
      const approach = this.worldGrid.battleApproachMetrics(
        currentAttacker.position,
        defender.position,
      );
      const defenderPreparedAmbush =
        order.engagementRounds === 0 &&
        defender.route.length === 0 &&
        !defender.combat.order &&
        defender.combat.status === "ready" &&
        defender.combat.cohesionPermille >= 650 &&
        defender.combat.fatiguePermille <= 450 &&
        (
          defender.vegetationDensity === "moderate" ||
          defender.vegetationDensity === "dense" ||
          defender.terrain === "hills" ||
          defender.terrain === "mountains"
        );
      const result = resolveGroupBattleRound(
        attackerGroup.map((unit) => ({ unit, completedTechnologyIds: attackerResearch })),
        defenderGroup.map((unit) => ({ unit, completedTechnologyIds: defenderResearch })),
        {
          terrain: defender.terrain,
          vegetation: defender.vegetation,
          attackerElevationMeters: approach.attackerElevationMeters,
          defenderElevationMeters: approach.defenderElevationMeters,
          attackerSlopeDegrees: approach.attackerSlopeDegrees,
          riverCrossing: approach.riverCrossing,
          ambushSide: defenderPreparedAmbush ? "defender" : "none",
          distanceMeters,
          isNight: !isDaytime(this.worldTimeValue),
        },
        this.seed,
        this.tickValue,
      );
      for (const unit of [...attackerGroup, ...defenderGroup]) engaged.add(unit.id);
      const battleEnded = result.attackersRouted || result.defendersRouted;
      if (result.attackersRouted !== result.defendersRouted) {
        const winner = result.attackersRouted ? defender : currentAttacker;
        const loser = result.attackersRouted ? currentAttacker : defender;
        this.createEvent("battle-won", winner.tribeId, loser.tribeId, winner.homeSettlementId, winner.id);
        this.createEvent("battle-lost", loser.tribeId, winner.tribeId, loser.homeSettlementId, loser.id);
      }
      const updates = [
        ...attackerGroup.map((unit, index) => ({ unit, combat: result.attackerCombats[index]! })),
        ...defenderGroup.map((unit, index) => ({ unit, combat: result.defenderCombats[index]! })),
      ];
      for (const { unit, combat } of updates) {
        this.reduceTribeWarriors(unit.tribeId, unit.combat!.strength - combat.strength);
        if (combat.strength === 0) {
          this.units.delete(unit.id);
          continue;
        }
        const incrementedOrder = combat.order && attackerGroup.some((attackerUnit) => attackerUnit.id === unit.id)
          ? { ...combat.order, engagementRounds: combat.order.engagementRounds + 1 }
          : combat.order;
        this.units.set(unit.id, {
          ...unit,
          route: combat.status === "routed" ? this.retreatRoute(unit) : unit.route,
          combat: { ...combat, order: battleEnded ? null : incrementedOrder },
        });
      }
    }
    for (const [id, unit] of this.units) {
      if (!unit.combat || engaged.has(id) || unit.combat.order) continue;
      this.units.set(id, { ...unit, combat: recoverCombatState(unit.combat) });
    }
  }

  private retreatRoute(unit: Unit): readonly { longitudeE6: number; latitudeE6: number }[] {
    const home = this.settlements.get(unit.homeSettlementId);
    return home ? [{ ...home.position }] : [];
  }

  private reduceTribeWarriors(tribeId: number, losses: number): void {
    if (losses <= 0) return;
    const tribe = this.tribes.get(tribeId);
    if (tribe) this.tribes.set(tribeId, { ...tribe, warriors: Math.max(0, tribe.warriors - losses) });
  }

  private moveUnits(): void {
    for (const [id, unit] of this.units) {
      const destination = unit.route[0];
      if (!destination) {
        continue;
      }
      const advance = this.worldGrid.advance(
        unit.position,
        destination,
        WORLD_MINUTES_PER_TICK,
        this.tribes.get(unit.tribeId)?.terrainMovementModifiers ?? {},
        this.tribes.get(unit.tribeId)?.vegetationMovementModifiers ?? {},
      );
      const stopped = advance.reached || advance.blocked;
      const route = advance.blocked
        ? []
        : advance.reached
          ? unit.route.slice(1)
          : unit.route;
      const nextDestination = route[0] ?? null;
      const stoppedMetrics = stopped
        ? this.worldGrid.scoutTravelMetrics(
            advance.position,
            nextDestination,
            this.tribes.get(unit.tribeId)?.terrainMovementModifiers ?? {},
            this.tribes.get(unit.tribeId)?.vegetationMovementModifiers ?? {},
          )
        : advance;
      this.units.set(id, {
        ...unit,
        position: advance.position,
        route,
        terrain: stoppedMetrics.terrain,
        vegetation: stoppedMetrics.vegetation,
        vegetationDensity: stoppedMetrics.vegetationDensity,
        speedMetersPerHour: stoppedMetrics.speedMetersPerHour,
        slopeDegrees: stoppedMetrics.slopeDegrees,
        remainingTravelMinutes: route.length === 0
          ? null
          : unit.remainingTravelMinutes === null
            ? null
            : Math.max(0, unit.remainingTravelMinutes - WORLD_MINUTES_PER_TICK),
      });
    }
  }

  private updatePlayerVisibility(): void {
    for (let index = 0; index < this.playerKnowledge.length; index += 1) {
      const knowledge = this.playerKnowledge[index];
      if (!knowledge) continue;
      const previouslyKnownTribeIds = new Set(
        [...knowledge.settlementIntelligence, ...knowledge.unitIntelligence].map(
          (record) => record.tribe.id,
        ),
      );
      const controlledTribeIds = new Set(
        [...this.tribes.values()]
          .filter((tribe) => tribe.controllerPlayerId === knowledge.playerId)
          .map((tribe) => tribe.id),
      );
      const daylightObservers: VisionObserver[] = [
        ...[...this.settlements.values()]
          .filter((settlement) => controlledTribeIds.has(settlement.tribeId))
          .map(settlementVisionObserver),
        ...[...this.units.values()]
          .filter((unit) => controlledTribeIds.has(unit.tribeId))
          .map(unitVisionObserver),
      ].sort((left, right) => left.id.localeCompare(right.id));
      const observers = isDaytime(this.worldTimeValue)
        ? daylightObservers
        : daylightObservers.map((observer) => ({
            ...observer,
            detectionRadiusMeters: Math.max(
              observer.footprintRadiusMeters,
              Math.round(observer.detectionRadiusMeters * NIGHT_VISION_MULTIPLIER),
            ),
            maximumTerrainDistanceMeters: Math.max(
              observer.footprintRadiusMeters,
              Math.round(observer.detectionRadiusMeters * NIGHT_VISION_MULTIPLIER),
            ),
          }));
      const observerKey = this.visibilitySystem.observerKey(observers);
      const previousVisibility = this.visibilityByPlayer.get(knowledge.playerId);
      const visibility =
        observerKey === this.observerKeyByPlayer.get(knowledge.playerId) &&
        previousVisibility
          ? previousVisibility
          : this.visibilitySystem.compute(
              observers,
              (previousVisibility?.revision ?? 0) + 1,
            );
      const exploredCells = knowledge.exploredCells.slice();
      if (visibility !== previousVisibility) {
        orGridBitsets(exploredCells, visibility.visibleCells);
      }
      const intelligence = refreshPlayerIntelligence({
        tick: this.tickValue,
        playerId: knowledge.playerId,
        previous: knowledge,
        tribes: [...this.tribes.values()],
        settlements: [...this.settlements.values()],
        units: [...this.units.values()],
        visibility,
        worldGrid: this.worldGrid,
      });
      this.playerKnowledge[index] = {
        playerId: knowledge.playerId,
        exploredCells,
        ...intelligence,
      };
      const currentlyKnownTribeIds = new Set(
        [...intelligence.settlementIntelligence, ...intelligence.unitIntelligence].map(
          (record) => record.tribe.id,
        ),
      );
      for (const discoveredTribeId of currentlyKnownTribeIds) {
        if (previouslyKnownTribeIds.has(discoveredTribeId)) continue;
        for (const controlledTribeId of controlledTribeIds) {
          if (
            discoveredTribeId !== controlledTribeId &&
            !eventAlreadyRepresentsContact(
              this.events,
              controlledTribeId,
              discoveredTribeId,
            )
          ) {
            const settlement = [...this.settlements.values()]
              .filter((candidate) => candidate.tribeId === controlledTribeId)
              .sort((left, right) => left.id - right.id)[0];
            this.createEvent(
              "first-contact",
              controlledTribeId,
              discoveredTribeId,
              settlement?.id ?? null,
            );
          }
        }
      }
      this.visibilityByPlayer.set(knowledge.playerId, visibility);
      this.observerKeyByPlayer.set(knowledge.playerId, observerKey);
    }
  }

  private growSettlements(): void {
    for (const [id, settlement] of this.settlements) {
      const administration = administrationRoleDefinition(settlement.administrator);
      const buildings = tribalBuildingEffects(settlement.buildings);
      this.settlements.set(id, {
        ...settlement,
        population:
          settlement.population +
          GAMEPLAY_CONFIG.settlements.populationGrowthPerInterval +
          administration.populationGrowthPerInterval +
          buildings.populationGrowthPerInterval,
        influenceRadiusMeters: Math.min(
          MAX_SETTLEMENT_INFLUENCE_METERS,
          Math.max(
            MIN_SETTLEMENT_INFLUENCE_METERS,
            settlement.influenceRadiusMeters +
              GAMEPLAY_CONFIG.settlements.influenceGrowthMetersPerInterval +
              administration.influenceGrowthMetersPerInterval +
              buildings.influenceGrowthMetersPerInterval,
          ),
        ),
      });
    }
  }

  private advanceResearch(): void {
    const populationByTribe = new Map<number, number>();
    const villagesByTribe = new Map<number, number>();
    const settlementKnowledgeByTribe = new Map<number, number>();
    for (const settlement of this.settlements.values()) {
      populationByTribe.set(
        settlement.tribeId,
        (populationByTribe.get(settlement.tribeId) ?? 0) + settlement.population,
      );
      if (settlement.tier === "village") {
        villagesByTribe.set(
          settlement.tribeId,
          (villagesByTribe.get(settlement.tribeId) ?? 0) + 1,
        );
      }
      settlementKnowledgeByTribe.set(
        settlement.tribeId,
        (settlementKnowledgeByTribe.get(settlement.tribeId) ?? 0) +
          administrationRoleDefinition(settlement.administrator).knowledgePerWorldDay +
          tribalBuildingEffects(settlement.buildings).knowledgePerWorldDay,
      );
    }
    for (const tribe of this.tribes.values()) {
      let research = this.researchByTribe.get(tribe.id);
      if (!research) continue;
      if (research.queuedTechnologyIds.length === 0 && tribe.controllerPlayerId === null) {
        const nextTechnology = nextNpcTechnology(research, tribe.cultureId);
        if (nextTechnology) research = { ...research, queuedTechnologyIds: [nextTechnology] };
      }
      const activeTechnologyId = research.queuedTechnologyIds[0];
      if (!activeTechnologyId) {
        this.researchByTribe.set(tribe.id, research);
        continue;
      }
      const technology = technologyDefinition(activeTechnologyId);
      const completed = new Set(research.completedTechnologyIds);
      if (!technologyIsAvailable(completed, technology)) {
        throw new Error(`Queued Technology ${activeTechnologyId} is not available`);
      }
      const progress = new Map(
        research.progress.map((entry) => [entry.technologyId, entry.investedKnowledgeMinutes]),
      );
      const invested =
        (progress.get(activeTechnologyId) ?? 0) +
        knowledgePerWorldDay(
          tribe.cultureId,
          populationByTribe.get(tribe.id) ?? 0,
          villagesByTribe.get(tribe.id) ?? 0,
          activeTechnologyId,
          settlementKnowledgeByTribe.get(tribe.id) ?? 0,
        ) * WORLD_MINUTES_PER_TICK;
      const required = technology.cost * 1_440;
      if (invested >= required) {
        progress.delete(activeTechnologyId);
        completed.add(activeTechnologyId);
        research = {
          tribeId: tribe.id,
          queuedTechnologyIds: research.queuedTechnologyIds.slice(1),
          completedTechnologyIds: [...completed].sort(
            (left, right) =>
              technologyDefinition(left).column - technologyDefinition(right).column ||
              technologyDefinition(left).row - technologyDefinition(right).row ||
              left.localeCompare(right),
          ),
          progress: [...progress]
            .map(([technologyId, investedKnowledgeMinutes]) => ({
              technologyId,
              investedKnowledgeMinutes,
            }))
            .sort((left, right) => left.technologyId.localeCompare(right.technologyId)),
        };
        this.createEvent("research-breakthrough", tribe.id);
      } else {
        progress.set(activeTechnologyId, invested);
        research = {
          ...research,
          progress: [...progress]
            .map(([technologyId, investedKnowledgeMinutes]) => ({
              technologyId,
              investedKnowledgeMinutes,
            }))
            .sort((left, right) => left.technologyId.localeCompare(right.technologyId)),
        };
      }
      this.researchByTribe.set(tribe.id, research);
    }
  }

  private tribeHasTechnology(tribeId: number, technologyId: string): boolean {
    return (
      this.researchByTribe
        .get(tribeId)
        ?.completedTechnologyIds.includes(technologyId) ?? false
    );
  }

  private assertTribe(tribe: Tribe): void {
    if (!Number.isInteger(tribe.id) || tribe.id < 1) {
      throw new Error("Tribe id must be a positive integer");
    }
    if (!Number.isInteger(tribe.warriors) || tribe.warriors < 0) {
      throw new Error("Tribe warriors must be a non-negative integer");
    }
    if (tribe.cultureId.trim().length === 0) {
      throw new Error("Tribe culture id must be present");
    }
    for (const modifier of Object.values(tribe.terrainMovementModifiers)) {
      if (!Number.isInteger(modifier) || modifier < -100 || modifier > 100) {
        throw new Error("Tribe terrain movement modifiers must be bounded integers");
      }
    }
    for (const modifier of Object.values(tribe.vegetationMovementModifiers)) {
      if (!Number.isInteger(modifier) || modifier < -100 || modifier > 100) {
        throw new Error("Tribe vegetation movement modifiers must be bounded integers");
      }
    }
  }

  private assertResearch(research: TribeResearch): void {
    if (!this.tribes.has(research.tribeId)) {
      throw new Error(`Research references unknown Tribe ${research.tribeId}`);
    }
    const completed = new Set(research.completedTechnologyIds);
    if (completed.size !== research.completedTechnologyIds.length) {
      throw new Error(`Research for Tribe ${research.tribeId} repeats a completed Technology`);
    }
    for (const technologyId of completed) {
      if (!technologyIsAvailable(completed, technologyDefinition(technologyId))) {
        throw new Error(`Completed Technology ${technologyId} lacks its prerequisites`);
      }
    }
    const queued = new Set(research.queuedTechnologyIds);
    if (
      queued.size !== research.queuedTechnologyIds.length ||
      research.queuedTechnologyIds.some((technologyId) => completed.has(technologyId))
    ) {
      throw new Error(`Research queue for Tribe ${research.tribeId} is invalid`);
    }
    for (const technologyId of [...completed, ...queued]) technologyDefinition(technologyId);
    const progressIds = new Set<string>();
    for (const entry of research.progress) {
      const technology = technologyDefinition(entry.technologyId);
      if (
        progressIds.has(entry.technologyId) ||
        completed.has(entry.technologyId) ||
        !Number.isInteger(entry.investedKnowledgeMinutes) ||
        entry.investedKnowledgeMinutes <= 0 ||
        entry.investedKnowledgeMinutes >= technology.cost * 1_440
      ) {
        throw new Error(`Research progress for Tribe ${research.tribeId} is invalid`);
      }
      progressIds.add(entry.technologyId);
    }
    const simulatedCompleted = new Set(completed);
    for (const technologyId of research.queuedTechnologyIds) {
      const technology = technologyDefinition(technologyId);
      if (!technologyIsAvailable(simulatedCompleted, technology)) {
        throw new Error(`Research queue for Tribe ${research.tribeId} is not prerequisite-first`);
      }
      simulatedCompleted.add(technologyId);
    }
  }

  private assertSettlement(settlement: Settlement): void {
    if (!this.tribes.has(settlement.tribeId)) {
      throw new Error(`Settlement references unknown tribe ${settlement.tribeId}`);
    }
    this.assertGeographicPosition(settlement.position, "Settlement");
    if (!Number.isInteger(settlement.population) || settlement.population < 1) {
      throw new Error("Settlement population must be a positive integer");
    }
    if (
      !Number.isInteger(settlement.influenceRadiusMeters) ||
      settlement.influenceRadiusMeters < 0
    ) {
      throw new Error("Settlement influence must be a non-negative integer distance");
    }
    for (const building of settlement.buildings) tribalBuildingDefinition(building);
    if (new Set(settlement.buildings).size !== settlement.buildings.length) {
      throw new Error("Settlement contains invalid or duplicate buildings");
    }
    const administration = administrationRoleDefinition(settlement.administrator);
    if (
      settlement.tier === "camp" &&
      administration.id !== DEFAULT_SETTLEMENT_ADMINISTRATOR
    ) {
      throw new Error("A Camp must be administered by its Tribal Leader");
    }
  }

  private assertUnit(unit: Unit): void {
    if (!Number.isInteger(unit.id) || unit.id < 1) {
      throw new Error("Unit id must be a positive integer");
    }
    const tribe = this.tribes.get(unit.tribeId);
    const home = this.settlements.get(unit.homeSettlementId);
    if (!tribe || !home || home.tribeId !== unit.tribeId) {
      throw new Error("Unit references an invalid Tribe or home Settlement");
    }
    const definition = tribalUnitDefinition(unit.kind);
    if (!unitIsAvailableToCulture(definition, tribe.cultureId)) {
      throw new Error(`${unit.kind} is not available to ${tribe.cultureId}`);
    }
    if (Boolean(definition.combat) !== Boolean(unit.combat)) {
      throw new Error(`${unit.kind} has invalid combat state`);
    }
    if (unit.combat) {
      const values = [
        unit.combat.strength,
        unit.combat.maximumStrength,
        unit.combat.moralePermille,
        unit.combat.cohesionPermille,
        unit.combat.fatiguePermille,
        unit.combat.missileReadinessPermille,
        unit.combat.experience,
      ];
      if (values.some((value) => !Number.isInteger(value) || value < 0)) {
        throw new Error("Combat state must contain non-negative integers");
      }
      if (
        unit.combat.maximumStrength < 1 ||
        unit.combat.strength > unit.combat.maximumStrength ||
        unit.combat.moralePermille > 1_000 ||
        unit.combat.cohesionPermille > 1_000 ||
        unit.combat.fatiguePermille > 1_000 ||
        unit.combat.missileReadinessPermille > 1_000
      ) {
        throw new Error("Combat state is outside its valid range");
      }
      if (
        unit.combat.order &&
        !definition.combat?.formations.includes(unit.combat.order.formation)
      ) {
        throw new Error(`${unit.kind} cannot use ${unit.combat.order.formation}`);
      }
      if (
        unit.combat.order &&
        (!Number.isInteger(unit.combat.order.engagementRounds) || unit.combat.order.engagementRounds < 0)
      ) {
        throw new Error("Combat engagement rounds must be a non-negative integer");
      }
    }
    this.assertGeographicPosition(unit.position, "Unit");
    for (const waypoint of unit.route) {
      this.assertGeographicPosition(waypoint, "Unit waypoint");
    }
  }

  private estimateRouteTravelMinutes(
    start: { readonly longitudeE6: number; readonly latitudeE6: number },
    route: readonly { readonly longitudeE6: number; readonly latitudeE6: number }[],
    terrainModifiers: Readonly<Partial<Record<TerrainType, number>>>,
    vegetationModifiers: Readonly<Partial<Record<VegetationType, number>>>,
  ): number | null {
    if (route.length === 0) return null;
    let total = 0;
    let position = start;
    for (const waypoint of route) {
      const segment = this.worldGrid.estimateScoutTravelMinutes(
        position,
        waypoint,
        terrainModifiers,
        vegetationModifiers,
      );
      if (segment === null) return null;
      total += segment;
      position = waypoint;
    }
    return total;
  }

  private assertGeographicPosition(
    position: { readonly longitudeE6: number; readonly latitudeE6: number },
    label: string,
  ): void {
    const { longitudeE6, latitudeE6 } = position;
    if (
      !Number.isInteger(longitudeE6) ||
      longitudeE6 < MINIMUM_LONGITUDE_E6 ||
      longitudeE6 > MAXIMUM_LONGITUDE_E6
    ) {
      throw new Error(`${label} has invalid longitude ${longitudeE6}`);
    }
    if (
      !Number.isInteger(latitudeE6) ||
      latitudeE6 < MINIMUM_LATITUDE_E6 ||
      latitudeE6 > MAXIMUM_LATITUDE_E6
    ) {
      throw new Error(`${label} has invalid latitude ${latitudeE6}`);
    }
  }

  private assertRelation(relation: TribeRelation): void {
    if (
      !this.tribes.has(relation.firstTribeId) ||
      !this.tribes.has(relation.secondTribeId)
    ) {
      throw new Error("Relation references an unknown tribe");
    }
    if (relation.firstTribeId >= relation.secondTribeId) {
      throw new Error("Relation tribe ids must be stored in ascending order");
    }
    if (
      !Number.isInteger(relation.opinion) ||
      relation.opinion < DIPLOMACY_CONFIG.minimumOpinion ||
      relation.opinion > DIPLOMACY_CONFIG.maximumOpinion ||
      !Number.isInteger(relation.trust) ||
      relation.trust < DIPLOMACY_CONFIG.minimumTrust ||
      relation.trust > DIPLOMACY_CONFIG.maximumTrust ||
      !Number.isInteger(relation.tension) ||
      relation.tension < DIPLOMACY_CONFIG.minimumTension ||
      relation.tension > DIPLOMACY_CONFIG.maximumTension
    ) {
      throw new Error("Diplomatic relationship values are outside their bounds");
    }
    if (
      !Number.isInteger(relation.lastInteractionTick) ||
      new Set(relation.agreements).size !== relation.agreements.length ||
      [...relation.agreements].sort().some(
        (agreement, index) => agreement !== relation.agreements[index],
      )
    ) {
      throw new Error("Diplomatic agreements or interaction time are invalid");
    }
    if (relation.stance === "war" && relation.agreements.length > 0) {
      throw new Error("Warring Tribes cannot retain diplomatic agreements");
    }
  }

  private assertDiplomaticProposal(proposal: DiplomaticProposal): void {
    if (!Number.isInteger(proposal.id) || proposal.id < 1) {
      throw new Error("Diplomatic proposal id must be a positive integer");
    }
    if (
      !this.tribes.has(proposal.fromTribeId) ||
      !this.tribes.has(proposal.toTribeId) ||
      proposal.fromTribeId === proposal.toTribeId
    ) {
      throw new Error("Diplomatic proposal references invalid Tribes");
    }
    const action = diplomaticActionDefinition(proposal.action);
    if (action.kind !== "proposal" && action.kind !== "peace") {
      throw new Error("Only pact and peace actions can be proposed");
    }
    if (
      !Number.isInteger(proposal.createdTick) ||
      !Number.isInteger(proposal.expiresTick) ||
      proposal.expiresTick <= proposal.createdTick
    ) {
      throw new Error("Diplomatic proposal has an invalid lifetime");
    }
  }

  private assertEvent(event: GameEvent): void {
    if (!Number.isInteger(event.id) || event.id < 1 || !this.tribes.has(event.tribeId)) {
      throw new Error("Event id or owning Tribe is invalid");
    }
    const definition = tribalEventDefinition(event.definitionId);
    if (definition.category !== event.category) {
      throw new Error(`Event ${event.id} has the wrong category`);
    }
    if (event.targetTribeId !== null && !this.tribes.has(event.targetTribeId)) {
      throw new Error(`Event ${event.id} references an unknown target Tribe`);
    }
    if (event.settlementId !== null && !this.settlements.has(event.settlementId)) {
      throw new Error(`Event ${event.id} references an unknown Settlement`);
    }
    if (event.unitId !== null && !this.units.has(event.unitId)) {
      throw new Error(`Event ${event.id} references an unknown Unit`);
    }
    if (
      !Number.isInteger(event.occurredTick) ||
      (event.status === "pending" && event.selectedChoiceId !== null) ||
      (event.selectedChoiceId !== null &&
        !definition.choices.some((choice) => choice.id === event.selectedChoiceId))
    ) {
      throw new Error(`Event ${event.id} has an invalid state`);
    }
  }

}
