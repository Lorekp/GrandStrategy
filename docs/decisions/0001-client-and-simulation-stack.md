# ADR 0001: TypeScript simulation with PixiJS rendering

Date: 2026-08-11

## Status

Accepted for the first playable layers. Revisit only if measured target-device or simulation-throughput benchmarks fail.

## Decision

Use strict TypeScript for the deterministic game simulation, client, worker adapters, future authoritative Node multiplayer server, and initial AI/RL environment. Use PixiJS 8 as a rendering library rather than adopting a full game engine.

The game simulation is a pure fixed-tick state machine. It receives ordered, serializable command batches and produces serializable snapshots. Browser workers, multiplayer servers, replay runners, tests, and RL adapters are external drivers of the same core.

## Why

- The browser remains a viable first delivery target without making browser APIs part of the game rules.
- One language and one core implementation cover client, server, tests, replays, and headless simulation.
- PixiJS provides the 2D rendering layer while leaving game-state architecture under project control.
- WebGL remains the baseline for low-end compatibility. WebGPU is not required.
- It follows the useful part of OpenFront's architecture while leaving the authority model open for longer grand-strategy campaigns.

## Constraints

- No simulation rule may depend on PixiJS, DOM APIs, wall-clock time, or transport arrival order.
- Game-state numbers that affect determinism use bounded integers or explicitly defined fixed-point representations.
- The browser worker is not authoritative multiplayer infrastructure.
- Rendering detail and map logical size must not imply per-tick simulation of every visible cell.
- Native packaging is deferred until browser benchmarks reveal a concrete need; the simulation boundary preserves that option.

## Map asset direction

Canonical geography and physical scale are now governed by
[ADR 0002](0002-georeferenced-campaign-maps.md). The raster pyramid below is an
Atlas View implementation, not the simulation coordinate system.

The current map is a bounded, three-level raster tile pyramid built offline from
Natural Earth II 1:50m shaded relief. It uses 1,024-pixel PNG tiles at 2K, 4K,
and 8K world widths; the client requests only visible tiles and samples them
with nearest-neighbor filtering. A shared 64-color palette and progressively
denser river overlay create the pixel-atlas visual language without making the
simulation operate at render resolution.

The visual relief, land mask, and mutable gameplay geography remain separate.
Settlement influence is clipped by the preprocessed land mask today. The next
simulation layer can move influence into chunked typed arrays updated by the
worker and transfer only dirty chunks. If asset count or network delivery
becomes a measured problem, the existing bounded tiles can be packaged in
PMTiles without changing the rendering or simulation model.
