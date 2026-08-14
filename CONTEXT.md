# Grand Strategy World Model

This context defines the geography shared by campaign simulation and every map
view. It keeps local tribal play and planet-scale strategy part of one world.

## Language

**Campaign Map**:
The complete, continuous geography in which a campaign takes place. Earth is the
first Campaign Map, but future Campaign Maps may use different geography.
_Avoid_: World map when referring specifically to the dataset or screen

**Atlas View**:
A planet- or campaign-scale presentation of a Campaign Map used for geographic
context and large-scale strategy. It is a view of the world, not a separate
simulation space.
_Avoid_: Main map, overview map

**Regional Theater**:
An accurately scaled local window generated from a Campaign Map for detailed
play. It shares locations, entities, and history with the Atlas View and is the
finest playable spatial view.
_Avoid_: Submap, level, handcrafted region

**Homeland**:
The geographically bounded part of a Campaign Map in which a people may begin.
A Homeland constrains where that people may choose its initial Camp site.
_Avoid_: Spawn point, starting country

**Physical Scale**:
The consistent relationship between a distance in the Campaign Map and the same
distance represented in simulation and a Regional Theater.
_Avoid_: Visual scale

**Geography Source**:
The georeferenced semantic description from which a Campaign Map's views and
terrain are generated. It preserves physical meaning that a painted overview
cannot contain.
_Avoid_: World image, master PNG

**Surface Cover**:
The geographically sourced material covering a location before relief is
applied. It is compiler input from which Terrain and Vegetation are derived;
it is not itself a runtime gameplay category.
_Avoid_: Biome noise, map color

**Terrain**:
The authoritative base ground class of a location: water, plains, hills,
mountains, desert, tundra, or permanent ice. Terrain determines basic
traversal and remains independent from Vegetation and Rivers.
_Avoid_: Biome, forest terrain, river terrain

**Vegetation**:
An independent Natural Feature describing forest or jungle and its density.
Vegetation may cover plains, hills, mountains, desert, or tundra without
replacing the underlying Terrain.
_Avoid_: Forest biome, wooded terrain

**River**:
A connected linear Natural Feature compiled from authoritative hydrography.
A River crosses Terrain rather than replacing it and is classified as minor
or major for presentation and later crossing/navigation rules.
_Avoid_: Water terrain, blue decoration

**Available Moisture**:
The long-term freshwater access of a semantic cell, derived from climate cover
and natural drainage. It is authoritative gameplay data for farming,
settlement, drought, and acclimatization, but is not rainfall, a Biome, or a
general land-quality score. Salt water has zero Available Moisture.
_Avoid_: River density, wet biome, fertility score

**Biome**:
A player-facing description derived from Terrain, Vegetation, elevation, and
Natural Features. Biome is never stored as an authoritative simulation grid.
_Avoid_: Terrain code, independent biome layer

**Influence Footprint**:
The geographically bounded area affected by an influence source such as a
village, army, alliance, or cultural center.
_Avoid_: Country size, painted circle

**Site**:
A single player-placeable strategic location in a Regional Theater. Settlements,
Farms, and Mines are Sites; their internal structures are not placed separately.
_Avoid_: Building, map object

**Settlement**:
A Site where a community resides. A Settlement changes tier without becoming a
different location or opening a more detailed spatial view.
_Avoid_: City map, collection of buildings

**Camp**:
The initial Settlement tier founded at the player's chosen valid site inside the
starting Regional Theater. Its one-kilometre occupied footprint is fully
visible and supplies distributed perimeter samples for physical line-of-sight.
_Avoid_: Starting Village

**Settlement Building**:
An upgrade constructed inside a Settlement through its construction window. It
changes the Settlement's strategic capabilities without becoming a separately
placeable Site.
_Avoid_: Map building, individual structure

**Scout Post**:
An early Settlement Building that raises its Settlement's observer height to
twelve metres, improving physical line-of-sight where terrain permits.
_Avoid_: Scout

**Scout**:
A player-controlled mobile Unit trained from one Settlement resident. A Scout
reveals terrain through elevation-aware viewsheds sampled around a one-kilometre
occupied footprint, identifies entities within three kilometres, and receives
terrain-paced move orders.
_Avoid_: Scout Post, abstract vision bonus

**Visibility Envelope**:
The stable gameplay mask derived from strict physical line-of-sight. Near-field
LOS is retained, distant fragments require agreement from multiple Settlement
perimeter samples, tiny detached flecks are removed, and the renderer contours
the result as crisp 125 metre pixels without changing the 500 metre simulation
grid.
_Avoid_: blurred fog, raw viewshed

**Terrain Pace**:
The percentage of a Unit's base movement supplied by its current semantic
terrain class. Water has zero Terrain Pace and is impassable.
_Avoid_: Animation speed, render speed

**Tribe**:
An autonomous early-era political community that owns Settlements, fields
Warriors, forms relationships, and may be controlled by a player or simulation
authority. Many Tribes can exist without corresponding human players.
_Avoid_: Player, Country

**Rival Tribe**:
Any autonomous Tribe in the Regional Theater that is not controlled by the
current player. Rival describes agency and competition, not an automatic state
of war.
_Avoid_: Enemy, NPC village

**Diplomatic Stance**:
The explicit relationship between two Tribes: friendly, neutral, hostile, or
at war. Hostility can precede combat; war authorizes it once combat rules exist.
_Avoid_: Team color

**Warrior**:
An available member of a Tribe's fighting strength. The current slice records
Warriors at Tribe scope; the later combat layer will decide how they form and
move as Warbands.
_Avoid_: Generic strength point

**Fog of War**:
The player-specific information boundary separating Unknown, Explored, and
currently Visible geography. It applies to transported game state as well as
map presentation, so unseen entities are not merely covered by a graphic.
_Avoid_: Dark overlay

**Visible Area**:
Geography currently in physical line-of-sight from any player-controlled
Settlement or mobile Unit. Entity state is disclosed only when it is also
inside that observer's Detection Range.
_Avoid_: Revealed map

**Detection Range**:
The maximum distance at which an observer can identify an entity already in
physical line-of-sight. It does not determine the shape of visible terrain.
_Avoid_: Sight radius

**Explored Area**:
Geography remembered by a player after it leaves current sight. Physical
terrain remains readable in a muted form, but mobile entities and changing
rival information are not current.
_Avoid_: Visible Area, fully revealed area

**Player View**:
The filtered snapshot produced from authoritative world state for one player.
It includes only visible Tribes, Settlements, Units, relationships, and that
player's own Fog of War areas.
_Avoid_: Client state, full World Snapshot

**Village**:
The Settlement tier created by upgrading a Camp. It is managed as one Site, not
as individually placed huts, fields, or paths.
_Avoid_: Village map, village building

**Production Site**:
A directly placeable Site that extracts or produces a geographically dependent
resource, such as a Farm or Mine.
_Avoid_: Resource building

**Route**:
An emergent connection formed and strengthened by repeated movement between
Sites. A Route may develop from a Beaten Path into later road forms.
_Avoid_: Player-drawn road

**Beaten Path**:
The earliest visible Route state, created through accumulated use rather than
direct construction.
_Avoid_: Dirt-road building

**Regional Culture**:
A broad learned starting tradition selected before geography. It supplies
historical tendencies, acclimatization, tradeoffs, and signature knowledge; it
does not represent ethnicity, biological identity, or a permanent state border.
_Avoid_: Race, nation, fixed people

**Culture Field**:
The soft geographic influence area used during Campaign setup to visualize
where a Regional Culture can found its first Camp. A Regional Theater may span
several Culture Fields, but the player's initial Camp must lie inside the field
of the selected Regional Culture.
_Avoid_: Country border, territorial claim

**Campaign Setup**:
The reversible three-step sequence Regional Culture → Regional Theater → Camp.
Back and Forward preserve compatible decisions; selecting a different Regional
Culture clears an incompatible Theater choice while retaining the new culture.
_Avoid_: Single spawn screen

**Technology**:
A persistent learned practice that a Tribe has made reliable, teachable, and
scalable. Tribal-age Technology organizes existing human capability; it does
not imply that one person invented fire, language, tools, or cooperation.
_Avoid_: Invention, universal historical milestone

**Knowledge**:
The non-physical research capacity contributed by a Tribe's population and
Settlements. Knowledge advances Technology but is neither a stored Resource nor
cargo that Units carry.
_Avoid_: Science points, inventory

**Research**:
A Tribe's deliberate focus that converts its Knowledge output into persistent
progress toward one Technology at a time. Changing focus preserves progress.
_Avoid_: Random discovery, construction

**Knowledge Web**:
The player-facing directed graph of tribal-age Technologies. Its branches may
develop in different orders; farming, permanent settlement, pottery,
watercraft, ritual organization, and pastoralism do not form one universal
historical ladder.
_Avoid_: Linear tech ladder, historical timeline

**Research Plan**:
The deterministic prerequisite-first queue created when a Tribe chooses a
Technology destination. The first Technology is active and the following
Technologies continue automatically as their requirements are met.
_Avoid_: Build queue, random recommendation

**Cultural Familiarity**:
A learned affinity that increases a Regional Culture's Knowledge output in one
broad research branch. It never creates exclusive Technologies or implies
innate ability.
_Avoid_: Racial bonus, cultural technology lock

**Geography Generation**:
The deterministic derivation of Atlas Views, Regional Theaters, terrain, water,
and traversal geography from a Campaign Map's source data.
_Avoid_: Map design, handcrafted map
