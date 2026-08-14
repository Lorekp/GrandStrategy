import { gridBitIsSet } from "./GridBitset";
import type {
  CurrentPlayerVisibility,
  GeographicPosition,
  PlayerKnowledge,
  Settlement,
  SettlementIntelligence,
  Tribe,
  Unit,
  UnitIntelligence,
} from "./model";
import { WorldGrid } from "./WorldGrid";

function cloneTribe(tribe: Tribe): Tribe {
  return {
    ...tribe,
    terrainMovementModifiers: { ...tribe.terrainMovementModifiers },
    vegetationMovementModifiers: { ...tribe.vegetationMovementModifiers },
  };
}

function cloneSettlement(settlement: Settlement): Settlement {
  return {
    ...settlement,
    position: { ...settlement.position },
    buildings: [...settlement.buildings],
  };
}

function snapshotEnemyUnit(unit: Unit): Unit {
  return {
    ...unit,
    position: { ...unit.position },
    route: [],
    remainingTravelMinutes: null,
    combat: unit.combat ? { ...unit.combat, order: null } : null,
  };
}

function cellIsDetectable(
  position: GeographicPosition,
  cells: Uint32Array,
  worldGrid: WorldGrid,
): boolean {
  const cell = worldGrid.cellAt(position);
  return cell !== undefined && gridBitIsSet(cells, cell.index);
}

function settlementDetectionCells(
  settlement: Settlement,
  visibility: CurrentPlayerVisibility,
): Uint32Array {
  return settlement.tier === "village"
    ? visibility.villageDetectableCells
    : visibility.campDetectableCells;
}

export interface RefreshPlayerIntelligenceInput {
  readonly tick: number;
  readonly playerId: number;
  readonly previous: PlayerKnowledge;
  readonly tribes: readonly Tribe[];
  readonly settlements: readonly Settlement[];
  readonly units: readonly Unit[];
  readonly visibility: CurrentPlayerVisibility;
  readonly worldGrid: WorldGrid;
}

/**
 * Refreshes the authoritative last-known ledger. An unseen record survives until
 * an observer can identify its last-known cell and confirms that it is gone.
 */
export function refreshPlayerIntelligence({
  tick,
  playerId,
  previous,
  tribes,
  settlements,
  units,
  visibility,
  worldGrid,
}: RefreshPlayerIntelligenceInput): Pick<
  PlayerKnowledge,
  "settlementIntelligence" | "unitIntelligence"
> {
  const controlledTribeIds = new Set(
    tribes
      .filter((tribe) => tribe.controllerPlayerId === playerId)
      .map((tribe) => tribe.id),
  );
  const tribeById = new Map(tribes.map((tribe) => [tribe.id, tribe]));

  const settlementsById = new Map<number, SettlementIntelligence>();
  for (const settlement of settlements) {
    if (controlledTribeIds.has(settlement.tribeId)) continue;
    const tribe = tribeById.get(settlement.tribeId);
    if (
      tribe &&
      cellIsDetectable(
        settlement.position,
        settlementDetectionCells(settlement, visibility),
        worldGrid,
      )
    ) {
      settlementsById.set(settlement.id, {
        settlement: cloneSettlement(settlement),
        tribe: cloneTribe(tribe),
        lastObservedTick: tick,
      });
    }
  }
  for (const record of previous.settlementIntelligence) {
    if (
      settlementsById.has(record.settlement.id) ||
      controlledTribeIds.has(record.settlement.tribeId) ||
      cellIsDetectable(
        record.settlement.position,
        settlementDetectionCells(record.settlement, visibility),
        worldGrid,
      )
    ) {
      continue;
    }
    settlementsById.set(record.settlement.id, {
      settlement: cloneSettlement(record.settlement),
      tribe: cloneTribe(record.tribe),
      lastObservedTick: record.lastObservedTick,
    });
  }

  const unitsById = new Map<number, UnitIntelligence>();
  for (const unit of units) {
    if (controlledTribeIds.has(unit.tribeId)) continue;
    const tribe = tribeById.get(unit.tribeId);
    if (
      tribe &&
      cellIsDetectable(
        unit.position,
        visibility.unitDetectableCells,
        worldGrid,
      )
    ) {
      unitsById.set(unit.id, {
        unit: snapshotEnemyUnit(unit),
        tribe: cloneTribe(tribe),
        lastObservedTick: tick,
      });
    }
  }
  for (const record of previous.unitIntelligence) {
    if (
      unitsById.has(record.unit.id) ||
      controlledTribeIds.has(record.unit.tribeId) ||
      cellIsDetectable(
        record.unit.position,
        visibility.unitDetectableCells,
        worldGrid,
      )
    ) {
      continue;
    }
    unitsById.set(record.unit.id, {
      unit: snapshotEnemyUnit(record.unit),
      tribe: cloneTribe(record.tribe),
      lastObservedTick: record.lastObservedTick,
    });
  }

  return {
    settlementIntelligence: [...settlementsById.values()].sort(
      (left, right) => left.settlement.id - right.settlement.id,
    ),
    unitIntelligence: [...unitsById.values()].sort(
      (left, right) => left.unit.id - right.unit.id,
    ),
  };
}
