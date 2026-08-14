import {
  Assets,
  Circle,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  type Texture,
} from "pixi.js";
import type {
  GeographicPosition,
  PlayerSettlement,
  PlayerUnit,
  PlayerWorldSnapshot,
  Settlement,
  Tribe,
  WorldGridDefinition,
} from "../core/model";
import type { CultureInfluenceField } from "../culture/CultureInfluence";
import { isDaytime } from "../core/WorldClock";
import type { CameraState } from "./CameraController";
import { FogOfWarLayer } from "./FogOfWarLayer";
import { organicInfluenceRadiusMeters } from "./Influence";
import {
  RegionalTheaterProjection,
  type RegionalTheaterManifest,
  type TheaterPoint,
} from "./RegionalTheater";
import { TilePyramidLayer } from "./TilePyramidLayer";
import { TheaterCultureFieldLayer } from "./TheaterCultureFieldLayer";
import {
  TheaterMapViewLayer,
  type TheaterMapViewMode,
} from "./TheaterMapViewLayer";
import { PRESENTATION_CONFIG } from "../config/GameConfig";
import { tribalUnitDefinition } from "../combat/MilitaryRoster";

const labelStyle = new TextStyle({
  fontFamily: '"Cascadia Mono", Consolas, monospace',
  fontSize: 15,
  fontWeight: "700",
  fill: 0x273128,
  letterSpacing: 0.9,
  dropShadow: {
    color: 0xe9e5c9,
    alpha: 1,
    blur: 0,
    angle: Math.PI / 4,
    distance: 2,
  },
});

const {
  minimumCampScreenScale: MINIMUM_CAMP_SCREEN_SCALE,
  maximumCampScreenScale: MAXIMUM_CAMP_SCREEN_SCALE,
  campLabelMinimumRelativeZoom: CAMP_LABEL_MINIMUM_RELATIVE_ZOOM,
  rememberedIntelligenceAlpha: REMEMBERED_INTELLIGENCE_ALPHA,
} = PRESENTATION_CONFIG.markers;

interface SettlementMarker {
  readonly root: Container;
  readonly iconRoot: Container;
  readonly icon: Graphics;
  readonly selection: Graphics;
  readonly label: Text;
  readonly hitArea: Circle;
  tribeId: number;
}

interface UnitMarker {
  readonly root: Container;
  readonly iconRoot: Container;
  readonly icon: Graphics;
  readonly selection: Graphics;
  readonly label: Text;
  readonly hitArea: Circle;
}

function positionsEqual(
  first: GeographicPosition,
  second: GeographicPosition,
): boolean {
  return (
    first.longitudeE6 === second.longitudeE6 &&
    first.latitudeE6 === second.latitudeE6
  );
}

function routeIsSuffix(
  route: readonly GeographicPosition[],
  preview: readonly GeographicPosition[],
): boolean {
  if (route.length > preview.length) return false;
  const offset = preview.length - route.length;
  return route.every((waypoint, index) =>
    positionsEqual(waypoint, preview[offset + index]!),
  );
}

function routesEqual(
  first: readonly GeographicPosition[],
  second: readonly GeographicPosition[],
): boolean {
  return (
    first.length === second.length &&
    first.every((waypoint, index) => positionsEqual(waypoint, second[index]!))
  );
}

export function campIconScreenScale(cameraScale: number): number {
  return Math.min(
    MAXIMUM_CAMP_SCREEN_SCALE,
    Math.max(MINIMUM_CAMP_SCREEN_SCALE, cameraScale),
  );
}

function appendOrganicInfluence(
  graphics: Graphics,
  settlement: Settlement,
  tribe: Tribe,
  point: TheaterPoint,
  metersPerPixel: number,
): void {
  const segmentCount = 64;
  for (let segment = 0; segment <= segmentCount; segment += 1) {
    const angle = (segment / segmentCount) * Math.PI * 2;
    const radius = organicInfluenceRadiusMeters(settlement, angle) / metersPerPixel;
    const x = point.x + Math.cos(angle) * radius;
    const y = point.y + Math.sin(angle) * radius;
    if (segment === 0) {
      graphics.moveTo(x, y);
    } else {
      graphics.lineTo(x, y);
    }
  }
  graphics.closePath();
  graphics.fill({ color: tribe.color, alpha: 0.22 });
  graphics.stroke({ color: tribe.color, alpha: 0.88, width: 1, pixelLine: true });
}

function createCampIcon(color: number, playerControlled: boolean): Graphics {
  const icon = new Graphics();
  if (playerControlled) {
    icon.circle(0, 0, 9).fill({ color: 0xeee7c7, alpha: 0.92 });
    icon.circle(0, 0, 9).stroke({ color: 0x293229, width: 1, pixelLine: true });
  }
  icon
    .poly([-7, 5, 0, -6, 7, 5])
    .fill(0x293229)
    .poly([-4, 4, 0, -3, 4, 4])
    .fill(color)
    .rect(-1, 1, 2, 4)
    .fill(0x293229);
  if (!playerControlled) {
    icon.rect(-7, 6, 14, 1).fill({ color: 0x293229, alpha: 0.8 });
  }
  return icon;
}

function createSettlementMarker(
  settlement: PlayerSettlement,
  tribe: Tribe,
  onSelectSettlement: (settlementId: number, tribeId: number) => void,
): SettlementMarker {
  const root = new Container();
  const iconRoot = new Container();
  const hitArea = new Circle(0, 2, 14 * MINIMUM_CAMP_SCREEN_SCALE);
  root.eventMode = "static";
  root.cursor = "pointer";
  root.hitArea = hitArea;
  root.on("pointertap", (event) => {
    if (event.button === 0) {
      onSelectSettlement(settlement.id, tribe.id);
    }
  });
  const selection = new Graphics()
    .circle(0, 0, 11)
    .stroke({ color: 0xf4edc8, width: 2, pixelLine: true });
  selection.visible = false;
  const icon = createCampIcon(tribe.color, tribe.controllerPlayerId !== null);
  iconRoot.addChild(selection, icon);
  const label = new Text({ text: tribe.name.toUpperCase(), style: labelStyle });
  label.anchor.set(0.5, 0);
  label.position.set(0, 15);
  root.addChild(iconRoot, label);
  return {
    root,
    iconRoot,
    icon,
    selection,
    label,
    hitArea,
    tribeId: settlement.tribeId,
  };
}

function createUnitMarker(
  unit: PlayerUnit,
  color: number,
  onSelectUnit: (unitId: number) => void,
): UnitMarker {
  const root = new Container();
  const iconRoot = new Container();
  const hitArea = new Circle(0, 0, 12 * MINIMUM_CAMP_SCREEN_SCALE);
  root.eventMode = "static";
  root.cursor = "pointer";
  root.hitArea = hitArea;
  root.on("pointertap", (event) => {
    if (event.button === 0) {
      onSelectUnit(unit.id);
    }
  });
  const selection = new Graphics()
    .rect(-8, -8, 16, 16)
    .stroke({ color: 0xf4edc8, width: 2, pixelLine: true });
  selection.visible = false;
  const icon = new Graphics()
    .rect(-2, -7, 4, 4)
    .fill(0x293229)
    .rect(-1, -6, 2, 2)
    .fill(color)
    .rect(-3, -2, 6, 7)
    .fill(0x293229)
    .rect(-1, -1, 2, 4)
    .fill(color)
    .rect(-5, 5, 4, 2)
    .fill(0x293229)
    .rect(1, 5, 4, 2)
    .fill(0x293229);
  iconRoot.addChild(selection, icon);
  const label = new Text({
    text: tribalUnitDefinition(unit.kind).abbreviation,
    style: labelStyle,
  });
  label.anchor.set(0.5, 0);
  label.position.set(0, 11);
  root.addChild(iconRoot, label);
  return { root, iconRoot, icon, selection, label, hitArea };
}

export class RegionalTheaterRenderer {
  public readonly root = new Container();
  private readonly terrain: TilePyramidLayer;
  private readonly mapView: TheaterMapViewLayer;
  private readonly projection: RegionalTheaterProjection;
  private readonly fogOfWar: FogOfWarLayer;
  private readonly influence = new Graphics();
  private readonly nightShade = new Graphics();
  private readonly unitOrders = new Graphics();
  private readonly markers = new Container();
  private readonly unitMarkers = new Container();
  private readonly spawnCandidate = new Graphics();
  private campCultureField: TheaterCultureFieldLayer | undefined;
  private campCultureLandTexture: Texture | undefined;
  private campCultureDefinition:
    | {
        readonly field: CultureInfluenceField;
        readonly selectedCultureId: string;
      }
    | undefined;
  private readonly markerBySettlement = new Map<number, SettlementMarker>();
  private readonly markerByUnit = new Map<number, UnitMarker>();
  private readonly pendingUnitRoutes = new Map<
    number,
    readonly GeographicPosition[]
  >();
  private latestSnapshot: PlayerWorldSnapshot | undefined;
  private cameraScale = 1;
  private cameraRelativeZoom = 1;
  private visualRevision = "";
  private selectedTribeId = 1;
  private selectedUnitIds = new Set<number>();

  public constructor(
    public readonly theater: RegionalTheaterManifest,
    private readonly requestRender: () => void,
    private readonly onSelectSettlement: (
      settlementId: number,
      tribeId: number,
    ) => void,
    private readonly onSelectUnit: (unitId: number) => void,
    getLevelBias: () => number,
  ) {
    this.root.boundsArea = new Rectangle(
      0,
      0,
      theater.render.width,
      theater.render.height,
    );
    this.projection = new RegionalTheaterProjection(theater);
    this.fogOfWar = new FogOfWarLayer(theater);
    this.mapView = new TheaterMapViewLayer(theater);
    this.terrain = new TilePyramidLayer(
      `/maps/theaters/${theater.id}/tiles`,
      theater.render.width,
      theater.render.height,
      theater.render.tileSize,
      theater.render.levels,
      requestRender,
      getLevelBias,
      theater.formatVersion,
    );
    this.root.addChild(
      this.terrain.root,
      this.mapView.root,
      this.influence,
      this.nightShade,
      this.unitMarkers,
      this.markers,
      this.spawnCandidate,
      this.fogOfWar.root,
      this.unitOrders,
    );
    this.spawnCandidate.eventMode = "none";
    this.nightShade
      .rect(0, 0, theater.render.width, theater.render.height)
      .fill({ color: 0x111827, alpha: 0.32 });
    this.nightShade.eventMode = "none";
    this.nightShade.visible = false;
    this.spawnCandidate.visible = false;
  }

  public async initialize(): Promise<void> {
    const initialViewport: CameraState = {
      left: 0,
      top: 0,
      right: this.theater.render.width,
      bottom: this.theater.render.height,
      scale: 1,
      relativeZoom: 1,
    };
    const [, maskTexture] = await Promise.all([
      this.terrain.setViewport(initialViewport),
      Assets.load<Texture>(
        `/maps/theaters/${this.theater.id}/${this.theater.semantic.landMaskPath}`,
      ),
    ]);
    maskTexture.source.scaleMode = "linear";
    const landMask = new Sprite(maskTexture);
    landMask.scale.set(
      this.theater.render.width / this.theater.semantic.width,
      this.theater.render.height / this.theater.semantic.height,
    );
    this.influence.setMask({ mask: landMask, channel: "red" });
    this.root.addChild(landMask);
    this.campCultureLandTexture = maskTexture;
    this.rebuildCampCultureField();
    // Orders are tactical UI and must remain readable through unexplored fog.
    this.root.addChild(this.unitOrders);
  }

  public update(snapshot: PlayerWorldSnapshot): boolean {
    this.latestSnapshot = snapshot;
    this.nightShade.visible = !isDaytime(snapshot.worldTime);
    for (const [unitId, route] of this.pendingUnitRoutes) {
      const unit = snapshot.units.find((candidate) => candidate.id === unitId);
      const reachedFinalWaypoint =
        unit &&
        unit.route.length === 0 &&
        route.length > 0 &&
        positionsEqual(unit.position, route[route.length - 1]!);
      if (
        !unit ||
        routesEqual(unit.route, route) ||
        (unit.route.length > 0 && routeIsSuffix(unit.route, route)) ||
        reachedFinalWaypoint
      ) {
        this.pendingUnitRoutes.delete(unitId);
      }
    }
    const fogChanged = this.fogOfWar.update(snapshot);
    const tribes = new Map(snapshot.tribes.map((tribe) => [tribe.id, tribe]));
    const revision = [
      ...snapshot.tribes.map(
        (tribe) => `${tribe.id}:${tribe.warriors}:${tribe.controllerPlayerId ?? 0}`,
      ),
      ...snapshot.settlements.map(
        (settlement) =>
          `${settlement.id}:${settlement.tier}:${settlement.population}:${settlement.influenceRadiusMeters}:${settlement.buildings.join(",")}:${settlement.intelligence}:${settlement.lastObservedTick}`,
      ),
      ...snapshot.units.map(
        (unit) =>
          `${unit.id}:${unit.position.longitudeE6}:${unit.position.latitudeE6}:${unit.route.map((waypoint) => `${waypoint.longitudeE6},${waypoint.latitudeE6}`).join(";")}:${unit.terrain}:${unit.vegetation}:${unit.vegetationDensity}:${unit.speedMetersPerHour}:${unit.slopeDegrees}:${unit.intelligence}:${unit.lastObservedTick}`,
      ),
      `period:${isDaytime(snapshot.worldTime) ? "day" : "night"}`,
      `selected:${this.selectedTribeId}`,
      `units:${[...this.selectedUnitIds].sort((a, b) => a - b).join(",")}`,
      `pending:${[...this.pendingUnitRoutes]
        .sort(([left], [right]) => left - right)
        .map(
          ([unitId, route]) =>
            `${unitId}:${route.map((waypoint) => `${waypoint.longitudeE6},${waypoint.latitudeE6}`).join(";")}`,
        )
        .join(",")}`,
    ].join("|");
    if (revision === this.visualRevision) {
      return fogChanged;
    }
    this.visualRevision = revision;
    this.influence.clear();
    this.unitOrders.clear();
    const present = new Set<number>();
    for (const settlement of snapshot.settlements) {
      const tribe = tribes.get(settlement.tribeId);
      if (!tribe) {
        continue;
      }
      const point = this.projection.toTheater(settlement.position);
      appendOrganicInfluence(
        this.influence,
        settlement,
        tribe,
        point,
        this.theater.render.metersPerPixel,
      );
      this.updateSettlementMarker(settlement, tribe, point);
      present.add(settlement.id);
    }
    for (const [id, marker] of this.markerBySettlement) {
      if (!present.has(id)) {
        marker.root.destroy({ children: true });
        this.markerBySettlement.delete(id);
      }
    }
    const presentUnits = new Set<number>();
    for (const unit of snapshot.units) {
      const tribe = tribes.get(unit.tribeId);
      if (!tribe) {
        continue;
      }
      const point = this.projection.toTheater(unit.position);
      const route = this.pendingUnitRoutes.get(unit.id) ?? unit.route;
      if (route.length > 0 && this.selectedUnitIds.has(unit.id)) {
        this.unitOrders.moveTo(point.x, point.y);
        for (const waypoint of route) {
          const destination = this.projection.toTheater(waypoint);
          this.unitOrders.lineTo(destination.x, destination.y);
        }
        this.unitOrders.stroke({
          color: 0xf4edc8,
          alpha: 0.9,
          width: 1,
          pixelLine: true,
        });
      }
      this.updateUnitMarker(unit, tribe, point);
      presentUnits.add(unit.id);
    }
    for (const [id, marker] of this.markerByUnit) {
      if (!presentUnits.has(id)) {
        marker.root.destroy({ children: true });
        this.markerByUnit.delete(id);
      }
    }
    return true;
  }

  public setSelectedTribe(tribeId: number): void {
    if (this.selectedTribeId === tribeId) {
      return;
    }
    this.selectedTribeId = tribeId;
    this.visualRevision = "";
  }

  public setSelectedUnits(unitIds: ReadonlySet<number>): void {
    const next = new Set(unitIds);
    const currentRevision = [...this.selectedUnitIds].sort().join(",");
    const nextRevision = [...next].sort().join(",");
    if (currentRevision === nextRevision) {
      return;
    }
    this.selectedUnitIds = next;
    this.visualRevision = "";
  }

  public previewUnitOrders(
    unitIds: ReadonlySet<number>,
    destination: GeographicPosition,
    append: boolean,
  ): ReadonlyMap<number, readonly GeographicPosition[]> {
    const routes = new Map<number, readonly GeographicPosition[]>();
    for (const unitId of unitIds) {
      const unit = this.latestSnapshot?.units.find(
        (candidate) => candidate.id === unitId,
      );
      if (!unit) continue;
      const current = this.pendingUnitRoutes.get(unitId) ?? unit.route;
      const route = append
        ? [...current, { ...destination }]
        : [{ ...destination }];
      this.pendingUnitRoutes.set(unitId, route);
      routes.set(unitId, route);
    }
    this.visualRevision = "";
    if (this.latestSnapshot) {
      this.update(this.latestSnapshot);
    }
    this.requestRender();
    return routes;
  }

  public setSpawnCandidate(point: TheaterPoint | undefined): void {
    this.spawnCandidate.clear();
    if (!point) {
      this.spawnCandidate.visible = false;
      return;
    }
    this.spawnCandidate
      .circle(0, 0, 13)
      .fill({ color: 0xeee7c7, alpha: 0.94 })
      .circle(0, 0, 13)
      .stroke({ color: 0x293229, width: 2, pixelLine: true })
      .poly([-7, 5, 0, -6, 7, 5])
      .fill(0x293229)
      .poly([-4, 4, 0, -3, 4, 4])
      .fill(0xd8c76f)
      .rect(-1, 1, 2, 4)
      .fill(0x293229);
    this.spawnCandidate.position.set(point.x, point.y);
    this.spawnCandidate.scale.set(1 / Math.max(this.cameraScale, 0.0001));
    this.spawnCandidate.visible = true;
  }

  public setCampCultureField(
    field: CultureInfluenceField,
    selectedCultureId: string,
  ): void {
    this.campCultureDefinition = { field, selectedCultureId };
    this.rebuildCampCultureField();
  }

  private rebuildCampCultureField(): void {
    const definition = this.campCultureDefinition;
    const landTexture = this.campCultureLandTexture;
    if (!definition || !landTexture) return;
    if (this.campCultureField) {
      this.root.removeChild(this.campCultureField.root);
      this.campCultureField.destroy();
    }
    this.campCultureField = new TheaterCultureFieldLayer(
      this.theater,
      definition.field,
      definition.selectedCultureId,
      landTexture,
    );
    this.campCultureField.setViewport({
      scale: this.cameraScale,
      relativeZoom: this.cameraRelativeZoom,
    });
    this.root.addChildAt(
      this.campCultureField.root,
      this.root.getChildIndex(this.terrain.root) + 1,
    );
    this.requestRender();
  }

  public setCampCultureFieldVisible(visible: boolean): void {
    if (this.campCultureField) {
      this.campCultureField.root.visible = visible;
    }
  }

  public setCampCultureHover(cultureId: string | undefined): void {
    const definition = this.campCultureDefinition;
    if (
      definition &&
      this.campCultureField?.setHoveredCulture(definition.field, cultureId)
    ) {
      this.requestRender();
    }
  }

  public setFogVisible(visible: boolean): void {
    this.fogOfWar.root.visible = visible;
    this.requestRender();
  }

  public prepareMapViews(definition: WorldGridDefinition): void {
    this.mapView.prepare(definition);
    this.mapView.setViewport({
      scale: this.cameraScale,
      relativeZoom: this.cameraRelativeZoom,
    });
  }

  public setMapView(mode: TheaterMapViewMode): boolean {
    const changed = this.mapView.setMode(mode);
    if (changed) {
      this.requestRender();
    }
    return changed;
  }

  public setViewport(viewport: CameraState): void {
    this.cameraScale = viewport.scale;
    this.cameraRelativeZoom = viewport.relativeZoom;
    const inverseScale = 1 / Math.max(viewport.scale, 0.0001);
    const iconScale = campIconScreenScale(viewport.scale);
    for (const marker of this.markerBySettlement.values()) {
      marker.root.scale.set(inverseScale);
      marker.iconRoot.scale.set(iconScale);
      marker.hitArea.radius = 14 * iconScale;
      marker.label.visible =
        viewport.relativeZoom >= CAMP_LABEL_MINIMUM_RELATIVE_ZOOM;
    }
    for (const marker of this.markerByUnit.values()) {
      marker.root.scale.set(inverseScale);
      marker.iconRoot.scale.set(iconScale);
      marker.hitArea.radius = 12 * iconScale;
      marker.label.visible = viewport.relativeZoom >= 2;
    }
    this.spawnCandidate.scale.set(inverseScale);
    this.campCultureField?.setViewport(viewport);
    this.mapView.setViewport(viewport);
    this.fogOfWar.setViewport(viewport);
    void this.terrain.setViewport(viewport);
  }

  public destroy(): void {
    if (this.campCultureField) {
      this.root.removeChild(this.campCultureField.root);
      this.campCultureField.destroy();
      this.campCultureField = undefined;
    }
    this.root.removeChild(this.terrain.root);
    this.terrain.destroy();
    this.root.removeChild(this.mapView.root);
    this.mapView.destroy();
    this.root.destroy({ children: true });
  }

  private updateSettlementMarker(
    settlement: PlayerSettlement,
    tribe: Tribe,
    point: TheaterPoint,
  ): void {
    let marker = this.markerBySettlement.get(settlement.id);
    if (!marker) {
      marker = createSettlementMarker(
        settlement,
        tribe,
        this.onSelectSettlement,
      );
      this.markerBySettlement.set(settlement.id, marker);
      this.markers.addChild(marker.root);
    }
    marker.tribeId = tribe.id;
    marker.root.position.set(point.x, point.y);
    marker.root.alpha =
      settlement.intelligence === "remembered"
        ? REMEMBERED_INTELLIGENCE_ALPHA
        : 1;
    const cameraScale = Math.max(this.cameraScale, 0.0001);
    const iconScale = campIconScreenScale(cameraScale);
    marker.root.scale.set(1 / cameraScale);
    marker.iconRoot.scale.set(iconScale);
    marker.hitArea.radius = 14 * iconScale;
    marker.label.visible =
      this.cameraRelativeZoom >= CAMP_LABEL_MINIMUM_RELATIVE_ZOOM;
    marker.icon.alpha = this.selectedTribeId === tribe.id ? 1 : 0.88;
    marker.selection.visible = this.selectedTribeId === tribe.id;
    marker.label.text = `${tribe.name.toUpperCase()} · ${tribe.warriors}`;
  }

  private updateUnitMarker(
    unit: PlayerUnit,
    tribe: Tribe,
    point: TheaterPoint,
  ): void {
    let marker = this.markerByUnit.get(unit.id);
    if (!marker) {
      marker = createUnitMarker(unit, tribe.color, this.onSelectUnit);
      this.markerByUnit.set(unit.id, marker);
      this.unitMarkers.addChild(marker.root);
    }
    marker.root.position.set(point.x, point.y);
    marker.root.alpha =
      unit.intelligence === "remembered" ? REMEMBERED_INTELLIGENCE_ALPHA : 1;
    const cameraScale = Math.max(this.cameraScale, 0.0001);
    const iconScale = campIconScreenScale(cameraScale);
    marker.root.scale.set(1 / cameraScale);
    marker.iconRoot.scale.set(iconScale);
    marker.hitArea.radius = 12 * iconScale;
    marker.label.visible = this.cameraRelativeZoom >= 2;
    marker.icon.alpha = this.selectedUnitIds.has(unit.id) ? 1 : 0.9;
    marker.selection.visible = this.selectedUnitIds.has(unit.id);
    const definition = tribalUnitDefinition(unit.kind);
    marker.label.text = unit.combat
      ? `${definition.abbreviation} · ${unit.combat.strength}/${unit.combat.maximumStrength} · ${Math.round(unit.combat.moralePermille / 10)}%`
      : `${definition.abbreviation} · ${(unit.speedMetersPerHour / 1_000).toFixed(1)} KM/H`;
  }
}
