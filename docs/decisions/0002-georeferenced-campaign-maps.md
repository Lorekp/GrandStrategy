# ADR 0002: Georeferenced campaign maps generate metric regional theaters

Date: 2026-08-11

## Status

Accepted.

## Decision

The authoritative Campaign Map is a georeferenced semantic Geography Source,
not a painted raster or renderer coordinate grid. Simulation positions remain
in the Campaign Map's canonical coordinates, and authoritative distances,
areas, movement, and influence use physical units. Earth uses WGS 84 geodetic
positions and ellipsoidal geodesic measurement; future maps may declare an
ellipsoid, sphere, or planar metric surface through the same geometry boundary.

Atlas Views and Regional Theaters are deterministic, disposable derivatives of
that source. The Earth theater contract is a 768 km square centered Azimuthal
Equidistant projection at 93.75 metres per highest-LOD pixel (8192 square), with
1,024, 2,048, and 4,096 pixel LODs. The compiler must validate no more than 0.13%
projection-scale distortion across the theater.

A pinned GDAL/PROJ compiler reads georeferenced raster and vector sources,
projects one aligned theater grid with processing halos, derives a 250 metre
semantic grid, 32 km semantic chunks, projected waterway geometry, and visual
layers, then slices 512-pixel delivery tiles. It also emits a manifest
containing the projection, physical extent, resolution, source/compiler
versions, hashes, and licenses. Render tiles never own geography or multiplayer
state.

## Consequences

- Regional geography is generated automatically for any valid map position;
  theaters are not handcrafted.
- The existing 16,384 x 8,192 `x`/`y` simulation positions and pixel-valued
  influence are obsolete and will be removed rather than adapted.
- The shaded Natural Earth II raster remains an Atlas View source only. Its
  separate unshaded, georeferenced idealized land-cover product is compiled as
  semantic Surface Cover; local relief still comes from metric elevation.
  Regional coastlines, minor islands, and lakes are rasterized from the 1:10m
  physical vectors directly onto the local grid, so the overview raster's cell
  size can never quantize Theater shorelines.
- The Atlas is a static tiled LOD pyramid. Adding source detail increases disk
  and build cost without increasing the viewport-bounded runtime texture set.
- Two differently centered theaters may rasterize their overlap differently,
  but canonical positions and feature IDs prevent simulation or multiplayer
  seams.
- Visual tiles, gameplay terrain arrays, and RL observations are separate
  products of the same Geography Source.
- A future custom map must provide georeferenced semantic layers or a
  deterministic generator. Accurate local detail cannot be inferred from an
  unreferenced painted image.

## Rejected alternatives

- Enlarging the overview raster cannot create missing geographic information.
- Making equirectangular pixels authoritative makes distance and area depend on
  latitude.
- Handcrafted regional maps duplicate data, introduce seams, and do not scale
  to additional Campaign Maps.
- UTM requires zone and polar special cases; centered Azimuthal Equidistant
  provides the simpler universal first regional view.
