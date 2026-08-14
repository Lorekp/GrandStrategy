import type {
  DiplomaticProposal,
  GameEvent,
  PlayerKnowledge,
  Settlement,
  Tribe,
  TribeRelation,
  TribeResearch,
  Unit,
  WorldDateTime,
} from "./model";

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mix(hash: number, value: number): number {
  hash ^= value | 0;
  return Math.imul(hash, FNV_PRIME) >>> 0;
}

function mixText(hash: number, value: string): number {
  let result = hash;
  for (let index = 0; index < value.length; index += 1) {
    result = mix(result, value.charCodeAt(index));
  }
  return result;
}

function mixTribe(hash: number, tribe: Tribe): number {
  let result = mix(hash, tribe.id);
  result = mixText(result, tribe.name);
  result = mixText(result, tribe.cultureId);
  for (const terrain of [
    "water",
    "plains",
    "hills",
    "mountains",
    "desert",
    "tundra",
    "ice",
  ] as const) {
    result = mix(result, tribe.terrainMovementModifiers[terrain] ?? 0);
  }
  for (const vegetation of ["none", "forest", "jungle"] as const) {
    result = mix(result, tribe.vegetationMovementModifiers[vegetation] ?? 0);
  }
  result = mix(result, tribe.color);
  result = mix(result, tribe.controllerPlayerId ?? -1);
  return mix(result, tribe.warriors);
}

function mixSettlement(hash: number, settlement: Settlement): number {
  let result = mix(hash, settlement.id);
  result = mix(result, settlement.tribeId);
  result = mixText(result, settlement.name);
  result = mix(result, settlement.position.longitudeE6);
  result = mix(result, settlement.position.latitudeE6);
  result = mixText(result, settlement.tier);
  result = mix(result, settlement.population);
  result = mix(result, settlement.influenceRadiusMeters);
  result = mixText(result, settlement.administrator);
  for (const building of settlement.buildings) {
    result = mixText(result, building);
  }
  return result;
}

function mixUnit(hash: number, unit: Unit): number {
  let result = mix(hash, unit.id);
  result = mix(result, unit.tribeId);
  result = mix(result, unit.homeSettlementId);
  result = mixText(result, unit.kind);
  result = mix(result, unit.position.longitudeE6);
  result = mix(result, unit.position.latitudeE6);
  result = mix(result, unit.route.length);
  for (const waypoint of unit.route) {
    result = mix(result, waypoint.longitudeE6);
    result = mix(result, waypoint.latitudeE6);
  }
  result = mixText(result, unit.terrain);
  result = mixText(result, unit.vegetation);
  result = mixText(result, unit.vegetationDensity);
  result = mix(result, unit.speedMetersPerHour);
  result = mix(result, Math.round(unit.slopeDegrees * 10));
  result = mix(result, unit.remainingTravelMinutes ?? -1);
  if (!unit.combat) return mix(result, -1);
  result = mix(result, unit.combat.strength);
  result = mix(result, unit.combat.maximumStrength);
  result = mix(result, unit.combat.moralePermille);
  result = mix(result, unit.combat.cohesionPermille);
  result = mix(result, unit.combat.fatiguePermille);
  result = mix(result, unit.combat.missileReadinessPermille);
  result = mix(result, unit.combat.experience);
  result = mixText(result, unit.combat.status);
  if (!unit.combat.order) return mix(result, -1);
  result = mix(result, unit.combat.order.targetUnitId);
  result = mixText(result, unit.combat.order.doctrine);
  result = mixText(result, unit.combat.order.formation);
  result = mixText(result, unit.combat.order.pursuit);
  result = mix(result, unit.combat.order.issuedTick);
  return mix(result, unit.combat.order.engagementRounds);
}

export function hashWorldState(
  seed: number,
  tick: number,
  worldTime: WorldDateTime,
  tribes: readonly Tribe[],
  settlements: readonly Settlement[],
  units: readonly Unit[],
  relations: readonly TribeRelation[],
  diplomaticProposals: readonly DiplomaticProposal[],
  events: readonly GameEvent[],
  playerKnowledge: readonly PlayerKnowledge[],
  research: readonly TribeResearch[],
): string {
  let hash = mix(FNV_OFFSET_BASIS, seed);
  hash = mix(hash, tick);
  hash = mix(hash, worldTime.year);
  hash = mix(hash, worldTime.month);
  hash = mix(hash, worldTime.day);
  hash = mix(hash, worldTime.hour);
  hash = mix(hash, worldTime.minute);
  for (const tribe of tribes) {
    hash = mixTribe(hash, tribe);
  }
  for (const settlement of settlements) {
    hash = mixSettlement(hash, settlement);
  }
  for (const unit of units) {
    hash = mixUnit(hash, unit);
  }
  for (const relation of relations) {
    hash = mix(hash, relation.firstTribeId);
    hash = mix(hash, relation.secondTribeId);
    hash = mixText(hash, relation.stance);
    hash = mix(hash, relation.opinion);
    hash = mix(hash, relation.trust);
    hash = mix(hash, relation.tension);
    for (const agreement of relation.agreements) {
      hash = mixText(hash, agreement);
    }
    hash = mix(hash, relation.lastInteractionTick);
  }
  for (const proposal of diplomaticProposals) {
    hash = mix(hash, proposal.id);
    hash = mix(hash, proposal.fromTribeId);
    hash = mix(hash, proposal.toTribeId);
    hash = mixText(hash, proposal.action);
    hash = mix(hash, proposal.createdTick);
    hash = mix(hash, proposal.expiresTick);
  }
  for (const event of events) {
    hash = mix(hash, event.id);
    hash = mixText(hash, event.definitionId);
    hash = mixText(hash, event.category);
    hash = mix(hash, event.tribeId);
    hash = mix(hash, event.targetTribeId ?? -1);
    hash = mix(hash, event.settlementId ?? -1);
    hash = mix(hash, event.unitId ?? -1);
    hash = mix(hash, event.occurredTick);
    hash = mixText(hash, event.status);
    hash = mixText(hash, event.selectedChoiceId ?? "");
  }
  for (const knowledge of playerKnowledge) {
    hash = mix(hash, knowledge.playerId);
    for (const word of knowledge.exploredCells) {
      hash = mix(hash, word);
    }
    for (const record of knowledge.settlementIntelligence) {
      hash = mixSettlement(hash, record.settlement);
      hash = mixTribe(hash, record.tribe);
      hash = mix(hash, record.lastObservedTick);
    }
    for (const record of knowledge.unitIntelligence) {
      hash = mixUnit(hash, record.unit);
      hash = mixTribe(hash, record.tribe);
      hash = mix(hash, record.lastObservedTick);
    }
  }
  for (const tribeResearch of research) {
    hash = mix(hash, tribeResearch.tribeId);
    for (const technologyId of tribeResearch.queuedTechnologyIds) {
      hash = mixText(hash, technologyId);
    }
    for (const technologyId of tribeResearch.completedTechnologyIds) {
      hash = mixText(hash, technologyId);
    }
    for (const progress of tribeResearch.progress) {
      hash = mixText(hash, progress.technologyId);
      hash = mix(hash, progress.investedKnowledgeMinutes);
    }
  }
  return hash.toString(16).padStart(8, "0");
}
