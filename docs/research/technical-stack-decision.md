# Technical stack decision for GrandStrategy

Research date: 2026-08-11

Decision status: **recommended for the first production architecture**, subject to a benchmark on the agreed low-end reference machine before map fidelity is locked.

Facts below come from official documentation, specifications, or first-party source repositories. Performance conclusions that have not yet been benchmarked in this project are labeled as engineering judgments.

## Decision

Build this as a **browser-first, browser-worker architecture in TypeScript, rendered with PixiJS 8.19, with the same headless simulation package executed by Node.js 24 LTS on the authoritative server and in RL/test workers**.

This is not a traditional all-in-one game-engine project. The stable seam is the deterministic simulation, not the renderer:

- **Language:** TypeScript for the simulation, server, browser client, tools, and tests.
- **2D renderer:** PixiJS 8.19, initially preferring WebGL and falling back to its experimental Canvas renderer; WebGPU is an opt-in path after visual parity is proven.
- **Browser build:** Vite.
- **Browser execution:** a Dedicated Worker owns the local single-player simulation; Pixi and DOM UI stay on the main thread.
- **Server:** Node.js 24 LTS, WebSocket transport, authoritative fixed-tick rooms, with CPU-heavy rooms and later RL environments distributed over a `worker_threads` pool.
- **Native packaging, only if needed:** Tauri 2 can package the unchanged web client for Windows, macOS, Linux, Android, and iOS. Do not add it to the first vertical slice.
- **Map source:** Natural Earth 1:10m physical vectors, with NOAA ETOPO 2022 as an optional public-domain elevation source after the coastline slice works.
- **Runtime map assets:** a PMTiles v3 archive for static visual tiles plus a separate, versioned flat binary file of typed-array gameplay data. Dynamic influence is an in-memory chunk grid, not GIS geometry.

The closest alternative is **Rust simulation core + PixiJS TypeScript client**. It offers better native headless throughput in principle, but it adds a second language, WebAssembly bindings, two build toolchains, and a data boundary before this project has demonstrated a simulation bottleneck. Because RL is currently a possibility rather than the primary product, that complexity is not justified yet. This TypeScript decision is intended to be viable long-term, not a planned prototype that must be rewritten.

## Why this fits the game

The difficult parts of this game are not sprite physics or scene editing. They are:

1. keeping a huge map responsive on low-end hardware;
2. making a fixed-tick simulation deterministic and replayable;
3. sharing rules between single-player, an authoritative multiplayer server, automated tests, and headless RL;
4. preventing the visual detail of Earth from becoming the simulation resolution; and
5. adding eras chronologically without coupling every rule to a monolithic engine scene tree.

Pixi is a focused renderer rather than a full game engine, so these concerns can stay separate. This follows an established precedent unusually close to the proposed product: OpenFront divides its TypeScript code into client, shared deterministic core, and server, and runs simulation separately from rendering. Its repository explicitly describes modern-browser reach and shared core/server concerns. [OpenFront README](https://github.com/openfrontio/OpenFrontIO/blob/main/README.md), [OpenFront architecture](https://github.com/openfrontio/OpenFrontIO/blob/main/docs/Architecture.md)

The recommendation carries that proven shape forward while changing the authority model for a longer, fog-of-war-heavy grand-strategy game: **the server owns multiplayer truth**. Clients receive player-filtered views and can be resynchronized. They do not receive the complete hidden world merely so that lockstep is convenient.

## Proposed architecture

```text
Browser main thread
  input + DOM UI + Pixi renderer
              |
              | PlayerCommand / ViewDelta
              v
      GameHost interface
       /             \
LocalGameHost      RemoteGameHost
(Dedicated Worker) (WebSocket)
       |             |
       v             v
packages/sim     Node authoritative room
TypeScript       using the same packages/sim
                       |
                       +-- snapshots + command log + state hashes

Headless tests / replay CLI / RL worker pool
                       |
                       v
                  packages/sim
```

Recommended repository shape:

```text
apps/web                 Pixi renderer, UI, input, local/remote host adapters
apps/server              matchmaking, authoritative rooms, persistence boundary
packages/sim             UI-free deterministic rules and state
packages/protocol        commands, deltas, snapshots, stable IDs
packages/map             runtime map/chunk readers and coordinate transforms
tools/map-preprocess     reproducible Natural Earth -> runtime asset pipeline
```

### Simulation contract

`packages/sim` must not import Pixi, DOM APIs, WebSocket APIs, Node filesystem APIs, or wall-clock timers. It should expose a small synchronous contract equivalent to:

```text
createWorld(scenario, seed)
step(world, canonicalCommands) -> TickResult
makePlayerView(world, playerId) -> ViewDelta
snapshot(world) / restore(snapshot)
stateHash(world)
```

An RL adapter can add `reset`, `observe`, `legalActions`, `stepMany`, and terminal/outcome queries without changing game rules. Run headless steps as fast as possible; the real-time scheduler belongs outside the simulation.

Browser and Node timers can run late or be throttled, so they cannot define simulation time. The HTML standard explicitly permits timer delay and suspension behavior. [WHATWG timers](https://html.spec.whatwg.org/multipage/timers.html) A scheduler may request zero, one, or several logical steps, but every call to `step` advances exactly one integer tick.

### Determinism rules

TypeScript does not make a simulation deterministic by itself. The project must establish the following contract from the first commit:

- authoritative quantities use integers or explicit fixed-point units (basis points, milli-units, integer days), not free-form floating-point math;
- a named and version-pinned seeded PRNG is the only randomness source; `Math.random()` never enters game rules;
- commands are canonicalized by `(tick, playerId, playerSequence)` before execution;
- iteration order that affects outcomes is explicit; object or collection insertion accidents cannot decide a battle;
- simulation state uses packed structure-of-arrays data (`Uint8Array`, `Uint16Array`, `Uint32Array`, and signed variants) for hot world data;
- snapshots and command logs carry a rules/content version and seed;
- Node and browser-worker replay tests must produce the same periodic state hashes.

ECMAScript defines `Number` as IEEE-754 binary64, but `Math.random()` is implementation-chosen and several transcendental operations are implementation approximations. That makes integer/fixed-point rules and a project-owned named PRNG necessary for authoritative state. [ECMAScript number and math specification](https://tc39.es/ecma262/2025/multipage/numbers-and-dates.html)

### Multiplayer from day one

Use one command and view protocol for both local and remote play:

1. UI emits a serializable `PlayerCommand`; it never mutates simulation state directly.
2. In single-player, `LocalGameHost` forwards it to the Dedicated Worker.
3. In multiplayer, `RemoteGameHost` sends it over WebSocket with player sequence and requested tick.
4. The server validates, orders, and executes accepted commands.
5. The server sends compact player-visible deltas, periodic snapshots, and tick/hash metadata.
6. Reconnect loads a snapshot and then replays the remaining confirmed commands.

The browser WebSocket API is mature and is available in workers, but it has no backpressure. The client must therefore bound queues, coalesce replaceable view updates, and request a fresh snapshot rather than accumulating an unbounded backlog. [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

Node's `worker_threads` are stable, run JavaScript in parallel, accept transferred/shared buffers, and are explicitly intended for CPU-intensive work. Use a persistent pool for simulation rooms and RL batches rather than creating one worker per tick or per action. [Node worker threads](https://nodejs.org/download/release/latest-v24.x/docs/api/worker_threads.html) Node 24 is an LTS release line; Node's own policy recommends LTS for production. [Node release status](https://nodejs.org/en/about/previous-releases)

Single-player pause and speed are scheduler controls. In multiplayer, pause and speed are room-level server commands governed by the eventual lobby rules; a client cannot pause its local view of authoritative time.

## Rendering the huge map

### Keep three resolutions separate

The map needs three related but independent representations:

1. **Visual geography:** tiled coastlines, land color, rivers, lakes, and pixel-art detail at several zoom levels.
2. **Gameplay geography:** a bounded grid/graph for land, terrain cost, water connectivity, settlements, and influence propagation.
3. **Strategic entities:** tribes, villages, armies, relationships, and influence sources.

A visually large Earth does not require one economic object per visual pixel. Villages and armies should be sparse entities. Influence can be a lower-resolution field derived from those sources. This separation is the main performance decision, regardless of language.

### Organic influence-painted borders

Do not create a Pixi `Graphics` object or simulation entity for every cell. Use chunked data textures/sprites:

- Begin with a gameplay lattice around **4096 x 2048** cells, divided into 128 x 128 or 256 x 256 chunks. Treat that resolution as a benchmark hypothesis, not a promise.
- Store land as a bitset, terrain as `u8`, dominant polity as `u16`, and dominance/contestation as `u8`.
- Villages, armies, cultural centers, and diplomatic rules are influence sources. A deterministic frontier/dirty-chunk queue incrementally propagates changes; the engine never recomputes the whole planet every render frame.
- The worker transfers only dirty chunk buffers. Transferable `ArrayBuffer` objects can move ownership between threads without copying. [Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- WebGL renders the dominant owner and border softness from small chunk textures. The low-end Canvas path receives already-colored RGBA chunks and displays ordinary sprites, sacrificing shader flourishes but preserving the game state.
- Zoomed-out levels aggregate influence and settlement markers rather than sampling full-resolution chunks.

At 4096 x 2048, a full-world land bitset is about 1 MiB, `u8` terrain is 8 MiB, `u16` owner IDs are 16 MiB, and `u8` dominance is 8 MiB: roughly 33 MiB before entity state. Chunk sparsity and land-only allocation can reduce that. This is an engineering budget to benchmark; it is not evidence that all 8.4 million cells should update each tick.

Never upload the planet as one texture. WebGL texture limits vary by implementation and must be queried at runtime. Static and dynamic content should stay in bounded tiles with an LRU cache. [Khronos WebGL specification](https://registry.khronos.org/webgl/specs/latest/1.0/), [WebGL parameter API](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getParameter)

### PixiJS support reality as of this decision

PixiJS 8.19 is the current documented release. Pixi's current release and migration documentation use one `pixi.js` package and asynchronous renderer initialization. [PixiJS June 2026 / 8.19 release](https://pixijs.com/blog/june-2026), [PixiJS v8 migration guide](https://pixijs.com/8.x/guides/migrations/v8)

- Pixi's WebGL renderer is stable, broadly supported, and currently recommended for production.
- Its WebGPU renderer is feature-complete but still described as experimental because browser implementations differ.
- Pixi 8.16 added an experimental Canvas 2D renderer and automatic fallback for machines without a GPU context. Pixi says this can produce a smaller build and run on older hardware; it supports sprites, graphics, text, and basic filters, not complete GPU feature parity.
- Pixi supports `WebWorkerAdapter`/`OffscreenCanvas`, but the first version should keep rendering on the main thread and place only simulation in a worker. That preserves simple DOM UI, input, accessibility, and debugging. Move rendering only if profiling later shows main-thread rendering is the limiting factor.

Sources: [Pixi renderer guide](https://pixijs.com/8.x/guides/components/renderers), [Pixi 8.16 Canvas announcement](https://pixijs.com/blog/8.16.0), [Pixi environment/worker guide](https://pixijs.com/8.x/guides/concepts/environments), [current renderer API](https://pixijs.download/release/docs/rendering.AutoDetectOptions.html).

Start with an explicit production preference equivalent to `['webgl', 'canvas']`. Do not make WebGPU a launch requirement. The border renderer must have a sprite-based degraded path if Canvas support is part of the low-end promise.

## World-map source and runtime format

### Canonical source for the first slice

Use **Natural Earth 1:10m physical vectors** for land, coastline, minor islands, lakes, and rivers. Natural Earth states that all raster and vector data on its site are public domain and may be modified or used commercially without permission. [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) Its 1:10m physical set currently provides integrated world land, coastlines, islands, lakes, rivers, glaciated areas, and bathymetry. [Natural Earth 1:10m physical vectors](https://www.naturalearthdata.com/downloads/10m-physical-vectors/)

Important: `1:10m` means a cartographic scale of 1:10,000,000, not ten-meter spatial resolution. It is appropriate for a world and country-scale strategy map, not street-level geography. Natural Earth calls 1:10m its most detailed level and suitable for zoomed-in country/region maps and wall posters. [Natural Earth downloads](https://www.naturalearthdata.com/downloads/)

If the first terrain model needs elevation, preprocess and heavily downsample **NOAA ETOPO 2022**, a global 15-arc-second relief model published under CC0. Do not ship the scientific source grid. [NOAA ETOPO 2022 metadata](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.dem%3Aetopo_2022), [NOAA ETOPO product page](https://www.ncei.noaa.gov/products/etopo-global-relief-model)

Do not start with modern administrative polygons as territorial truth. The game's tribes and polities paint their own territory. Modern-country data may later help place curated lineage spawns, but physical geography is the canonical map base.

### Preprocessing pipeline

Keep Shapefiles, GeoPackages, GeoTIFFs, and GeoJSON out of shipped runtime assets. A reproducible offline tool should:

1. download and checksum a pinned Natural Earth release;
2. normalize to WGS84 and repair/split dateline geometry;
3. rasterize the authoritative land mask and coarse terrain/elevation arrays;
4. generate several equirectangular visual LODs with nearest-neighbor-safe pixel styling;
5. cut visual LODs into bounded raster tiles and pack them into `earth.pmtiles`;
6. write `world.sim.bin` containing a small header/section table followed by flat typed-array sections;
7. emit a JSON manifest containing source versions, dimensions, checksums, projection, and spawn-coordinate transform;
8. run validation for dateline wrap, disconnected islands, land/water counts, and deterministic asset hashes.

Use normalized equirectangular coordinates for the first complete Earth map because they provide a full rectangular world, simple texture addressing, and horizontal longitude wrap. Precompute latitude-dependent movement/distance factors so polar projection distortion does not become a gameplay advantage. This is an engineering recommendation, not a Natural Earth requirement.

### Why PMTiles plus a flat simulation binary

PMTiles v3 is a **single-file archive for tiled data**. It has a fixed header and indexed tile directories, can live on static storage, and has official JavaScript tooling. The specification is public domain/CC0 where applicable and the reference implementations are BSD-licensed. [PMTiles v3 specification](https://github.com/protomaps/PMTiles/blob/master/spec/v3/spec.md), [PMTiles reference project](https://github.com/protomaps/PMTiles)

That makes it a good static visual asset: one file, HTTP range reads in a browser, no tile-server process, and natural multi-resolution loading. It is not the right mutable gameplay state. General GIS vector objects are expensive to update, hash, transfer, and expose to RL.

`world.sim.bin` should therefore be deliberately boring: magic/version, dimensions, chunk size, section offsets, then packed land/terrain/elevation data. HTTP compression handles transfer; runtime creates typed-array views over the fetched buffer. Because map assets are generated, the project can break and regenerate this format when it changes rather than accumulating migration code.

For a vector-only experimental slice, quantized TopoJSON is also reasonable because it shares arcs and delta-encodes integer coordinates. [TopoJSON specification](https://github.com/topojson/topojson-specification) It loses to raster PMTiles for the first pixel-art client because runtime triangulation, style, and Canvas parity add work that offline rendering can avoid. MVT inside PMTiles remains an option if later zoom levels truly require dynamic vector styling. [Mapbox Vector Tile specification](https://github.com/mapbox/vector-tile-spec)

## Candidate comparison

| Candidate | What it does well | Current limitations for this game | Verdict |
|---|---|---|---|
| **TypeScript + PixiJS + browser worker + Node** | One language; shortest path to a browser; direct DOM UI; stable WebGL and experimental Canvas fallback; same pure package runs in a worker, server, tests, replay tools, and Node RL pool; OpenFront is a close working precedent. | Determinism requires discipline; garbage creation must be controlled; Python RL needs a batched subprocess/protocol adapter; ultimate rollout throughput may be below optimized native Rust. | **Choose this.** It is the simplest architecture that fully meets the current requirements. |
| **Rust + Bevy 0.19 + wgpu 30 + WASM** | One language for native game and headless server; excellent native reach; wgpu supports Vulkan, Metal, D3D12, OpenGL/GLES, and WebGL2/WebGPU on WASM; Bevy has explicit headless schedule runners. | Current Bevy web builds choose `webgl2` or `webgpu`; enabling WebGPU overrides WebGL2, so one artifact does not provide Pixi-like runtime fallback. Browser examples are still single-threaded. Bevy systems are parallel by default unless ordered, adding determinism work. Its broad engine/ECS/render surface is more machinery than this data-oriented 2D map needs. | Capable, but loses on browser fallback, UI iteration, and implementation complexity. |
| **Godot 4.6.x 2D / web / headless** | Mature editor and 2D workflow; broad native exports; dedicated-server export and `--headless` are official; built-in multiplayer APIs. | Godot 4 web targets only WebGL 2 via Compatibility and still has no WebGPU. Default web export is single-threaded; threads require cross-origin isolation. C# projects cannot export to web. Browser networking is limited to HTTP, WebSocket client, and WebRTC. A headless RL environment still carries engine/runtime coupling. | Strong for a native scene-driven 2D game, weaker for browser-first giant-map simulation and high-density headless runs. |
| **Rust simulation core + PixiJS TypeScript client** | Native authoritative server and RL speed; integer/data-oriented Rust core can compile to WASM; Pixi preserves browser/UI strengths. | Two languages and toolchains, WebAssembly bindings, cross-boundary data ownership, harder debugging, and no benefit to static map rendering. It pays complexity before a measured TypeScript bottleneck exists. | Best fallback if RL becomes the primary product or a representative benchmark disproves TypeScript; not the starting decision. |
| **Raw Canvas/WebGL or Phaser** | Raw APIs reduce dependencies; Phaser offers more game-framework facilities. | Raw rendering means rebuilding camera, batching, assets, interaction, and renderer fallback. Phaser adds scenes/physics/game-loop features that the project deliberately keeps outside its simulation, while offering less direct control than Pixi for this specialized tiled map. | No clearly superior simpler alternative. Pixi is the smaller relevant abstraction. |

### Rust/Bevy support details

The latest official crate documentation at the research date is Bevy 0.19. Bevy's `MinimalPlugins` includes `ScheduleRunnerPlugin` specifically for applications without a window event loop, and its headless example supports run-once or fixed-loop execution. [Bevy 0.19 `MinimalPlugins`](https://docs.rs/bevy/latest/bevy/struct.MinimalPlugins.html), [Bevy `ScheduleRunnerPlugin`](https://docs.rs/bevy/latest/bevy/app/struct.ScheduleRunnerPlugin.html)

Bevy's current feature documentation says `webgpu` overrides `webgl2`, and the resulting WASM build cannot run with WebGL2. Its official examples also state that browser execution is currently single-threaded. [Bevy 0.19 web feature documentation](https://docs.rs/crate/bevy/latest/source/examples/README.md) The lower-level wgpu 30 API itself has broad reach: Vulkan, Metal, D3D12, and OpenGL natively, plus WebGL2 and WebGPU on WASM, with WebGL requiring its conditional feature. [wgpu 30 documentation](https://docs.rs/wgpu/latest/wgpu/)

This means Rust is not rejected for lack of capability. Full Bevy is rejected because this project's highest-value renderer path is a lightweight browser 2D client with graceful fallback, while its highest-value simulation path is a plain deterministic library rather than a parallel ECS schedule.

### Godot support details

Godot 4.6.3 is the current stable archive release at the research date. [Godot release archive](https://godotengine.org/download/archive/) Its official web documentation states:

- WebAssembly and WebGL 2 are required;
- Godot 4 web can only use the Compatibility renderer and does not support WebGPU;
- C# projects currently cannot export to web;
- the preferred/default web export is single-threaded, while thread support requires `SharedArrayBuffer` and cross-origin isolation headers;
- web networking lacks low-level networking and supports HTTP, WebSocket client, and WebRTC; and
- the generated WASM and pack files are usually large enough that Godot recommends server compression, saying the WASM commonly gzip-compresses to around one quarter of its original size.

[Godot web export documentation](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)

Godot does have a credible native dedicated-server story: any platform binary can run with `--headless`, and dedicated exports can strip visual resources. [Godot dedicated-server export](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_dedicated_servers.html) The rejection is therefore about the combination of browser limits, engine-coupled headless environments, and web/server language-sharing constraints—not about Godot's general quality.

## Browser-first, not browser-only

The browser should be the first shipping shell because it gives instant playtesting, link-based multiplayer, and broad desktop/mobile reach with the least installation friction. It also matches the interaction model that inspired the project.

This does not close the native path. Tauri 2 supports existing HTML/JavaScript frontends and targets Windows, macOS, Linux, Android, and iOS from one codebase while using OS webviews. [Tauri 2 overview](https://v2.tauri.app/), [Tauri frontend model](https://v2.tauri.app/start/frontend/) Add Tauri only when a concrete requirement appears, such as Steam distribution, filesystem mod packs, platform APIs, or more predictable desktop lifecycle behavior.

Tauri advertises that a minimal application can be under 600 KB because it reuses the operating system webview. That is a framework-floor claim, not a size estimate for this game: Pixi code, art, audio, and map assets still determine the shipped size. [Tauri overview and app-size claim](https://v2.tauri.app/start/)

Tauri is packaging, not a second game implementation. Multiplayer remains client/server. The simulation package remains headless and independent.

## Concrete dependency baseline

Pin exact versions in the lockfile when scaffolding; the following is the intended package surface rather than an invitation to add a framework for every concern:

- `pixi.js@8.19.x`
- `typescript`
- `vite`
- `vitest` for Node/browser replay and invariant tests
- `pmtiles` for static map archive access
- [`ws`](https://github.com/websockets/ws) on the Node server for WebSocket service
- a small, named seeded PRNG package with a pinned algorithm/version
- optionally `@noble/hashes` for periodic BLAKE3 replay/state hashes

Use built-in typed arrays, `DataView`, transferable buffers, browser `fetch`, and Node workers before adding state-management, ECS, serialization, or worker-pool frameworks. Commands are small enough to start as strictly validated JSON; world chunks and snapshots are binary frames. Add a schema/code-generation package only when protocol evolution justifies it.

Do not add React, a physics engine, Bevy, maplibre-gl, or a database to the first map slice. DOM controls plus Pixi are enough to prove the architecture. Persistence begins as snapshots and append-only command logs behind an interface; database selection belongs to a later persistence requirement.

## First end-to-end vertical slice

Build only enough tribal-age functionality to test every architectural seam:

1. Load an equirectangular Natural Earth world from local `earth.pmtiles` and pan/zoom it with pixel-perfect nearest scaling.
2. Load `world.sim.bin` in a Dedicated Worker and verify land/water picking.
3. Place one fixed tribe camp/village from a scenario file.
4. Run a fixed tick with pause and speed controls.
5. Execute one command through the `GameHost` interface, such as founding/upgrading the village or projecting influence.
6. Paint organic influence through dirty chunks without redrawing the whole world.
7. Run the identical scenario headlessly in Node and compare state hashes after a long command replay.
8. Connect two browser clients to one authoritative Node room and execute the same command path.
9. Kill/reconnect a client and restore it from snapshot plus confirmed commands.
10. Run many headless scenarios through a persistent Node worker pool to prove the future RL seam.

The first slice is successful only if the full-sized map representation is present. A small placeholder map would postpone the highest-risk performance question.

## Benchmark gates before adding the next era

Pick and document a real low-end reference machine. On that machine, measure rather than infer:

- pan/zoom frame time at the most detailed supported visual zoom;
- resident CPU and GPU memory under a fixed tile-cache budget;
- worst and 95th-percentile tick time with an inflated number of tribes, villages, armies, and dirty borders;
- worker-to-main transfer volume per second;
- server room tick time and reconnect snapshot size;
- browser-versus-Node state-hash parity over at least a long randomized command replay;
- headless steps per second for one environment and a worker pool.

The map lattice, visual maximum zoom, tick rate, and server rooms-per-worker should remain adjustable until this benchmark passes. That is not speculative configuration: these values directly express the hardware promise.

## Risks and explicit tradeoffs

- **TypeScript may eventually limit RL rollout density.** Mitigation: data-oriented typed arrays, no allocations in hot ticks, persistent worker pools, batched RL operations, and profiling with a late-game-sized state before introducing another language. If the game becomes primarily an RL research platform, Rust + a thin Python binding deserves a new decision.
- **Canvas fallback cannot match custom WebGL shaders.** Mitigation: make the authoritative border product a worker-generated colored tile. WebGL can add soft blending; Canvas must retain a legible flat-color version. Define "potato" as low-end hardware with either WebGL or Pixi's supported Canvas subset, then test it.
- **Browser tabs are throttled in the background.** Multiplayer authority remains on the server and resynchronizes on return. Single-player can deliberately auto-pause when hidden instead of pretending background timers are reliable.
- **A 4096 x 2048 gameplay grid could still be too large.** It is chunked and measured before content production. Visual detail stays independent, so reducing gameplay resolution does not discard the Earth artwork.
- **Natural Earth is not village-level data.** That is acceptable for the first global strategy map. Villages, resources, and historical spawn content are curated gameplay data, not inferred from modern cartography.
- **A dual local/remote host can drift semantically.** Run protocol conformance tests in which both hosts execute the same command fixture and compare player-visible results.

## Final recommendation in one sentence

Use **TypeScript + PixiJS 8.19 in a browser-first client, a pure fixed-tick simulation in a Dedicated Worker, and the same simulation package in an authoritative Node 24 LTS server/headless RL pool; stream a public-domain Natural Earth map from PMTiles and keep influence in a separate chunked typed-array grid**.
