# ADR 0004: Regional cultures are learned gameplay traditions

Status: Accepted  
Date: 2026-08-12

## Context

The Atlas assigns every selectable Regional Theater one of 40 broad cultures. Those cultures need enough mechanical identity to support meaningful homeland choice, but the game also spans migration, hybridization, and alternate history. A culture therefore cannot be modeled as a permanent biological property or a rigid territorial polygon.

## Decision

Each Regional Culture is a compact data profile containing:

- two Gameplay Focus labels;
- one defining Legacy;
- one coupled Tradeoff;
- Homeland Acclimatization with explicit per-terrain movement modifiers; and
- one Tribal Age Signature Knowledge unlock.

These rules describe learned environmental knowledge, institutions, and material practice. A Tribe owns its current culture identifier and the resolved authoritative movement modifiers. The simulation never derives rules from display names, map colors, or render pixels.

Only Homeland Acclimatization is activated in the current playable slice because terrain movement already exists. Other rules remain structured content until their corresponding simulation systems are built. A profile is loaded once and referenced by culture ID; it is not duplicated across the thousands of Theater candidates.

## Consequences

- Homeland selection creates an immediate, deterministic difference in Scout movement.
- Culture identity can later change, hybridize, or be learned without moving geography or rewriting entities.
- Multiplayer and RL workers receive explicit numeric rules rather than presentation-dependent behavior.
- Balance and historical wording can be revised in one catalog without altering the Theater lattice.
- The first-pass profile set requires a dedicated historical and balance review before it is treated as final content.
