# Automatic, accurately scaled regional maps from a canonical world

> Implementation update (2026-08-13): the coordinate/source architecture in
> this note remains accepted, but format 12 now uses a 768 km theater, an
> 8,192² highest render LOD, a 250 m semantic grid, and 32 km semantic chunks.
> ADR 0002 is the current size and resolution contract.

Status: architecture research and recommendation  
Date: 2026-08-11

## Recommendation in one paragraph

Treat the current painted relief map as an **overview product**, not as the source of truth. A painted 8K or 16K world image cannot recover village-scale coastline, terrain, rivers, or land cover when enlarged. Instead, define each game world with georeferenced, semantic source layers (at minimum elevation, land/water, and land cover), canonical surface coordinates, and a deterministic seed. Generate both the world atlas and every tribal theater from those same sources. For an Earth theater, keep authoritative positions in WGS 84 longitude/latitude and calculate gameplay distances and areas geodesically; generate a 512 km local view in a meter-based, center-specific Azimuthal Equidistant projection at 125 m/pixel. Keep all theater images and render tiles disposable and cacheable. Simulation cells, entities, territory, and procedural fields stay in canonical world coordinates, so changing projections or crossing a theater boundary cannot create a gameplay seam.

This is the simplest long-term design because it adds only one durable seam: a `WorldSource` interface that provides semantic samples in canonical coordinates. Earth GIS datasets, procedural planets, and flat authored maps can all implement it. Pixi remains the renderer; GDAL/PROJ form the offline or server-side compiler.

## The crucial distinction: source geography versus a painted overview

The current Natural Earth relief is good atlas art, but it is not a high-resolution terrain database. Natural Earth describes its products as small-scale cartographic data and supplies them at 1:10 million, 1:50 million, and 1:110 million; even its most detailed tier is intended for countries, regions, and large wall maps, not settlement-scale simulation ([Natural Earth downloads](https://www.naturalearthdata.com/downloads/)). An 8192-pixel-wide Earth image represents roughly 4.9 km per pixel at the equator. Upscaling only creates more samples of the same 4.9 km pixels.

Therefore the desired pipeline is not literally:

```text
painted world PNG -> magically recover a detailed local map
```

It is:

```text
canonical georeferenced source layers
        ├──> world overview tiles
        ├──> regional semantic grids
        └──> regional pixel-art render tiles
```

For a future custom map, an artist may still paint an overview, but the map package must also provide either:

- georeferenced semantic rasters/vectors at the intended maximum fidelity; or
- a deterministic world generator capable of answering the same semantic queries.

If neither exists, automatic local detail may be invented procedurally, but it cannot be geographically accurate to the painted image beyond the information encoded in that image. The tool should report this as a source-resolution limitation rather than silently implying accuracy.

## Coordinate model

### Do not use equirectangular pixels as authoritative game coordinates

Equirectangular/Plate Carrée is useful for global raster storage because pixels map simply to longitude and latitude. PROJ explicitly says that this simplicity is why it is common for global raster datasets, while also warning that the projection introduces distortion, has little use in navigation or cadastral mapping, and is best used near the equator. It has true scale only at its selected standard parallel ([PROJ: Equidistant Cylindrical](https://proj.org/en/stable/operations/projections/eqc.html)).

Consequences of making equirectangular pixels authoritative would include:

- east-west distance per pixel shrinking with latitude;
- area per pixel varying strongly over the world;
- circular influence becoming physically wrong away from the standard parallel;
- pathfinding and economy density depending accidentally on latitude; and
- singular behavior at the poles and special handling at the antimeridian.

Equirectangular is acceptable as an **overview tile matrix and interchange raster**, but not as the metric simulation plane.

### Canonical coordinates plus projected views

For Earth, persist entity and feature positions as geodetic longitude/latitude on the WGS 84 ellipsoid, preferably as scaled integers at serialization boundaries. The authoritative server performs distance, azimuth, and polygon-area calculations geodesically. PROJ defines a geodesic as the shortest path on an ellipsoid and supplies direct/inverse distance and polygon-area routines; its terrestrial geodesic implementation is accurate to numerical round-off ([PROJ geodesic calculations](https://proj.org/en/stable/geodesic.html), [PROJ distance API](https://proj.org/en/stable/development/reference/functions.html#distances)).

For other worlds, the map manifest selects one of three surface models:

```ts
type WorldGeometry =
  | { kind: "ellipsoid"; semiMajorMeters: number; inverseFlattening: number }
  | { kind: "sphere"; radiusMeters: number }
  | { kind: "plane"; widthMeters: number; heightMeters: number; wrapX: boolean };
```

The rest of the game consumes a `WorldGeometry` service (`distance`, `direct`, `area`, `projectForView`) rather than importing Earth-specific formulas. PROJ supports Azimuthal Equidistant in spherical and ellipsoidal forms and allows a custom spherical radius, so the same compiler path can cover Earth-like fictional globes ([PROJ: Azimuthal Equidistant](https://proj.org/en/stable/operations/projections/aeqd.html)). A planar world uses identity coordinates in meters.

### Regional view projection

For a tribal theater, use an ellipsoidal **Azimuthal Equidistant (AEQD)** projection centered on the theater anchor:

```text
+proj=aeqd +lat_0=<anchor latitude> +lon_0=<anchor longitude>
+ellps=WGS84 +units=m +x_0=0 +y_0=0
```

This provides a universal center-specific metric plane without UTM zone branching, works at high latitudes, and gives exact radial distance and azimuth from the theater center by construction. PROJ exposes AEQD globally in both spherical and ellipsoidal form with meter-valued false easting/northing ([PROJ: Azimuthal Equidistant](https://proj.org/en/stable/operations/projections/aeqd.html)).

UTM is a valid alternative for a region contained in one zone, but it divides Earth into sixty generally 6-degree zones ([PROJ: UTM](https://proj.org/en/stable/operations/projections/utm.html)). Automatically choosing zones, handling cross-zone theaters and polar exceptions creates complexity that the centered AEQD view avoids. Lambert Azimuthal Equal Area should be used only for generated analytics where exact area preservation matters; PROJ supports it in spherical and ellipsoidal forms ([PROJ: Lambert Azimuthal Equal Area](https://proj.org/en/stable/operations/projections/laea.html)). Gameplay area itself should still be computed geodesically, not measured from render pixels.

## A concrete 512 km accuracy and fidelity budget

Recommended first tribal-theater contract:

| Property | Target | Meaning |
|---|---:|---|
| Theater extent | 512 km × 512 km | 262,144 km² around a selected anchor |
| Highest semantic/render grid | 4096 × 4096 | 125 m per pixel/cell |
| Potato-hardware fallback | 2048 × 2048 | 250 m per pixel/cell |
| Source elevation | 30 m class or better | Aggregated into the game grid; never inferred from the overview |
| Source land cover | 10–30 m class | Mode/coverage-aggregated into the game grid |
| Authoritative position serialization | ≤1 m quantization | Independent of rendered pixels |
| Authoritative distance error | ≤1 m numerical budget | Use ellipsoidal geodesics; dataset position error is separate |
| Render quantization | ≤0.5 pixel at a point | 62.5 m at 125 m/pixel |
| Accepted projection scale distortion | ≤0.1% over the theater | Validated for every generated theater |
| Intra-theater raster tile seams | 0 pixels | Tiles are clipped from one aligned projected grid with a halo |
| Inter-theater authoritative seam | 0 m | Canonical coordinates and semantic feature IDs are unchanged |

For a 512 km square, the farthest corner is about 362 km from the projection center. In the spherical approximation, AEQD's transverse scale factor at angular radius `c` is `c / sin(c)`. With an Earth-sized radius this is approximately 1.00054 at the corner, or about 0.054% scale distortion. That is an engineering estimate, not a promise: the compiler should sample a validation grid and compare projected measurements to PROJ geodesics, rejecting or subdividing any theater above the 0.1% budget.

At 125 m/pixel, a 5 km influence radius is 40 pixels and a 15 km radius is 120 pixels. A starting tribe is therefore no longer visually the size of a country. These radii remain meter-valued simulation data; pixel radius is derived from the current view.

The accuracy labels must remain honest:

- **metric accuracy** comes from geodesic calculations and the projected view contract;
- **spatial fidelity** is limited by each input dataset's resolution and accuracy;
- **render fidelity** is limited by the selected meters per pixel; and
- **procedural fidelity** is reproducible but not historical or survey truth.

## Per-theater projection seams

Per-theater local projections necessarily sample the curved world onto different rectangular grids. Two overlapping theaters centered at different anchors will not produce byte-identical pixels in their overlap, even when both are correct. Attempting to make those textures authoritative would create duplicate terrain, mismatched borders, and multiplayer disagreement.

The rule should be:

> A theater is a disposable, cacheable view of the world. It never owns geography or simulation state.

Authoritative objects use canonical positions and stable world feature IDs. Terrain semantics are sampled from canonical layers or globally keyed procedural fields. A generated theater contains only derived arrays and render assets tied to one projection manifest.

There are two distinct seam cases:

1. **Inside one theater:** generate a single aligned 4096 × 4096 grid (or deterministic aligned blocks), include a processing halo, run all neighborhood operations, and only then cut it into 512-pixel delivery tiles. Adjacent tiles will match exactly. Vector clipping uses a buffer, consistent with MapLibre's own warning that unbuffered tile features can produce visual artifacts ([MapLibre source specification](https://maplibre.org/maplibre-style-spec/sources/)).
2. **Between theaters:** never compare or merge render pixels. Keep entities and semantic features in canonical coordinates, switch/reproject the view, and cross-fade the old and new imagery if needed. If the design later requires continuous high-detail panning, reproject visible source tiles into the current camera projection instead of stitching pre-baked theater textures.

Procedural generation must also be world-addressed:

- sample noise from canonical 3D planet coordinates or stable global cell IDs, never from chunk-local coordinates;
- derive river basins and long connected features globally or by basin, not independently per render tile;
- seed from `(mapVersion, worldSeed, semanticFeatureId)`, not tile load order; and
- include a halo wider than the largest terrain-analysis kernel before clipping.

For stable source partitioning, adopt an OGC-style tile matrix or hierarchical global cell ID. OGC's Tile Matrix Set standard defines regular grids at a limited list of scales in an explicit CRS and uniquely identifies a tile by matrix, row, and column ([OGC Two Dimensional Tile Matrix Set](https://www.ogc.org/standards/tms/)). A full equal-area DGGS is attractive later for population density, influence, and strategic aggregation because it defines hierarchical, uniquely addressed global cells ([OGC DGGS](https://www.ogc.org/standards/dggs/)), but it is unnecessary for the first end-to-end theater. Start with canonical coordinates plus an OGC-style geodetic source quadtree; add a DGGS only when gameplay truly needs global equal-area cells.

Do not use source tile IDs as simulation cells. Source tiles partition storage; simulation cells model gameplay.

## Source layers and generated assets

### Source-of-truth map package

Every map should have a small manifest and immutable source layers:

```yaml
id: earth
version: 1
geometry:
  kind: ellipsoid
  semiMajorMeters: 6378137
  inverseFlattening: 298.257223563
seed: 184467
layers:
  elevation: sources/elevation.vrt
  landcover: sources/landcover.vrt
  water: sources/water.gpkg
  hydrography: sources/hydrography.gpkg
  coast: sources/coast.gpkg
licenses: sources/licenses.json
```

Required source semantics:

- elevation in meters relative to a declared vertical datum;
- land/water classification;
- categorical land cover/biome inputs;
- coast, lake, and river geometry or sufficient elevation/flow inputs to derive them;
- a stable world seed; and
- CRS, nodata, provenance, license, source date, and content hash for every layer.

Optional later layers include soil, climate, roads, settlement candidates, resources, and historical masks. They should be adapters, not hard dependencies of the projection pipeline.

For Earth, plausible primary sources include:

| Role | Candidate | Important constraint |
|---|---|---|
| Overview cartography | Natural Earth | Public domain, but small-scale only; suitable for the atlas, not tribal geometry ([terms](https://www.naturalearthdata.com/about/terms-of-use/)) |
| Elevation | Copernicus DEM GLO-30 | 30 m where available; access and derivative redistribution terms must be reviewed for the exact product/version ([Copernicus DEM docs](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM.html)) |
| Land cover | ESA WorldCover | 10 m, CC BY 4.0 with required acknowledgement ([WorldCover data and license](https://esa-worldcover.org/en/data-access)) |
| Hydrology | HydroSHEDS/HydroRIVERS/HydroLAKES | Core products are available for commercial use but have product-specific attribution and redistribution terms; do not treat the site or every product as one blanket license ([HydroSHEDS product license](https://www.hydrosheds.org/products/hydrosheds), [license FAQ](https://www.hydrosheds.org/faq)) |
| Roads/settlements, if later desired | OpenStreetMap extracts | ODbL requires attribution and share-alike treatment of adapted databases; never use the public tile service as the game's backend ([OSM copyright and license](https://www.openstreetmap.org/copyright)) |

Dataset choice is a product/legal decision as well as a technical one. The build must preserve attribution and license metadata in generated packages. Pinning source versions is mandatory so a saved multiplayer world does not change when an upstream dataset updates.

### Generated, reproducible products

The compiler creates:

- global overview raster tiles and their LODs;
- a projected elevation grid per theater;
- slope, aspect, ruggedness, coast distance, water, biome, and passability arrays;
- river/road/shore vector clips with stable source IDs;
- visual hillshade, palette, and pixel-art raster layers;
- optional navigation and settlement-candidate graphs; and
- a theater manifest containing source hashes, projection, extent, resolution, compiler version, and licenses.

The following must **not** be sourced back from a visual PNG:

- elevation, biome, passability, water connectivity;
- authoritative coastline or river routes;
- village placement constraints;
- territory ownership; or
- RL observations.

Visual relief is one consumer of the semantic elevation. GDAL can generate hillshade, slope, aspect, ruggedness, and color relief from a DEM, and specifically recommends reprojecting geographic grids before terrain analysis away from the equator or at high latitude ([GDAL DEM processing](https://gdal.org/en/stable/programs/gdaldem.html)).

## Deterministic compiler pipeline

Use a pinned GDAL + PROJ toolchain in a container or locked runtime:

1. **Validate inputs.** Verify CRS, axis order, extent, units, nodata, vertical datum, source version, license, and checksum.
2. **Create the theater definition.** Quantize the requested anchor if cache reuse is desired; record center, 512 km extent, AEQD definition, 125 m target resolution, and world seed.
3. **Read only relevant source windows.** Keep large raster sources as Cloud Optimized GeoTIFFs or VRT mosaics. The OGC COG standard combines internal tiling, reduced-resolution overviews, georeferencing, and HTTP range requests so clients can fetch only required areas and resolutions ([OGC COG standard](https://docs.ogc.org/is/21-026/21-026.html)).
4. **Warp continuous layers.** Reproject elevation to the exact theater bounds and grid. Use a documented continuous resampler such as bilinear or cubic.
5. **Warp categorical layers.** Use nearest or mode/coverage aggregation for land cover and masks; never blend category codes.
6. **Clip vectors with a halo.** Reproject coast, rivers, lakes, and later roads into theater meters while preserving canonical feature IDs.
7. **Derive semantic fields.** Calculate slope, ruggedness, drainage constraints, terrain cost, coast distance, and biome. Long-range hydrology must originate globally or by basin.
8. **Derive visual fields.** Produce hillshade and hypsometric color, quantize to the game's palette, then composite water and semantic vectors.
9. **Cut delivery tiles.** Slice the already-aligned output into 512 × 512 tiles; do not independently warp each final tile.
10. **Validate.** Check geodesic/projection error, source coverage, categorical values, nodata, tile-edge equality, deterministic semantic hashes, and required attribution.

GDAL's warp utility exposes target CRS, target extent, target resolution, aligned pixels, resampling, and nodata controls. Its documentation also notes that `-et 0` disables the approximate coordinate transformer for true pixel-by-pixel reprojection; use this for reproducibility on these bounded regional products ([GDAL gdalwarp](https://gdal.org/en/stable/programs/gdalwarp.html)). Pin thread count and tool versions. Hash normalized decoded semantic arrays, because container metadata or compression libraries may otherwise prevent byte-identical GeoTIFF/PNG files despite identical pixels.

Suggested cache identity:

```text
viewKey = hash(
  mapId,
  mapVersion,
  canonicalAnchor,
  extentMeters,
  metersPerPixel,
  projectionDefinition,
  compilerVersion,
  sourceLayerHashes,
  generatorConfigHash
)
```

An authoritative semantic feature ID must not include `viewKey`; otherwise the same river or mountain becomes a different object in every theater.

## Storage, tiling, and browser delivery

### Authoring and compilation formats

- Raster sources: COG + VRT mosaics, preserving native values and overviews.
- Vector sources: GeoPackage/FlatGeobuf/GeoParquet depending tooling; GeoPackage is the conservative first choice.
- Generated semantic arrays: compact binary typed arrays per theater or chunk, compressed independently.
- Generated visual tiles: PNG initially for exact palette/pixel output; evaluate lossless WebP only after visual and decode benchmarks.

### Runtime delivery

A 4096-pixel theater divides naturally into an 8 × 8 grid of 512-pixel tiles. Pixi can continue loading only visible tiles and use nearest-neighbor sampling. Gameplay overlays remain Pixi geometry or compact semantic textures. No MapLibre dependency is needed for the game view.

Keep the current simple URL tile directory for the first working slice. Package mature immutable pyramids into PMTiles later if file-count/deployment overhead matters. PMTiles is an archive for tile pyramids accessed with HTTP range requests ([Protomaps PMTiles overview](https://docs.protomaps.com/)); its browser client can fetch selected tiles directly. Because PMTiles does not make a local projection self-describing for the game, retain the theater manifest beside the archive.

MapLibre remains useful as a development/debug viewer for canonical GIS layers, but should not replace Pixi merely to display the game. Its standard tiled sources assume the global Mercator slippy-map profile and TileJSON, whereas the tribal view uses a theater-specific projection ([MapLibre sources](https://maplibre.org/maplibre-style-spec/sources/)).

## Multiplayer and reinforcement-learning separation

The authoritative server owns:

- the map/world version and immutable source hashes;
- canonical positions, meter-valued radii, and territory geometry/cells;
- geodesic movement, distance, and area calculations;
- stable terrain/feature IDs and semantic field version; and
- the deterministic simulation tick.

Clients own only camera projection and rendering. They may download a cached theater compiled elsewhere, but cannot submit its pixels as state. Two clients can view the same battle through differently centered projections without disagreeing about where it occurs.

The RL environment must also consume the semantic side, not screenshot pixels unless visual control is deliberately the research goal. Expose observations such as elevation, slope, land-cover category, water, traversal cost, settlement graph, territory, and neighbors at a configured resolution. The same canonical coordinate and distance APIs power both the game server and RL environment. This allows headless training to skip Pixi, PNG decoding, hillshade, labels, and palette composition entirely.

Determinism should be scoped realistically:

- authoritative simulation is deterministic under a pinned server implementation;
- semantic compiler outputs have stable normalized hashes;
- visual assets are replaceable and may be regenerated without changing a save; and
- source/compiler version upgrades create a new map version rather than mutating an existing multiplayer world.

## Minimal implementation sequence

1. **Introduce `WorldGeometry` and `WorldSource` interfaces.** Keep Earth as the only adapter, but remove direct dependence on relief-image pixels for game semantics.
2. **Build one automatic 512 km compiler path.** Given any longitude/latitude, emit a 4096² AEQD theater from one high-resolution DEM, land/water, and land-cover source window.
3. **Render it in the existing Pixi client.** Add the scale transition between atlas and theater; render one test tribe with a meter-valued radius.
4. **Add semantic terrain queries.** Village siting and movement use the generated arrays; verify the headless worker can run without visual tiles.
5. **Add cache manifests and hashes.** Demonstrate that two builds of the same theater produce identical semantic hashes and seamless internal tile edges.
6. **Test a second arbitrary location and one non-Earth sphere.** This verifies the abstraction before adding more content.
7. **Only then add hydrology, settlement generation, PMTiles packaging, and on-demand server compilation.**

The first proof should answer one hard question end to end: can the game request any Earth anchor, automatically build an accurately scaled local theater, place a 5–15 km tribe correctly, and run the same terrain queries in the multiplayer simulation and headless RL environment? Once that works, visual fidelity and additional map layers can grow without changing the architecture.

## Decision summary

- **Yes:** automatically generate a regional tribal view from the same canonical world data.
- **No:** do not enlarge the painted world relief and call the result higher fidelity.
- **Canonical position:** geodetic coordinates on an explicit ellipsoid/sphere, or meters on a planar map.
- **Authoritative measurement:** geodesic distance and area, never equirectangular pixel distance.
- **Regional display:** centered AEQD in meters, 512 km square, initially 125 m/pixel.
- **Authority:** semantic sources, entity coordinates, and feature IDs.
- **Disposable cache:** theater semantic grids, hillshade, palette rasters, and delivery tiles.
- **Seams:** zero within a theater by aligned-grid slicing; no gameplay seam between theaters because theater pixels are never state.
- **World partition:** OGC-style geodetic tile matrix for source storage first; evaluate equal-area DGGS only when gameplay needs it.
- **Runtime:** Pixi + visible 512-pixel tiles; GDAL/PROJ compiler; simple files first, PMTiles later.
- **Future maps:** implement the same `WorldGeometry`/`WorldSource` contract with semantic data or a deterministic generator.
