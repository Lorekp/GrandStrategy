import diplomacySource from "../config/diplomacy.json";
import type {
  DiplomaticAction,
  DiplomaticAgreement,
  DiplomaticStance,
  TribeId,
  TribeRelation,
} from "../core/model";

export type DiplomaticActionKind = "unilateral" | "proposal" | "war" | "peace";

export interface DiplomaticActionDefinition {
  readonly id: DiplomaticAction;
  readonly kind: DiplomaticActionKind;
  readonly requiredTechnologyIds: readonly string[];
  readonly agreement: DiplomaticAgreement | null;
  readonly opinionDelta: number;
  readonly trustDelta: number;
  readonly tensionDelta: number;
  readonly acceptanceThreshold: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function validateCatalog(): void {
  const ids = new Set<string>();
  for (const action of diplomacySource.actions) {
    if (!action.id || ids.has(action.id)) {
      throw new Error("Diplomacy actions require unique ids");
    }
    ids.add(action.id);
    if (new Set(action.requiredTechnologyIds).size !== action.requiredTechnologyIds.length) {
      throw new Error(`Diplomacy action ${action.id} repeats a technology requirement`);
    }
  }
}

validateCatalog();

export const DIPLOMACY_CONFIG = diplomacySource;
export const DIPLOMATIC_ACTIONS =
  diplomacySource.actions as readonly DiplomaticActionDefinition[];
const ACTION_BY_ID = new Map(DIPLOMATIC_ACTIONS.map((action) => [action.id, action]));

export function diplomaticActionDefinition(
  id: DiplomaticAction,
): DiplomaticActionDefinition {
  const definition = ACTION_BY_ID.get(id);
  if (!definition) throw new Error(`Unknown diplomatic action ${id}`);
  return definition;
}

export function orderedTribePair(
  firstTribeId: TribeId,
  secondTribeId: TribeId,
): readonly [TribeId, TribeId] {
  if (firstTribeId === secondTribeId) {
    throw new Error("A Tribe cannot have a diplomatic relation with itself");
  }
  return firstTribeId < secondTribeId
    ? [firstTribeId, secondTribeId]
    : [secondTribeId, firstTribeId];
}

export function diplomaticRelationKey(
  firstTribeId: TribeId,
  secondTribeId: TribeId,
): string {
  const [first, second] = orderedTribePair(firstTribeId, secondTribeId);
  return `${first}:${second}`;
}

export function stanceFromRelationship(
  current: DiplomaticStance,
  opinion: number,
  trust: number,
  tension: number,
): DiplomaticStance {
  if (current === "war") return "war";
  if (opinion <= -30 || tension >= 65) return "hostile";
  if (opinion >= 40 && trust >= 35 && tension < 45) return "friendly";
  return "neutral";
}

export function applyRelationshipDelta(
  relation: TribeRelation,
  delta: {
    readonly opinionDelta?: number;
    readonly trustDelta?: number;
    readonly tensionDelta?: number;
  },
  tick: number,
): TribeRelation {
  const opinion = clamp(
    relation.opinion + (delta.opinionDelta ?? 0),
    diplomacySource.minimumOpinion,
    diplomacySource.maximumOpinion,
  );
  const trust = clamp(
    relation.trust + (delta.trustDelta ?? 0),
    diplomacySource.minimumTrust,
    diplomacySource.maximumTrust,
  );
  const tension = clamp(
    relation.tension + (delta.tensionDelta ?? 0),
    diplomacySource.minimumTension,
    diplomacySource.maximumTension,
  );
  return {
    ...relation,
    opinion,
    trust,
    tension,
    stance: stanceFromRelationship(relation.stance, opinion, trust, tension),
    lastInteractionTick: tick,
  };
}

export function proposalAcceptanceScore(relation: TribeRelation): number {
  const stanceScore =
    relation.stance === "friendly"
      ? 25
      : relation.stance === "hostile"
        ? -25
        : relation.stance === "war"
          ? -45
          : 0;
  return relation.opinion + relation.trust - relation.tension + stanceScore;
}
