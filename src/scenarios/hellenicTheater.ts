import type {
  DiplomaticStance,
  GeographicPosition,
  ScenarioDefinition,
  Settlement,
  Tribe,
  TribeRelation,
  Unit,
  WorldGridDefinition,
} from "../core/model";
import proj4 from "proj4";
import { geographicDistanceMeters } from "../core/Geography";
import { createGridBitset } from "../core/GridBitset";
import type { CultureProfile } from "../culture/CultureProfile";
import { movementModifiers } from "../culture/CultureProfile";
import { GAMEPLAY_CONFIG, PRESENTATION_CONFIG, parseHexColor } from "../config/GameConfig";
import { createInitialTribeResearch } from "../technology/TribalTechnology";
import { cultureMilitaryUnits } from "../combat/MilitaryRoster";

const opening = GAMEPLAY_CONFIG.openingScenario;
const RIVAL_TRIBES = opening.rivalTribes.map((tribe) => ({
  name: tribe.name,
  color: parseHexColor(tribe.color),
}));

function gridCellPosition(
  index: number,
  worldGrid: WorldGridDefinition,
  projection: proj4.Converter,
): GeographicPosition {
  const column = index % worldGrid.width;
  const row = Math.floor(index / worldGrid.width);
  const cellWidth = worldGrid.extentWidthMeters / worldGrid.width;
  const cellHeight = worldGrid.extentHeightMeters / worldGrid.height;
  const easting = -worldGrid.extentWidthMeters / 2 + (column + 0.5) * cellWidth;
  const northing = worldGrid.extentHeightMeters / 2 - (row + 0.5) * cellHeight;
  const [longitude, latitude] = projection.inverse([easting, northing]);
  return {
    longitudeE6: Math.round(longitude * 1_000_000),
    latitudeE6: Math.round(latitude * 1_000_000),
  };
}

function foundingSeed(position: GeographicPosition, openingRoll: number): number {
  let seed =
    opening.baseSeed ^
    position.longitudeE6 ^
    Math.imul(openingRoll + 1, 0x9e37_79b1);
  seed = Math.imul(seed ^ (seed >>> 16), 0x21f0_aaad);
  seed ^= position.latitudeE6;
  seed = Math.imul(seed ^ (seed >>> 15), 0x735a_2d97);
  return (seed ^ (seed >>> 15)) >>> 0;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomInteger(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function randomStance(random: () => number): DiplomaticStance {
  const roll = random();
  return roll < opening.friendlyChance
    ? "friendly"
    : roll < opening.friendlyChance + opening.hostileChance
      ? "hostile"
      : "neutral";
}

/** Creates the authoritative opening state after the player confirms a Camp location. */
export function createHellenicTheaterScenario(
  playerPosition: GeographicPosition,
  worldGrid: WorldGridDefinition,
  openingRoll: number,
  culture: CultureProfile,
): ScenarioDefinition {
  const seed = foundingSeed(playerPosition, openingRoll);
  const cultureMovement = movementModifiers(culture);
  const random = createRandom(seed);
  const projection = proj4("EPSG:4326", worldGrid.projectionDefinition);
  const rivalPositions: GeographicPosition[] = [];
  const cellCount = worldGrid.width * worldGrid.height;
  for (let attempt = 0; attempt < cellCount * 2 && rivalPositions.length < opening.rivalCampCount; attempt += 1) {
    const index = Math.floor(random() * cellCount);
    if ((worldGrid.terrainCells[index] ?? 0) === 0) {
      continue;
    }
    const position = gridCellPosition(index, worldGrid, projection);
    if (geographicDistanceMeters(playerPosition, position) < opening.minimumRivalDistanceMeters) {
      continue;
    }
    if (
      rivalPositions.some(
        (existing) =>
          geographicDistanceMeters(existing, position) <
          opening.minimumRivalSeparationMeters,
      )
    ) {
      continue;
    }
    rivalPositions.push(position);
  }
  if (rivalPositions.length !== opening.rivalCampCount) {
    throw new Error("Regional Theater does not contain enough separated rival Camp sites");
  }

  const tribes: Tribe[] = [
    {
      id: opening.playerTribeId,
      name: culture.name,
      cultureId: culture.id,
      terrainMovementModifiers: cultureMovement.terrain,
      vegetationMovementModifiers: cultureMovement.vegetation,
      color: parseHexColor(PRESENTATION_CONFIG.theaterPicker.selectionColor),
      controllerPlayerId: opening.playerId,
      warriors: opening.playerWarriors,
    },
  ];
  const settlements: Settlement[] = [
    {
      id: opening.playerSettlementId,
      tribeId: opening.playerTribeId,
      name: `${culture.name} Camp`,
      position: { ...playerPosition },
      tier: "camp",
      population: opening.playerPopulation,
      influenceRadiusMeters: opening.playerInfluenceMeters,
      administrator: "tribal-leader",
      buildings: [],
    },
  ];
  const relations: TribeRelation[] = [];
  const units: Unit[] = [];
  const cultureUnits = cultureMilitaryUnits(culture.id);

  for (const [index, position] of rivalPositions.entries()) {
    const template = RIVAL_TRIBES[(index + openingRoll) % RIVAL_TRIBES.length]!;
    const id = index + opening.firstRivalTribeId;
    const warriors = randomInteger(
      random,
      opening.rivalWarriorsMinimum,
      opening.rivalWarriorsMaximum,
    );
    tribes.push({
      id,
      name: template.name,
      cultureId: culture.id,
      terrainMovementModifiers: cultureMovement.terrain,
      vegetationMovementModifiers: cultureMovement.vegetation,
      color: template.color,
      controllerPlayerId: null,
      warriors,
    });
    settlements.push({
      id,
      tribeId: id,
      name: `${template.name} Camp`,
      position,
      tier: "camp",
      population: randomInteger(
        random,
        opening.rivalPopulationMinimum,
        opening.rivalPopulationMaximum,
      ),
      influenceRadiusMeters:
        randomInteger(
          random,
          opening.rivalInfluenceHalfKilometersMinimum,
          opening.rivalInfluenceHalfKilometersMaximum,
        ) * 500,
      administrator: "tribal-leader",
      buildings: [],
    });
    const fieldGroup = cultureUnits[index % cultureUnits.length]!;
    units.push({
      id: index + 1,
      tribeId: id,
      homeSettlementId: id,
      kind: fieldGroup.id,
      position: { ...position },
      route: [],
      terrain: "plains",
      vegetation: "none",
      vegetationDensity: "none",
      speedMetersPerHour: 0,
      slopeDegrees: 0,
      remainingTravelMinutes: null,
      combat: {
        strength: warriors,
        maximumStrength: warriors,
        moralePermille: 850,
        cohesionPermille: 800,
        fatiguePermille: 0,
        missileReadinessPermille: 1_000,
        experience: 40 + index * 5,
        status: "ready",
        order: null,
      },
    });
    const stance = randomStance(random);
    relations.push({
      firstTribeId: opening.playerTribeId,
      secondTribeId: id,
      stance,
      opinion: stance === "friendly" ? 45 : stance === "hostile" ? -40 : 0,
      trust: stance === "friendly" ? 35 : stance === "hostile" ? 5 : 15,
      tension: stance === "friendly" ? 8 : stance === "hostile" ? 65 : 20,
      agreements: [],
      lastInteractionTick: -1_000_000,
    });
  }

  return {
    seed,
    startWorldTime: { ...opening.startWorldTime },
    worldGrid,
    tribes,
    settlements,
    units,
    relations,
    diplomaticProposals: [],
    events: [],
    research: tribes.map((tribe) => createInitialTribeResearch(tribe.id)),
    playerKnowledge: [
      {
        playerId: opening.playerId,
        exploredCells: createGridBitset(worldGrid.width * worldGrid.height),
        settlementIntelligence: [],
        unitIntelligence: [],
      },
    ],
  };
}
