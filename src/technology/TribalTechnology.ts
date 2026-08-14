import technologySource from "../config/tribal-technologies.json";
import { GAMEPLAY_CONFIG } from "../config/GameConfig";
import { administrationRoleDefinition } from "../administration/TribalAdministration";
import { tribalBuildingEffects } from "../tribal/TribalRoster";
import type {
  Settlement,
  TechnologyId,
  Tribe,
  TribeId,
  TribeResearch,
} from "../core/model";

export const TECHNOLOGY_BRANCHES = [
  "sustenance",
  "craft",
  "settlement",
  "society",
  "exploration",
] as const;

export type TechnologyBranch = (typeof TECHNOLOGY_BRANCHES)[number];

export interface TribalTechnology {
  readonly id: TechnologyId;
  readonly branch: TechnologyBranch;
  readonly column: number;
  readonly row: number;
  readonly cost: number;
  readonly prerequisites: readonly TechnologyId[];
  /** At least one of these is required when the list is non-empty. */
  readonly alternativePrerequisites: readonly TechnologyId[];
  readonly unlocks: readonly string[];
}

export type TechnologyActionState =
  | "completed"
  | "researching"
  | "queued"
  | "available"
  | "blocked";

const isBranch = (value: string): value is TechnologyBranch =>
  TECHNOLOGY_BRANCHES.includes(value as TechnologyBranch);

function validateCatalog(): readonly TribalTechnology[] {
  if (
    technologySource.branches.length !== TECHNOLOGY_BRANCHES.length ||
    technologySource.branches.some((branch, index) => branch !== TECHNOLOGY_BRANCHES[index])
  ) {
    throw new Error("Tribal Technology branch order is invalid");
  }
  const ids = new Set<string>();
  const positions = new Set<string>();
  for (const technology of technologySource.technologies) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(technology.id) || ids.has(technology.id)) {
      throw new Error(`Invalid or duplicate Tribal Technology id ${technology.id}`);
    }
    ids.add(technology.id);
    if (!isBranch(technology.branch)) {
      throw new Error(`Unknown Tribal Technology branch ${technology.branch}`);
    }
    if (
      !Number.isInteger(technology.column) ||
      technology.column < 0 ||
      !Number.isInteger(technology.row) ||
      technology.row < 0 ||
      !Number.isInteger(technology.cost) ||
      technology.cost <= 0
    ) {
      throw new Error(`Invalid layout or cost for Tribal Technology ${technology.id}`);
    }
    const position = `${technology.column}:${technology.row}`;
    if (positions.has(position)) {
      throw new Error(`Two Tribal Technologies occupy ${position}`);
    }
    positions.add(position);
  }

  const byId = new Map(technologySource.technologies.map((technology) => [technology.id, technology]));
  for (const technology of technologySource.technologies) {
    const dependencies = [
      ...technology.prerequisites,
      ...technology.alternativePrerequisites,
    ];
    if (new Set(dependencies).size !== dependencies.length) {
      throw new Error(`Duplicate prerequisite on ${technology.id}`);
    }
    for (const dependencyId of dependencies) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        throw new Error(`${technology.id} references unknown prerequisite ${dependencyId}`);
      }
      if (
        dependency.column > technology.column ||
        (dependency.column === technology.column && dependency.row >= technology.row)
      ) {
        throw new Error(`${technology.id} must depend on an earlier graph position`);
      }
    }
  }
  for (const [cultureId, branch] of Object.entries(technologySource.cultureAffinities)) {
    if (!isBranch(branch)) {
      throw new Error(`Culture ${cultureId} has invalid Research affinity ${branch}`);
    }
  }
  const unlocks = new Set(
    technologySource.technologies.flatMap((technology) => technology.unlocks),
  );
  for (const unlock of technologySource.implementedUnlocks) {
    if (!unlocks.has(unlock)) throw new Error(`Implemented unlock ${unlock} is not in the catalog`);
  }
  return technologySource.technologies as readonly TribalTechnology[];
}

export const TRIBAL_TECHNOLOGIES = validateCatalog();
export const TRIBAL_TECHNOLOGY_BY_ID = new Map(
  TRIBAL_TECHNOLOGIES.map((technology) => [technology.id, technology]),
);

export function technologyDefinition(technologyId: TechnologyId): TribalTechnology {
  const technology = TRIBAL_TECHNOLOGY_BY_ID.get(technologyId);
  if (!technology) throw new Error(`Unknown Tribal Technology ${technologyId}`);
  return technology;
}

export function technologyGameplayIsImplemented(technology: TribalTechnology): boolean {
  return technology.unlocks.some((unlock) =>
    technologySource.implementedUnlocks.includes(unlock),
  );
}

export function cultureResearchAffinity(cultureId: string): TechnologyBranch | null {
  const affinity = (technologySource.cultureAffinities as Record<string, string>)[cultureId];
  return affinity && isBranch(affinity) ? affinity : null;
}

export function createInitialTribeResearch(tribeId: TribeId): TribeResearch {
  return {
    tribeId,
    queuedTechnologyIds: [],
    completedTechnologyIds: [],
    progress: [],
  };
}

export function cloneTribeResearch(research: TribeResearch): TribeResearch {
  return {
    tribeId: research.tribeId,
    queuedTechnologyIds: [...research.queuedTechnologyIds],
    completedTechnologyIds: [...research.completedTechnologyIds],
    progress: research.progress.map((entry) => ({ ...entry })),
  };
}

export function technologyIsAvailable(
  completedTechnologyIds: ReadonlySet<TechnologyId>,
  technology: TribalTechnology,
): boolean {
  return (
    technology.prerequisites.every((id) => completedTechnologyIds.has(id)) &&
    (technology.alternativePrerequisites.length === 0 ||
      technology.alternativePrerequisites.some((id) => completedTechnologyIds.has(id)))
  );
}

function remainingPlanCost(
  targetId: TechnologyId,
  completed: ReadonlySet<TechnologyId>,
  progress: ReadonlyMap<TechnologyId, number>,
  visiting = new Set<TechnologyId>(),
): number {
  if (completed.has(targetId)) return 0;
  if (visiting.has(targetId)) throw new Error(`Cyclic Tribal Technology route at ${targetId}`);
  visiting.add(targetId);
  const technology = technologyDefinition(targetId);
  let cost = Math.max(
    0,
    technology.cost * 1_440 - (progress.get(targetId) ?? 0),
  );
  for (const prerequisite of technology.prerequisites) {
    cost += remainingPlanCost(prerequisite, completed, progress, visiting);
  }
  if (
    technology.alternativePrerequisites.length > 0 &&
    !technology.alternativePrerequisites.some((id) => completed.has(id))
  ) {
    const alternativeCosts = technology.alternativePrerequisites
      .map((id) => ({ id, cost: remainingPlanCost(id, completed, progress, visiting) }))
      .sort((left, right) => left.cost - right.cost || left.id.localeCompare(right.id));
    cost += alternativeCosts[0]?.cost ?? 0;
  }
  visiting.delete(targetId);
  return cost;
}

/** Returns a deterministic prerequisite-first route to a selected destination. */
export function researchPlanForTarget(
  research: TribeResearch,
  targetId: TechnologyId,
): readonly TechnologyId[] {
  technologyDefinition(targetId);
  const completed = new Set(research.completedTechnologyIds);
  const progress = new Map(
    research.progress.map((entry) => [entry.technologyId, entry.investedKnowledgeMinutes]),
  );
  const plan: TechnologyId[] = [];
  const planned = new Set<TechnologyId>();

  const visit = (technologyId: TechnologyId): void => {
    if (completed.has(technologyId) || planned.has(technologyId)) return;
    const technology = technologyDefinition(technologyId);
    for (const prerequisite of [...technology.prerequisites].sort()) visit(prerequisite);
    if (
      technology.alternativePrerequisites.length > 0 &&
      !technology.alternativePrerequisites.some((id) => completed.has(id) || planned.has(id))
    ) {
      const choice = technology.alternativePrerequisites
        .map((id) => ({
          id,
          cost: remainingPlanCost(id, completed, progress),
        }))
        .sort((left, right) => left.cost - right.cost || left.id.localeCompare(right.id))[0];
      if (choice) visit(choice.id);
    }
    planned.add(technologyId);
    plan.push(technologyId);
  };
  visit(targetId);
  return plan;
}

export function technologyActionState(
  research: TribeResearch,
  technologyId: TechnologyId,
): TechnologyActionState {
  if (research.completedTechnologyIds.includes(technologyId)) return "completed";
  const queueIndex = research.queuedTechnologyIds.indexOf(technologyId);
  if (queueIndex === 0) return "researching";
  if (queueIndex > 0) return "queued";
  return technologyIsAvailable(
    new Set(research.completedTechnologyIds),
    technologyDefinition(technologyId),
  )
    ? "available"
    : "blocked";
}

export function investedKnowledgeMinutes(
  research: TribeResearch,
  technologyId: TechnologyId,
): number {
  return (
    research.progress.find((entry) => entry.technologyId === technologyId)
      ?.investedKnowledgeMinutes ?? 0
  );
}

export function technologyProgressFraction(
  research: TribeResearch,
  technologyId: TechnologyId,
): number {
  if (research.completedTechnologyIds.includes(technologyId)) return 1;
  const technology = technologyDefinition(technologyId);
  return Math.min(
    1,
    investedKnowledgeMinutes(research, technologyId) / (technology.cost * 1_440),
  );
}

export function tribeKnowledgePerWorldDay(
  tribe: Tribe,
  settlements: readonly Settlement[],
  activeTechnologyId: TechnologyId | null,
): number {
  const tribeSettlements = settlements.filter((settlement) => settlement.tribeId === tribe.id);
  const population = tribeSettlements.reduce((sum, settlement) => sum + settlement.population, 0);
  const villages = tribeSettlements.filter((settlement) => settlement.tier === "village").length;
  const administrationKnowledge = tribeSettlements.reduce(
    (sum, settlement) =>
      sum + administrationRoleDefinition(settlement.administrator).knowledgePerWorldDay,
    0,
  );
  const buildingKnowledge = tribeSettlements.reduce(
    (sum, settlement) =>
      sum + tribalBuildingEffects(settlement.buildings).knowledgePerWorldDay,
    0,
  );
  return knowledgePerWorldDay(
    tribe.cultureId,
    population,
    villages,
    activeTechnologyId,
    administrationKnowledge + buildingKnowledge,
  );
}

export function knowledgePerWorldDay(
  cultureId: string,
  population: number,
  villages: number,
  activeTechnologyId: TechnologyId | null,
  administrationKnowledgePerWorldDay = 0,
): number {
  let output =
    GAMEPLAY_CONFIG.research.baseKnowledgePerWorldDay +
    Math.floor(population / GAMEPLAY_CONFIG.research.populationPerAdditionalKnowledge) +
    villages * GAMEPLAY_CONFIG.research.villageKnowledgePerWorldDay +
    administrationKnowledgePerWorldDay;
  if (
    activeTechnologyId &&
    technologyDefinition(activeTechnologyId).branch === cultureResearchAffinity(cultureId)
  ) {
    output = Math.floor(
      (output * (100 + GAMEPLAY_CONFIG.research.cultureAffinityPercent)) / 100,
    );
  }
  return output;
}

/** NPC choice is stable across machines and intentionally simple until strategy AI exists. */
export function nextNpcTechnology(research: TribeResearch, cultureId: string): TechnologyId | null {
  const completed = new Set(research.completedTechnologyIds);
  const affinity = cultureResearchAffinity(cultureId);
  return (
    TRIBAL_TECHNOLOGIES.filter(
      (technology) =>
        !completed.has(technology.id) && technologyIsAvailable(completed, technology),
    ).sort(
      (left, right) =>
        Number(right.branch === affinity) - Number(left.branch === affinity) ||
        left.cost - right.cost ||
        left.id.localeCompare(right.id),
    )[0]?.id ?? null
  );
}
