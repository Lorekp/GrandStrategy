# Grand Strategy design ledger

Last updated: 2026-08-14

## Product direction

- Large, detailed, accurately scaled Earth grand strategy from tribal society into the future.
- Pausable real-time fixed-tick simulation, deterministic and renderer-independent for multiplayer, replay, and future RL use.
- Pixel-art relief presentation with a whole-Earth Atlas and 768 km Regional Theater as the finest gameplay view.
- Progressive complexity: the Tribal Age begins with founding a Camp, unification, diplomacy, raiding, conquest, scouting, and combat.
- Many asymmetric tribes; modern countries do not exist at the start. Civilizations branch through historically grounded but player-directed evolutions.
- Organic influence borders arise from settlements, alliance, military power, and culture rather than fixed province polygons.
- The campaign is divided into mechanically distinct World Ages, while every society keeps its own development stage and can advance at a different pace.

## Accepted age progression

- Historical dates are soft natural unlocks, not forced upgrades. Reaching a new age's natural date opens its content to eligible societies without granting its institutions or technologies automatically.
- Every age ends in a broad synthesis technology. It requires progress across several knowledge branches and lived accomplishments, so it cannot be reached through a narrow research beeline.
- Researching the synthesis technology before the natural unlock grants the decision to **Usher in the Next Age**. The decision disappears once that age has emerged naturally or another society has ushered it in.
- Ushering changes the global World Age, but it does not advance every society. Less-developed societies retain their current organization and technology while gaining opportunities for observation, trade, conquest, and knowledge diffusion.
- The pioneering society receives bounded prestige, influence, and a choice that helps characterize the new age. It does not receive a compounding permanent research advantage.
- Age transitions never force a civilization identity swap. A polity may continue, reform, adopt a plausible successor identity, or hybridize according to its history.

## Accepted interaction rules

- World time advances one minute per simulation tick.
- Day is 06:00â€“18:00. Scouts move during day and rest at night; night reduces authoritative sight and detection to half range while preserving the one-kilometre occupied footprint.
- Right click replaces a Scout route. Ctrl-right-click appends a waypoint in all supported browsers. The route preview updates while paused and renders above fog.
- Left drag selects units; middle drag pans; wheel zooms.
- Camps reveal and sample vision from a one-kilometre footprint. Scouts use the same footprint and have a three-kilometre daytime identification range.

## Accepted geography rules

- Authoritative positions are WGS84 integer coordinates. Regional render tiles are disposable views, never simulation state.
- Terrain and vegetation are orthogonal. Terrain is water, plains, hills, mountains, desert, or snow.
- Forest and jungle are features that can overlay any land terrain. Their densities are sparse, light, moderate, and dense.
- Movement combines trained-scout slope pace, terrain footing, vegetation obstruction and density, then cultural acclimatization.
- The world picker reports terrain percentages separately from forest and jungle coverage, so totals are not expected to form one combined 100% composition.

## Deferred, not forgotten

- Tribal combat and warband resolution.
- Camp-to-village growth, placeable farms/mines/works, and automatically beaten paths.
- Full culture-history research and civilization evolution trees.
- Authoritative multiplayer rooms and reconnect/resynchronization.
- Weather, seasons, stealth, load, fatigue, roads, and continuous measured canopy/roughness data.
