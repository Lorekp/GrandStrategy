# ADR 0005: Fixed world time and physical scout travel

Status: Accepted  
Date: 2026-08-12

## Context

The prototype previously moved Scouts by arbitrary percentages attached to broad terrain classes. That made every mountain equally slow, lost the direction of a slope, and could not produce a meaningful calendar or arrival time. The game also needs one deterministic time model for local play, multiplayer replay, and RL workers.

## Decision

- One fixed simulation tick advances one world minute. At the current 10 ticks per real second, one world day lasts 144 real seconds at 1×.
- The Tribal Age scenario begins at 06:00 on 1 March 10,000 BCE. The authoritative calendar is simulation state, advances only with ticks, crosses the worker boundary in every frame, and participates in the state hash.
- Day is the fixed interval from 06:00 through 17:59. Night is 18:00 through 05:59. A Scout travels continuously during day and rests at night, with no automatic hourly halt.
- Moving speed uses the empirical median Lorentz curve fitted to trained Type-1 wildland firefighters hiking under load. Elevation supplies a continuous directional slope; the same route can therefore cost different amounts uphill and downhill.
- Terrain and vegetation are independent. Terrain is water, plains, hills, mountains, desert, or snow. Forest and jungle are vegetation features that may overlay any land terrain.
- Vegetation density is none, sparse, light, moderate, or dense. Forest and jungle apply progressively stronger obstruction factors; jungle is more restrictive than temperate forest at the same density. Water and slopes over 45 degrees are impassable.
- Homeland Acclimatization remains a relative cultural modifier applied after the physical slope, terrain, and vegetation calculation. It no longer replaces physical travel with a broad category percentage.
- Preview ETA and actual movement use the same semantic grid and travel function. The client displays current km/h, directional slope, and scheduled arrival including overnight rest.
- A Unit stores an ordered authoritative waypoint route. Right-click replaces it. Shift-left-click appends a waypoint in every supported browser; Shift-right-click remains accepted where the browser does not reserve that gesture. The complete route is presentation UI and renders above unexplored fog without revealing terrain beneath it.
- Night is authoritative simulation state, not a cosmetic filter. Observer identification and terrain viewshed distance fall to 50%, never below the observer's occupied one-kilometre footprint. A static cool-dark tint communicates the state without animation.

## Consequences

- Pause and speed controls alter real-time tick delivery but never calendar or movement rules. Orders and queued waypoints may be prepared while paused and are applied on the next authoritative tick.
- Steepness is sampled from the shared elevation grid. Rocky mountain footing may still differ from plains, while forest or jungle obstruction comes from the independent vegetation grid.
- `terrain.u8` and `vegetation.u8` are separate authoritative simulation inputs. The map compiler emits the same split globally and for every disposable Regional Theater.
- Future roads can replace the surface factor with a maintained-trail factor without changing the slope model. Weather, darkness, fatigue, load, heat, and stealth remain separate future layers.
- The field survey reports terrain, vegetation kind, and density independently. Regional picker percentages likewise allow a forested hill to contribute to both hills and forest.

## Evidence

The source review and implementation constants are recorded in [realistic-scout-travel.md](../research/realistic-scout-travel.md). Canopy-density terminology follows the established four-band USFS convention, with the user-facing label `light` replacing the source term `open/low`.
