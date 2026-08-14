# Regional culture umbrellas for Theater selection

Research date: 2026-08-12

## Recommendation

Use **40 broad regional traditions** as the first-pass labels in the world-map Theater picker. These are deliberately coarse gameplay umbrellas, not claims that a continent was divided into 40 bounded peoples. The UI may call the field `Regional culture`, but design and historical writing should treat it as a starting affinity assembled from geography, language history, subsistence patterns, interaction zones, and player-recognizable names.

Recommended tooltip copy:

> Regional culture · Hellenic-Balkan

Do not say that a hovered point “belongs to” a culture. The labels describe the likely starting tradition for a Theater, while the game's tribal population and later identities remain procedurally generated.

## Why this must be a gameplay synthesis

No academic source supplies a defensible 25–40-item map of ancient world cultures. The underlying evidence is far more granular and time-dependent:

- [Glottolog 5.3](https://glottolog.org/glottolog/glottologinformation) currently distinguishes hundreds of language families and isolates, gives each languoid a persistent identifier, and warns that classifications change as scholarship improves. Language ancestry is therefore useful split/merge evidence, not a ready-made culture map.
- [D-PLACE](https://d-place.org/about) connects more than 1,400 geographically located societies to linguistic, environmental, and cultural observations. Its authors define a society as a group at a particular locality and date, and most of its initial descriptions concern the nineteenth and early twentieth centuries. The [D-PLACE methods paper](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0158391) also stresses that shared history, migration, diffusion, environment, and spatial dependence all shape cultural similarity.
- [ArchaeoGLOBE](https://archaeoglobe.com/index.php/projects/archaeoglobe-project-2018/) gathered expert assessments of land use for 146 regions across ten timeslices over 10,000 years. Its [open GIS dataset](https://doi.org/10.7910/DVN/CQWUBI) is a useful future scaffold for temporally grounded regional boundaries, but 146 regions are too many for the requested picker.
- HRAF's [Outline of World Cultures](https://ehrafarchaeology.yale.edu/help/GetStarted/owc_c.html) covers more than 2,500 cultures in a regional and subregional hierarchy. It is useful for auditing names and omissions, not for collapsing the world into one authoritative top level.
- Seshat selects Natural Geographic Areas to capture spatial and historical diversity rather than assuming one timeless cultural partition. Its [World Sample-30 method](https://seshatdatabank.info/methods/world-sample-30) is useful as a coverage check.

Language is also not interchangeable with culture or ancestry. A global analysis of gene-language relationships found recurrent mismatches caused by language shift and contact; the paper explicitly cautions against treating linguistic and biological histories as identical ([PNAS/PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9704691/)). Grambank likewise finds that both genealogical inheritance and geographic proximity matter to linguistic structure ([Science Advances/PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10115409/)).

The roster below is therefore a product taxonomy: compact enough for a new player, geographically complete, and designed to be replaced by era-specific historical content later without changing the picker interaction.

## Proposed roster

| Macro-region | Regional traditions | Consolidation rationale |
|---|---|---|
| Europe | Norse; Atlantic Celtic; Continental Germanic; Balto-Slavic; Uralic Forest; Hellenic-Balkan; Western Mediterranean | Keeps the strongly legible Norse/Germanic distinction for gameplay, while merging smaller adjacent European traditions into interaction zones. Norse is linguistically Germanic but retained as a separate maritime play identity. |
| West and Central Asia | Anatolian-Caucasian; Levantine-Mesopotamian; Arabian; Iranian Highland; Eurasian Steppe; Siberian | Separates settled highland, river-valley, desert, steppe, and taiga traditions that imply substantially different early play. Each label still contains many unrelated historical peoples. |
| South, East, and Southeast Asia | Indo-Gangetic; Dravidian; Himalayan-Tibetan; East Asian Heartland; Japonic; Mainland Southeast Asian; Maritime Austronesian | Preserves major ecological and interaction divides while combining closely interwoven mainland zones. `East Asian Heartland` is intentionally regional rather than a claim that Sinitic, Koreanic, and Tungusic histories are one lineage. |
| Africa | Amazigh-Saharan; Nile Valley; Horn-East African; Sahelian; West African; Bantu Belt; Kalahari-Cape; Malagasy | Avoids disputed macrofamily labels such as “Nilo-Saharan” and “Khoisan.” The labels are geographic or expansion-zone shorthand, not genealogical classifications. |
| North and Middle America | Arctic-Subarctic; Pacific Northwest; Eastern Woodlands; Plains-Prairie; Desert Southwest; Middle American | Follows the established usefulness of broad ecological culture areas while remaining much coarser than actual nations. The Smithsonian's North American subsistence handbook, for example, organizes full continental coverage into eight broad geographic regions ([Smithsonian Scholarly Press](https://scholarlypress.si.edu/store/all/subsistence-economies-of-indigenous-north-american-societies-a-handbook/)). `Middle American` combines Mesoamerican and Caribbean anchors for roster restraint. |
| South America | Andean; Amazonian; Southern Cone | Separates the highland, tropical-river, and temperate/southern interaction zones while accepting substantial internal diversity and transition areas. |
| Oceania | Papuan-Melanesian; Polynesian; Aboriginal Australian | Keeps the three most important geographic play distinctions. `Papuan-Melanesian` is explicitly a regional umbrella, not a single language family. |

Count: **40**.

## Spatial assignment model

The machine-readable roster is [public/maps/cultures/manifest.json](../../public/maps/cultures/manifest.json). Each culture has a stable ID, display name, and a small set of approximate WGS84 influence anchors. The intended deterministic score is:

```text
score = great-circle distance in km / (anchor radiusKm × anchor weight)
```

The culture with the lowest anchor score wins; exact ties resolve by ascending culture ID. Assignment only runs for Theater candidates that pass the game's land-ratio threshold.

This model has four useful properties:

1. It is fast enough to evaluate on hover without allocating polygons or loading a second global texture.
2. Multiple anchors let a maritime or elongated tradition reach islands and coastlines without claiming every point inside a hard polygon.
3. The transition follows geography continuously, so an overlapping Theater lattice does not expose little culture-selection boxes.
4. The data can later be replaced by sampled historical rasters or era-specific influence fields without changing culture IDs or UI copy.

The radii are influence scale controls, not historically attested borders. They should be tuned visually after rendering a diagnostic world map. For a production historical pass, derive candidate fields from ArchaeoGLOBE regions, audit coverage against HRAF/D-PLACE, and have regional subject experts review names and boundaries.

## Important edge cases and limitations

- **Time:** the roster mixes labels whose familiar meanings peak in different eras. `Norse`, for example, is a player-facing lineage label, not a claim that Norse identity existed unchanged throughout the entire tribal start date.
- **Transitions and overlap:** real identities overlap, migrate, hybridize, and change. Nearest influence creates a single tooltip because the UI needs one answer; it does not make that answer exclusive or exact.
- **Language is a proxy:** a language family can cross very different lifeways, and neighboring unrelated languages can share material culture. The roster uses language only alongside region and ecology.
- **Uneven granularity:** Europe and the Mediterranean receive more distinctions than some internally more diverse tropical regions. This reflects initial gameplay recognizability and must not be mistaken for relative human diversity.
- **Indigenous boundaries:** authoritative institutions explicitly warn against treating overview maps as exact or fixed. AIATSIS notes that Aboriginal Australia contains many distinct groups and that its own overview map shows only general locations with blurred, sometimes contested boundaries ([AIATSIS](https://aiatsis.gov.au/explore/map-indigenous-australia)). `Aboriginal Australian` in this roster is much broader still.
- **Disputed labels:** `Kalahari-Cape`, `Papuan-Melanesian`, `East Asian Heartland`, `Middle American`, and similar names are openly synthetic regional umbrellas. They are not asserted ethnonyms or language families.
- **Islands:** the anchors include Iceland, Japan and Ryukyu, Madagascar and Comoros, Maritime Southeast Asia, Melanesia, Polynesia, Greenland, and the Caribbean. A Theater with 10% land or less will still be excluded by design, so many small oceanic islands will not become standalone Theaters even though their culture anchor exists.
- **Uninhabited and sparsely inhabited land:** nearest influence mathematically assigns every land coordinate, including high Arctic, deep desert, or historically uninhabited locations. The land-ratio rule is not a habitability model; future generation should also consider climate, freshwater, and era-specific settlement evidence.
- **No modern diaspora/colonial projection:** anchors approximate indigenous or long-duration regional traditions, not the global distribution of modern languages, states, or settler populations.

## Content rule for future evolution trees

Treat a regional culture as a broad starting pool, never as the player's final identity. A Theater's tribes should draw several local names and traits from the umbrella; contact, ecology, migration, alliances, and unification should then determine the civilization's actual evolution. Historical evolution branches require their own cited research and should not be inferred mechanically from this manifest.
