"""Compile the global Natural Earth II land-cover raster to semantic cells."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from surface_cover import (
    VEGETATION_CODES,
    classify_land_cover_rgb,
    rasterize_land_mask,
)
from terrain_classification import TERRAIN_CODES


DEFAULT_WIDTH = 16_384
SOURCE_NAME = "Natural Earth II 1:10m idealized land cover v3.2.0"
SOURCE_URL = "https://naciscdn.org/naturalearth/10m/raster/NE2_HR_LC.zip"


def build_surface_cover(arguments: argparse.Namespace) -> None:
    height = arguments.width // 2
    Image.MAX_IMAGE_PIXELS = None
    with Image.open(arguments.source) as source:
        resized = source.convert("RGB").resize(
            (arguments.width, height),
            Image.Resampling.LANCZOS,
        )
    latitudes = 90.0 - (np.arange(height) + 0.5) * 180.0 / height
    terrain, vegetation = classify_land_cover_rgb(
        np.asarray(resized, dtype=np.uint8),
        latitudes,
    )
    land = rasterize_land_mask(arguments.land_source, arguments.width, height)
    terrain[~land] = TERRAIN_CODES["water"]
    vegetation[~land] = 0

    arguments.terrain_output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(terrain).save(
        arguments.terrain_output,
        optimize=True,
    )
    Image.fromarray(vegetation).save(
        arguments.vegetation_output,
        optimize=True,
    )
    manifest = {
        "formatVersion": 3,
        "kind": "global-natural-cover",
        "projection": "equirectangular",
        "width": arguments.width,
        "height": height,
        "baseTerrainPath": arguments.terrain_output.name,
        "vegetationPath": arguments.vegetation_output.name,
        "source": SOURCE_NAME,
        "sourceUrl": SOURCE_URL,
        "terrainCodes": {
            name: TERRAIN_CODES[name]
            for name in (
                "water", "plains", "hills", "mountains", "desert", "tundra", "ice"
            )
        },
        "vegetationCodes": VEGETATION_CODES,
    }
    arguments.terrain_output.with_name("manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {arguments.width:,} x {height:,} semantic surface cover to "
        f"{arguments.terrain_output} and {arguments.vegetation_output}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(".cache/maps/NE2_HR_LC/NE2_HR_LC.tif"),
    )
    parser.add_argument(
        "--land-source",
        type=Path,
        default=Path(".cache/maps/ne_50m_land.geojson"),
    )
    parser.add_argument(
        "--terrain-output",
        type=Path,
        default=Path("public/maps/geography/base-terrain.png"),
    )
    parser.add_argument(
        "--vegetation-output",
        type=Path,
        default=Path("public/maps/geography/vegetation.png"),
    )
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    return parser.parse_args()


if __name__ == "__main__":
    build_surface_cover(parse_args())
