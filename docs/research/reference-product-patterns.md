# Reference-product patterns for GrandStrategy

Research date: 2026-08-11

This is an initial ideation pass, not a technology selection. Facts below come from first-party product pages, manuals, developer diaries, documentation, or source repositories. Recommendations are explicitly labeled as design inferences.

## Short answer

The most transferable idea from OpenFront is not its exact combat economy. It is the combination of one immediately legible map interaction, a deterministic simulation separated from rendering, and a low-friction browser entry point. The most useful lessons from Civilization and Paradox are progressive disclosure, contextual explanations, recommended starts, and guidance embedded in a real sandbox campaign.

For this game, the safest product direction is therefore:

- Keep the first playable loop tiny: inspect territory, make one consequential allocation/order, advance time, read the result.
- Let complexity emerge from new situations and unlocked capabilities, rather than exposing every subsystem on the first screen.
- Make the detailed Earth map a view of a smaller strategic data model, not millions of independently simulated objects.
- Build a deterministic, headless simulation core with a command interface before committing to browser or native presentation. This preserves the options for browser distribution, multiplayer replays, automated testing, and RL.

## 1. OpenFront: what is actually worth carrying over

### Verified facts

- OpenFront describes itself as an online real-time strategy game centered on territorial expansion, structures, resource management, and alliances, with multiple real-world-geography maps. It runs in modern browsers. [Official repository README](https://github.com/openfrontio/OpenFrontIO/blob/main/README.md)
- Its documented match loop starts with expansion into adjacent neutral tiles, then increasingly emphasizes gold/troop allocation, automatically resolved real-time attacks, structures, alliances, and map control. Wider shared borders affect attack advance, making border shape strategically meaningful. [OpenFront gameplay guide](https://openfrontio-openfrontio.mintlify.app/guides/gameplay)
- Its browser entry flow supports guest play, public/quick matches, private games, and local single-player practice. [OpenFront quick start](https://openfrontio-openfrontio.mintlify.app/quickstart)
- Its code is divided into `client`, `core`, `server`, and API concerns. The core is a deterministic TypeScript/JavaScript simulation with no external dependencies; rendering/UI are client concerns. [Official architecture document](https://github.com/openfrontio/OpenFrontIO/blob/main/docs/Architecture.md)
- The simulation runs in a worker separate from the client/rendering thread. Players emit intents, the server bundles and relays them by turn/tick, and each client applies executions to its own deterministic simulation. [Official architecture document](https://github.com/openfrontio/OpenFrontIO/blob/main/docs/Architecture.md)
- The project includes dedicated full-game, client-update, client-memory, and client-tick performance scripts, plus game replay tooling. [Official `package.json`](https://github.com/openfrontio/OpenFrontIO/blob/main/package.json)
- OpenFront maps begin as raster images and are compiled into binary terrain/elevation data, full-resolution data, two reduced minimap levels, metadata, and a thumbnail. Its map-generator guidance recommends roughly 2–3 million source pixels and no more than 3 million land tiles, and removes very small islands/lakes for performance. [OpenFront map-generator documentation](https://openfrontio-openfrontio.mintlify.app/map-generator/overview)
- Recent official release notes include map balancing, early-game pacing changes, anti-snowball changes, easier AI behavior, a simplified attack overlay, game-speed controls, mobile/fullscreen work, and platform-specific fixes. They also mention a Firefox performance notice and iOS rendering issues. [Official releases](https://github.com/openfrontio/OpenFrontIO/releases)

### Design inferences

- **Steal the interaction economy:** a player should be able to do something strategically meaningful directly on the map within seconds. This does not require copying OpenFront's troop-percentage attack mechanic.
- **Steal the deterministic core boundary:** represent player decisions as serializable commands and make rendering consume state updates. This is unusually valuable here because the same core can support replays, multiplayer synchronization, fast simulations, and RL.
- **Do not assume “browser-based” makes cross-platform free:** OpenFront's own release history shows browser and mobile rendering/input differences still need active testing.
- **Do not copy peer-to-peer/client lockstep without reconsideration:** it is elegant for short deterministic matches, but a long, information-rich grand-strategy campaign has different cheating, persistence, reconnect, and simulation-cost constraints. Reuse the deterministic command model; make the eventual multiplayer authority model a separate decision.

## 2. Civilization: progressive complexity through time and scope

### Verified facts

- Civilization VI explicitly presents a journey from the Stone Age to the Information Age. Technologies and culture unlock new potential, diplomacy evolves over time, and several victory paths coexist. Its official product page says tutorial systems introduce underlying concepts while veterans retain many tuning choices. [Official Civilization VI page](https://civilization.2k.com/en-GB/civ-vi/)
- The official manual describes a turn-based solo game, fog of war, contextual unit actions, queued multi-turn movement, automation such as automated exploration, and early units with limited capabilities. [Official Civilization VI manual (PDF)](https://assets.2k.com/1a6ngf98576c/4YkeFUH1vHHp3JT7EHK2SC/6926dff3a52120e73ec36c2013802ed3/Civilization_VI_PC_MANUAL_ENG_HIRES.pdf)
- Firaxis describes later Civilization VII empire-management work as streamlining systems to eliminate busywork while keeping choices impactful. [Official Civilization developer post](https://civilization.2k.com/en-GB/civ-vii/news/civ-streams-exploration-age/)

### Design inferences

- **Progressive complexity is a changing decision set, not merely a larger UI.** At the beginning, give the player few assets, few neighbors, few policies, and a clear local problem. Add diplomacy, institutions, logistics, ideology, or global coordination only when the world state makes them relevant.
- **Keep the core verbs stable.** Civilization grows from scouting and settling into a much larger game, but the player continues to read the map, allocate production/research, move forces, and respond to rivals. New systems should deepen established verbs instead of repeatedly replacing them.
- **Use automation to remove repetition, not strategy.** Queued movement and automated exploration are good models. Late-game governors, templates, standing orders, and delegation should execute player policy; they should not choose the player's goals.
- **Give every era a readable near-term objective.** Multiple long-term victory paths are useful, but the next five minutes must still have an obvious problem to solve.

## 3. Paradox: teach inside the sandbox

### Verified facts

- Victoria 3's “Learn the Game” is an objective layered on the regular sandbox rather than a separate disposable tutorial. It recommends easier countries, starts with an optional UI introduction, lowers AI aggression by default, and then uses reactive journal entries. [Victoria 3 Tutorial developer diary](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-51-tutorials)
- Its lessons are short and modular. A task can offer separate “Tell me How” and “Tell me Why” walkthroughs, and concept tooltips can launch relevant lessons on demand even outside the tutorial objective. Paradox explicitly states goals of supporting different learning styles, integrating teaching with normal play, and keeping tutorial content modular as mechanics change. [Victoria 3 Tutorial developer diary](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-51-tutorials)
- Victoria 3 objectives ask players what kind of campaign they want, recommend suitable countries, and pace journal entries according to conditions and completed subgoals. Paradox says playtests found that new players could see the systems but did not know why to act without some direction. [Victoria 3 Player Objectives developer diary](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-52-player-objectives)
- Crusader Kings III's console adaptation uses a control hierarchy, top-level command bar, radial map/character menus, quick access to active processes, contextual control prompts, hints, notifications, and optional automated warfare. It also exposes auto/advanced tooltips for players who want more detail. [Official CK3 console UI diary](https://www.paradoxinteractive.com/games/crusader-kings-iii/news/ck3-console-dev-diary-3-uiux-and-controls), [official CK3 console optimization diary](https://www.paradoxinteractive.com/games/crusader-kings-iii/news/console-dev-diary-4-tech-optimization-ps-exclusive-features)

### Design inferences

- **Onboarding should be a playable campaign with guardrails.** A forgiving recommended nation/scenario is more representative and maintainable than a scripted tutorial map.
- **Teach in layers:** show the consequence first, the action second, and the underlying formula only on demand. Preserve a “why?” path for players who want mastery.
- **Offer direction without railroading.** Let a player choose a fantasy such as expansion, trade, diplomacy, or internal reform; then surface relevant goals while leaving solutions open.
- **Use suggestions as exception handling.** The UI should call attention to an emerging food shortage, exposed border, idle institution, or diplomatic opportunity instead of making the player patrol every panel.
- **Cross-platform requires a control grammar.** Design a small hierarchy of map, selection, command, and time controls that works with mouse, touch, and controller concepts. Do not port a desktop panel maze to each platform.

## 4. Huge detailed Earth map without huge simulation cost

### Design inference from the combined evidence

Separate three layers:

1. **Visual geography:** coastlines, rivers, terrain, elevation tint, cities, borders, and pixel-art detail.
2. **Strategic topology:** a bounded graph of provinces/territories, adjacencies, crossings, sea zones, infrastructure links, and a small number of important locations.
3. **Simulation entities:** populations, armies, markets, governments, and other actors updated at the lowest frequency and granularity that still produces the intended decisions.

The player can see a very detailed world without every visible pixel becoming an economic or military agent. This is important both for potato hardware and for RL throughput. Detail should improve legibility and strategic geography; it should not automatically multiply per-tick work.

OpenFront is a useful partial precedent: it compiles raster maps and produces lower-resolution minimap levels rather than treating the source artwork itself as the runtime format. Its documented multi-million-tile budgets are evidence that large browser maps are feasible, not evidence that a much deeper grand-strategy simulation should update millions of tiles every tick.

To stop a fixed Earth map from exhausting replayability, vary the **strategic situation**, not necessarily the landmass: starting date or distribution, state capabilities, goals, relationships, resources, crises, institutions, and rule modules. OpenFront's official releases repeatedly rebalance geographically asymmetric maps, which is a useful warning that real geography creates interesting but persistent positional advantages. [Official OpenFront releases](https://github.com/openfrontio/OpenFrontIO/releases)

## 5. Browser, native, and cross-platform: recommendation for now

### Recommendation (not a final decision)

Do not choose the shipping shell yet. Choose the simulation contract first.

- A browser prototype has strong advantages for instant playtesting, sharing, and broad reach; OpenFront demonstrates that a deterministic real-time territorial game can use this route.
- A native shell can offer more predictable performance, background execution, filesystem access, and platform integration.
- Either route remains viable if the simulation is headless, deterministic, renderer-independent, and driven by serializable commands.

A practical first milestone is therefore a headless simulation executable plus one thin visual client. Benchmark a target “potato” device early using a full-size map and deliberately inflated late-game state. Pixel art reduces art/rendering complexity, but it does not reduce the cost of simulating thousands of actors.

## 6. RL-friendly architecture from day one

### Verified interface patterns

- Gymnasium's environment contract separates `reset`, observations, `step`, termination/truncation, and rendering; its official guide supports deterministic resets through a supplied seed. [Gymnasium custom-environment guide](https://gymnasium.farama.org/main/tutorials/gymnasium_basics/environment_creation/)
- PettingZoo distinguishes sequential Agent-Environment-Cycle environments from a Parallel API for simultaneous actions, and its custom-environment guidance includes observations, rewards, terminations, action spaces, and illegal-action handling. [PettingZoo overview](https://pettingzoo.farama.org/), [Parallel API](https://pettingzoo.farama.org/main/api/parallel/), [environment creation guide](https://pettingzoo.farama.org/main/content/environment_creation/)

### Design inferences

- Expose the simulation as `reset(seed, scenario)`, `observe(player)`, `legal_actions(player)`, `step(commands)`, and `is_terminal`, without requiring graphics, audio, wall-clock time, or networking.
- Make every source of randomness explicit and seeded. Save the seed plus command log so a run can be replayed exactly.
- Use hierarchical actions such as “set budget policy,” “assign army objective,” or “offer treaty,” rather than making an agent click UI pixels or choose from every map coordinate every tick.
- Design observation views deliberately. A player/agent should receive only information allowed by fog of war and diplomacy, while tests may use a privileged full-state view.
- Keep rewards outside core rules. First build clear game outcomes and measurable state changes; reward shaping can then evolve without contaminating the human game.
- Expect full-game RL to be difficult. Support small scenarios and curriculum stages using the same rules: one province economy, two-state border conflict, trade network, then full campaigns.

## 7. Important cautions

- **“Paradox depth” is not a feature list.** It comes from systems interacting to create decisions. A small set of strongly coupled systems is better than many isolated meters.
- **A fixed Earth map can undermine replayability** if geography determines the same winners. Asymmetry needs compensating goals, capabilities, diplomacy, and scenario variation—not necessarily symmetric starts.
- **Real-time, turn-based, and pausable real-time are different products.** This choice affects onboarding, multiplayer synchronization, session length, RL action timing, and CPU budget. It is the highest-leverage unresolved design decision.
- **Future multiplayer still shapes the core now.** Deterministic commands, stable IDs, explicit state ownership, replay logs, and UI-free rules are cheap early and expensive to retrofit.
- **Avoid per-unit late-game micromanagement.** A huge Earth game should increasingly operate through formations, fronts, policies, queues, and delegation.

## 8. Questions to settle before technology or content production

1. **Player fantasy:** Are you a nation, a government, a dynasty/leader, or an abstract civilization across changing regimes?
2. **Time model:** Turn-based, simultaneous turns, or pausable real-time with fixed ticks?
3. **Campaign scale:** What years does one campaign cover, and how long should one complete campaign take?
4. **Core promise:** What is the one sentence players will use to explain why this is not OpenFront, Civilization, or a Paradox game?
5. **First ten minutes:** What three decisions can a new player make, and what understandable consequences appear immediately?
6. **Strategic granularity:** Roughly how many land territories and active actors must a full Earth campaign contain?
7. **Complexity curve:** Which systems exist at minute one, and what events justify introducing each later system?
8. **Replay engine:** What changes between campaigns if coastlines and continents do not?
9. **Multiplayer target:** Occasional two-to-eight-player campaigns, short public matches, or persistent large sessions?
10. **RL purpose:** Is RL for research, opponent AI, automated balancing, or all three? Each implies a different environment and compute budget.

The first question to answer is **player fantasy**, closely followed by **time model**. Together they determine almost every other design choice.

## Source caveat

OpenFront's gameplay and technical guide pages are generated from its public project documentation and identify a 2026 generation date. Where those pages and the live repository or release history ever disagree, treat the repository and releases as authoritative.
