import administrationSource from "../config/tribal-administration.json";
import type { SettlementAdministrator, TechnologyId } from "../core/model";

export const SETTLEMENT_ADMINISTRATORS = [
  "tribal-leader",
  "elder",
  "sage",
  "steward",
] as const satisfies readonly SettlementAdministrator[];

export interface TribalAdministrationRole {
  readonly id: SettlementAdministrator;
  readonly villageOnly: boolean;
  readonly knowledgePerWorldDay: number;
  readonly populationGrowthPerInterval: number;
  readonly influenceGrowthMetersPerInterval: number;
}

const isAdministrator = (value: string): value is SettlementAdministrator =>
  SETTLEMENT_ADMINISTRATORS.includes(value as SettlementAdministrator);

function validateAdministration(): readonly TribalAdministrationRole[] {
  if (!isAdministrator(administrationSource.defaultRole)) {
    throw new Error("Tribal administration has an invalid default role");
  }
  const ids = new Set<string>();
  for (const role of administrationSource.roles) {
    if (!isAdministrator(role.id) || ids.has(role.id)) {
      throw new Error(`Invalid or duplicate Tribal administration role ${role.id}`);
    }
    ids.add(role.id);
    for (const value of [
      role.knowledgePerWorldDay,
      role.populationGrowthPerInterval,
      role.influenceGrowthMetersPerInterval,
    ]) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Tribal administration role ${role.id} has an invalid effect`);
      }
    }
  }
  if (
    ids.size !== SETTLEMENT_ADMINISTRATORS.length ||
    SETTLEMENT_ADMINISTRATORS.some((id) => !ids.has(id))
  ) {
    throw new Error("Tribal administration role catalog is incomplete");
  }
  return administrationSource.roles as readonly TribalAdministrationRole[];
}

export const TRIBAL_ADMINISTRATION_ROLES = validateAdministration();
export const DEFAULT_SETTLEMENT_ADMINISTRATOR =
  administrationSource.defaultRole as SettlementAdministrator;
export const VILLAGE_ADMINISTRATION_TECHNOLOGY_ID =
  administrationSource.unlockTechnologyId as TechnologyId;

const ADMINISTRATION_ROLE_BY_ID = new Map(
  TRIBAL_ADMINISTRATION_ROLES.map((role) => [role.id, role]),
);

export function administrationRoleDefinition(
  administrator: SettlementAdministrator,
): TribalAdministrationRole {
  const role = ADMINISTRATION_ROLE_BY_ID.get(administrator);
  if (!role) throw new Error(`Unknown settlement administrator ${administrator}`);
  return role;
}
