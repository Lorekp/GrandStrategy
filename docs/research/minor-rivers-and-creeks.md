# Minor rivers, streams, and creeks

> Implementation update (2026-08-13): the source recommendation is now live,
> while the temporary `river.u8` delivery recommendation below is superseded.
> Format 13 derives Available Moisture from climate cover and all natural
> freshwater drainage, then ships projected centerlines only for Rivers selected
> by automatic Horton-Strahler prominence, physical width, and regime. Small
> channels remain semantic inputs instead of inheriting cell width or becoming
> visible map clutter.

Status: architecture research and recommendation  
Date: 2026-08-13

## Decision

Yes, the game can add substantially more minor rivers and creeks without generating them procedurally.

For Earth, ingest a **dated, checksummed OpenStreetMap PBF snapshot** into one normalized offline hydrography layer. Accept natural linear waterways (`waterway=river`, `waterway=stream`, and, where wanted, `waterway=tidal_channel`); retain unnamed features; preserve `intermittent`/`seasonal` metadata; and reject artificial classes such as `canal`, `ditch`, `drain`, `pressurised`, `fairway`, and `link`. OpenStreetMap's documented taxonomy explicitly separates natural rivers and streams from artificial waterways, and its river ways are meant to run downstream and form a routable centerline description ([OSM waterway taxonomy](https://wiki.openstreetmap.org/wiki/Key:waterway), [river tagging](https://wiki.openstreetmap.org/wiki/Tag:waterway%3Driver)). This directly solves the present failure mode in which the compiler's “named natural river only” safeguard also discards unnamed creeks.

Do **not** make procedural drainage the primary Earth source or a silent gap filler. A DEM predicts potential flow paths, not whether water actually flows there, and is least trustworthy in precisely the flat deltas and coastal plains where false channels are most conspicuous. Use procedural drainage as the primary hydrology implementation only for fictional/custom maps that explicitly declare generated hydrography. It can be an opt-in authoring aid for an Earth-like custom map, but not a factual claim about Earth.

HydroSHEDS v2 is the best future factual baseline if its eventual global release and license remain suitable: its released products use approximately 30 m source cells, a 1 km² river-initiation threshold, explicit reach topology, and CC BY 4.0. As of this review, however, the official release covers the Americas, not Egypt or Greece ([HydroSHEDS v2 technical documentation](https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v2_0_0.pdf), [official Americas release](https://www.hydrosheds.org/news/hydrosheds-v2-for-the-americas), [v2 downloads](https://www.hydrosheds.org/downloads-core-data-v2)). It should be reassessed when global coverage exists, not designed into the current release as an unfinished dependency.

## Fit with the current pipeline

The regional compiler already has the right delivery shape:

- a 512 km × 512 km theater rendered at 4096², or 125 m/pixel;
- a 1024² semantic grid, or 500 m/cell;
- a `river.u8` semantic raster with minor and major classes;
- a full-resolution river mask baked into the palette tile pyramid; and
- max-pooling when river classes are reduced to the semantic grid, so narrow channels do not disappear.

The missing piece is source fidelity, not runtime rendering. The current source is Natural Earth 1:10m mixed river/canal cartography. The safety filter accepts only named features classified as rivers and excludes canal-like names. That was appropriate for removing obvious man-made artifacts, but it necessarily removes unnamed streams and exposes the scale limit of small-scale atlas data.

The new data should remain an **offline compiler input**. The browser should continue loading the existing raster tiles plus the compact semantic array; it should not parse OSM, HydroRIVERS, or a stream graph at runtime. A 1024² byte river grid is 1 MiB raw per theater before transport compression, and a temporary 4096² byte render mask is 16 MiB during compilation. Thus, adding many source features need not increase browser draw calls or simulation scans. Only ship a separate reach graph if gameplay later needs downstream routing, river travel, or basin queries.

Minor streams should not all appear on the world atlas. Its maximum 16,384-pixel width is roughly 2.4 km/pixel at the equator, so creek-scale lines would turn into blue noise. Use progressively stricter rank/flow thresholds for global levels; show the dense stream network only in regional theater levels where a one-pixel 125 m line is legible.

## Source comparison

| Source | Detail and coverage | Natural/artificial and wet/dry meaning | Topology | License and commercial use | Download/build implications | Verdict |
|---|---|---|---|---|---|---|
| HydroRIVERS / HydroSHEDS v1 | Near-global. HydroRIVERS is derived at 15 arc-seconds (about 500 m at the equator) and begins streams at 10 km² contributing area or 0.1 m³/s. It contains about 8.48 million reaches and 35.85 million km of linework. Quality is explicitly poorer above 60° N because SRTM was unavailable there. | DEM/model-derived river reaches; it has no reliable natural-vs-artificial feature class. It is not a source for tiny creeks below its threshold. | Excellent for its scale: stable reach ID, `NEXT_DOWN`, main-river ID, upstream/downstream distances, contributing area, discharge, and several river orders. | Commercial use is allowed, but the WWF license is not a simple permissive data license. It includes attribution, downstream EULA, integration, redistribution, termination, and other conditions that need legal review before shipping. | Global compressed Shapefile is 544 MB; regional extracts such as Africa are 108 MB. Easy to pin and compile offline. | Good ranked backbone/topology, but not enough minor streams and awkward as a shipping dependency. Do not mix and redistribute it with an OSM-derived database without license review. |
| HydroSHEDS v2 | Approximately 1 arc-second/30 m and a 1 km² stream threshold; much closer to the regional render's needs. Current official coverage is the Americas only. | Hydrologic network, not an observational natural/artificial inventory. | Strong, explicit upstream/downstream reach relationships. | CC BY 4.0 for the released product, permitting commercial derivatives with attribution. | Large, but partitioned official downloads and offline compilation are practical. | Best future baseline if global coverage arrives; not usable for Egypt/Greece now. |
| Hydrography90m | Global 3 arc-second (about 90 m at the equator); starts channels at only 0.05 km²/5 ha. It contains 726 million segments and 1.6 million drainage basins—by far the densest candidate. | The authors explicitly define a channel as a **potential flow path**, not evidence of water. The published work says hydrologically irrelevant DEM-derived headwaters still need exclusion. It neither distinguishes canals from natural streams nor establishes perennial flow. | Excellent: globally unique segments, upstream/downstream relationships, sub-catchments, flow direction/accumulation, slope, distance, and stream orders. | Dataset is CC BY-NC 4.0. Commercial use is prohibited without express permission, so it is not a shippable default for a commercial game. | Distributed in 116 20° tiles. Flow-accumulation tiles alone range from a few MB to 2 GB, and the published global workflow is a substantial GIS/HPC job. | Technically impressive and useful as a reference or non-commercial experiment, but rejected for shipping because of license, extreme density, and “potential path” semantics. |
| OpenStreetMap waterways | Global and has no imposed feature-size floor; can include unnamed creeks at much finer positional detail than the game's 125 m render. Completeness varies greatly by region and mapping effort. | Best classification of the candidates: `river` and `stream` are natural; canal/drain/ditch and other engineered waterways are separate tags. `intermittent` and `seasonal` can be retained. It describes the modern mapped world, not a guaranteed historical landscape, and tagging mistakes still occur. | Ways are supposed to be drawn downstream and connect as routable watercourses, but completeness and connectivity are community-maintained rather than guaranteed. Validate native node connectivity and do not silently bridge broad gaps. | ODbL permits commercial use with attribution and share-alike obligations for a publicly used derivative database. Raster maps are generally Produced Works, but a distributed normalized vector layer or geometry-bearing semantic database must be treated as ODbL/share-alike unless legal review establishes otherwise. | The official current planet PBF is about 88 GB, too large for routine local builds. Dated country/region extracts are practical; filter them once to waterways and index the small normalized result. | Recommended current Earth source for minor natural waterways, using pinned extracts, explicit attribution, and an ODbL source-offer process. |
| Procedural DEM-derived drainage | Resolution follows the DEM. The established pipeline is hydrologic conditioning, flow direction, flow accumulation, an upstream-area threshold, vectorization, and ranking. | Generates possible drainage. It does not observe water, seasonality, springs, underground loss, or artificial construction. Unconditioned DEMs produce errors around flats, deltas, bridges, embankments, reservoirs, and noise. | Can be internally perfect if computed basin-wide, but D8 often makes artificially straight channels and single-downstream graphs do not represent delta bifurcations. MFD/MD8 improves headwaters at additional cost. | Output rights follow the DEM and other conditioning inputs; wholly generated custom-world inputs avoid an external river-data license. | Deterministic when DEM, depression/stream-burning masks, threshold, tool version, numeric settings, tile scheme, and hashes are pinned. Must operate basin-wide or with correct upstream context—not independently per 512 km theater. | Primary for fictional/custom maps; rejected as primary or automatic fallback for factual Earth. |

Primary HydroRIVERS facts and download sizes come from the [official product page](https://www.hydrosheds.org/products/hydrorivers) and [technical documentation](https://data.hydrosheds.org/file/technical-documentation/HydroRIVERS_TechDoc_v10.pdf). The HydroSHEDS v1 raster products span 3, 15, and 30 arc-seconds; continental 3-arc-second inputs are commonly multi-gigabyte downloads ([official core downloads](https://www.hydrosheds.org/hydrosheds-core-downloads), [v1 technical documentation and license](https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf)).

Hydrography90m's resolution, threshold, segment count, topology, potential-flow-path meaning, tiling, and license are documented in its [peer-reviewed data paper](https://essd.copernicus.org/articles/14/4525/2022/), [official layer catalog](https://hydrography.org/hydrography90m/hydrography90m_layers/), and [published GRASS workflow](https://hydrography.org/hydrography90m/hydrography90m_workflow/).

OpenStreetMap publishes dated, checksummed planet snapshots; the current full PBF is approximately 88 GB ([official planet archive](https://planet.openstreetmap.org/pbf/)). Its database is ODbL: copying, adapting, and commercial use are permitted with attribution, while public derivative databases inherit share-alike obligations ([OSM copyright summary](https://www.openstreetmap.org/copyright), [ODbL legal text](https://opendatacommons.org/licenses/odbl/1-0/), [OSMF Produced Work guidance](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline)).

## Recommended normalized architecture

Keep one source-independent compilation seam:

```text
pinned source snapshot
    -> source adapter and license validation
    -> normalized natural-waterway reaches
    -> connectivity/rank validation
    -> global spatial index
    -> theater clip + AEQD reprojection
    -> 125 m render mask and 500 m semantic river grid
    -> baked PNG tiles + river.u8
```

The normalized reach record should contain only durable semantics needed by compilers and future gameplay:

```text
featureId
geometry in canonical world coordinates
kind = river | stream | tidal-channel
regime = perennial | intermittent | seasonal | unknown
sourceRank / derivedRank
upstreamArea or width when known
downstreamFeatureIds when validated
sourceId, sourceVersion, sourceLicense
```

This is a data contract, not a new runtime abstraction. One Earth adapter reads OSM now; a later HydroSHEDS v2 adapter or a custom-world generator can emit the same normalized records. Render and semantic compilers should not contain provider-specific tag logic.

For the OSM adapter:

1. Pin a dated regional PBF and SHA-256; never build release maps from `latest`.
2. Filter ways to `river`, `stream`, and optionally `tidal_channel`, retaining referenced nodes and relevant tags. Do not require a name.
3. Explicitly exclude artificial and navigation-only waterway classes. Treat conflicting `natural`/`man_made` tagging as invalid input to audit, not as a guessing opportunity.
4. Preserve OSM IDs only as source provenance; derive stable world feature IDs from the map version and source identity.
5. Build edges from shared OSM node IDs and documented way direction. Report dangling endpoints, uphill segments against the theater DEM, self-intersections, disconnected crossings, ocean protrusions, and duplicate overlap. Do not broadly snap unrelated nearby lines.
6. Clip only after graph/rank work. Clip render lines to the canonical land/water boundary with a small processing halo, retaining legitimate mouths but removing sea-going artifacts.
7. Classify display density from validated graph rank plus source type/width/regime. `river` is not automatically “major”; `stream` is not automatically perennial.
8. Rasterize at 125 m, then max-pool to the 500 m semantic grid as the existing compiler already does.
9. Write source date, checksum, filter policy, compiler version, ODbL attribution, and normalized-layer hash into the map manifest. Publish or offer the ODbL-derived normalized hydrology database used for a release.

This approach is deterministic offline: OSM is mutable, but a particular PBF snapshot, filter policy, and toolchain are immutable inputs. It also keeps build size bounded. The 88 GB planet file is unnecessary for normal development; maintain regional pinned inputs, then produce a global waterway-only indexed artifact in release infrastructure. Exact filtered size and compile time should be measured in the first spike rather than guessed.

## Procedural generation policy

Procedural drainage should be a first-class **custom-map provider**, not an Earth repair effect.

Use an established hydrology implementation such as GRASS rather than writing a bespoke river-growth algorithm. `r.watershed` produces flow accumulation and direction using SFD or MFD and can spill large jobs to disk; `r.stream.extract` creates raster/vector streams from a specified accumulation threshold and can prune short first-order reaches ([GRASS `r.watershed`](https://grass.osgeo.org/grass85/manuals/r.watershed.html), [GRASS `r.stream.extract`](https://grass.osgeo.org/grass85/manuals/r.stream.extract.html)). Pin the container/tool version and every option.

For a generated map:

- condition the DEM and declare true inland depressions;
- burn any authored lakes, coasts, and river control lines before routing;
- compute flow accumulation globally or by complete basin with overlap/upstream context;
- use a 30–90 m working DEM where creek detail matters, not the 500 m gameplay grid;
- threshold by physical contributing area, then calculate rank/order;
- preserve the global reach graph and clip disposable theater views from it; and
- validate that neighboring theaters yield identical canonical streams.

Running drainage independently inside each 512 km theater would produce border seams and rivers whose upstream area changes with camera location. Running it directly on the 500 m semantic grid would also create visibly angular, misplaced creeks. Generate at source resolution, rasterize to 125 m for presentation, and only then reduce to 500 m for gameplay.

For Earth, a procedural layer may be exposed as an editor preview labelled “inferred drainage.” It should be disabled in release maps unless a human author promotes specific reaches after comparison with factual evidence. In flat deltas, coastal plains, wetlands, karst terrain, and dense human landscapes, reject automatic inference entirely.

## Phased implementation

### Phase 1 — one complete Earth theater

- Add a pinned OSM extract for one target region, including the Nile theater and enough surrounding basin context.
- Replace the named-only Natural Earth minor-river input for that theater with normalized OSM natural waterways.
- Keep the existing two render/semantic classes and output files.
- Add source-policy tests proving unnamed streams survive and every artificial waterway value is excluded.
- Add visual and structural checks for river density, sea protrusions, dangling mouths, and deterministic hashes.
- Record ODbL attribution and source availability in the manifest/release documentation.

This phase should answer the product question with the smallest end-to-end change: do real unnamed streams make the 125 m theater feel richer without making the 500 m simulation or atlas noisy?

### Phase 2 — global release compiler

- Pin regional PBF snapshots for all supported Earth regions and produce one indexed waterway-only build artifact.
- Derive stable reach IDs and rank once, before theater clipping.
- Establish level-of-detail thresholds: major rivers at atlas levels, rivers and selected tributaries in previews, dense streams only at close theater levels.
- Publish a source attribution/source-offer bundle and automate license-manifest checks.
- Benchmark download, filtered artifact, per-theater compile time, peak RAM, tile size, and semantic compression.

### Phase 3 — topology only when gameplay needs it

- Ship a compact validated reach graph only for mechanics such as downstream movement, transport, flood propagation, or basin ownership.
- Until then, keep graph construction as an offline ranking/validation tool and ship only the existing `river.u8` semantics.

### Phase 4 — custom maps

- Add a generated-hydrography adapter backed by pinned GRASS tools.
- Require a map manifest to choose `observed`, `authored`, or `generated` hydrography explicitly.
- Test a full basin and overlapping theaters for deterministic canonical IDs and zero cross-theater seams.
- Allow authored control lines and masks; never disguise generated waterways as observed ones.

### Phase 5 — reevaluate official global data

- Reassess HydroSHEDS v2 when Europe/Africa and the rest of the world are officially released.
- Compare its coverage and topology against the pinned OSM layer in representative mountains, arid basins, deltas, wetlands, and high latitudes.
- Prefer one canonical factual provider per released map where possible. If combining sources, establish explicit spatial/feature precedence and resolve license compatibility before implementation.

## Acceptance criteria

The change is ready to ship when:

- unnamed natural streams appear in representative 125 m theaters;
- no canal, ditch, drain, fairway, or maritime connector enters the natural-river layer;
- intermittent/seasonal streams remain distinguishable in semantics even if initially styled the same;
- atlas density remains restrained at every overview level;
- the same source snapshot produces identical normalized and `river.u8` hashes;
- overlapping theaters trace the same canonical waterways;
- river compilation adds no vector parsing or graph traversal to browser runtime;
- every input and derivative records source date, checksum, filter policy, license, attribution, and compiler version; and
- the release process satisfies the source's commercial-use, attribution, and share-alike obligations.

## Bottom line

Use **pinned OpenStreetMap extracts now** for Earth creeks and minor natural waterways. It offers the classification the project needs to exclude man-made channels, has sufficient local detail, compiles deterministically once versioned, and does not burden runtime. Accept its uneven completeness openly and validate it aggressively.

Keep **HydroSHEDS v2 under review** as the likely future hydrologically consistent global baseline. Do not adopt Hydrography90m for a commercial release without separate permission, and do not expect HydroRIVERS v1 to supply creek-scale detail.

Use **procedural DEM drainage as the primary source for fictional/custom maps only**. For factual Earth it is neither primary nor an automatic fallback; it is an explicitly labelled authoring tool, because a plausible blue line is not evidence of a real creek.
