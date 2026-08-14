import type {
  CurrentPlayerVisibility,
  PlayerId,
  PlayerSettlement,
  PlayerUnit,
  PlayerWorldSnapshot,
  Tribe,
  WorldSnapshot,
} from "./model";
import { WorldGrid } from "./WorldGrid";
import { cloneTribeResearch } from "../technology/TribalTechnology";

function cloneTribe(tribe: Tribe): Tribe {
  return {
    ...tribe,
    terrainMovementModifiers: { ...tribe.terrainMovementModifiers },
    vegetationMovementModifiers: { ...tribe.vegetationMovementModifiers },
  };
}

export function createPlayerWorldSnapshot(
  snapshot: WorldSnapshot,
  viewerPlayerId: PlayerId,
  worldGrid: WorldGrid,
  currentVisibility: CurrentPlayerVisibility,
): PlayerWorldSnapshot {
  const controlledTribes = snapshot.tribes.filter(
    (tribe) => tribe.controllerPlayerId === viewerPlayerId,
  );
  const controlledTribeIds = new Set(controlledTribes.map((tribe) => tribe.id));
  if (controlledTribeIds.size === 0) {
    throw new Error(`Player ${viewerPlayerId} controls no tribe`);
  }
  const knowledge = snapshot.playerKnowledge.find(
    (candidate) => candidate.playerId === viewerPlayerId,
  );
  if (!knowledge) {
    throw new Error(`Player ${viewerPlayerId} has no knowledge state`);
  }

  const settlements: PlayerSettlement[] = [
    ...snapshot.settlements
      .filter((settlement) => controlledTribeIds.has(settlement.tribeId))
      .map((settlement) => ({
        ...settlement,
        position: { ...settlement.position },
        buildings: [...settlement.buildings],
        intelligence: "controlled" as const,
        lastObservedTick: snapshot.tick,
      })),
    ...knowledge.settlementIntelligence.map((record) => ({
      ...record.settlement,
      position: { ...record.settlement.position },
      buildings: [...record.settlement.buildings],
      intelligence:
        record.lastObservedTick === snapshot.tick
          ? ("observed" as const)
          : ("remembered" as const),
      lastObservedTick: record.lastObservedTick,
    })),
  ].sort((left, right) => left.id - right.id);

  const units: PlayerUnit[] = [
    ...snapshot.units
      .filter((unit) => controlledTribeIds.has(unit.tribeId))
      .map((unit) => ({
        ...unit,
        position: { ...unit.position },
        route: unit.route.map((waypoint) => ({ ...waypoint })),
        combat: unit.combat
          ? { ...unit.combat, order: unit.combat.order ? { ...unit.combat.order } : null }
          : null,
        intelligence: "controlled" as const,
        lastObservedTick: snapshot.tick,
      })),
    ...knowledge.unitIntelligence.map((record) => ({
      ...record.unit,
      position: { ...record.unit.position },
      route: [],
      remainingTravelMinutes: null,
      combat: record.unit.combat ? { ...record.unit.combat, order: null } : null,
      intelligence:
        record.lastObservedTick === snapshot.tick
          ? ("observed" as const)
          : ("remembered" as const),
      lastObservedTick: record.lastObservedTick,
    })),
  ].sort((left, right) => left.id - right.id);

  const knownTribes = new Map<number, { tribe: Tribe; observedTick: number }>();
  for (const tribe of controlledTribes) {
    knownTribes.set(tribe.id, { tribe, observedTick: snapshot.tick });
  }
  for (const record of [
    ...knowledge.settlementIntelligence,
    ...knowledge.unitIntelligence,
  ]) {
    const previous = knownTribes.get(record.tribe.id);
    if (!previous || record.lastObservedTick >= previous.observedTick) {
      knownTribes.set(record.tribe.id, {
        tribe: record.tribe,
        observedTick: record.lastObservedTick,
      });
    }
  }
  const tribes = [...knownTribes.values()]
    .map(({ tribe }) => cloneTribe(tribe))
    .sort((left, right) => left.id - right.id);
  const visibleTribeIds = new Set(tribes.map((tribe) => tribe.id));
  const relations = snapshot.relations
    .filter(
      (relation) =>
        visibleTribeIds.has(relation.firstTribeId) &&
        visibleTribeIds.has(relation.secondTribeId),
    )
    .map((relation) => ({
      ...relation,
      agreements: [...relation.agreements],
    }));
  const diplomaticProposals = snapshot.diplomaticProposals
    .filter(
      (proposal) =>
        (controlledTribeIds.has(proposal.fromTribeId) ||
          controlledTribeIds.has(proposal.toTribeId)) &&
        visibleTribeIds.has(proposal.fromTribeId) &&
        visibleTribeIds.has(proposal.toTribeId),
    )
    .map((proposal) => ({ ...proposal }));
  const events = snapshot.events
    .filter((event) => controlledTribeIds.has(event.tribeId))
    .map((event) => ({ ...event }));
  const research = snapshot.research
    .filter((tribeResearch) => controlledTribeIds.has(tribeResearch.tribeId))
    .map(cloneTribeResearch);

  return {
    seed: snapshot.seed,
    tick: snapshot.tick,
    worldTime: { ...snapshot.worldTime },
    viewerPlayerId,
    tribes,
    settlements,
    units,
    relations,
    diplomaticProposals,
    events,
    research,
    visibility: {
      width: worldGrid.width,
      height: worldGrid.height,
      revision: currentVisibility.revision,
      visibleCells: currentVisibility.visibleCells.slice(),
      exploredCells: knowledge.exploredCells.slice(),
    },
  };
}
