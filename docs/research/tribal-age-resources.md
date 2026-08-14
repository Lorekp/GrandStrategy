# Tribal-age resources

Research date: 2026-08-14

## Short answer

Use **four settlement stockpiles** in the tribal age:

1. **Food** — consumed by population; surplus supports growth, expeditions, feasts, and warriors.
2. **Timber** — camps, palisades, boats, fires, and most early construction.
3. **Stone** — hearths, durable buildings, fortification, and later monumental construction.
4. **Tools** — a manufactured, slowly wearing stock that improves gathering, farming, construction, and equipment.

The player should initially care mostly about **Food and Timber**. Stone becomes important when the camp becomes a permanent village; Tools become important when specialists and improved production appear. This preserves progressive complexity even though all four resources belong to the same era.

Do **not** turn freshwater, soil fertility, forest biomass, game, fish, clay, hides, fibers, bone, reeds, and every crop into separate stockpile counters. Most should be local environmental conditions or sources that feed the four stocks.

This follows a proven early-game pattern: *Age of Empires IV* teaches a complete opening economy with only Food, Wood, Gold, and Stone, while *Millennia* explicitly starts simple in the Stone Age, lets workers forage directly, and adds depth through improvements and processing chains rather than presenting every good immediately. [Official Age of Empires IV quick-start guide](https://www.ageofempires.com/news/quickstart-guide-age-of-empires-iv/), [official Millennia economy diary](https://www.paradoxinteractive.com/games/millennia/news/economy-part-one), [official Millennia world-and-map diary](https://www.paradoxinteractive.com/games/millennia/news/world-and-map)

## Resource model

| Layer | Contents | Simulation rule | Player interaction |
|---|---|---|---|
| Environmental potential | Moisture/freshwater, fertility, forest biomass, wild-food capacity, fisheries | Continuous or slowly changing field; not carried in inventory | Determines where camps, farms, hunting camps, fisheries, and villages are productive |
| Ordinary sources | Forest, forage, game, fish, workable stone | Renewable, depleting, or locally abundant depending on source | Assign people or place an improvement to produce a core stock |
| Rare deposits | High-quality toolstone first; salt later | Localized and limited; useful for specialization and trade | Survey, quarry/mine, defend, exchange |
| Settlement stockpiles | Food, Timber, Stone, Tools | Stored locally and transported physically | Spend, reserve, raid, trade, or redistribute |
| Social systems | Labor, knowledge, influence, prestige, morale | Capacities or abstract flows, not physical cargo | Govern work, discovery, borders, loyalty, and diplomacy |

Archaeology supports making geography matter without creating dozens of counters. The National Park Service describes a permanent settlement drawn to dependable freshwater and high-quality flint, with food supplied by hunting, gathering, and farming; its flint supported tools and long-distance exchange. [NPS: Antelope Creek Culture](https://www.nps.gov/alfl/learn/historyculture/antelope-creek-culture.htm) Neolithic evidence at Burzahom likewise combines cultivation, hunting, stone and bone tools, pottery, and changing construction techniques rather than a single universal subsistence method. [UNESCO: Neolithic Settlement of Burzahom](https://whc.unesco.org/en/tentativelists/5917/)

## The four stockpiles

### Food

`Food` is the UI name; its sources can include gathered plants, hunted game, fish, shellfish, livestock, and crops without splitting the inventory. Production method still matters: each source can differ in seasonality, labor, risk, depletion, and reliability.

- Food is produced as a **daily/seasonal flow** and stored locally.
- Stored food should spoil unless preservation and storage improve.
- A camp consumes food continuously; an expedition carries a limited ration load.
- Farms do not create a new crop resource. They convert fertility, moisture, labor, seed knowledge, and time into Food.
- Hunting, foraging, fishing, and farming should remain viable together early on. The historical record repeatedly shows mixed subsistence rather than an instant replacement of wild foods by agriculture. [NPS: Antelope Creek Culture](https://www.nps.gov/alfl/learn/historyculture/antelope-creek-culture.htm), [UNESCO: Burzahom](https://whc.unesco.org/en/tentativelists/5917/)

### Timber

Timber covers logs, poles, firewood, and ordinary workable wood at the strategic level. Individual recipes can distinguish construction timber from fuel internally without giving the player two nearly identical inventories.

- Forest biomass is the **source field**; Timber is the hauled stock.
- Harvest lowers local biomass and regrowth restores it slowly.
- Dense forest offers more standing wood but may cost more labor to clear and transport.
- Camp structures, palisades, boats, tool handles, and fires all compete for the same stock, making Timber strategically distinct.

Prehistoric village construction used wood alongside stone, earth, adobe, bark, reeds, and other local materials; some suitable timber required substantial travel or exchange. [NPS: Upper Cliff Dwelling construction](https://www.nps.gov/tont/learn/historyculture/upper-cliff-dwelling-construction-sequence.htm)

### Stone

Stone means **bulk construction material**, not every loose rock and not automatically high-quality toolstone.

- Surface collection supports the first hearths and simple construction.
- A quarry raises output but requires labor, Tools, and transport.
- Because Stone is heavy, proximity should matter more than national ownership; hauling it across a theater should be costly.
- Only unusually productive or valuable sources need visible resource markers. Ordinary availability can be a subtle geology/terrain suitability value.

### Tools

Tools are the first manufactured economic good and the bridge to later eras. A single Tools stock can represent the currently available toolkit—stone, bone, wood, and eventually copper, bronze, iron, and steel—while its quality and recipes change with technology.

- Tools are **produced**, not gathered directly.
- They should wear slowly through work and be consumed in bursts by some construction or equipment orders.
- A tool shortage reduces efficiency rather than instantly stopping all activity.
- Better materials and specialists improve tool quality, durability, and production rate.

Stone tools historically supported butchery, hunting, tree-felling, hide preparation, plant-fiber processing, and woodworking. High-quality flint could justify deep mines and long-distance trade, making tool production a strong early specialization without requiring separate stocks for every implement. [English Heritage: Grime's Graves](https://www.english-heritage.org.uk/visit/places/grimes-graves-prehistoric-flint-mine/history/), [UNESCO: Krzemionki flint-mining region](https://whc.unesco.org/en/list/1599/)

## What should appear in the resource view

The first useful resource view should show **potential and sources**, not current settlement inventories:

- **Forests** — already present; display sustainable wood potential rather than individual trees.
- **Wild food potential** — a restrained heat/tint derived from biome, vegetation, moisture, season, and human pressure.
- **Fisheries** — productive coast, lake, and major-river stretches; not a fish icon every few hundred metres.
- **Construction stone** — only strong quarry opportunities.
- **Toolstone** — rare flint, obsidian, chert, or comparable high-quality lithic deposits.
- **Later: salt** — the first additional strategic/trade resource once preservation and exchange matter.

Moisture/freshwater should remain its own view and feed settlement capacity and farm output. It is a **location constraint and renewable flow**, not a magically global water stockpile. The FAO treats soil-water management, rainwater harvesting, moisture conservation, and distribution as central to rain-fed productivity, which supports using the existing moisture model directly in farm yields. [FAO: Rainfed agriculture](https://www.fao.org/land-water/water/agricultural-water-management/rainfed-agriculture/en)

## Discovery and technology gating

Keep resource existence deterministic; technology changes what a tribe can recognize, evaluate, extract, or process.

1. **Immediately visible when explored:** water access, forests, obvious forage/game signs, fisheries, and surface stone.
2. **Surveyed by scouts:** source quality, seasonal reliability, approximate capacity, and evidence of rare surface toolstone.
3. **Knapping / specialist knowledge:** efficient Tool production and accurate evaluation of lithic quality.
4. **Permanent settlement / masonry:** quarry improvements and meaningful Stone demand.
5. **Cultivation:** farms convert suitable moisture/fertility into Food; later irrigation modifies the same field rather than creating a second farming system.
6. **Mining / prospecting:** deep toolstone, salt, and eventually metal ores become extractable.
7. **Metallurgy:** copper belongs at the late-tribal/Chalcolithic transition; tin and bronze belong after that.

An unexplored deposit should already exist in the simulation seed. Discovery reveals it; it must never reroll the map. That keeps multiplayer deterministic and makes procedural maps fair and auditable.

## Deliberate exclusions

- **Freshwater:** environmental availability and carried expedition supply, not a normal settlement stockpile.
- **Soil fertility:** production potential, not cargo.
- **Game, fish, berries, grain, meat:** distinct source methods producing Food; keep names for tooltips and cultural flavor.
- **Hides, fibers, bone, antler, reeds:** implicit inputs to Tools and buildings. Add one `Craft Materials` pool only if equipment logistics later proves genuinely fun.
- **Clay and mud:** ordinary local building/pottery availability; technology should unlock pottery/adobe without covering the map in clay nodes.
- **Fuel:** part of Timber until charcoal or fossil fuels create a real strategic choice.
- **Livestock:** reproducing herd assets, not an inert resource counter.
- **Gold/currency:** premature for the starting economy. Rare prestige goods can drive diplomacy and exchange before standardized money.
- **Copper, tin, iron:** generate them in world geology from the beginning, but keep them unknown or unusable until the correct technological transition.
- **Named luxury lists:** shells, pigments, amber, turquoise, feathers, incense, and similar goods should initially be one category of locally flavored `Prestige Goods`, not separate global systems.

## Recommended first implementation

Build one end-to-end economy with **Food, Timber, Stone, and Tools**, plus the existing moisture and forest fields. Add wild-food/fish potential, construction-stone suitability, and rare toolstone deposits to procedural theater generation. Make Salt the first post-prototype addition only after local stockpiles, hauling, trade, and preservation already work.

The key design principle is: **few inventories, many geographically different ways to fill them**. That creates cultural and regional variety without early-game accounting overhead.
