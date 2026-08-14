# ADR 0003: The Regional Theater is the finest playable spatial view

Date: 2026-08-11

## Status

Accepted.

## Decision

The game will not introduce a settlement, village, or individual-building map.
The Regional Theater is the finest playable spatial view throughout the game.
The campaign begins with a Camp at the scenario-defined position associated
with the chosen people. The player places Production Sites such as Farms and
Mines. A Village is created by upgrading the Camp in place; the player does not
place its individual huts, fields, paths, or internal facilities.

Routes are emergent infrastructure rather than manually drawn objects. Sites
produce aggregate movement demand, and repeated movement across terrain creates
Beaten Paths that can strengthen, decay, and later develop into road forms.
Authoritative route state is derived from deterministic site-to-site traffic;
individual moving people may be visualized later but are not required for road
generation or simulation correctness.

## Consequences

- Settlement development remains a strategic upgrade system rather than a city
  builder.
- Site placement, terrain, and economic relationships indirectly shape the road
  network.
- Farms and Mines are spatially meaningful without requiring internal
  micromanagement.
- One physical scale serves territory, settlement locations, production,
  movement, and routes.
- The simulation can represent traffic as sparse route flows instead of updating
  thousands of individual walkers.
- Later eras may change Route materials, capacity, and engineering, but do not
  add a finer spatial view.
