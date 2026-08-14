import { createGridBitset } from "../core/GridBitset";
import type {
  PlayerId,
  PlayerKnowledge,
  ScenarioDefinition,
  Tribe,
  TribeRelation,
} from "../core/model";
import { diplomaticRelationKey, orderedTribePair } from "../diplomacy/TribalDiplomacy";

const NEW_RELATION_LAST_INTERACTION_TICK = -1_000_000_000;

function nextAvailablePlayerId(scenario: ScenarioDefinition): PlayerId {
  return (
    Math.max(
      0,
      ...scenario.tribes.flatMap((tribe) =>
        tribe.controllerPlayerId === null ? [] : [tribe.controllerPlayerId],
      ),
      ...scenario.playerKnowledge.map((knowledge) => knowledge.playerId),
    ) + 1
  );
}

function assignControllers(scenario: ScenarioDefinition): readonly Tribe[] {
  let nextPlayerId = nextAvailablePlayerId(scenario);
  const controllerByTribeId = new Map<number, PlayerId>();
  for (const tribe of [...scenario.tribes].sort((left, right) => left.id - right.id)) {
    controllerByTribeId.set(
      tribe.id,
      tribe.controllerPlayerId ?? nextPlayerId++,
    );
  }
  return scenario.tribes.map((tribe) => ({
    ...tribe,
    controllerPlayerId: controllerByTribeId.get(tribe.id)!,
  }));
}

function ensureControllerKnowledge(
  scenario: ScenarioDefinition,
  tribes: readonly Tribe[],
): readonly PlayerKnowledge[] {
  const knowledgeByPlayer = new Map(
    scenario.playerKnowledge.map((knowledge) => [knowledge.playerId, knowledge]),
  );
  const cellCount = scenario.worldGrid.width * scenario.worldGrid.height;
  for (const playerId of new Set(
    tribes.map((tribe) => tribe.controllerPlayerId as PlayerId),
  )) {
    if (!knowledgeByPlayer.has(playerId)) {
      knowledgeByPlayer.set(playerId, {
        playerId,
        exploredCells: createGridBitset(cellCount),
        settlementIntelligence: [],
        unitIntelligence: [],
      });
    }
  }
  return [...knowledgeByPlayer.values()].sort(
    (left, right) => left.playerId - right.playerId,
  );
}

function completeRelationGraph(scenario: ScenarioDefinition): readonly TribeRelation[] {
  const relationByPair = new Map(
    scenario.relations.map((relation) => [
      diplomaticRelationKey(relation.firstTribeId, relation.secondTribeId),
      relation,
    ]),
  );
  const tribeIds = scenario.tribes.map((tribe) => tribe.id).sort((a, b) => a - b);
  for (let firstIndex = 0; firstIndex < tribeIds.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < tribeIds.length; secondIndex += 1) {
      const firstTribeId = tribeIds[firstIndex]!;
      const secondTribeId = tribeIds[secondIndex]!;
      const key = diplomaticRelationKey(firstTribeId, secondTribeId);
      if (relationByPair.has(key)) continue;
      const [first, second] = orderedTribePair(firstTribeId, secondTribeId);
      relationByPair.set(key, {
        firstTribeId: first,
        secondTribeId: second,
        stance: "neutral",
        opinion: 0,
        trust: 15,
        tension: 20,
        agreements: [],
        lastInteractionTick: NEW_RELATION_LAST_INTERACTION_TICK,
      });
    }
  }
  return [...relationByPair.values()].sort(
    (left, right) =>
      left.firstTribeId - right.firstTribeId ||
      left.secondTribeId - right.secondTribeId,
  );
}

/**
 * Converts passive scenario tribes into independently controlled agents without
 * changing geography, opening state, or existing diplomacy.
 */
export function createSelfPlayScenario(
  scenario: ScenarioDefinition,
): ScenarioDefinition {
  const tribes = assignControllers(scenario);
  return {
    ...scenario,
    tribes,
    relations: completeRelationGraph(scenario),
    playerKnowledge: ensureControllerKnowledge(scenario, tribes),
  };
}
