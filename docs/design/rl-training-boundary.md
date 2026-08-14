# RL training boundary

## Decision

The game has one authoritative rules engine: `GameSimulation`. Human input from the
browser worker and AI input from `TribalRlEnvironment` are adapters that submit the
same `GameCommand` values to the same fixed-tick simulation. Training must never
reimplement movement, research, diplomacy, event, building, or unit rules.

The environment follows the established Gymnasium/PettingZoo shape:

- `reset(seed)` returns per-agent observations and information.
- `step(actionsByAgent)` applies one action per agent simultaneously and returns
  observations, scalar rewards, `terminated`, `truncated`, and information.
- Time limits set `truncated`; only future game-rule victory or defeat conditions
  may set `terminated`.
- Agent ids are stable strings (`player:<PlayerId>`), while the environment owns
  command player ids and sequences. A policy cannot impersonate another player.

Primary conventions:

- [Gymnasium environment API](https://gymnasium.farama.org/api/env/)
- [PettingZoo multi-agent environments](https://pettingzoo.farama.org/)
- [PettingZoo action masking](https://pettingzoo.farama.org/tutorials/custom_environment/3-action-masking/)
- [RLlib multi-agent environments](https://docs.ray.io/en/master/rllib/multi-agent-envs.html)

## Observation contract

`RlObservation` is versioned and contains:

1. the existing `PlayerWorldSnapshot`, including last-known entity intelligence;
2. the semantic terrain, vegetation, moisture, and elevation values for currently
   visible cells only; and
3. legal actions derived only from that same player-filtered snapshot.

It deliberately excludes the global state hash and all unexplored semantic cell
values. Policies therefore receive the same partial information as a human player.
The visible grid is sparse: sorted cell indices plus parallel typed arrays. This
avoids copying an entire high-resolution theater for every agent on every decision.
A recurrent policy can learn terrain memory; later observation encoders may add
local crops or remembered-map tensors without changing the simulation rules.

Terrain and vegetation codes use the exported, stable tables from `WorldGrid`.
RL consumes semantic arrays, never rendered pixels or Pixi objects.

## Action contract

Each agent action is either `wait` or one player decision. Concrete decisions such
as research, construction, training, administration, diplomacy, proposal answers,
and event choices form a deterministic legal catalog. An encoder can map that
catalog to a discrete boolean action mask.

Movement remains a structured spatial action: a legal controlled unit, an order
mode, and a WGS84-E6 land destination. Enumerating every map cell as a giant
discrete action would scale poorly and make policies dependent on theater
resolution. The core simulation remains the final validator for every command.

All agents choose from the same pre-tick state. Commands are then applied on the
same authoritative tick in deterministic player/sequence order. This makes the
environment suitable for simultaneous self-play and deterministic replay.

Frame-skipped training ticks use `GameSimulation.advance`, which executes the same
rules without building and hashing an unused render snapshot on every world minute.
The normal `step` API delegates to that path and then snapshots, so there is no
separate fast-but-inexact simulation.

## Self-play scenarios

`createSelfPlayScenario` is an explicit training transformation. It:

- gives every passive NPC tribe a stable controller id;
- creates empty knowledge state for new controllers; and
- completes the pairwise diplomatic relation graph with neutral relations while
  preserving scenario-authored relations.

Gameplay scenarios stay unchanged. Training can also disable the transformation
to train one controlled faction against later scripted opponents.

## Rewards and episode endings

The environment exposes raw, own-state reward signals: population, warriors,
settlements, villages, influence, completed technologies, and explored cells.
`tribalDevelopmentReward` is a small potential-difference curriculum for the
current Tribal-age slice; it is not the final competitive objective. Reward models
are injected so self-play, exploration curricula, evaluation, and future victory
rewards can use different scalarizations without modifying game rules.

The current game has no complete victory/defeat state, so `terminated` is always
false. Episode horizons are explicit and produce `truncated = true`. When combat
elimination and victory rules exist, they should be implemented in the simulation
and reflected through `terminated` without changing the environment response
shape.

## Required invariants

- Same scenario factory, reset seed, and action stream produce the same state hash.
- Policies never receive global state or unexplored terrain through observations,
  action catalogs, rewards, or per-agent information.
- Every advertised concrete decision is accepted by the authoritative simulation
  from the state in which it was advertised.
- Missing, extra, or out-of-mask agent actions fail loudly during development.
- Rendering speed and UI state never affect simulation ticks or observations.
- Observation schema changes bump `RL_OBSERVATION_SCHEMA_VERSION`; old checkpoints
  are retrained rather than supported through compatibility paths.

## Next layer, when training begins

Build a thin Python adapter that maps the TypeScript response to PettingZoo Parallel
or RLlib dictionaries, plus policy-specific tensor encoders. Keep reset, legal
actions, rewards, termination semantics, and determinism in this TypeScript module.
Run PettingZoo API, parallel API, seed, and action-mask tests against that adapter
before starting expensive training.
