# Tribal-age battle system and culture roster

Research date: 2026-08-14

## Recommendation

Build combat as a persistent, fixed-tick encounter on the regional Theater map. A
warband remains a strategic unit; when hostile warbands make contact, the simulation
creates a `Battle` aggregate that resolves approach, missiles, close combat, rout, and
pursuit over multiple ten-minute world ticks. The player commands intent, formation,
and pursuit policy rather than individual fighters.

This is the right middle ground for the game:

- it is substantially deeper than comparing a single `warriors` number;
- it makes terrain, scouting, timing, reinforcements, morale, and veteran survival
  matter without opening a separate tactical game;
- it remains cheap enough to run many battles in a deterministic headless simulation;
- it gives an RL policy meaningful decisions with a bounded, hierarchical action
  space; and
- it supports very different cultural flavor without maintaining forty separate
  combat engines.

The central product rule is **morale wins battles; pursuit decides their cost**.
The official *Total War* manuals make casualties, fatigue, numerical pressure,
flanking, and leadership inputs to rout rather than treating every formation as a
bag of hit points ([Rome II morale](https://r2enc.totalwar.com/en/manual/single-player/0087_enc_page_battle_play_phase_conflict_morale/),
[fatigue](https://r2enc.totalwar.com/en/manual/single-player/0088_enc_page_battle_play_phase_conflict_fatigue/)).
The *Field of Glory II* manual similarly says cohesion is more important than raw
casualties and gives rout, rally, and pursuit their own consequences
([official manual, especially sections 14 and 24.9](https://cdn.cloudflare.steamstatic.com/steam/apps/660160/manuals/FOG2_manual_EBOOK.pdf?t=1614686424)).
Those are proven abstractions worth adopting.

## Historical framing: traditions, not timeless ethnic armies

The map's forty cultures are deliberately broad regional traditions, not claims that
the same named peoples existed from the game's prehistoric start through later ages.
The existing [culture research](regional-cultures.md) already notes that familiar
labels such as `norse` are player-facing lineage labels. Combat content must preserve
that distinction.

Use three chronological layers:

1. **Hunter-levy:** the start-of-game layer. Plain hunting spears, clubs, bows,
   slings, or throwing spears; no iconic later identity.
2. **Organized warband:** unlocked through `warband-discipline`. Each culture gets
   the close and ranged pair in the roster below. The names remain ecological and
   descriptive rather than asserting a precise ethnicity.
3. **Historical evolution:** later technology may turn a safe early unit into an
   iconic descendant: Ridge Shield Spears into hoplites, Steppe Bow Hunters into
   mounted composite bowmen, or Village Spearmen into a Yayoi spear levy. These
   upgrades must carry their real date horizon rather than spawning in 10,000 BCE.

Material evidence proves that equipment existed, not that a whole region used one
universal doctrine or that a weapon deserves a particular damage number. For
example, Denmark's National Museum documents Viking-age swords, axes, bows, lances,
spears, shields, helmets, and rare mail, while also showing that wealth constrained
access to them ([National Museum of Denmark](https://en.natmus.dk/historical-knowledge/denmark/prehistoric-period-until-1050-ad/the-viking-age/weapons/)).
That supports a later Norse equipment package, not a prehistoric "Viking unit."
The same caution applies to late written and ethnographic sources everywhere.

Internally, tag every historical package with an evidence tier:

- `A`: dated archaeological object or excavation;
- `B`: contemporary text or depiction, preferably corroborated by objects;
- `C`: later ethnographic or historical analogy; and
- `S`: explicit game synthesis for a broad culture umbrella.

The player does not need to see these codes, but content review and future era work
do.

## Battle loop

### 1. Contact and commitment

A battle begins only between tribes whose diplomatic stance is `war`. `hostile`
allows threats and incidents, not automatic killing. When opposing combat-capable
units enter the engagement distance, create one battle centered on their real map
positions. Nearby units do not teleport into it: they retain their routes and join as
reinforcements only when they physically reach the battle.

Before contact, each unit has persistent doctrine defaults:

- intent: `advance`, `hold`, `skirmish`, or `withdraw`;
- formation: one of the formations it has unlocked;
- missile policy: `fire-at-will`, `conserve`, or `hold`;
- pursuit: `hold-ground`, `controlled`, or `all-out`.

The player may override these while paused. Orders take effect on the next
authoritative tick and never deal damage immediately. This preserves simultaneous
multiplayer and RL decisions.

### 2. Battlefield frontage

Do not build a tactical grid. Sample terrain, vegetation, river crossing, slope, and
relative elevation around the battle center once, then derive a small frontage:

| Ground | Recommended frontage | Character |
|---|---:|---|
| Open plains, dry grassland, gentle desert | 4 | Formations and flanking work freely. |
| Hills, sparse woods, broken shore | 3 | High ground matters; maneuver costs fatigue. |
| Dense forest, jungle, steep hills, ford | 2 | Concealment and short-range troops improve; missiles lose clean lanes. |
| Mountain pass or defended palisade gate | 1 | The defender can delay a larger force; reserves matter. |

One warband occupies one frontage point. Extra units form a reserve, preserving
morale and replacing a routed or withdrawn front unit. A side with spare frontage and
a mobile unit may gain a flank; the player does not drag tiny formations around.
This makes force composition legible without inventing a second map scale.

Official *Total War* guidance uses hills for melee and missile advantage, water as a
movement/combat penalty, forests for concealment, and flanks/rear attacks as decisive
pressure ([Total War Academy: deployment and terrain](https://academy.totalwar.com/battle-deployment-and-battle-terrain/)).
The game should adopt those readable relationships, but calculate them from the
existing Theater elevation, terrain, vegetation, and river data.

### 3. Tick phases

Every ten-minute battle round executes the same ordered pipeline:

1. **Join and withdraw:** eligible reinforcements enter reserve; successful retreats
   leave contact.
2. **Initiative:** scouting, concealment, elevation, fatigue, and doctrine determine
   surprise and who controls range. Resolve this only when the situation changes,
   not as a fresh random roll every tick.
3. **Missile exchange:** ranged units with a lane and ammunition apply light physical
   casualties but meaningful cohesion and morale pressure.
4. **Approach and charge:** intent changes the abstract range band; climbing,
   sprinting, and changing formation add fatigue and cohesion cost.
5. **Close combat:** opposed frontline units exchange bounded losses and cohesion
   shocks. Flank, formation matchup, fatigue, elevation, cover, and experience modify
   the result.
6. **Morale:** casualties, being outnumbered, ally routs, flank pressure, leader or
   standard effects, and the previous exchange's outcome alter morale.
7. **Rout and pursuit:** routed units try to disengage. Pursuers may convert scattered
   fighters into wounds, deaths, captives, and loot, but lose cohesion and gain
   fatigue.
8. **Battle end:** if no side remains willing and able to contest the center, record
   the outcome and release survivors to normal movement or recovery.

This approach/shot/contact/rout sequence is also consistent with established product
patterns: *Age of Empires II* gives melee and ranged units distinct engagement rules
and a readable counter structure ([official guide](https://www.ageofempires.com/learn-to-play/military-and-economy-aoe2/));
*Age of Empires IV* separates ranged aim, windup, reload, minimum range, and maximum
range rather than treating a missile as ordinary melee DPS
([official weapon documentation](https://support.ageofempires.com/hc/en-us/articles/4418736198292-6-Weapons-Masterclass)).

### 4. Explain the result

Each round should produce a compact deterministic battle log, for example:

> Stone Slingers pressure the uphill Forest Spearband: 1 wounded, cohesion -8.
> Dense woods -20% shooting; veteran cadence +10%; exposed flank +15% shock.

Show the three largest positive and negative modifiers, not the full formula. This is
critical for fun, balance debugging, and RL evaluation: surprising outcomes feel fair
when the system names their causes.

## Core abstractions

### Strength and casualties

Replace the definition-only `warriors` contribution with actual unit personnel:

- `fit`: present and able to fight;
- `wounded`: alive but unavailable until recovery;
- `scattered`: fled or separated and may return after the battle;
- `captured`: controlled by the victor and usable in diplomacy; and
- `dead`: permanent population loss.

Do not expose individual hit points. Before a rout, most losses should be wounds,
scattering, and morale damage; all-out pursuit is where deaths and captures become
dangerous. Cap ordinary round losses so a bad seeded roll cannot erase a fresh
warband. Use fixed-point casualty remainders so small six-to-ten-person units can
accumulate fractional expected losses deterministically.

This makes defeat survivable and creates useful choices: a controlled retreat saves
population and veterans, while a reckless pursuit may win captives but leave the
victor exhausted and disordered.

### Morale, cohesion, and fatigue

These are distinct:

- **Morale (0-100)** is willingness to remain. At zero, the unit routs. It falls from
  casualties, losing exchanges, ally routs, flanking, isolation, and overwhelming
  force; it rises slowly in reserve or near a renowned unit.
- **Cohesion (0-100)** is physical order. It changes quickly from movement through
  difficult ground, formation changes, missiles, charges, and close fighting. Low
  cohesion reduces attack and defense before morale necessarily breaks.
- **Fatigue (0-100)** is exertion. Travel, slope, heat/cold without acclimatization,
  charges, firing, melee, and pursuit add it. Holding or resting out of contact removes
  it. Fatigue reduces movement, cohesion recovery, attack cadence, and morale
  resilience rather than causing direct damage.

This separation produces believable stories: steady veterans can be exhausted but
still refuse to run; a fresh ambushed levy can lose cohesion and morale almost at
once. It also matches the proven use of fatigue as a vulnerability multiplier rather
than another health pool in the *Total War* manuals
([Medieval II manual, pp. 52-56](https://cdn.akamai.steamstatic.com/steam/apps/4700/manuals/manual.pdf)).

### Range and ammunition

Use four internal bands, not projectile simulation:

- `distant`: maneuver and observation only;
- `missile`: bows and slings are effective;
- `closing`: javelins and spear-throwers gain their best shock window;
- `melee`: close units fight; most ranged units try to withdraw behind a frontline.

Each ranged archetype has a real-meter effective and maximum range for UI and battle
setup, but the battle resolver compares bands. Bows provide sustained pressure;
slings favor prepared long-range fire; javelins and atlatls deliver fewer, stronger
short-range volleys; blowguns, if introduced later, are stealth hunting tools rather
than a universal battlefield poison cannon.

Track `missileReadiness` from 0-100 as an encounter abstraction for ammunition and
physical shooting effort. `conserve` waits for an effective target; `fire-at-will`
spends readiness freely. It recovers after resupply rather than asking the player to
manage individual arrows or stones.

### Formations

Keep five shared formations with clear tradeoffs:

| Formation | Role | Cost |
|---|---|---|
| Loose order | Concealment, missile avoidance, woods and broken ground | Poor close holding power |
| Line | General-purpose frontage and mutual support | No extreme advantage |
| Spear hedge | Resists frontal charge and protects ranged reserve | Slow turning, weak pursuit, flank-sensitive |
| Shield ring | Missile and morale defense while holding | Low movement and offensive pressure |
| Raiding column | Fast approach, ambush, withdrawal and pursuit | Severe penalty if surprised in the open |

`warband-discipline` unlocks Line and Spear Hedge. Shield Ring also needs appropriate
shield/textile craft. Raiding Column requires food preservation and trail knowledge.
Not every culture gets a new formation; cultural traits alter how the shared set works
in familiar home ground. Official *Rome: Total War* formation rules likewise exchange
speed, attack, missile defense, charge resistance, or flank safety rather than giving
free bonuses ([official manual, pp. 56 and 61-63](https://cdn.akamai.steamstatic.com/steam/apps/4760/manuals/manual_en.pdf)).

### Terrain and weather-ready hooks

Use only relationships the current map can explain:

- relative elevation improves observation and missile effectiveness; climbing adds
  fatigue and weakens a charge;
- forest and jungle provide concealment and missile cover but reduce formed-unit
  cohesion;
- hills reduce frontage and reward `ridgewise` units;
- plains reward lines, maneuver, and `open-country` units;
- river crossings reduce attacker frontage, speed, and cohesion;
- desert, tundra, ice, and dense vegetation use the existing culture
  acclimatization as fatigue resistance, not a second unrelated combat bonus; and
- palisades provide cover and deny flanking until breached or abandoned.

Weather can later modify the same lanes, fatigue, and footing fields. Do not create a
parallel weather-only combat model now.

### Rout, rally, and pursuit

At zero morale a unit routs toward its home settlement, a chosen rally point, or the
nearest safe path. A routed unit remains an entity on the Theater and may rally only
after leaving enemy contact. Reserve veterans can stabilize wavering allies, but no
instant magical rally occurs inside melee.

Pursuit policy is a meaningful pre-commitment:

- `hold-ground`: preserve formation; few extra casualties; secure the objective;
- `controlled`: mobile units pursue until fatigue or distance threshold;
- `all-out`: maximize capture, death, and loot, but accept exhaustion, ambush risk,
  and a delayed return to formation.

The *Field of Glory II* rules explicitly make routing, pursuit, rally restrictions,
nearby cohesion shocks, and flank/rear attacks part of the outcome rather than a
victory animation ([official manual](https://cdn.cloudflare.steamstatic.com/steam/apps/1368870/manuals/FOG2_Medieval_Manual_EN_EBook.pdf?t=1716897287)).

## Compact reusable unit model

Forty cultures must not mean eighty unique mechanical implementations. Use three
close and four ranged archetypes plus eight shared environment/doctrine traits.

Close archetypes:

- `guard-spear`: high holding power and charge defense; modest shock and pursuit;
- `shock`: clubs, maces, axes, or heavy thrusting weapons; strong cohesion damage on
  contact; vulnerable to missiles and failed charges;
- `mobile-raider`: light spear/club fighters; good ambush, flank, withdrawal, and
  pursuit; weak in a prolonged frontal line.

Ranged archetypes:

- `bow-skirmisher`: sustained medium-range pressure and concealment;
- `slinger`: strong prepared range and accuracy, weak when rushed;
- `javelin-skirmisher`: mobile, short range, high closing shock;
- `atlatl-skirmisher`: deliberate short-to-medium throwing-dart attack, with a
  stronger first volley and slower cadence.

Shared traits:

- `shorewise`, `ridgewise`, `woodwise`, `riverwise`, `open-country`, `heatwise`,
  `coldwise`, and `adaptable`.

An archetype owns the formula and counter relationships. A culture unit supplies its
name, trait, balanced stat offsets, graphics, and later technology evolution. A
specialty should normally move two or three values by 5-15%, never invent a new
subsystem.

## Exact 40-culture roster

The following IDs exactly match
[`public/maps/cultures/manifest.json`](../../public/maps/cultures/manifest.json).
The two names in each row are the **safer organized-warband names** suitable for the
Tribal age. The last column records historical caveats or later iconic branches; it
is not permission to spawn that later equipment at game start. This table can map
directly to `culture-military.json` fields `cultureId`, `close.name`,
`close.archetype`, `ranged.name`, `ranged.archetype`, and `trait`.

| cultureId | Close unit / archetype | Ranged unit / archetype | Trait | Historical caveat or later evolution |
|---|---|---|---|---|
| `norse` | Fjord Spearband / `guard-spear` | Pine Bow Hunters / `bow-skirmisher` | `shorewise` | `norse` is a much later identity. Viking axes, swords, and mail belong to a dated late evolution, not the prehistoric roster ([Danish museum](https://en.natmus.dk/historical-knowledge/denmark/prehistoric-period-until-1050-ad/the-viking-age/weapons/)). |
| `atlantic-celtic` | Upland Spearband / `guard-spear` | Hill Slingers / `slinger` | `ridgewise` | Broad Atlantic synthesis. British chariot skirmishing is a late, local branch rather than a universal Celtic trait ([Caesar, *Gallic War* 4.33](https://www.perseus.tufts.edu/hopper/text?doc=Perseus%3Atext%3A1999.02.0001%3Abook%3D4%3Achapter%3D33)). |
| `continental-germanic` | Forest Spearband / `guard-spear` | Javelin Skirmishers / `javelin-skirmisher` | `woodwise` | Tacitus describes spears usable close or thrown and multiple missiles, but he is a Roman outsider writing in 98 CE; treat this as a later branch ([*Germania* 6](https://www.perseus.tufts.edu/hopper/text?doc=Perseus%3Atext%3A1999.02.0083%3Achapter%3D6)). |
| `balto-slavic` | Clearing Spearband / `guard-spear` | Forest Bow Hunters / `bow-skirmisher` | `woodwise` | Both label and pairing are broad early synthesis; axes can upgrade after hafted-polished tools. |
| `uralic-forest` | Taiga Spear Hunters / `mobile-raider` | Birch Bow Hunters / `bow-skirmisher` | `coldwise` | A vast multi-people umbrella; weapon names are ecological, not an asserted common army. |
| `hellenic-balkan` | Ridge Shield Spears / `guard-spear` | Stone Slingers / `slinger` | `ridgewise` | The hoplite panoply and close overlapping-shield phalanx are 7th-6th century BCE capstones ([Met](https://www.metmuseum.org/essays/warfare-in-ancient-greece)), not a start unit. |
| `western-mediterranean` | Dry-Hill Shield Spears / `guard-spear` | Island Slingers / `slinger` | `heatwise` | Broad Iberian/Italian/island synthesis. A later Balearic specialization must be geographically and chronologically labeled. |
| `anatolian-caucasian` | Pass Spear Guard / `guard-spear` | Mountain Bowmen / `bow-skirmisher` | `ridgewise` | Extremely diverse umbrella; later metal armor and stronghold retinues require their own dated branches. |
| `levantine-mesopotamian` | Reed-Shield Spearmen / `guard-spear` | Reed Bowmen / `bow-skirmisher` | `riverwise` | Neolithic weapons begin in stone/wood; copper, bronze, cavalry, swords, and composite equipment are later progressions ([Met Near Eastern survey](https://resources.metmuseum.org/resources/metpublications/pdf/Ancient_Near_Eastern_Art_The_Metropolitan_Museum_of_Art_Bulletin_v_41_no_4_Spring_1984.pdf)). |
| `arabian` | Oasis Spear Raiders / `mobile-raider` | Desert Bow Hunters / `bow-skirmisher` | `heatwise` | Pan-Arabian game synthesis; camel or horse troops must wait for domestication and riding technology. |
| `iranian-highland` | Plateau Spear Guard / `guard-spear` | Horn Bowmen / `bow-skirmisher` | `ridgewise` | Later Iranian and steppe composite bows are not a prehistoric default; unlock them through bow craft and mounted warfare. |
| `eurasian-steppe` | Herd Spear Raiders / `mobile-raider` | Steppe Bow Hunters / `bow-skirmisher` | `open-country` | Scythian mounted archery is first-millennium BCE inspiration; horse archers and feigned retreat require horse and composite-bow technology ([Met Scythian survey](https://www.metmuseum.org/essays/scythian-art)). |
| `siberian` | Taiga Spear Hunters / `mobile-raider` | Taiga Bow Hunters / `bow-skirmisher` | `coldwise` | Broad taiga synthesis. Recurve/composite construction is an upgrade, not assumed at start. |
| `indo-gangetic` | Floodplain Shield Spears / `guard-spear` | Cane Bowmen / `bow-skirmisher` | `riverwise` | Broad ecological synthesis across many periods; chariots, elephants, and metal-age bows are later content. |
| `dravidian` | Tableland Spearband / `guard-spear` | Bamboo Bowmen / `bow-skirmisher` | `heatwise` | Linguistic-regional umbrella, not one timeless military tradition; avoid projecting later Tamil names backward. |
| `himalayan-tibetan` | Pass Spear Guard / `guard-spear` | Horn Bowmen / `bow-skirmisher` | `ridgewise` | The label covers many highland peoples. Surviving Tibetan armor and mounted bow evidence is much later and belongs to future eras ([Met](https://www.metmuseum.org/essays/tibetan-arms-and-armor)). |
| `east-asian-heartland` | Millet Levy Spearmen / `guard-spear` | Hunting Bowmen / `bow-skirmisher` | `adaptable` | Synthetic regional umbrella. Dagger-axes and crossbows are later research; surviving crossbow fittings are dated, not timeless ([British Museum Eastern Zhou fitting](https://www.britishmuseum.org/collection/object/A_1934-0216-1)). |
| `japonic` | Village Spearband / `guard-spear` | Island Bow Hunters / `bow-skirmisher` | `shorewise` | Jomon bows/spears are best treated as hunting tools; purpose-built group warfare and bronze weapons belong to a Yayoi evolution ([National Museum of Japanese History](https://archive.rekihaku.ac.jp/exhibitions/project/old/140715/i002.html)). |
| `mainland-southeast-asian` | Bamboo Spear Guard / `guard-spear` | Jungle Javelin Hunters / `javelin-skirmisher` | `woodwise` | Broad mainland synthesis. Dong Son metal swords and crossbows are later regional upgrades, not start gear ([Met Dong Son sword](https://www.metmuseum.org/art/collection/search/25370)). |
| `maritime-austronesian` | Outrigger Spear Raiders / `mobile-raider` | Shore Javelin Skirmishers / `javelin-skirmisher` | `shorewise` | Broad maritime synthesis. Later blades, shields, and raid traditions are supported ethnographically but cannot date the prehistoric roster ([National Museum of the Philippines](https://www.nationalmuseum.gov.ph/our-collections/ethnology/weapons-and-shields/)). |
| `amazigh-saharan` | Dune Spear Raiders / `mobile-raider` | Desert Javelin Skirmishers / `javelin-skirmisher` | `heatwise` | Amazigh and Saharan is a large synthetic umbrella. Horse/camel lancers and metal swords are later branches. |
| `nile-valley` | Hide-Shield Spearmen / `guard-spear` | Nile Bowmen / `bow-skirmisher` | `riverwise` | Strong progression anchor: arrowheads and maceheads are attested 4000-2000 BCE; bows/shields and then spears/axes appear in later periods ([UCL Petrie Museum](https://www.ucl.ac.uk/museums-static/digitalegypt/tools/weapons.html)). |
| `horn-east-african` | Escarpment Spearmen / `guard-spear` | Highland Javelin Skirmishers / `javelin-skirmisher` | `ridgewise` | Multi-people regional synthesis; later highland swords, shields, and mounted forces need separate evidence. |
| `sahelian` | Savanna Spear Guard / `guard-spear` | Bow Skirmishers / `bow-skirmisher` | `open-country` | Broad trans-Sahel synthesis. Mounted cavalry and metal prestige arms require later pastoral and metallurgy technologies. |
| `west-african` | Compound Spearmen / `guard-spear` | Forest Bow Hunters / `bow-skirmisher` | `woodwise` | Very diverse umbrella. Do not use a generic "African throwing knife": many museum examples are late, ceremonial, or currency rather than thrown weapons. |
| `bantu-belt` | Homestead Spearmen / `guard-spear` | Woodland Bow Hunters / `bow-skirmisher` | `adaptable` | `Bantu` is a huge language-expansion shorthand, not one army. Iron spearheads and named shield traditions are later local evolutions. |
| `kalahari-cape` | Hunting Spear Band / `mobile-raider` | Light Bow Hunters / `bow-skirmisher` | `heatwise` | Synthetic ecological umbrella; poison effects, where evidenced, should be a researched hunting specialization rather than free damage-over-time. |
| `malagasy` | Highland Spearmen / `guard-spear` | Highland Javelin Hunters / `javelin-skirmisher` | `ridgewise` | Malagasy settlement and cultural formation are much later than the game start; this is a safe highland/maritime synthesis. |
| `arctic-subarctic` | Shore Spear Hunters / `mobile-raider` | Atlatl Hunters / `atlatl-skirmisher` | `coldwise` | Vast umbrella. Arctic spear-throwers support the ranged concept, but a hunting implement is not proof of universal warfare ([British Museum object](https://www.britishmuseum.org/collection/object/E_Am1896-472)). |
| `pacific-northwest` | Cedar Shield Guard / `shock` | Hunting Bowmen / `bow-skirmisher` | `shorewise` | Regional synthesis; plank/wood armor and shields are late local traditions and should be technology/material dependent. |
| `eastern-woodlands` | Woodland Club Guard / `shock` | Bow Hunters / `bow-skirmisher` | `woodwise` | Multi-nation umbrella. Later confederacy, palisade, club, and bow packages need local era research. |
| `plains-prairie` | Prairie Spearband / `mobile-raider` | Bow Hunters / `bow-skirmisher` | `open-country` | This is explicitly pre-horse. Mounted Plains warfare follows reintroduction of the horse and belongs to a much later evolution. |
| `desert-southwest` | Dryland Spearmen / `guard-spear` | Atlatl Hunters / `atlatl-skirmisher` | `heatwise` | Broad ecological synthesis. Pueblo defenses and later bow traditions require settlement/era gates. |
| `middle-american` | Village Spearmen / `guard-spear` | Atlatl Skirmishers / `atlatl-skirmisher` | `heatwise` | The umbrella includes Mesoamerica and Caribbean anchors. Obsidian-edged macuahuitl and Aztec equipment are Postclassic late evolutions, not tribal spawn units ([British Museum atlatl, 1400-1521](https://www.britishmuseum.org/collection/object/E_Am-5226)). |
| `andean` | Upland Mace Guard / `shock` | Andean Slingers / `slinger` | `ridgewise` | One of the strongest early anchors: slings occur with some of the earliest American textiles, and maces/spears are also documented ([Met](https://www.metmuseum.org/art/collection/search/315748)). |
| `amazonian` | Hardwood Club Guard / `shock` | Forest Bow Hunters / `bow-skirmisher` | `woodwise` | Extremely broad synthesis. Blowguns are a possible later stealth-hunter branch, but current museum evidence is late ethnographic ([NMAI Bora blowgun](https://americanindian.si.edu/collections-search/object/NMAI_218245)). |
| `southern-cone` | Open-Country Spear Raiders / `mobile-raider` | Bow Hunters / `bow-skirmisher` | `open-country` | Broad Pampas/Patagonia synthesis; mounted raiders are post-contact or otherwise later content, not a start trait. |
| `papuan-melanesian` | Ridge Spear Warriors / `guard-spear` | Forest Bow Hunters / `bow-skirmisher` | `woodwise` | Synthetic regional umbrella across exceptional diversity; avoid one universal "Melanesian" weapon story. |
| `polynesian` | Island Club Guard / `shock` | Sling Skirmishers / `slinger` | `shorewise` | Slings, spears, and clubs are locally supported in later Polynesian evidence, but not universal across every island; Maori taiaha and Hawaiian gear are separate late branches ([British Museum Hawaii guide](https://www.britishmuseum.org/exhibitions/hawaii-kingdom-crossing-oceans/hawaii-large-print-guide)). |
| `aboriginal-australian` | Shield-and-Club Guard / `shock` | Spear-Thrower Skirmishers / `atlatl-skirmisher` | `heatwise` | The label is exceptionally broad. Australian Museum evidence distinguishes hand-to-hand and missile shields and warns that technologies vary regionally and chronologically ([overview](https://australian.museum/about/history/exhibitions/indigenous-australians/), [Cape York shield](https://australian.museum/learn/cultures/first-nations-collections/wooden-shield-from-cape-york-c1893/)). |

## Counter relationships

Avoid a hard rock-paper-scissors damage table. Use soft, explainable situational
counters:

- ranged skirmishers pressure slow shock units before contact;
- mobile raiders catch exposed ranged units and exploit flanks;
- guard spears deny frontal charges and protect ranged reserves;
- shock units break guard units that are tired, disordered, flanked, or already
  pinned;
- loose order reduces missile pressure but gives up close holding power;
- dense terrain favors concealment and mobile skirmishing while reducing clean
  formations and missile lanes.

This keeps every culture's close-plus-ranged pair viable while rewarding mixed forces.
The player wins by creating the condition for a counter, not merely selecting a unit
whose hidden tag grants double damage.

## Experience and technology upgrades

### Experience: learned behavior

Use four ranks: `untried`, `proven`, `veteran`, and `renowned`. Experience improves
morale floor, cohesion recovery, order-change speed, and formation proficiency more
than raw lethality. At `proven` and `veteran`, choose one perk from a small
archetype-specific pair:

- close: `steady-under-missiles` or `hard-charge`; then `shield-discipline` or
  `controlled-pursuit`;
- ranged: `rangefinding` or `quick-withdrawal`; then `veteran-cadence` or
  `concealed-volley`.

`renowned` grants a small nearby rally/steadiness effect, making a surviving unit a
social asset rather than a superhuman damage dealer. Official *Rome II* experience
also improves morale and combat competence rather than changing a unit into a new
weapon type ([experience manual](https://r2encv2.totalwar.com/en/manual/single-player/0028_enc_page_campaign_play_military_experience/index.html)).

Award XP for threat-adjusted participation, holding an objective, executing an
order, surviving a difficult withdrawal, and winning against a credible opponent.
Cap pursuit XP and give almost none for farming broken or vastly weaker units. When
green replacements refill a veteran unit, dilute its XP in proportion to the veteran
survivor share. This makes preserving experienced fighters strategically meaningful
and closes an obvious RL reward exploit.

### Technology: equipment and organization

Technology changes available equipment and orders; it should not duplicate XP:

| Existing technology | Combat effect |
|---|---|
| `cooperative-hunts` | Establishes hunter levy and basic coordinated missile fire. |
| `cordage-basketry` | Better sling cords, bowstrings, quivers, and missile readiness recovery. |
| `hafted-polished-tools` | Reliable stone/wood close weapons and the first shock loadout. |
| `warband-discipline` | Organized culture pair, Line, Spear Hedge, reserve rotation, controlled withdrawal. |
| `food-preservation` + `trail-networks` | Reduced campaign fatigue and reliable reinforcement/pursuit supply. |
| `weaving` | Padded protection, shield bindings, and lower formation fatigue. |
| `oral-tradition` | Battle signals and improved rally/order changes. |
| `defensive-earthworks` | Palisade cover, restricted attacker frontage, protected rally point. |
| `copper-working` | Limited copper-edged elite loadouts produced by a workshop; never an automatic army-wide damage upgrade. |

Add only three combat-specific technologies to the current tree if playtests need
more progression:

- `missile-craft` after `cooperative-hunts` + `cordage-basketry`;
- `shield-craft` after `hafted-polished-tools` + `weaving`; and
- `battle-signals` after `warband-discipline` + `oral-tradition`.

Do not force the existing civilian culture special technologies into combat bonuses.
Iconic historical units should come from later, cited military evolution technologies
with explicit dates.

## Determinism, multiplayer, fog of war, and RL

The current repository is well positioned for this system, but combat state must join
the same authoritative boundary:

- [`GameSimulation`](../../src/core/GameSimulation.ts) already sorts commands by
  player and sequence before applying them. Combat orders should update intent only;
  after all players' commands and movement are applied, the resolver snapshots battle
  participants and resolves every battle in ascending `BattleId` and `UnitId` order.
  This prevents first-command damage from biasing simultaneous play.
- Every stochastic residual must derive from a stable key such as
  `seed + battleId + round + attackerUnitId + defenderUnitId + effectKind`. Do not
  consume a mutable global RNG. Keep variance small and bounded. The *Field of Glory
  II* designer specifically reports replacing overly random hit results to reduce
  wildly against-the-odds outcomes
  ([designer explanation](https://forum.slitherine.com/viewtopic.php?p=679787)).
- Add battle, personnel, morale, cohesion, fatigue, XP, perks, formation, loadout,
  and pursuit state to the world hash. A replay with the same seed and commands must
  remain bit-identical.
- Use integer or fixed-point arithmetic in the authoritative resolver. Rendering may
  interpolate but never feeds state back into combat.
- [`PlayerWorldSnapshot`](../../src/core/model.ts) must expose full combat detail only
  for controlled or actively observed units. Last-known enemy strength, morale, and
  battle state freeze like current unit intelligence. A battle sound/rumor may reveal
  that fighting exists without leaking exact participants.
- [`LegalActions`](../../src/ai/LegalActions.ts) must advertise only orders for
  controlled units and observed battles. Spatial movement and battle decisions remain
  hierarchical rather than enumerating every possible target cell.
- Extend the RL reward signals with own personnel lost, own units routed, objectives
  held, settlements defended/captured, and final battle/war outcome. Enemy casualties
  are observable reward input only when the agent could observe them. Do not reward
  raw kills per tick; that encourages endless farming, refusal to accept peace, and
  suicidal trades.
- A lost battle does not terminate an episode. Only authoritative tribe elimination,
  surrender, unification, or future victory rules set `terminated`; a training horizon
  remains `truncated`.

Recommended RL curricula, in order:

1. one close unit against one close unit on level open ground;
2. close plus ranged pairs and legal order masks;
3. fatigue, retreat, rally, and pursuit;
4. hills, forest, rivers, and ambush under partial observation;
5. reinforcements and settlement defense; and
6. multi-agent self-play where diplomacy determines when combat is legal.

Always train against the exact production resolver. No fast approximate combat model
may sit behind the RL adapter.

## Repository gaps found

The current system has a good deterministic base but no combat aggregate yet:

- `Unit` stores movement and terrain state but not personnel, morale, fatigue,
  experience, formation, equipment, or battle membership.
- `TribalUnitDefinition` has a single `warriors` contribution. The current seven-unit
  roster has scouts, hunting parties, slingers, spear/axe/raiding warbands, and a
  village guard, but those are not yet combat roles.
- The technology tree already contains the correct seams: `cooperative-hunts`,
  `warband-discipline`, `hafted-polished-tools`, `weaving`,
  `defensive-earthworks`, and `copper-working`.
- Diplomacy already distinguishes `hostile` from `war`; automatic battle should use
  only `war`.
- The event system already uses deterministic seeded rolls and has a conflict
  category. Combat should emit reactive events (`battle-begun`, `unit-routed`,
  `battle-won`, `captives-taken`, `settlement-sacked`) through that system, while the
  per-round log stays non-blocking.
- The RL observation is player-filtered and legal-action masked. New combat commands,
  state, and reward signals must extend that interface rather than bypass it.

## Minimum complete slice

Implement the smallest end-to-end version before adding all content:

1. Add data-driven archetype, formation, trait, and Hellenic pair definitions. Extend
   `Unit` with `fit`, `wounded`, `morale`, `cohesion`, `fatigue`, `experience`,
   `formation`, `intent`, `missileReadiness`, `pursuitPolicy`, and `battleId`.
2. Add `Battle`, `SetCombatDoctrineCommand`, and `IssueBattleOrderCommand`. Detect only
   open-field battles between tribes at `war`; resolve in fixed tick order.
3. Implement Line and Loose Order, guard spear and slinger archetypes, open/hill/forest
   terrain, morale rout, controlled retreat, and the three pursuit policies.
4. Add one readable battle panel, a map marker, round log, pause-safe commands, and
   frozen last-known enemy battle intelligence.
5. Add XP ranks plus `warband-discipline` and `hafted-polished-tools` upgrades. Emit
   battle events and update diplomacy consequences.
6. Extend state hashing, snapshots, worker protocol, legal RL actions, observations,
   reward signals, deterministic replay tests, simultaneous-order tests, fog-leak
   tests, and long headless performance tests.
7. Only when that Hellenic slice is fun and deterministic, populate the exact forty
   culture rows above and add the remaining shared archetypes. The data contract stays
   unchanged; only catalog content grows.

This slice is complete enough to answer the risky design questions--whether ranged
support, morale, terrain, retreat, and pursuit feel good on the regional Theater--while
preserving a working product at every layer.

## Source limitations

Historical sources are highly uneven. The roster uses direct or institutional sources
where strong anchors exist: Greek equipment and formation
([Met](https://www.metmuseum.org/essays/warfare-in-ancient-greece)), Near Eastern
weapon development ([Met](https://resources.metmuseum.org/resources/metpublications/pdf/Ancient_Near_Eastern_Art_The_Metropolitan_Museum_of_Art_Bulletin_v_41_no_4_Spring_1984.pdf)),
Egyptian excavation material ([UCL](https://www.ucl.ac.uk/museums-static/digitalegypt/tools/weapons.html)),
Andean slings ([Met](https://www.metmuseum.org/art/collection/search/315748)),
Philippine weapons and shields ([National Museum of the Philippines](https://www.nationalmuseum.gov.ph/our-collections/ethnology/weapons-and-shields/)),
and Aboriginal Australian regional variation
([Australian Museum](https://australian.museum/about/history/exhibitions/indigenous-australians/)).

Many other pairings are deliberately `S`-tier gameplay syntheses because the culture
itself combines many peoples or because the surviving evidence is late. That is safer
than presenting a sparse elite grave, a hostile outsider's text, or a nineteenth-
century collection as a timeless description of a continent. All exact combat numbers
remain balance hypotheses and should be tuned through deterministic simulations and
play, not attributed to the historical sources.
