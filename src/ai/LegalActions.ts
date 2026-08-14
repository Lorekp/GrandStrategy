import { VILLAGE_ADMINISTRATION_TECHNOLOGY_ID, TRIBAL_ADMINISTRATION_ROLES } from "../administration/TribalAdministration";
import { WORLD_MINUTES_PER_TICK } from "../core/constants";
import type {
  BattleFormation,
  CombatDoctrine,
  GameCommand,
  PlayerWorldSnapshot,
  PursuitPolicy,
} from "../core/model";
import {
  diplomaticRelationKey,
  DIPLOMATIC_ACTIONS,
  DIPLOMACY_CONFIG,
} from "../diplomacy/TribalDiplomacy";
import { tribalEventDefinition } from "../events/TribalEvents";
import { TRIBAL_TECHNOLOGIES } from "../technology/TribalTechnology";
import { tierMeetsMinimum, TRIBAL_BUILDINGS } from "../tribal/TribalRoster";
import {
  TRIBAL_UNITS,
  tribalUnitDefinition,
  unitIsAvailableToCulture,
} from "../combat/MilitaryRoster";

type StripCommandEnvelope<Command> = Command extends GameCommand
  ? Omit<Command, "playerId" | "sequence">
  : never;

export type PlayerDecision = StripCommandEnvelope<GameCommand>;
export type MoveUnitDecision = Extract<PlayerDecision, { readonly kind: "move-unit" }>;
export type EngageUnitDecision = Extract<PlayerDecision, { readonly kind: "engage-unit" }>;
export type DiscretePlayerDecision = Exclude<PlayerDecision, MoveUnitDecision | EngageUnitDecision>;

export interface MovementActionParameters {
  readonly unitId: number;
  readonly modes: readonly ["replace", "append"];
  readonly destinationEncoding: "wgs84-e6";
  readonly requiresLand: true;
}

export interface EngagementActionParameters {
  readonly unitId: number;
  readonly targetUnitIds: readonly number[];
  readonly doctrines: readonly CombatDoctrine[];
  readonly formations: readonly BattleFormation[];
  readonly pursuits: readonly PursuitPolicy[];
}

export interface LegalActionCatalog {
  /** Concrete choices suitable for a discrete masked-action encoder. */
  readonly discrete: readonly DiscretePlayerDecision[];
  /** Spatial actions remain parametric instead of exploding into one action per cell. */
  readonly movement: readonly MovementActionParameters[];
  /** Observed wartime targets and legal tactical policies stay parametric. */
  readonly engagement: readonly EngagementActionParameters[];
}

export function playerDecisionKey(decision: PlayerDecision): string {
  return JSON.stringify(decision);
}

export function legalActionCatalog(
  snapshot: PlayerWorldSnapshot,
): LegalActionCatalog {
  const discrete: DiscretePlayerDecision[] = [];
  const controlledTribes = snapshot.tribes
    .filter((tribe) => tribe.controllerPlayerId === snapshot.viewerPlayerId)
    .sort((left, right) => left.id - right.id);
  const controlledTribeIds = new Set(controlledTribes.map((tribe) => tribe.id));
  const researchByTribe = new Map(
    snapshot.research.map((research) => [research.tribeId, research]),
  );
  const relationByPair = new Map(
    snapshot.relations.map((relation) => [
      diplomaticRelationKey(relation.firstTribeId, relation.secondTribeId),
      relation,
    ]),
  );
  const unitCountBySettlementAndKind = new Map<string, number>();
  for (const unit of snapshot.units) {
    const key = `${unit.homeSettlementId}:${unit.kind}`;
    unitCountBySettlementAndKind.set(
      key,
      (unitCountBySettlementAndKind.get(key) ?? 0) + 1,
    );
  }
  const pendingProposalKeys = new Set(
    snapshot.diplomaticProposals.map(
      (proposal) =>
        `${proposal.fromTribeId}:${proposal.toTribeId}:${proposal.action}`,
    ),
  );

  for (const event of snapshot.events) {
    if (event.status !== "pending" || !controlledTribeIds.has(event.tribeId)) continue;
    for (const choice of tribalEventDefinition(event.definitionId).choices) {
      discrete.push({ kind: "resolve-event", eventId: event.id, choiceId: choice.id });
    }
  }
  for (const proposal of snapshot.diplomaticProposals) {
    if (!controlledTribeIds.has(proposal.toTribeId)) continue;
    discrete.push({ kind: "respond-diplomatic-proposal", proposalId: proposal.id, accept: false });
    discrete.push({ kind: "respond-diplomatic-proposal", proposalId: proposal.id, accept: true });
  }

  for (const tribe of controlledTribes) {
    const research = researchByTribe.get(tribe.id);
    const completed = new Set(research?.completedTechnologyIds ?? []);
    if (research) {
      for (const technology of TRIBAL_TECHNOLOGIES) {
        if (!completed.has(technology.id)) {
          discrete.push({
            kind: "select-research",
            tribeId: tribe.id,
            technologyId: technology.id,
          });
        }
      }
    }

    const settlements = snapshot.settlements
      .filter((settlement) => settlement.tribeId === tribe.id)
      .sort((left, right) => left.id - right.id);
    for (const settlement of settlements) {
      if (settlement.tier === "camp" && completed.has("village-planning")) {
        discrete.push({ kind: "upgrade-camp", settlementId: settlement.id });
      }
      for (const building of TRIBAL_BUILDINGS) {
        if (
          !settlement.buildings.includes(building.id) &&
          tierMeetsMinimum(settlement.tier, building.minimumTier) &&
          (!building.requiredTechnologyId || completed.has(building.requiredTechnologyId))
        ) {
          discrete.push({
            kind: "construct-building",
            settlementId: settlement.id,
            building: building.id,
          });
        }
      }
      for (const unit of TRIBAL_UNITS) {
        const trainedCount =
          unitCountBySettlementAndKind.get(`${settlement.id}:${unit.id}`) ?? 0;
        if (
          unitIsAvailableToCulture(unit, tribe.cultureId) &&
          tierMeetsMinimum(settlement.tier, unit.minimumTier) &&
          unit.requiredTechnologyIds.every((technologyId) => completed.has(technologyId)) &&
          (!unit.requiredBuildingId || settlement.buildings.includes(unit.requiredBuildingId)) &&
          trainedCount < unit.maximumPerSettlement &&
          settlement.population >= unit.populationCost + unit.minimumPopulationAfterTraining
        ) {
          discrete.push({
            kind: "train-unit",
            settlementId: settlement.id,
            unitKind: unit.id,
          });
        }
      }
      for (const role of TRIBAL_ADMINISTRATION_ROLES) {
        if (role.id === settlement.administrator) continue;
        if (
          !role.villageOnly ||
          (settlement.tier === "village" &&
            completed.has(VILLAGE_ADMINISTRATION_TECHNOLOGY_ID))
        ) {
          discrete.push({
            kind: "assign-administrator",
            settlementId: settlement.id,
            administrator: role.id,
          });
        }
      }
    }

    for (const target of snapshot.tribes) {
      if (target.controllerPlayerId === snapshot.viewerPlayerId) continue;
      const relation = relationByPair.get(diplomaticRelationKey(tribe.id, target.id));
      if (!relation) continue;
      const cooldownTicks = Math.ceil(
        (DIPLOMACY_CONFIG.actionCooldownWorldDays * 1_440) /
          WORLD_MINUTES_PER_TICK,
      );
      if (snapshot.tick - relation.lastInteractionTick < cooldownTicks) continue;
      for (const action of DIPLOMATIC_ACTIONS) {
        if (!action.requiredTechnologyIds.every((technologyId) => completed.has(technologyId))) {
          continue;
        }
        if (action.kind === "war" && relation.stance === "war") continue;
        if (action.kind === "unilateral" && relation.stance === "war") continue;
        if (action.kind === "peace" && relation.stance !== "war") continue;
        if (action.kind === "proposal" && relation.stance === "war") continue;
        if (action.agreement && relation.agreements.includes(action.agreement)) continue;
        if (pendingProposalKeys.has(`${tribe.id}:${target.id}:${action.id}`)) {
          continue;
        }
        discrete.push({
          kind: "take-diplomatic-action",
          tribeId: tribe.id,
          targetTribeId: target.id,
          action: action.id,
        });
      }
    }
  }

  discrete.sort((left, right) =>
    playerDecisionKey(left).localeCompare(playerDecisionKey(right)),
  );
  const movement = snapshot.units
    .filter((unit) => controlledTribeIds.has(unit.tribeId))
    .sort((left, right) => left.id - right.id)
    .map((unit) => ({
      unitId: unit.id,
      modes: ["replace", "append"] as const,
      destinationEncoding: "wgs84-e6" as const,
      requiresLand: true as const,
    }));
  const observedEnemies = snapshot.units.filter(
    (unit) => unit.intelligence === "observed" && !controlledTribeIds.has(unit.tribeId) && unit.combat,
  );
  const engagement = snapshot.units
    .filter((unit) => controlledTribeIds.has(unit.tribeId) && unit.combat?.status !== "routed")
    .sort((left, right) => left.id - right.id)
    .flatMap((unit): EngagementActionParameters[] => {
      const definition = tribalUnitDefinition(unit.kind).combat;
      if (!definition) return [];
      const targets = observedEnemies
        .filter(
          (target) =>
            relationByPair.get(diplomaticRelationKey(unit.tribeId, target.tribeId))
              ?.stance === "war",
        )
        .map((target) => target.id)
        .sort((left, right) => left - right);
      if (targets.length === 0) return [];
      return [{
        unitId: unit.id,
        targetUnitIds: targets,
        doctrines: ["cautious", "balanced", "aggressive"],
        formations: [...definition.formations],
        pursuits: ["hold", "controlled", "all-out"],
      }];
    });
  return { discrete, movement, engagement };
}

export function playerDecisionIsLegal(
  catalog: LegalActionCatalog,
  decision: PlayerDecision,
): boolean {
  if (decision.kind === "move-unit") {
    return (
      Number.isInteger(decision.destination.longitudeE6) &&
      decision.destination.longitudeE6 >= -180_000_000 &&
      decision.destination.longitudeE6 <= 180_000_000 &&
      Number.isInteger(decision.destination.latitudeE6) &&
      decision.destination.latitudeE6 >= -90_000_000 &&
      decision.destination.latitudeE6 <= 90_000_000 &&
      catalog.movement.some(
        (movement) =>
          movement.unitId === decision.unitId && movement.modes.includes(decision.mode),
      )
    );
  }
  if (decision.kind === "engage-unit") {
    return catalog.engagement.some(
      (engagement) =>
        engagement.unitId === decision.unitId &&
        engagement.targetUnitIds.includes(decision.targetUnitId) &&
        engagement.doctrines.includes(decision.doctrine) &&
        engagement.formations.includes(decision.formation) &&
        engagement.pursuits.includes(decision.pursuit),
    );
  }
  const key = playerDecisionKey(decision);
  return catalog.discrete.some((candidate) => playerDecisionKey(candidate) === key);
}
