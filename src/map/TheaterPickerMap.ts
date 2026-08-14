import { Container, Graphics } from "pixi.js";
import type {
  CultureInfluenceField,
  CultureOverlap,
  RegionalCulture,
} from "../culture/CultureInfluence";
import type { GeographicPosition } from "../core/model";
import type { CameraState } from "./CameraController";
import type { CultureMapLayer, CultureMapMode } from "./CultureMapLayer";
import type { TheaterLevel, TheaterPoint } from "./RegionalTheater";
import {
  GlobalTheaterCatalog,
  theaterFootprint,
  type GlobalTheaterCatalogManifest,
  type TheaterCandidate,
} from "./TheaterCatalog";
import { TilePyramidLayer } from "./TilePyramidLayer";
import { CULTURE_MAP_STYLE } from "./CultureMapStyle";
import { PRESENTATION_CONFIG, parseHexColor } from "../config/GameConfig";

const pickerStyle = PRESENTATION_CONFIG.theaterPicker;
const ATLAS_DIM_COLOR = parseHexColor(pickerStyle.atlasDimColor);
const THEATER_DIM_ALPHA = pickerStyle.theaterDimAlpha;
const HOVER_COLOR = parseHexColor(pickerStyle.hoverColor);
const INVALID_COLOR = parseHexColor(pickerStyle.invalidColor);
const SELECTION_COLOR = parseHexColor(pickerStyle.selectionColor);

export const ATLAS_FORMAT_VERSION = 3;

export interface AtlasManifest {
  readonly formatVersion: typeof ATLAS_FORMAT_VERSION;
  readonly projection: "equirectangular";
  readonly source: string;
  readonly sourceUrl: string;
  readonly tileSize: number;
  readonly paletteColors: number;
  readonly levels: readonly TheaterLevel[];
}

export interface TheaterPreview {
  readonly candidate: TheaterCandidate;
  readonly cultureOverlap: CultureOverlap;
  readonly eligible: boolean;
}

export interface TheaterSelection {
  readonly candidate: TheaterCandidate;
  readonly cultureOverlap: CultureOverlap;
  readonly roll: number;
}

function assertAtlasManifest(value: unknown): asserts value is AtlasManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Atlas manifest is not an object");
  }
  const candidate = value as Partial<AtlasManifest>;
  const levels = candidate.levels;
  if (
    candidate.formatVersion !== ATLAS_FORMAT_VERSION ||
    candidate.projection !== "equirectangular" ||
    !candidate.source ||
    !candidate.sourceUrl ||
    !candidate.tileSize ||
    !candidate.paletteColors ||
    !levels?.length ||
    levels.some(
      (level, index) =>
        level.level !== index ||
        level.width !== level.columns * candidate.tileSize! ||
        level.height !== level.rows * candidate.tileSize! ||
        (index > 0 &&
          (level.width <= levels[index - 1]!.width ||
            level.height <= levels[index - 1]!.height)),
    )
  ) {
    throw new Error(
      `Atlas manifest violates format version ${ATLAS_FORMAT_VERSION}`,
    );
  }
}

export function parseAtlasManifest(value: unknown): AtlasManifest {
  assertAtlasManifest(value);
  return value;
}

export async function loadAtlasManifest(path: string): Promise<AtlasManifest> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Unable to load Atlas: ${response.status}`);
  }
  return parseAtlasManifest(await response.json());
}

export function atlasLevelForDisplayWidth(
  displayWidth: number,
  levels: readonly TheaterLevel[],
): TheaterLevel {
  const level = levels.find((candidate) => candidate.width >= displayWidth);
  const fallback = levels.at(-1);
  if (!level && !fallback) {
    throw new Error("Atlas tile pyramid has no levels");
  }
  return level ?? fallback!;
}

function appendDashedPolyline(
  graphics: Graphics,
  points: readonly TheaterPoint[],
  dashLength: number,
  gapLength: number,
): void {
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance === 0) continue;
    const directionX = (end.x - start.x) / distance;
    const directionY = (end.y - start.y) / distance;
    for (let offset = 0; offset < distance; offset += dashLength + gapLength) {
      const dashEnd = Math.min(distance, offset + dashLength);
      graphics
        .moveTo(start.x + directionX * offset, start.y + directionY * offset)
        .lineTo(start.x + directionX * dashEnd, start.y + directionY * dashEnd);
    }
  }
}

/** Streams the Atlas while culture and Theater selection remain static overlays. */
export class TheaterPickerMap {
  public readonly root = new Container();
  public readonly width: number;
  public readonly height: number;
  private readonly atlasTiles: TilePyramidLayer;
  private readonly dimmer = new Graphics();
  private readonly outlines = new Graphics();
  private readonly catalog: GlobalTheaterCatalog;
  private readonly overlapCache = new Map<string, CultureOverlap>();
  private viewport: CameraState | undefined;
  private mode: CultureMapMode = "culture";
  private selectedCultureId: string | undefined;
  private hoveredCultureId: string | undefined;
  private hoveredTheater: TheaterPreview | undefined;
  private selection: TheaterSelection | undefined;
  private roll = 0;
  private rerollState = 0x4845_4c4c;

  public constructor(
    private readonly atlas: AtlasManifest,
    catalogManifest: GlobalTheaterCatalogManifest,
    private readonly cultureField: CultureInfluenceField,
    private readonly cultureLayer: CultureMapLayer,
    atlasTilePath: string,
    private readonly requestRender: () => void,
    getLevelBias: () => number,
  ) {
    const highestLevel = atlas.levels.at(-1);
    if (!highestLevel) throw new Error("Atlas tile pyramid has no levels");
    this.width = highestLevel.width;
    this.height = highestLevel.height;
    this.catalog = new GlobalTheaterCatalog(catalogManifest);
    this.atlasTiles = new TilePyramidLayer(
      atlasTilePath,
      this.width,
      this.height,
      atlas.tileSize,
      atlas.levels,
      requestRender,
      getLevelBias,
      atlas.formatVersion,
    );
    this.root.eventMode = "none";
    this.root.addChild(
      this.atlasTiles.root,
      this.dimmer,
      this.cultureLayer.root,
      this.outlines,
    );
    this.cultureLayer.setPresentation("culture", undefined, undefined);
    this.drawPresentation();
  }

  public setViewport(viewport: CameraState): void {
    this.viewport = viewport;
    this.cultureLayer.setViewport(viewport);
    const displayWidth = this.width * viewport.scale;
    const atlasLevel = atlasLevelForDisplayWidth(displayWidth, this.atlas.levels);
    const lowestAtlasLevel = this.atlas.levels[0]!;
    void this.atlasTiles.setViewport({
      ...viewport,
      relativeZoom: atlasLevel.width / lowestAtlasLevel.width,
    });
    this.drawPresentation();
  }

  public setMode(mode: CultureMapMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.hoveredCultureId = undefined;
    this.hoveredTheater = undefined;
    this.cultureLayer.setPresentation(
      mode,
      this.selectedCultureId,
      undefined,
    );
    this.drawPresentation();
    this.requestRender();
  }

  public setSelectedCulture(cultureId: string): void {
    if (!this.cultureField.cultureById(cultureId)) {
      throw new Error(`Unknown regional culture ${cultureId}`);
    }
    if (this.selectedCultureId !== cultureId) {
      this.selection = undefined;
      this.roll = 0;
    }
    this.selectedCultureId = cultureId;
    this.cultureLayer.setPresentation(
      this.mode,
      cultureId,
      this.hoveredCultureId,
    );
    this.drawPresentation();
    this.requestRender();
  }

  /** Changes the campaign Culture while keeping the already chosen Theater. */
  public adoptCultureForCurrentTheater(
    cultureId: string,
  ): TheaterSelection | undefined {
    if (!this.cultureField.cultureById(cultureId)) {
      throw new Error(`Unknown regional culture ${cultureId}`);
    }
    this.selectedCultureId = cultureId;
    if (this.selection) {
      const preview = this.previewFor(this.selection.candidate, cultureId);
      this.selection = {
        candidate: this.selection.candidate,
        cultureOverlap: preview.cultureOverlap,
        roll: this.selection.roll,
      };
      this.hoveredTheater = preview;
    }
    this.cultureLayer.setPresentation(
      this.mode,
      cultureId,
      this.hoveredCultureId,
    );
    this.drawPresentation();
    this.requestRender();
    return this.selection;
  }

  public cultureAt(point: TheaterPoint): RegionalCulture | undefined {
    const id = this.cultureLayer.cultureIdAt(point, this.width, this.height);
    return id ? this.cultureField.cultureById(id) : undefined;
  }

  public cultureAtGeographic(position: GeographicPosition): RegionalCulture | undefined {
    return this.cultureField.cultureAt(position);
  }

  public hoverCultureAt(point: TheaterPoint): RegionalCulture | undefined {
    const culture = this.cultureAt(point);
    if (culture?.id === this.hoveredCultureId) return culture;
    this.hoveredCultureId = culture?.id;
    this.cultureLayer.setPresentation(
      "culture",
      this.selectedCultureId,
      this.hoveredCultureId,
    );
    this.requestRender();
    return culture;
  }

  public hoverTheaterAt(
    point: TheaterPoint,
    cultureId: string,
  ): TheaterPreview | undefined {
    const candidate = this.catalog.candidateAt(point, this.width, this.height);
    const preview = candidate ? this.previewFor(candidate, cultureId) : undefined;
    if (
      preview?.candidate.id === this.hoveredTheater?.candidate.id &&
      preview?.cultureOverlap.cultureId ===
        this.hoveredTheater?.cultureOverlap.cultureId
    ) {
      return preview;
    }
    this.hoveredTheater = preview;
    this.drawPresentation();
    this.requestRender();
    return preview;
  }

  public clearHover(): void {
    if (!this.hoveredCultureId && !this.hoveredTheater) return;
    this.hoveredCultureId = undefined;
    this.hoveredTheater = undefined;
    this.cultureLayer.setPresentation(
      this.mode,
      this.selectedCultureId,
      undefined,
    );
    this.drawPresentation();
    this.requestRender();
  }

  public currentSelection(): TheaterSelection | undefined {
    return this.selection;
  }

  public selectTheaterAt(
    point: TheaterPoint,
    cultureId: string,
  ): TheaterSelection | undefined {
    const candidate = this.catalog.candidateAt(point, this.width, this.height);
    if (!candidate) return undefined;
    const preview = this.previewFor(candidate, cultureId);
    return preview.eligible ? this.selectCandidate(preview) : undefined;
  }

  public reroll(cultureId: string): TheaterSelection {
    const current = this.selection?.candidate ?? this.hoveredTheater?.candidate;
    if (!current) {
      throw new Error("A Theater must be hovered or selected before re-dicing");
    }
    this.rerollState =
      (Math.imul(this.rerollState, 1_664_525) + 1_013_904_223) >>> 0;
    const candidate = this.catalog.rerollNeighbor(
      current,
      this.rerollState / 4_294_967_296,
      (neighbor) => this.previewFor(neighbor, cultureId).eligible,
    );
    this.roll += 1;
    return this.selectCandidate(this.previewFor(candidate, cultureId));
  }

  public destroy(): void {
    this.root.removeChild(this.atlasTiles.root, this.cultureLayer.root);
    this.atlasTiles.destroy();
    this.cultureLayer.destroy();
    this.root.destroy({ children: true });
  }

  private previewFor(candidate: TheaterCandidate, cultureId: string): TheaterPreview {
    const key = `${candidate.id}:${cultureId}`;
    let cultureOverlap = this.overlapCache.get(key);
    if (!cultureOverlap) {
      cultureOverlap = this.cultureField.overlap(
        candidate.center,
        this.catalog.theaterExtentMeters,
        cultureId,
        (position) => this.cultureLayer.isLand(position),
      );
      this.overlapCache.set(key, cultureOverlap);
    }
    return {
      candidate,
      cultureOverlap,
      eligible: cultureOverlap.matchingLandSamples > 0,
    };
  }

  private selectCandidate(preview: TheaterPreview): TheaterSelection {
    this.selection = {
      candidate: preview.candidate,
      cultureOverlap: preview.cultureOverlap,
      roll: this.roll,
    };
    this.hoveredTheater = preview;
    this.drawPresentation();
    this.requestRender();
    return this.selection;
  }

  private drawPresentation(): void {
    const hoveredCandidate = this.hoveredTheater?.candidate;
    const previewCandidate = hoveredCandidate ?? this.selection?.candidate;
    const brightCandidate = this.hoveredTheater?.eligible
      ? hoveredCandidate
      : this.selection?.candidate;
    this.dimmer.clear();
    this.dimmer
      .rect(-this.width, -this.height, this.width * 3, this.height * 3)
      .fill({
        color: ATLAS_DIM_COLOR,
        alpha:
          this.mode === "culture"
            ? CULTURE_MAP_STYLE.atlasCultureDimAlpha
            : THEATER_DIM_ALPHA,
      });
    if (this.mode === "theater" && brightCandidate) {
      const footprint = theaterFootprint(
        brightCandidate,
        this.catalog.theaterExtentMeters,
        this.width,
        this.height,
        32,
      );
      this.dimmer.poly(footprint.flatMap((point) => [point.x, point.y])).cut();
    }

    this.outlines.clear();
    if (!this.viewport || this.mode === "culture") return;
    const inverseScale = 1 / Math.max(this.viewport.scale, 0.0001);
    if (this.selection && this.selection.candidate.id !== previewCandidate?.id) {
      const selectedFootprint = theaterFootprint(
        this.selection.candidate,
        this.catalog.theaterExtentMeters,
        this.width,
        this.height,
        32,
      );
      appendDashedPolyline(
        this.outlines,
        selectedFootprint,
        7 * inverseScale,
        5 * inverseScale,
      );
      this.outlines.stroke({
        color: SELECTION_COLOR,
        width: 1.5 * inverseScale,
        alpha: 0.72,
      });
    }
    if (!previewCandidate) return;
    const footprint = theaterFootprint(
      previewCandidate,
      this.catalog.theaterExtentMeters,
      this.width,
      this.height,
      32,
    );
    appendDashedPolyline(
      this.outlines,
      footprint,
      8 * inverseScale,
      5 * inverseScale,
    );
    this.outlines.stroke({
      color:
        previewCandidate.id === this.selection?.candidate.id
          ? SELECTION_COLOR
          : this.hoveredTheater?.eligible
            ? HOVER_COLOR
            : INVALID_COLOR,
      width: 2 * inverseScale,
      alpha: 0.96,
    });
  }
}
