# Grand Strategy

A first vertical slice for a large, low-overhead 2D Earth grand-strategy game.
The current playable surface is an accurately scaled Regional Theater for the
tribal era.

## Run it

From `C:\Users\laure\Desktop\GrandStrategy`:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173/`. Opening
`index.html` directly with a `file:///` URL bypasses the module server and does
not run the game.

Use Space to pause/play, 1-3 to change speed, F to fit the theater, drag to pan,
and the wheel to zoom. Select a Camp on the map or a tribe in the left roster to
inspect its people, warriors, influence radius, and stance toward the player.

## Current slice

- A zoomable, pannable whole-Earth founding Atlas with 1,492 overlapping,
  land-qualified Regional Theater choices and pointer-driven previews
- Forty broad regional-culture traditions assigned from 144 weighted geodetic
  anchors and shown without fixed cultural borders
- A selected 768 km Regional Theater generated at 93.75 metres per render pixel
- Azimuthal-equidistant local projection with a compiler-validated maximum
  scale-error budget of 0.13%
- Nine asymmetric tribes, one player-controlled Camp, and eight autonomous
  rival Camps
- Three-state fog of war: unknown terrain, remembered explored terrain, and
  current full-color sight, with unknown space rendered as neutral charcoal
- Elevation-aware terrain viewsheds with ridge occlusion, Earth curvature, and
  shorter per-observer entity-detection limits
- One-kilometre Settlement footprints with 360 perimeter samples deduplicated
  onto the canonical semantic grid
- One-kilometre Scout footprints using the same 360-sample visibility model,
  while entity detection remains limited to 3 km
- A discrete day/night cycle: 06:00â€“18:00 daylight, overnight Scout rest,
  static night tint, and authoritative half-range night viewsheds
- Art-directed visibility envelopes that retain near-field LOS, require broader
  observer support at long range, close pinholes, and discard detached flecks
- Twice-refined Scale2x fog contours mapped crisply onto the 93.75 m render
  while simulation and player knowledge remain on canonical 250 m cells
- Spatially bounded visibility updates plus a deterministic 500 m elevation
  LOD that keep moving-Scout LOS work bounded on the full 3,072² grid
- A strict paused clock: orders queue without advancing ticks, and repeated
  Unit move orders coalesce to the latest destination; the client previews the
  newest queued route immediately
- Browser-safe waypoint input: right click replaces the route and
  Ctrl-right-click appends while paused or running
- A fog-safe Field Survey readout for terrain, vegetation kind and density,
  elevation, nearby Units and Sites,
  Settlement works, influence, and allegiance
- Information-safe player snapshots that omit unseen tribes, Camps, and
  diplomatic relationships before data reaches the renderer
- Kilometer-scale organic influence footprints clipped to generated land
- Explicit friendly, neutral, hostile, and war-ready diplomatic state
- Camp-to-Village in-place upgrade command in the deterministic simulation
- Four visual levels from 1,024 to 8,192 pixels; only visible 512 px tiles plus
  a one-tile prefetch halo occupy the GPU
- Independent 250 m terrain, vegetation-density, and elevation cells split
  into cacheable 32 km chunks and shared by
  movement, line-of-sight, and hover information
- Natural drainage compiled from a pinned OpenStreetMap snapshot into a smooth
  Available Moisture field, while automatic network prominence keeps only
  strategically legible minor and major Rivers on the visible map

The tribe labels and starting values are provisional gameplay data, not the
project's eventual historical research pass. Combat is a firm tribal-era
requirement; warband movement and resolution are the next gameplay layer, not a
hidden part of this map slice.

## Architecture

- **TypeScript** is shared by the browser client, simulation worker, future
  authoritative server, replay tools, and headless AI/RL adapters.
- **PixiJS 8** renders through WebGL with demand-driven frames and nearest-neighbor
  sampling.
- **Proj4JS** projects authoritative WGS84 entity positions into the disposable
  Regional Theater view. Render pixels never enter simulation state.
- **Pure deterministic core:** `GameSimulation` consumes an ordered command
  batch for every fixed tick and imports no DOM, renderer, worker, or networking
  API.
- **Worker adapter:** local play advances the same core intended for an
  authoritative multiplayer server. Its player-view boundary filters hidden
  world state before transport rather than merely covering it with graphics.
- **Generated geography:** the renderer streams a manifest-driven tile pyramid
  and 32 km semantic chunks. Gameplay startup assembles the same cells once and
  transfers their buffers directly to the worker; projected waterway geometry
  remains independent of terrain-cell resolution.

## Source layout

- `src/core/Viewshed.ts` — deterministic elevation and curvature line-of-sight

- `src/core` — deterministic rules and state
- `src/core/PlayerView.ts` — detection-safe per-player entity filtering
- `src/core/VisibilityEnvelope.ts` — deterministic LOS support shaping
- `src/worker` — local fixed-tick clock and transport messages
- `src/map` — theater manifest, projection, tiles, influence, and camera
- `src/map/FogOfWarLayer.ts` — unknown, remembered, and visible map states
- `src/scenarios` — geodetic tribal starts and relations
- `tools/map-preprocess` — offline geography compilers
- `public/maps/theaters` — generated Regional Theater derivatives

## Generate the global Theater catalog

Create an isolated tool environment once:

```powershell
python -m venv .cache/map-tools
.cache\map-tools\Scripts\python.exe -m pip install -r tools\map-preprocess\requirements.txt
```

Build the deterministic whole-Earth overlap catalog from the Atlas land mask
and regional-culture anchors:

```powershell
.cache\map-tools\Scripts\python.exe tools\map-preprocess\build_global_theater_catalog.py
```

The catalog samples each 768 km footprint in its own metric projection, removes
regions with 10% land or less, omits uninhabited Antarctica from the tribal
picker, and assigns one broad gameplay culture. Hovering never runs this work:
the browser queries a compact prebuilt spatial index. Committing to an uncached
region asks the local development adapter to compile that one immutable Theater;
subsequent visits reuse it from `public/maps/theaters`.

The Regional Theater compiler downloads and caches only source elevation tiles
intersecting the requested metric square, projects them onto a WGS84 ellipsoid,
styles and quantizes the relief, and emits the visual pyramid plus chunked
semantic elevation, terrain, vegetation density, land, and Available Moisture
data, together with projected prominent-River geometry.

Regional hydrography comes from checksum-verified, date-pinned Geofabrik
OpenStreetMap PBF extracts. The compiler automatically selects the smallest
leaf extracts covering a Theater, streams only the nodes needed by natural
`river`, `stream`, and `tidal_channel` ways, clips the normalized network to the
Theater, and records every source URL, checksum, snapshot date, and normalized
content hash in the generated manifest. Canals, ditches, drains, engineered
waterways, and features tagged `man_made` or `artificial` are rejected. Unnamed,
seasonal, and intermittent natural waterways are retained as drainage inputs.

The compiler derives Horton-Strahler order from connected OSM topology. Order,
physical width, permanence, and the river/stream tag determine presentation;
small channels become moisture-only instead of blue map clutter. The browser
receives baked relief tiles, one extra moisture byte per 250 m semantic cell,
and a compact visible-centerline file with a 32 km spatial index. Keep the
visible attribution link in the map scale panel when redistributing builds.

Elevation comes from the open [Mapzen Terrain Tiles AWS dataset](https://registry.opendata.aws/terrain-tiles/)
in Terrarium format. Source and attribution details are preserved in every
generated manifest. The planet-scale Natural Earth II atlas assets remain a
separate overview derivative and are not used to invent local detail.
