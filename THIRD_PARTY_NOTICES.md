# Third-party notices

## Geographic data

- **OpenStreetMap:** © OpenStreetMap contributors. Waterway extracts are obtained through [Geofabrik](https://download.geofabrik.de/) and licensed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). See [OSM copyright and attribution](https://www.openstreetmap.org/copyright). Generated manifests record the extract date, checksums, and source. The preprocessing code and manifest parameters document the transformations.
- **Natural Earth:** physical vectors and Natural Earth II idealized land cover are [public-domain data](https://www.naturalearthdata.com/about/terms-of-use/). The project resamples and classifies these inputs for game terrain and vegetation; these are game approximations, not observations of current land use.
- **Mapzen Terrain Tiles:** elevation tiles come from the [AWS public dataset](https://registry.opendata.aws/terrain-tiles/). This is a composite dataset, not a single-license source. The upstream [source list](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md) and [provider attributions](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) describe the underlying data. The bundled [map credits](public/map-credits.html) retain the provider acknowledgements. This project crops, resamples, projects, and shades elevation data for gameplay; the providers do not endorse these changes.

Keep the map credits and source/license metadata with distributed map derivatives. Data-specific terms apply independently of the project's own code.

## Software dependencies

PixiJS, Proj4JS, and the build/preprocessing dependencies retain their respective licenses. Exact JavaScript versions are recorded in `package-lock.json`; Python requirements are in `tools/map-preprocess/requirements.txt`. Their notices are supplied with the packages.

This document identifies third-party material; it does not grant a new license for the project's original code.
