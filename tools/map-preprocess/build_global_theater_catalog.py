"""Build the land-qualified global Regional Theater catalog.

The catalog is a cheap pointer-query index, not rendered geography. Candidate
centers form an overlapping equal-distance lattice. Each 768 km footprint is
sampled in its own azimuthal-equidistant projection against semantic land
cover and low-LOD elevation; regions with ten percent land or less never enter
the runtime catalog.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import CRS, Geod, Transformer

from build_regional_theater import (
    SOURCE_TILE_SIZE,
    decode_terrarium,
    download_tile,
    web_mercator_pixel,
)
from surface_cover import (
    load_base_terrain,
    load_vegetation,
    sample_equirectangular,
)
from terrain_classification import TERRAIN_CODES, classify_terrain

EARTH_CIRCUMFERENCE_METERS = 40_075_016.686
METERS_PER_LATITUDE_DEGREE = 111_132.0
UNINHABITED_LATITUDE = -60.0


@dataclass(frozen=True)
class CultureAnchor:
    culture_id: str
    display_name: str
    longitude: float
    latitude: float
    radius_km: float
    weight: float


def clamp_terrarium_pixels(values: np.ndarray, zoom: int) -> np.ndarray:
    maximum_pixel = SOURCE_TILE_SIZE * (1 << zoom) - 1
    return np.clip(values, 0, maximum_pixel)


class TerrariumSampler:
    """Nearest-sample cached low-LOD elevation for picker summaries."""

    def __init__(self, cache: Path, zoom: int) -> None:
        self.cache = cache
        self.zoom = zoom
        self.tiles: dict[tuple[int, int], np.ndarray] = {}

    def sample(
        self,
        longitudes: np.ndarray,
        latitudes: np.ndarray,
    ) -> np.ndarray:
        global_x, global_y = web_mercator_pixel(
            longitudes,
            latitudes,
            self.zoom,
        )
        global_x = clamp_terrarium_pixels(global_x, self.zoom)
        global_y = clamp_terrarium_pixels(global_y, self.zoom)
        tile_columns = np.floor(global_x / SOURCE_TILE_SIZE).astype(np.int32)
        tile_rows = np.floor(global_y / SOURCE_TILE_SIZE).astype(np.int32)
        pixel_x = np.floor(global_x).astype(np.int32) % SOURCE_TILE_SIZE
        pixel_y = np.floor(global_y).astype(np.int32) % SOURCE_TILE_SIZE
        result = np.empty(longitudes.shape, dtype=np.float32)
        keys = np.unique(
            np.stack((tile_columns.ravel(), tile_rows.ravel()), axis=1),
            axis=0,
        )
        for column, row in keys:
            key = (int(column), int(row))
            tile = self.tiles.get(key)
            if tile is None:
                path = download_tile(self.cache, self.zoom, *key)
                with Image.open(path) as image:
                    tile = decode_terrarium(
                        np.asarray(image.convert("RGB"), dtype=np.uint8)
                    )
                self.tiles[key] = tile
            selection = (tile_columns == column) & (tile_rows == row)
            result[selection] = tile[pixel_y[selection], pixel_x[selection]]
        return result


def load_culture_anchors(path: Path) -> list[CultureAnchor]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    anchors: list[CultureAnchor] = []
    for culture in manifest["cultures"]:
        for anchor in culture["anchors"]:
            anchors.append(
                CultureAnchor(
                    culture_id=culture["id"],
                    display_name=culture["displayName"],
                    longitude=anchor["longitudeE6"] / 1_000_000,
                    latitude=anchor["latitudeE6"] / 1_000_000,
                    radius_km=anchor["radiusKm"],
                    weight=anchor["weight"],
                )
            )
    return anchors


def culture_for(
    longitude: float,
    latitude: float,
    anchors: list[CultureAnchor],
    geod: Geod,
) -> tuple[str, str]:
    scored: list[tuple[float, str, str]] = []
    for anchor in anchors:
        _, _, distance_meters = geod.inv(
            longitude,
            latitude,
            anchor.longitude,
            anchor.latitude,
        )
        score = (distance_meters / 1_000) / (anchor.radius_km * anchor.weight)
        scored.append((score, anchor.culture_id, anchor.display_name))
    _, culture_id, display_name = min(scored)
    return culture_id, display_name


def footprint_samples(
    longitude: float,
    latitude: float,
    extent_meters: float,
    samples_per_axis: int,
) -> tuple[np.ndarray, np.ndarray]:
    local_crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={latitude} +lon_0={longitude} "
        "+ellps=WGS84 +units=m +no_defs"
    )
    inverse = Transformer.from_crs(local_crs, "EPSG:4326", always_xy=True)
    half = extent_meters / 2
    step = extent_meters / samples_per_axis
    offsets = -half + step * (np.arange(samples_per_axis) + 0.5)
    east, north = np.meshgrid(offsets, offsets)
    sample_longitudes, sample_latitudes = inverse.transform(east, north)
    return sample_longitudes, sample_latitudes


def terrain_composition_permille(terrain: np.ndarray) -> dict[str, int]:
    names = (
        "water", "plains", "hills", "mountains", "desert", "tundra", "ice"
    )
    counts = np.asarray(
        [np.count_nonzero(terrain == TERRAIN_CODES[name]) for name in names],
        dtype=np.int64,
    )
    exact = counts * 1_000 / terrain.size
    permille = np.floor(exact).astype(np.int64)
    remainder = 1_000 - int(permille.sum())
    order = np.argsort(-(exact - permille), kind="stable")
    permille[order[:remainder]] += 1
    return {name: int(value) for name, value in zip(names, permille, strict=True)}


def vegetation_composition_permille(vegetation: np.ndarray) -> dict[str, int]:
    forest = int(np.count_nonzero((vegetation >= 1) & (vegetation <= 4)))
    jungle = int(np.count_nonzero((vegetation >= 5) & (vegetation <= 8)))
    return {
        "forest": math.floor(forest * 1_000 / vegetation.size),
        "jungle": math.floor(jungle * 1_000 / vegetation.size),
    }


def build_catalog(arguments: argparse.Namespace) -> dict[str, object]:
    base_terrain = load_base_terrain(arguments.base_terrain)
    vegetation = load_vegetation(arguments.vegetation)
    elevation = TerrariumSampler(arguments.elevation_cache, arguments.elevation_zoom)
    anchors = load_culture_anchors(arguments.cultures)
    geod = Geod(ellps="WGS84")
    latitude_spacing = (
        arguments.center_spacing_meters * math.sqrt(3) / 2
    ) / METERS_PER_LATITUDE_DEGREE
    candidates: list[dict[str, object]] = []
    row = 0
    latitude = -90 + latitude_spacing / 2
    while latitude < 90:
        circumference = EARTH_CIRCUMFERENCE_METERS * max(
            0.01, math.cos(math.radians(latitude))
        )
        columns = max(1, round(circumference / arguments.center_spacing_meters))
        longitude_step = 360 / columns
        row_offset = longitude_step / 2 if row % 2 else 0
        for column in range(columns):
            longitude = -180 + (column + 0.5) * longitude_step + row_offset
            if longitude >= 180:
                longitude -= 360
            if latitude <= UNINHABITED_LATITUDE:
                continue
            sample_longitudes, sample_latitudes = footprint_samples(
                longitude,
                latitude,
                arguments.theater_extent_meters,
                arguments.samples_per_axis,
            )
            sampled_base_terrain = sample_equirectangular(
                base_terrain,
                sample_longitudes,
                sample_latitudes,
            )
            sampled_vegetation = sample_equirectangular(
                vegetation,
                sample_longitudes,
                sample_latitudes,
            )
            land_ratio = float(
                np.count_nonzero(sampled_base_terrain != TERRAIN_CODES["water"])
            ) / sampled_base_terrain.size
            if land_ratio <= arguments.minimum_land_ratio:
                continue
            sampled_elevation = elevation.sample(
                sample_longitudes,
                sample_latitudes,
            )
            terrain = classify_terrain(
                sampled_elevation,
                arguments.theater_extent_meters / arguments.samples_per_axis,
                sampled_base_terrain,
            )
            composition = terrain_composition_permille(terrain)
            vegetation_composition = vegetation_composition_permille(
                sampled_vegetation
            )
            culture_id, culture_name = culture_for(
                longitude, latitude, anchors, geod
            )
            candidates.append(
                {
                    "index": len(candidates),
                    "id": f"world-r{row}-c{column}",
                    "center": {
                        "longitudeE6": round(longitude * 1_000_000),
                        "latitudeE6": round(latitude * 1_000_000),
                    },
                    "landRatioPermille": 1_000 - composition["water"],
                    "terrainPermille": composition,
                    "vegetationPermille": vegetation_composition,
                    "cultureId": culture_id,
                    "cultureName": culture_name,
                }
            )
        row += 1
        latitude += latitude_spacing
    return {
        "formatVersion": 5,
        "kind": "global-theater-catalog",
        "theaterExtentMeters": arguments.theater_extent_meters,
        "centerSpacingMeters": arguments.center_spacing_meters,
        "minimumLandRatioPermille": round(arguments.minimum_land_ratio * 1_000),
        "candidateCount": len(candidates),
        "candidates": candidates,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-terrain",
        type=Path,
        default=Path("public/maps/geography/base-terrain.png"),
    )
    parser.add_argument(
        "--vegetation",
        type=Path,
        default=Path("public/maps/geography/vegetation.png"),
    )
    parser.add_argument(
        "--elevation-cache",
        type=Path,
        default=Path(".cache/maps/terrarium"),
    )
    parser.add_argument("--elevation-zoom", type=int, default=5)
    parser.add_argument(
        "--cultures",
        type=Path,
        default=Path("public/maps/cultures/manifest.json"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/maps/theaters/catalog.json"),
    )
    parser.add_argument("--theater-extent-meters", type=int, default=768_000)
    parser.add_argument("--center-spacing-meters", type=int, default=384_000)
    parser.add_argument("--minimum-land-ratio", type=float, default=0.10)
    parser.add_argument("--samples-per-axis", type=int, default=24)
    return parser.parse_args()


def main(arguments: argparse.Namespace) -> None:
    catalog = build_catalog(arguments)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(catalog, separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {catalog['candidateCount']} playable Theater candidates to "
        f"{arguments.output}"
    )


if __name__ == "__main__":
    main(parse_args())
