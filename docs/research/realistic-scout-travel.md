# Realistic scout travel speeds

Research date: 2026-08-12

## Recommendation

Model a scout's movement as three independent effects:

1. a **directional slope speed** in metres per second;
2. a **surface/vegetation factor** (not a generic "mountain biome" penalty); and
3. a **march/rest schedule** tied to the world clock.

This matters because a grassy 15-degree hillside, waist-deep brush on level ground, and a broken-rock mountain trail are different movement problems. Elevation should determine uphill/downhill speed, while land cover determines footing and obstruction.

Use the moderate Type 1 wildland-firefighter model as the scout's moving pace. It was fitted to GPS observations from trained crews hiking under an average 22.7 kg load. The study recorded 108,600 observations over 209 km and explicitly removed stops and running, so it describes **instantaneous hiking pace**, not distance sustained per day. Its median model peaks at 1.404 m/s on a slight (-2.9 degree) descent and has a cross-validated mean absolute error of 0.081 m/s. The faster model peaked at 1.699 m/s but was less predictive; that is better reserved for a future forced-march or urgent-withdrawal order. [Sullivan et al., 2020, USDA Forest Service landing page](https://research.fs.usda.gov/treesearch/61249) and [paper with coefficients](https://research.fs.usda.gov/download/treesearch/61249.pdf).

### Directional slope formula

For each path segment, let `dz = destinationHeightM - sourceHeightM`, `d = horizontalDistanceM`, and:

```text
thetaDeg = clamp(atan2(dz, d) * 180 / PI, -45, 45)

vSlopeMps =
    77.6346
    / (PI * 20.9482 * (1 + ((thetaDeg + 2.8292) / 20.9482)^2))
    + 0.2228
    - 0.0004 * thetaDeg

vMps = max(0.05, vSlopeMps * surfaceFactor)
segmentTravelSeconds = d / vMps
```

The function is directional: traversing the same edge uphill and downhill has a different cost. It gives these moving speeds before the surface factor:

| Slope | Speed |
|---:|---:|
| -30 degrees | 0.675 m/s (2.43 km/h) |
| -15 degrees | 1.111 m/s (4.00 km/h) |
| -5 degrees | 1.392 m/s (5.01 km/h) |
| 0 degrees | 1.381 m/s (4.97 km/h) |
| +5 degrees | 1.256 m/s (4.52 km/h) |
| +15 degrees | 0.901 m/s (3.24 km/h) |
| +30 degrees | 0.552 m/s (1.99 km/h) |
| +45 degrees | 0.395 m/s (1.42 km/h) |

The measured firefighter models peak on a slight descent and slow on both steep ascents and steep descents; trained firefighters were less impaired by steepness than general hikers. That makes this a good fit for a well-trained scout without turning every hill into molasses. [Sullivan et al., 2020](https://research.fs.usda.gov/download/treesearch/61249.pdf).

Treat slopes above 45 degrees as impassable without a traversable pass, road, or later climbing technology. Do not add another `hill` penalty: the formula already prices the hill. Apply a rocky/alpine factor only when the **surface** is broken or unstable.

### Initial terrain and vegetation factors

These are implementation constants, not claims that every forest or desert has one universal speed. They are conservative game-ready inferences bounded by the field and military evidence below.

| Traversal surface | Factor | Flat moving speed | Flat distance in the 12 h daylight window |
|---|---:|---:|---:|
| Road / maintained trail | 1.00 | 1.381 m/s (4.97 km/h) | 59.6 km |
| Open plains / short grass | 0.90 | 1.243 m/s (4.47 km/h) | 53.7 km |
| Moderate forest on plains | 0.90 Ã— 0.944 | 1.173 m/s (4.22 km/h) | 50.7 km |
| Dense forest on plains | 0.90 Ã— 0.72 | 0.895 m/s (3.22 km/h) | 38.7 km |
| Dense jungle on plains | 0.90 Ã— 0.333 | 0.414 m/s (1.49 km/h) | 17.9 km |
| Firm desert / stony ground | 0.90 | 1.243 m/s (4.47 km/h) | 53.7 km |
| Rocky mountain footing | 0.65 | 0.898 m/s (3.23 km/h) | 38.8 km |
| Shallow, unbroken snow | 0.50 | 0.691 m/s (2.49 km/h) | 29.8 km |

Evidence behind the factors:

- The density labels follow the USFS four-band canopy convention: sparse 10â€“24%, open/low 25â€“39%, moderate 40â€“59%, and dense 60â€“100%. The UI uses `light` instead of `open/low`. The current Natural Earth color classifier is an art-directed proxy for those bands, not measured local canopy data. [USFS vegetation classification](https://www.fs.usda.gov/emc/nfma/includes/r5/feis/vol_1/ch_2.pdf).
- FAO defines canopy cover as the percentage of ground covered by the vertical projection of tree crowns. That makes density a vegetation property rather than a terrain/landform category. [FAO forest definitions](https://fra-data.fao.org/definitions/fra/2020/en/tad).

- In an original field experiment, highly forest-adapted Tsimane participants averaged 1.20 m/s through unbroken Amazon forest and 1.39 m/s on a forest trail. The ratio is 0.86, supporting a mild `0.85` penalty for forest with passable understory—not a severe penalty merely because trees exist. [Venkataraman et al., 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10426037/).
- The STRIDE field model found that waist-to-chest-height vegetation, ground roughness, and slope independently reduce off-path travel. It explains over 80% of group-level variance, but requires continuous lidar-derived vegetation density and roughness that the current biome map does not contain. This supports keeping forest, dense brush, and rocky footing separate now, then replacing categorical factors with continuous obstruction data if that data becomes available. [Campbell et al., 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11399398/).
- U.S. Army jungle-training observations give only 50-150 m/h for a **platoon trailblazing tactically** through dense Hawaiian rainforest and often less than 200 m/h on sharply broken jungle terrain. A lone scout is much less encumbered, so the recommended 1.49 km/h is intentionally far faster while still making genuinely dense jungle costly. [U.S. Army *Armor*, 2015](https://www.benning.army.mil/Armor/eARMOR/content/issues/2015/JAN_MAR/Healy.html).
- U.S. Army cold-weather planning gives 1.5-3 km/h in less than 0.3 m of unbroken snow and 0.5-1 km/h in deeper unbroken snow for troops carrying rucksacks over gently rolling terrain. The proposed 2.49 and 0.90 km/h flat-ground values sit inside those ranges. [U.S. Army cold-weather movement guide](https://api.army.mil/e2/c/downloads/440621.pdf).
- Army foot-march doctrine explicitly models sand and heavy brush separately from easy terrain and warns that slope, vegetation, and hydrology all affect movement. Its broad sustained planning rates are 4 km/h on roads, 2.4 km/h cross-country, and 20-32 km/day. [ATP 3-21.18, *Foot Marches*](https://rdl.train.army.mil/catalog-ws/view/100.ATSC/2EC64B6E-23DE-422B-9441-9AA644D86355-1492694761315/atp3_21x18.pdf) and the [U.S. Army Infantry article reproducing the doctrine tables](https://www.lineofdeparture.army.mil/Journals/Infantry/Infantry-Fall-2024/Soldier-Load/).

`Desert` should not itself mean slow. Firm desert pavement or stony ground can be nearly as fast as open plains; loose dunes get the sand penalty. Heat, dehydration, and visibility are separate systems and should not be baked permanently into the terrain factor.

## World-clock integration

Keep locomotion and endurance separate:

- The deliberately simplified game rule defines day as **06:00â€“18:00** and night as 18:00â€“06:00.
- A Scout moves continuously in daylight with no automatic hourly halt, then rests at night. This is a player-selected abstraction for a trained individual rather than a claim about formed-unit doctrine.
- Flat open-ground distance can approach 54 km in a full daylight window. Terrain, vegetation, route choice, and incomplete use of the window normally lower it.
- A path preview should report both moving time and clock arrival time, including scheduled halts and overnight stops. A 40 km route is therefore not simply `40 / currentKph` when it crosses a day boundary.

Army doctrine says a normal foot-march day is 8 hours and that forced marches extend the **hours marched** more often than the pace. It recommends maxima of 56 km in 24 hours, 96 km in 48 hours, and 128 km in 72 hours for formed troops; these are useful future limits for forced travel, not default scout behavior. [FM 21-18, *Foot Marches*](https://www.moore.army.mil/infantry/doctrinesupplement/atp3-21.8/PDFs/fm21_18.pdf).

For the first implementation, do not add a continuous fatigue curve. The discrete daylight/rest rule gives an auditable end-to-end model. A later forced-march order can extend movement into night and attach explicit fatigue/injury costs.

## Sampling and pathfinding details

- Sample elevation along a route at the semantic grid interval (currently about 500 m) or more finely if elevation is available. Compute cost per sample, not from route-start height to route-end height; otherwise a valley and return climb can incorrectly cancel out.
- Smooth only obvious single-cell elevation noise (for example, a three-sample median). Do not smooth away real ridges.
- Use each directed edge's travel time as the pathfinding weight. The fastest route may be longer but flatter or follow open ground, which is the desired behavior.
- Keep roads as overlays that replace the underlying surface factor with the road/trail factor. This gives automatically generated beaten paths mechanical value later.
- Water and cliffs remain impassable rather than receiving an extremely low speed.

## Uncertainty and design tradeoffs

- The best slope evidence here is from modern, fit firefighters with modern footwear and an average 22.7 kg load, over hikes averaging 4.8 km. The long-duration schedule comes from military doctrine, not the same experiment.
- A lightly equipped, well-trained scout may exceed the moderate firefighter curve for a short period. Using the high-tertile curve continuously would overstate sustainable travel and collapse gameplay distances, so reserve it for urgency mechanics.
- Forest and jungle are now independent vegetation features with sparse, light, moderate, and dense classes. They can overlay plains, hills, or mountains; canopy remains only a proxy for the undergrowth and roughness that actually obstruct travel.
- Weather, darkness, altitude, heat, load, stealth, navigation difficulty, injury, and river crossings are deliberately excluded from this first layer. They should multiply or schedule around this model, not change its source constants.
