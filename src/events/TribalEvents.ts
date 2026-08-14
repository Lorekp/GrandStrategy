import eventSource from "../config/tribal-events.json";
import type {
  EventCategory,
  GameEvent,
  Settlement,
  Tribe,
  TribeId,
  TribeResearch,
  Unit,
} from "../core/model";

export interface TribalEventEffects {
  readonly populationDelta?: number;
  readonly warriorsDelta?: number;
  readonly influenceDelta?: number;
  readonly researchKnowledge?: number;
  readonly opinionDelta?: number;
  readonly trustDelta?: number;
  readonly tensionDelta?: number;
}

export interface TribalEventChoice {
  readonly id: string;
  readonly effects: TribalEventEffects;
}

export interface TribalEventConditions {
  readonly requiresKnownTribe?: boolean;
  readonly requiresScout?: boolean;
  readonly requiresVillage?: boolean;
  readonly requiresWarriors?: boolean;
  readonly requiresActiveResearch?: boolean;
  readonly minimumPopulation?: number;
}

export interface TribalEventDefinition {
  readonly id: string;
  readonly category: EventCategory;
  readonly trigger: "periodic" | "reactive";
  readonly weight: number;
  readonly conditions: TribalEventConditions;
  readonly choices: readonly TribalEventChoice[];
}

export interface TribalEventContext {
  readonly tribe: Tribe;
  readonly settlements: readonly Settlement[];
  readonly units: readonly Unit[];
  readonly research: TribeResearch | undefined;
  readonly knownTribeIds: readonly TribeId[];
}

function validateCatalog(): void {
  const ids = new Set<string>();
  for (const definition of eventSource.definitions) {
    if (!definition.id || ids.has(definition.id)) {
      throw new Error("Tribal Events require unique ids");
    }
    ids.add(definition.id);
    if (definition.trigger === "periodic" && definition.weight < 1) {
      throw new Error(`Periodic event ${definition.id} requires positive weight`);
    }
    const choiceIds = new Set<string>();
    for (const choice of definition.choices) {
      if (!choice.id || choiceIds.has(choice.id)) {
        throw new Error(`Event ${definition.id} has invalid choice ids`);
      }
      choiceIds.add(choice.id);
      for (const value of Object.values(choice.effects)) {
        if (!Number.isInteger(value)) {
          throw new Error(`Event ${definition.id} effects must be integers`);
        }
      }
    }
  }
}

validateCatalog();

export const TRIBAL_EVENT_CONFIG = eventSource;
export const TRIBAL_EVENTS =
  eventSource.definitions as readonly TribalEventDefinition[];
const EVENT_BY_ID = new Map(TRIBAL_EVENTS.map((definition) => [definition.id, definition]));

export function tribalEventDefinition(id: string): TribalEventDefinition {
  const definition = EVENT_BY_ID.get(id);
  if (!definition) throw new Error(`Unknown Tribal Event ${id}`);
  return definition;
}

export function eventIsEligible(
  definition: TribalEventDefinition,
  context: TribalEventContext,
): boolean {
  const conditions = definition.conditions;
  const population = context.settlements.reduce(
    (sum, settlement) => sum + settlement.population,
    0,
  );
  return (
    definition.trigger === "periodic" &&
    (!conditions.requiresKnownTribe || context.knownTribeIds.length > 0) &&
    (!conditions.requiresScout || context.units.some((unit) => unit.kind === "scout")) &&
    (!conditions.requiresVillage || context.settlements.some((settlement) => settlement.tier === "village")) &&
    (!conditions.requiresWarriors || context.tribe.warriors > 0) &&
    (!conditions.requiresActiveResearch || Boolean(context.research?.queuedTechnologyIds[0])) &&
    population >= (conditions.minimumPopulation ?? 0)
  );
}

function mix(value: number, next: number): number {
  return Math.imul((value ^ next) >>> 0, 0x45d9f3b) >>> 0;
}

function textHash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619) >>> 0;
  }
  return result;
}

export function deterministicEventRoll(
  seed: number,
  tick: number,
  tribeId: TribeId,
  salt: string,
): number {
  return mix(mix(mix(seed >>> 0, tick), tribeId), textHash(salt));
}

export function chooseWeightedEvent(
  definitions: readonly TribalEventDefinition[],
  roll: number,
): TribalEventDefinition | undefined {
  const total = definitions.reduce((sum, definition) => sum + definition.weight, 0);
  if (total <= 0) return undefined;
  let choice = roll % total;
  for (const definition of definitions) {
    if (choice < definition.weight) return definition;
    choice -= definition.weight;
  }
  return definitions.at(-1);
}

export function eventAlreadyRepresentsContact(
  events: readonly GameEvent[],
  tribeId: TribeId,
  targetTribeId: TribeId,
): boolean {
  return events.some(
    (event) =>
      event.definitionId === "first-contact" &&
      event.tribeId === tribeId &&
      event.targetTribeId === targetTribeId,
  );
}
