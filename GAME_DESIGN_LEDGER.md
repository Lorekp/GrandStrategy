# Grand Strategy Game — Design Ledger

Last updated: 2026-08-13

This is the living record of the game's direction. It separates the creator's stated ideas from working interpretations and settled decisions so that early exploration does not accidentally become commitment.

## Current concept

An accessible, high-performance 2D grand-strategy/4X game spanning the tribal age through the future on a large, detailed map of Earth. Every player begins as a tribe and guides a country/civilization through contingent, branching historical forms. The current inspiration is the clarity and immediacy of OpenFront, combined with the systemic depth associated with Paradox games and the gradual complexity curve of Civilization.

This wording is a **working synthesis**, not yet a final pitch.

## Creator's stated ideas

- The design of OpenFront.io is the main current inspiration.
- The game must be highly optimized and run on very weak ("potato") hardware.
- Training an AI through reinforcement learning is under consideration.
- The game should be cross-platform.
- The game should be 2D.
- The visual direction should use pixel graphics.
- The genre is grand strategy / 4X.
- Paradox games are an important reference point.
- It must be easy to pick up.
- Civilization's gradual increase in complexity is an important reference: the beginning should be approachable, with complexity emerging as the game develops.
- The initial setting/map is Earth only.
- The Earth map needs to be very large and detailed.
- Despite using Earth, the specific map should not dominate the experience; replayability should come from more than map novelty.
- Browser delivery is being considered but is not decided.
- Multiplayer is important and must inform foundational design decisions from the beginning, although implementing or focusing on multiplayer is not the present priority.
- Every player controls a country/civilization beginning as a tribe.
- Each country/civilization should have a custom, branching evolution with historically semi-accurate possibilities.
- Working example supplied by the creator: a lineage associated with modern Greece might progress through tribe, Athenian, Byzantine, modern Greek, and neo-Byzantine forms, with multiple choices at each evolution and additional steps between them.
- The starting world should contain many tribes.
- Large countries should not exist at the beginning; creating them requires unification, as it did historically.
- Starting tribes should be asymmetric rather than equally strong.
- Some tribes should be specially designated. Every present-day country should have a corresponding special starting presence in its associated geographic location.
- A campaign spans the ancient/tribal world through the future.
- The game's production should follow the game's chronology: first make the tribal age work as a game, then expand development through later eras toward modernity and the future.
- The time model is pausable real-time with a fixed simulation tick.
- On the Earth map, a player starts in a geographically anchored location rather than freely choosing any world position.
- Choosing a tribe/people type (examples supplied: Viking, Germanian) should roughly determine the player's starting territory or homeland.
- The first era focuses on tribal unification through diplomacy, conquest, raiding, and related interactions among many tribes.
- The earliest game state and mechanics should be basic and approachable.
- Establishing or building a basic village is part of the opening game.
- Territorial borders should be organically painted rather than constrained to fixed provinces.
- Control is currently conceived as influence. Potential contributors include alliances, military strength, culture, and additional systems to be defined.
- Implementation has begun with the large Earth map and foundational simulation architecture.
- The initial technical stack is strict TypeScript with PixiJS 8 rendering, a browser worker for local simulation, and the same headless simulation intended for an authoritative Node multiplayer server and RL/test workers.
- The first dark, flat-vector map treatment was explicitly rejected as generic and "LLM slop."
- The desired Earth presentation is a pixel-graphic physical relief map in the visual family of the referenced ArcGIS World Relief Map: readable terrain and elevation, restrained natural colors, visible drainage, and detailed geography rather than a dark dashboard aesthetic.
- The creator wants substantially more local geographic fidelity. A starting tribe or village must not visually occupy an area comparable to Germany, Denmark, or Greece.
- A smaller, geographically specific map for the tribal stage is under consideration.
- Regional tribal geography must be generated automatically from the complete Campaign Map rather than handcrafted.
- Physical scale must be accurate: distances and territorial footprints in detailed play must correspond consistently to the source geography.
- The generation approach must support future Campaign Maps rather than embedding Earth-specific assumptions in the game rules.
- The Regional Theater is the finest playable spatial scale; there will be no separate settlement or village map.
- Village-building means upgrading a Camp into a Village, not placing individual huts or managing a settlement layout.
- Settlements, Farms, and Mines occupy strategic Sites in the Regional Theater. The player chooses a valid starting Camp site inside the initial theater, and that Camp upgrades in place into a Village.
- Roads should form automatically as beaten paths from accumulated movement rather than being manually drawn.
- Combat is mandatory in the first era rather than being deferred to a later historical layer.
- Other autonomous tribes must be present in the first era and visible in the Regional Theater.
- The game should have fog of war.
- Camp founding begins on one continuous world map. A Regional Theater is selected in-place on that Atlas rather than appearing as a separate foreground map.
- The player can choose among different Regional Theaters during the pick phase and can re-dice a selected Theater before committing to it.
- Selecting a Regional Theater loads its high-resolution geography inside its exact world-map footprint, at full brightness against the dim Atlas, with a dashed selection border.
- The Theater picker should be a continuous hover-preview across the whole inhabited world rather than a field of small boxes or markers to click.
- Regional Theater candidates with 10% land or less should not be selectable.
- Hovering a Theater should identify its broad regional culture. Similar cultural traditions should be unified into a restrained roster rather than split into a large number of near-duplicates.
- The game needs a main menu and a settings menu.
- Every regional culture should have fleshed-out buffs, debuffs, acclimatization, and special technology.
- The world needs an advancing clock. Scout movement should use realistic travel time for a well-trained scout, with terrain cover and actual elevation steepness replacing arbitrary biome pace percentages.

## Requirements that currently look firm

- Excellent performance on low-end hardware
- Cross-platform direction
- 2D presentation
- Pixel-art visual language
- Grand-strategy / 4X structure
- Low initial cognitive load with increasing systemic depth
- A large and detailed Earth map for the first version
- Campaign progression from tribes through the future
- Branching civilization/country evolution
- A tribal starting world without pre-existing large countries
- Multiplayer-aware foundations, even while single-player/core gameplay is developed first
- Pausable real-time progression on fixed simulation ticks
- Geographically anchored Earth-map starts influenced by the chosen tribe/people
- A tribal-era opening centered on village-building and regional unification
- Organic influence-painted territory rather than fixed province ownership
- A deterministic, integer-tick, command-driven simulation isolated from rendering and transport
- A pixel-art physical-relief map whose terrain remains the visual focus
- Strategic Site placement without individual-building micromanagement
- Emergent beaten paths and roads generated by movement between Sites
- Rival tribes and combat as first-era systems
- Player-specific fog of war that distinguishes unknown, explored, and currently visible geography
- Broad regional cultures with legible mechanical strengths, explicit tradeoffs, homeland acclimatization, and signature knowledge

## Settled visual direction for the map foundation

- The physical atlas is the hero of the screen; interface chrome must stay quiet and compact.
- Relief uses a restrained land-and-water palette, crisp pixel sampling, and progressively revealed geographic detail.
- Terrain visuals, gameplay influence, and simulation geography are separate layers so visual detail does not set simulation cost.
- The current implementation is a 64-color, multi-resolution Natural Earth II relief pyramid with cyan river detail and nearest-neighbor sampling.
- Large decorative titles, floating explanatory cards, gradients, and ornamental HUD framing are outside this direction.

## Settled geographic generation direction

- A Campaign Map is backed by georeferenced semantic geography rather than a painted overview image.
- Atlas Views and Regional Theaters are generated automatically from the same Geography Source.
- Simulation positions, distance, movement, and influence use physical map units rather than render pixels.
- Earth positions use geodetic coordinates and geodesic measurement; future Campaign Maps may define a spherical or planar metric surface.
- A Regional Theater is a disposable view and never owns territory, entities, or multiplayer state.
- The working target is a 768 km square theater at 93.75 metres per highest-LOD pixel, with projection distortion validated below 0.13%.
- The current Natural Earth II relief remains the Atlas View; it is not a source of village-scale geography.
- The founding pick phase uses one continuous, zoomable and pannable Atlas camera. The world Atlas stays dim; the hovered or selected 768 km footprint becomes a full-brightness survey window with a dashed cartographic edge. Camp placement begins only after the player commits to that Theater.
- The inhabited world exposes one deterministic overlapping lattice whose neighboring centers are approximately 384 km apart. Candidate footprints are sampled offline against the semantic land mask and enter the runtime catalog only when they contain more than 10% land.
- The runtime picker draws no candidate markers and never scans the global roster on pointer movement. It queries a compact spatial bucket index, cuts one footprint out of one Atlas dimming layer, and compiles no Regional geography until commitment.
- Broad regional cultures are soft gameplay traditions assigned from weighted WGS84 anchors, not hard ethnic polygons or claims about bounded peoples. The initial roster intentionally contains 40 umbrellas; the tooltip wording is “Regional culture.”
- Culture-pick boundaries are smooth vector paths whose screen weight grows from a fine Atlas line at fit view to full interactive weight when zoomed close. Hover changes the whole culture tint and adds a cased outline; the overlay keeps constant opacity up to inland boundaries so it never creates a glow or relief halo beneath the line.
- Culture colors are assigned against actual land-border adjacency, so neighboring Culture Fields are deliberately far apart after final display saturation; a color may repeat only where fields do not share a land boundary.
- A mixed-culture Regional Theater reprojects every overlapping Culture Field during Camp placement: the selected field remains untouched, each other field uses its shared Atlas color, hover identifies that entire field, and score-interpolated vector delimiters preserve every pairwise transition and three-way junction. The overlay disappears after founding; the exact clicked WGS84 position remains the authoritative eligibility check.
- Re-dicing selects a nearby land-qualified Theater of the same regional culture and changes the procedural opening seed. It never changes physical terrain, coastlines, elevation, or biome classification.

## Settled spatial interaction direction

### Culture identity model

- Each of the 40 Regional Cultures has one defining Legacy, one coupled Tradeoff, two gameplay focuses, Homeland Acclimatization, and one Tribal Age Signature Knowledge unlock. Profiles are loaded once from a dedicated catalog rather than copied into every Theater candidate.
- Culture mechanics represent learned traditions, institutions, and environmental knowledge rather than biological or permanent ethnic traits. Balance values and names remain a first-pass design set pending historical review.
- Homeland Acclimatization is already authoritative simulation state: a Tribe carries deterministic per-terrain modifiers and its Scouts apply them after the base terrain penalty. Other profile rules are specified and visible but will activate only as their systems (trade, warbands, food, construction, diplomacy) are implemented.

- The Regional Theater remains the finest playable view in every era.
- The player places Sites, not the internal buildings of a settlement.
- A Camp upgrades in place into a Village and potentially later Settlement tiers.
- The chosen tribe/people constrains or recommends a Homeland on the Atlas. The player selects a Regional Theater within the allowed pick area, may re-dice its generated starting conditions, then commits and chooses the exact valid Camp site within it.
- Farms and Mines are Production Sites placed according to geography, access, and resource conditions.
- Routes emerge from traffic between Sites. Beaten Paths strengthen with use and can fade when abandoned.
- Authoritative road generation uses aggregate route demand; it does not require simulating every traveler.
- The first Regional Theater slice contains one player-controlled Camp and multiple asymmetric rival Camps; rival does not automatically mean at war.

## Current Regional Theater implementation

- The startup shell is a survey-folio main menu laid over the dim Atlas. It opens before map interaction, returns as a non-destructive Resume menu, and exposes persistent interface scale, map-detail LOD bias, and Field Survey visibility settings. Escape and the in-game Menu control use the same shell.

- The global catalog currently contains 1,492 overlapping 768 km Theater choices across inhabited land. Every retained candidate has more than 10% sampled land.
- It renders at 93.75 metres per pixel in an ellipsoidal azimuthal-equidistant projection.
- The compiler enforces a maximum projection scale error below the 0.13% target.
- The visual pyramid has 1,024, 2,048, 4,096, and 8,192 pixel levels made of 512 pixel tiles.
- Regional land, minor islands, and lakes are rasterized from Natural Earth 1:10m vectors directly onto the 93.75 metre Theater grid. The compact global Surface Cover raster supplies biome categories but never supplies a Theater coastline; this prevents kilometre-scale overview cells from becoming visible coast steps.
- The founding Atlas uses pre-rendered raster LODs split into bounded chunks. The renderer loads only the LOD and chunks intersecting the camera plus a small prefetch halo, retaining a bounded texture cache rather than allocating one oversized global texture. The current 2,048, 4,096, and 8,192 pixel relief levels prove the approach; higher Atlas LODs require genuinely higher-resolution geography rather than upscaling the Natural Earth overview.
- The pick phase streams the existing 2,048/4,096/8,192 Atlas LOD pyramid once. Hover changes only one reusable dim mask and dashed outline; it does not allocate per-candidate sprites or textures. An uncached committed region is compiled on demand to 8,192² and then reused as an immutable cached derivative.
- A shared 250 metre semantic grid stores signed elevation, terrain, vegetation, and Available Moisture in 128²-cell (32 km) chunks. Pointer survey and route preview load only nearby chunks; gameplay startup assembles and transfers the complete grid once to the worker. Movement, line-of-sight, fog memory, server filtering, farming, and future RL observations use these same canonical cells.
- Founding a Camp deterministically places eight asymmetric rival Camps on valid separated land cells inside the committed Theater. The same Theater roll and founding coordinates produce the same rivals, population, Warriors, influence radii, and player-relative diplomatic stances.
- Geographic labels and balance values are provisional; historical validation is deliberately deferred to its own research pass.
- Combat state is represented at the Tribe/relationship boundary, but Warband movement and combat resolution are not implemented yet.
- Fog of war uses three states: unknown terrain is completely concealed by an opaque neutral-charcoal field, explored terrain remains as muted geographic memory, and currently visible terrain is full-color. The unknown field fills the viewport so a Regional Theater never reads as a square tile against a separate background.
- The Tribal Age fog treatment is a static, terrain-independent pixel hatch across the entire unknown viewport. The hatch thins in crisp density bands near explored terrain, uses no blur, shader, or animation, and never derives decoration from concealed geography.
- Every player has one current-visibility bitset and one persistent explored bitset over the semantic grid. All controlled observers union into those masks before rendering, so different sources and overlapping viewsheds cannot cut holes into one another.
- Live terrain visibility is elevation-aware. The deterministic outward horizon sweep accounts for observer height, intervening terrain, Earth curvature, and 13% atmospheric refraction, with an 80 km clear-air processing limit. A hilltop can reveal plains below until the physical horizon or another ridge blocks them.
- Terrain visibility and entity detection are separate. Camps detect entities within 10 km, Villages within 20 km, and Scouts within 3 km, but all reveal terrain according to the physical viewshed. A person observes from 1.75 m, a Village from 6 m, and a Scout Post raises its Settlement lookout to 12 m instead of adding an abstract radius bonus.
- A Settlement observes from an occupied 1 km radius footprint rather than an infinitesimal point. Its center plus 360 perimeter samples are resolved onto unique sight-source cells, every 250 m semantic cell whose center lies inside the footprint is always revealed, and detection distance remains measured from the Settlement center.
- Strict line-of-sight is shaped into an art-directed Visibility Envelope before it changes player knowledge: any physical LOS is accepted through 6 km, 10% perimeter support is required from 6-30 km, and 25% beyond 30 km. A one-cell morphological closing fills pinholes and narrow cuts, while detached four-connected components under 256 cells (64 km²) are removed unless connected to the observer footprint.
- The fog renderer applies the established Scale2x pixel-art contour rule twice to the 250 m gameplay mask and maps it onto the 93.75 m render. This creates materially smoother crisp diagonal detail without blur or animation, while the authoritative player-knowledge mask remains unchanged.
- Fog is an information boundary, not only a visual overlay: the local worker filters unseen Tribes, Camps, and relationships out of the player snapshot before transport.
- The Regional Theater camera supports up to 32× fit-relative zoom. Middle-button drag pans until any Theater edge reaches the viewport center, allowing deliberate inspection beyond the rendered square; the World Atlas remains fully contained. Left click or drag selects; right click issues movement orders. Camp symbols remain at least 1.5× their base screen size and grow only to a restrained 2.5× cap; map labels and the full HUD use the larger 150% interface scale.
- Player knowledge is authoritative scenario/simulation state. Settlement buildings and mobile Scouts affect visibility there, and Scout movement records explored cells rather than keeping memory only in the renderer. The worker sends the 3,072² visibility grid only when its revision changes, not on every fixed tick.
- Pausing freezes authoritative simulation ticks. Commands may be issued while paused, but remain queued until play resumes; repeated move orders for the same Unit in one pending tick coalesce to the newest destination instead of advancing time or accumulating redundant work.
- A newly issued Unit destination is previewed optimistically in the renderer as soon as the command is sent, including while paused. The simulation remains authoritative and replaces the preview when it accepts the queued order on a later tick.
- A compact Field Survey ledger sits above the scale and reports the hovered semantic Biome, signed elevation, nearby Unit or Settlement, Settlement works, organic influence owner, and player-relative allegiance. It queries the same elevation, entity snapshot, and deterministic influence boundary used by gameplay; unexplored cells return only "Undiscovered" and never leak hidden geography or ownership.
- Visibility processing is spatially bounded. Elevation LOS uses a deterministic averaged 500 m LOD, expands the result back onto 250 m knowledge cells, and restores the exact fine-grid 1 km observer interior. The worker shapes only combined viewshed bounds, while the client contours only occupied mask regions and computes the hatch-distance field within a 128-cell halo. Empty portions of the 3,072² grid receive no per-revision pixel work.
- Clicking the player's Camp opens Camp Works with Works and Train ledgers. The first Settlement Building is the Scout Post; the first trainable Unit is one Scout per Camp.
- The player begins with 100 population and zero Warriors. Training a Scout assigns one resident to the Unit and leaves 99 in the Camp.
- A Scout has a 1 km occupied visibility footprint sampled from 360 perimeter points, a 3 km entity-detection radius, elevation-aware terrain viewsheds, and a deterministic destination order. The full footprint interior is always revealed, matching the Camp model.
- One fixed simulation tick equals one world minute. The Tribal Age scenario begins at 06:00 on 1 March 10,000 BCE; time advances only while authoritative ticks run, so pausing also freezes the calendar. At the current 10 ticks per real second, a world day takes 144 real seconds at 1×.
- A normal trained Scout marches continuously from 06:00 to 18:00 without an automatic hourly halt, then camps overnight. Preview and Unit-panel ETAs include overnight rest.
- Scout pace uses the empirical median trained-wildland-firefighter slope curve. The elevation grid supplies continuous directional steepness—uphill and downhill differ—while separate Terrain and Vegetation grids supply footing and cover. Flat moving speeds are approximately 4.5 km/h on plains or firm desert, 4.2 km/h in open forest, 1.5 km/h in dense jungle, 3.7 km/h on tundra, and 2.5 km/h on permanent ice. Water and slopes above 45 degrees are impassable.
- Homeland Acclimatization remains an explicit culture-specific multiplier after physical slope and surface pace; it no longer substitutes a broad biome percentage for travel physics.
- Right-click replaces a Scout's route; Ctrl-right-click appends an authoritative waypoint. Queued waypoints survive pause/resume and appear as one connected route above even unexplored fog, without revealing the concealed geography below.
- Terrain, vegetation, and elevation are compiled into fixed 32 km semantic chunks. Movement rules never sample relief-render colors, keeping the same results in the browser worker, multiplayer server, tests, and RL workers.

### Terrain and natural features

- The deliberately small base Terrain roster is Water, Plains, Hills, Mountains, Desert, Tundra, and Permanent Ice.
- Forest and Jungle are Vegetation features with sparse, light, moderate, and dense cover. They may overlay plains, hills, mountains, desert, or tundra instead of replacing the underlying Terrain.
- Rivers are connected minor/major Natural Features compiled from natural OpenStreetMap hydrography. They cross Terrain rather than becoming Water cells. Automatic Horton-Strahler stream order, OSM's river/stream distinction, and explicit metric width select only strategically prominent channels for display; no named-region list or hand calibration participates.
- Regional hydrography uses the pinned 1 August 2026 OpenStreetMap snapshot distributed as checksum-verified Geofabrik PBF extracts. The offline compiler automatically selects the smallest covering leaf extracts, streams natural `river`, `stream`, and `tidal_channel` ways, rejects canals, ditches, drains, engineered waterways and `man_made`/`artificial` features, and records both source checksums and a normalized network hash in every Theater manifest. Unnamed and small channels remain drainage inputs even when they are not drawn.
- The browser never parses PBF data. It receives pre-rendered LOD tiles, a compact projected centerline file containing only visible Rivers, and chunked Available Moisture. Small perennial, seasonal, and intermittent drainage therefore influences settlement and farming without filling the map with blue lines.
- Procedural DEM drainage is reserved as the canonical hydrology provider for fictional/custom maps, generated basin-wide at source resolution and then clipped into Regional Theaters. It should not silently invent missing Earth waterways, especially in deltas, wetlands, and flat coastal terrain where plausible-looking drainage is often wrong.
- Biome is a player-facing derived description, not another authoritative grid. Examples include Woodland, Forested Hills, Rainforest, Taiga, and Permanent Ice.
- Regional Theater render tiles bake LOD-aware River presentation into the static pyramid, while projected centerlines supply deterministic hover-survey and future crossing semantics. Tidal channels never contribute freshwater; intermittent and seasonal channels contribute less and are visible only when they qualify as major.
- Founding-era physical geography contains only unambiguous natural drainage. Modern canals and ambiguous unnamed cartographic linework are excluded from both Atlas and Regional Theater compilation, and river strokes stop at the physical coastline; constructed canals, reservoirs, ports, and reclaimed land should appear only through the evolving simulation when their era and builders make them possible.

## Domain glossary

- **Regional Culture** — a broad, soft gameplay tradition associated with a homeland; it is not a bounded ethnicity, state, or biological category.
- **Legacy** — the single rule that most strongly defines a Regional Culture's recurring gameplay advantage.
- **Tradeoff** — a cost coupled to a Regional Culture's way of organizing or using its Legacy; not an arbitrary penalty added only for balance.
- **Homeland Acclimatization** — learned environmental practice that reduces specific terrain movement penalties. It may later be learned or lost through migration and cultural change rather than remaining permanently inherent.
- **Signature Knowledge** — a named Tribal Age technology associated with the culture's established material or institutional practice and its first unique unlock.
- **Gameplay Focus** — one of two short descriptors used to communicate the strategic shape of a culture before the player reads detailed rules.

## Open product decisions

- The exact boundary between the player's persistent civilization identity and its changing tribes, polities, governments, cultures, names, and borders
- The degree of historical grounding and how alternative history changes or unlocks evolution choices
- Whether civilization evolution is selected from a tree, emerges from world-state conditions, or uses curated choices gated by conditions
- Whether a civilization can fragment, merge, be absorbed, become stateless, or re-emerge
- What qualifies as a present-day country for the special-start roster, and how geographically overlapping or very small present-day states are represented
- The core verbs and moment-to-moment decision loop
- What “taking OpenFront's design” specifically means: map interaction, expansion model, real-time pacing, readability, multiplayer dynamics, or another quality
- How 4X structure and Paradox-style grand strategy combine
- What changes between campaigns if the geography stays broadly fixed
- What “detailed” means for the map: visual resolution, number of territories/cells, geographic fidelity, simulation granularity, or all of these
- Victory, defeat, campaign length, and whether campaigns have explicit endings
- Browser-first, native-first, or a shared portable technology with more than one target
- How much cartographic labeling belongs on the physical map, and which labels should be geographic, historical, or generated from the evolving simulation
- The initial regional theater's physical size, terrain resolution, and rules for loading or crossing into neighboring regions
- Which source layers every Campaign Map must provide so Geography Generation can produce equivalent regional terrain automatically
- Multiplayer format, player count, persistence, authority model, and campaign/session expectations
- Whether reinforcement learning is a research tool, an AI-production method, a player-facing feature, or some combination
- The placement rules, operating requirements, and upgrade chains for Settlement and Production Sites
- How traffic demand, terrain cost, route reinforcement, decay, and later road engineering interact
- The exact influence formula, resolution, propagation rules, contesting rules, and how soft tribal influence becomes formal later-era sovereignty
- The taxonomy of starting identity: historical people/culture, individual tribe, gameplay archetype, or multiple separate layers
- What tribal unification mechanically requires and which non-conquest relationships count toward it

## Important design tensions to resolve

### Detailed world versus cheap simulation

A visually and geographically detailed map does not require equally fine simulation. We can separate render resolution, interaction regions, and simulation entities. This is likely essential for low-end hardware, fast AI training, and eventual multiplayer.

### World atlas versus tribal-scale geography

The whole-Earth atlas is appropriate for choosing a homeland, understanding distant powers, migration, and later large-state strategy, but it cannot also make a single village spatially meaningful at low cost. Tribal play therefore uses a Regional Theater, roughly hundreds rather than thousands of kilometers across, rendered from the same canonical Earth data. It is not a disconnected scenario map: adjacent chunks can load as expansion reaches them, and the Atlas View remains available as strategic context. Starting village influence should be measured in tens of kilometers, not hundreds. No finer settlement view will be added.

### Depth versus approachability

The likely solution is progressive disclosure and genuinely layered systems: the player begins with a small set of meaningful verbs, then encounters new responsibilities as their state grows. Merely hiding a fully complex game behind menus would not achieve the desired learning curve.

### Fixed Earth versus replayability

If geography is stable, variability may need to come from starting conditions, political actors, resources, institutions, technology, objectives, crises, diplomacy, information, or player-created history. Which of these matter is undecided.

### Single-player first versus future multiplayer and RL

Multiplayer and fast machine-driven simulation do not need to be the first playable focus, but multiplayer is a foundational requirement. The core simulation should therefore be deterministic, command-driven, headless, serializable, replayable, and separate from presentation from the beginning. The multiplayer server-authority model remains undecided.

### Historical identity versus deterministic evolution

The proposed civilization histories should provide recognizable roots and plausible possibilities without implying that a modern state was an inevitable outcome of an ancient tribe. Historical forms can be curated as branching identities unlocked by geography, culture, institutions, religion, government, achievements, and prior choices. The exact model is undecided.

### Many tribes versus many players

The world may contain far more tribes than human players. We need to distinguish player civilizations, special historical lineages, ordinary autonomous tribes, and any non-state population or neutral territory. These terms and roles are not yet settled.

### Homeland and meaningful Camp placement

Choosing a people will eventually recommend or constrain plausible portions of the global Theater catalog. The current founding slice deliberately exposes the whole inhabited Atlas so the overlap, culture, and land-qualification model can be tested end to end. The player previews continuously, selects or re-dices a nearby same-culture Theater, commits, and then chooses a valid Camp site inside it. The final rules that connect a chosen people to allowed starting regions remain an open product decision.

### Cultural identity versus gameplay archetype

A historical identity and a tribal way of life may need to be separate concepts. For example, a people/lineage can determine homeland, names, and potential historical forms, while an archetype such as seafaring raiders, pastoralists, or settled farmers determines initial mechanics. This would permit different playthroughs of the same lineage and avoid treating one temporary way of life as an eternal civilization identity. This separation is a proposal, not a decision.

### Organic influence versus legible control

Territory is an influence field shaped by settlements and potentially by alliances, military strength, culture, and other sources. Early borders may be soft, overlapping, and contested. The design must make dominant control, contested areas, access rights, and the consequences of influence legible without turning the map into visual noise. Later eras can formalize sovereignty while retaining the same underlying spatial model.

### Moisture versus visible hydrography

Hydrological simulation and map presentation are separate. Every trustworthy natural freshwater channel may raise a compact cell-level Available Moisture field, but only strategically prominent networks remain visible and interactive Rivers. Available Moisture is long-term freshwater access—not rainfall, a Biome, or a desirability score—and will support Camp suitability, farming, forage, drought, and arid-culture acclimatization. Salt water is always zero; wetland and difficult-Terrain penalties remain separate.

The offline compiler derives a smooth climate baseline from natural Terrain and Vegetation, then adds drainage influence with diminishing distance. Perennial channels contribute fully, seasonal and intermittent channels contribute less, and tidal channels contribute nothing. Visible Rivers are selected automatically by connected Horton-Strahler order with explicit physical width and the OSM river/stream tag as secondary evidence. Generated maps will provide procedural climate and drainage grids to the same four-input moisture compiler, so Earth and fictional worlds share the gameplay model without place-specific calibration.

## Product development strategy

Development should mirror campaign chronology while always preserving an end-to-end playable game:

1. Build a complete tribal-age game with a minimal but satisfying loop.
2. Add the next historical layer onto that working product.
3. Expand the same stable core verbs and simulation rather than replacing the game at each era.
4. Continue through antiquity, later historical eras, modernity, and the future.

The first tribal-age version still needs its own temporary campaign ending or victory condition so it is a game rather than an unfinished opening chapter.

### Working tribal-era loop

1. Choose a tribe/people, which anchors the start to a corresponding Earth region.
2. Select and optionally re-dice a Regional Theater on the Atlas, then commit to it.
3. Choose a valid site in the committed Regional Theater and found the Camp; rival Camps are generated deterministically around it.
4. Place initial Production Sites and upgrade the Camp into a Village.
5. Let movement between Sites establish the first Beaten Paths.
6. Grow enough local capacity to interact with neighboring tribes.
7. Raid, conquer, negotiate, ally, confederate, or otherwise compete for regional influence.
8. Unify enough tribes/territory to form a larger polity and reach the first civilization evolution.

Only the broad shape is established; resource, population, territory, military, diplomacy, and unification mechanics remain open.

## Research

- [Reference-product patterns](docs/research/reference-product-patterns.md) covers OpenFront, Civilization, Paradox onboarding, map/simulation separation, browser tradeoffs, multiplayer-aware deterministic architecture, and RL-ready boundaries.
- [Minor rivers, streams, and creeks](docs/research/minor-rivers-and-creeks.md) compares OpenStreetMap, HydroRIVERS/HydroSHEDS, Hydrography90m, and terrain-derived drainage, including resolution, topology, licensing, LOD, and a phased compiler plan.

## Next question

Define the first complete conflict loop: how Warriors form a Warband, how a player orders a raid, how travel follows terrain, and what combat can win or lose without overwhelming the approachable opening. Then connect its costs to the Camp-to-Village decision.

## Parking lot

- Reinforcement-learning experimentation
- Multiplayer formats and player counts
- Browser delivery
- Maps beyond Earth
