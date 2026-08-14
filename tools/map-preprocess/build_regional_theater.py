"""Compile an accurately scaled Regional Theater from global elevation tiles.

The output is a disposable render/terrain derivative. Geographic positions stay
in WGS84 in the simulation; this compiler projects only the local theater view.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import math
from pathlib import Path
import struct
import sys
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image, ImageFilter
from hydrology import (
    MOISTURE_MODEL_VERSION,
    climate_moisture_from_cover,
    compile_available_moisture,
)
from osm_waterways import (
    NORMALIZER_VERSION,
    OSM_ATTRIBUTION,
    OSM_COPYRIGHT_URL,
    OSM_LICENSE,
    OSM_SNAPSHOT,
    load_osm_waterways,
)
from surface_cover import (
    ProjectedWaterway,
    apply_physical_water_mask,
    load_base_terrain,
    load_projected_waterways,
    load_vegetation,
    rasterize_projected_freshwater,
    rasterize_projected_mask,
    rasterize_projected_rivers,
    sample_equirectangular,
)
from terrain_classification import TERRAIN_CODES, classify_terrain

try:
    from pyproj import CRS, Transformer
except ImportError as error:
    raise SystemExit(
        "pyproj is required. Install the pinned tool dependency with: "
        "python -m pip install --target .cache/python pyproj==3.7.2"
    ) from error


TILE_SIZE = 512
SOURCE_TILE_SIZE = 256
SOURCE_URL = (
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
)
TERRAIN_PALETTE_SIZE = 48
BASE_RELIEF_PALETTE_SIZE = 46
RIVER_MINOR_PALETTE_INDEX = 46
RIVER_MAJOR_PALETTE_INDEX = 47
RIVER_MINOR_COLOR = (64, 125, 151)
RIVER_MAJOR_COLOR = (83, 151, 174)
SEMANTIC_METERS_PER_CELL = 250
SEMANTIC_CHUNK_SIZE = 128
SEMANTIC_CHUNK_ENCODING = "terrain-u8-vegetation-u8-moisture-u8-elevation-i16le-v2"
WATERWAY_GEOMETRY_ENCODING = "projected-waterway-f32-v1"
VEGETATION_FEATHER_METERS = 1_500
CLIMATE_TERRAIN_FEATHER_METERS = 3_000
SOURCE_ATTRIBUTION = "Mapzen Terrain Tiles (AWS Open Data)"
PHYSICAL_GEOMETRY_ROOT = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson"
)
LAND_GEOMETRY_FILES = (
    "ne_10m_land.geojson",
    "ne_10m_minor_islands.geojson",
)
LAKE_GEOMETRY_FILES = ("ne_10m_lakes.geojson",)


def web_mercator_pixel(
    longitude: np.ndarray | float,
    latitude: np.ndarray | float,
    zoom: int,
) -> tuple[np.ndarray, np.ndarray]:
    scale = SOURCE_TILE_SIZE * (1 << zoom)
    longitude_array = np.asarray(longitude, dtype=np.float64)
    latitude_array = np.clip(np.asarray(latitude, dtype=np.float64), -85.05112878, 85.05112878)
    x = (longitude_array + 180.0) / 360.0 * scale
    latitude_radians = np.radians(latitude_array)
    y = (
        1.0
        - np.arcsinh(np.tan(latitude_radians)) / math.pi
    ) / 2.0 * scale
    return x, y


def theater_edge_geography(
    inverse: Transformer,
    half_extent_meters: float,
    sample_count: int = 129,
) -> tuple[np.ndarray, np.ndarray]:
    edge = np.linspace(-half_extent_meters, half_extent_meters, sample_count)
    top_x = edge
    top_y = np.full_like(edge, half_extent_meters)
    bottom_x = edge
    bottom_y = np.full_like(edge, -half_extent_meters)
    side_y = edge
    left_x = np.full_like(edge, -half_extent_meters)
    right_x = np.full_like(edge, half_extent_meters)
    sample_x = np.concatenate((top_x, bottom_x, left_x, right_x))
    sample_y = np.concatenate((top_y, bottom_y, side_y, side_y))
    return inverse.transform(sample_x, sample_y)


def theater_bounds(
    inverse: Transformer,
    half_extent_meters: float,
    zoom: int,
) -> tuple[int, int, int, int]:
    longitude, latitude = theater_edge_geography(inverse, half_extent_meters)
    source_x, source_y = web_mercator_pixel(longitude, latitude, zoom)
    maximum_tile = (1 << zoom) - 1
    minimum_x = max(0, math.floor(float(source_x.min()) / SOURCE_TILE_SIZE) - 1)
    maximum_x = min(maximum_tile, math.floor(float(source_x.max()) / SOURCE_TILE_SIZE) + 1)
    minimum_y = max(0, math.floor(float(source_y.min()) / SOURCE_TILE_SIZE) - 1)
    maximum_y = min(maximum_tile, math.floor(float(source_y.max()) / SOURCE_TILE_SIZE) + 1)
    return minimum_x, maximum_x, minimum_y, maximum_y


def theater_geographic_bounds(
    inverse: Transformer,
    half_extent_meters: float,
    center_longitude: float,
    halo_meters: float = 5_000.0,
) -> tuple[float, float, float, float]:
    """Bound a projected Theater in WGS84, preserving dateline wrapping."""
    longitude, latitude = theater_edge_geography(
        inverse,
        half_extent_meters + halo_meters,
    )
    unwrapped = center_longitude + (
        (np.asarray(longitude) - center_longitude + 180.0) % 360.0
    ) - 180.0
    west_unwrapped = float(unwrapped.min())
    east_unwrapped = float(unwrapped.max())
    if east_unwrapped - west_unwrapped >= 360.0:
        raise ValueError("Regional Theater waterway bounds span the globe")

    def wrap(value: float) -> float:
        return ((value + 180.0) % 360.0) - 180.0

    return (
        max(-90.0, float(np.asarray(latitude).min())),
        wrap(west_unwrapped),
        min(90.0, float(np.asarray(latitude).max())),
        wrap(east_unwrapped),
    )


def download_source(destination: Path, url: str) -> Path:
    if destination.exists():
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": "GrandStrategy-theater-compiler/1"})
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                payload = response.read()
            temporary = destination.with_name(f"{destination.name}.tmp")
            temporary.write_bytes(payload)
            temporary.replace(destination)
            return destination
        except (OSError, URLError) as error:
            last_error = error
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"Unable to download {url}") from last_error


def download_tile(cache: Path, zoom: int, column: int, row: int) -> Path:
    destination = cache / str(zoom) / str(column) / f"{row}.png"
    url = SOURCE_URL.format(z=zoom, x=column, y=row)
    return download_source(destination, url)


def load_physical_geometry(
    cache: Path,
    filenames: tuple[str, ...],
) -> list[Path]:
    return [
        download_source(cache / filename, f"{PHYSICAL_GEOMETRY_ROOT}/{filename}")
        for filename in filenames
    ]


def load_source_mosaic(
    cache: Path,
    zoom: int,
    bounds: tuple[int, int, int, int],
) -> tuple[np.ndarray, int, int]:
    minimum_x, maximum_x, minimum_y, maximum_y = bounds
    coordinates = [
        (column, row)
        for row in range(minimum_y, maximum_y + 1)
        for column in range(minimum_x, maximum_x + 1)
    ]
    with ThreadPoolExecutor(max_workers=12) as executor:
        paths = list(
            executor.map(
                lambda coordinate: download_tile(cache, zoom, *coordinate),
                coordinates,
            )
        )

    columns = maximum_x - minimum_x + 1
    rows = maximum_y - minimum_y + 1
    mosaic = np.empty(
        (rows * SOURCE_TILE_SIZE, columns * SOURCE_TILE_SIZE, 3),
        dtype=np.uint8,
    )
    for (column, row), path in zip(coordinates, paths, strict=True):
        with Image.open(path) as tile:
            source = np.asarray(tile.convert("RGB"), dtype=np.uint8)
        left = (column - minimum_x) * SOURCE_TILE_SIZE
        top = (row - minimum_y) * SOURCE_TILE_SIZE
        mosaic[top : top + SOURCE_TILE_SIZE, left : left + SOURCE_TILE_SIZE] = source
    return mosaic, minimum_x * SOURCE_TILE_SIZE, minimum_y * SOURCE_TILE_SIZE


def decode_terrarium(source: np.ndarray) -> np.ndarray:
    if source.ndim != 3 or source.shape[2] != 3 or source.dtype != np.uint8:
        raise ValueError("Terrarium source must be an RGB uint8 image")
    result = source[:, :, 0].astype(np.float32)
    result *= np.float32(256.0)
    stripe_rows = 512
    for top in range(0, result.shape[0], stripe_rows):
        bottom = min(result.shape[0], top + stripe_rows)
        stripe = result[top:bottom]
        np.add(
            stripe,
            source[top:bottom, :, 1],
            out=stripe,
            casting="unsafe",
        )
        blue = source[top:bottom, :, 2].astype(np.float32)
        blue *= np.float32(1.0 / 256.0)
        stripe += blue
    result -= np.float32(32768.0)
    return result


def bilinear_sample(
    elevation: np.ndarray,
    source_x: np.ndarray,
    source_y: np.ndarray,
) -> np.ndarray:
    x0 = np.floor(source_x).astype(np.int32)
    y0 = np.floor(source_y).astype(np.int32)
    x0 = np.clip(x0, 0, elevation.shape[1] - 2)
    y0 = np.clip(y0, 0, elevation.shape[0] - 2)
    x1 = x0 + 1
    y1 = y0 + 1
    fraction_x = source_x - x0
    fraction_y = source_y - y0
    top = elevation[y0, x0] * (1.0 - fraction_x) + elevation[y0, x1] * fraction_x
    bottom = elevation[y1, x0] * (1.0 - fraction_x) + elevation[y1, x1] * fraction_x
    return top * (1.0 - fraction_y) + bottom * fraction_y


def project_geography(
    inverse: Transformer,
    source_elevation: np.ndarray,
    source_origin_x: int,
    source_origin_y: int,
    zoom: int,
    global_base_terrain: np.ndarray,
    global_vegetation: np.ndarray,
    pixel_size: int,
    extent_meters: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Project all raster geography through one coordinate transform per stripe."""
    meters_per_pixel = extent_meters / pixel_size
    x = -extent_meters / 2.0 + (np.arange(pixel_size) + 0.5) * meters_per_pixel
    elevation = np.empty((pixel_size, pixel_size), dtype=np.float32)
    base_terrain = np.empty((pixel_size, pixel_size), dtype=np.uint8)
    vegetation = np.empty((pixel_size, pixel_size), dtype=np.uint8)
    chunk_height = 128
    for top in range(0, pixel_size, chunk_height):
        bottom = min(pixel_size, top + chunk_height)
        y = extent_meters / 2.0 - (np.arange(top, bottom) + 0.5) * meters_per_pixel
        local_x, local_y = np.meshgrid(x, y)
        longitude, latitude = inverse.transform(local_x, local_y)
        source_x, source_y = web_mercator_pixel(longitude, latitude, zoom)
        elevation[top:bottom] = bilinear_sample(
            source_elevation,
            source_x - source_origin_x,
            source_y - source_origin_y,
        )
        base_terrain[top:bottom] = sample_equirectangular(
            global_base_terrain,
            longitude,
            latitude,
        )
        vegetation[top:bottom] = sample_equirectangular(
            global_vegetation,
            longitude,
            latitude,
        )
    return elevation, base_terrain, vegetation


def interpolate_palette(values: np.ndarray, stops: list[tuple[float, tuple[int, int, int]]]) -> np.ndarray:
    result = np.empty((*values.shape, 3), dtype=np.float32)
    positions = np.asarray([stop[0] for stop in stops], dtype=np.float32)
    for channel in range(3):
        colors = np.asarray([stop[1][channel] for stop in stops], dtype=np.float32)
        result[:, :, channel] = np.interp(values, positions, colors)
    return result


def soften_vegetation_cover(
    vegetation: np.ndarray,
    meters_per_pixel: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Build smooth presentation fields without changing semantic cover cells."""
    vegetation_weights = np.asarray(
        [0.0, 0.16, 0.27, 0.40, 0.54, 0.24, 0.38, 0.54, 0.68],
        dtype=np.float32,
    )
    opacity = vegetation_weights[vegetation]
    forest = np.where((vegetation >= 1) & (vegetation <= 4), opacity, 0.0)
    jungle = np.where(vegetation >= 5, opacity, 0.0)
    radius = VEGETATION_FEATHER_METERS / meters_per_pixel

    def feather(field: np.ndarray) -> np.ndarray:
        encoded = Image.fromarray(
            np.rint(field * 255.0).astype(np.uint8),
        )
        blurred = encoded.filter(ImageFilter.GaussianBlur(radius=radius))
        return np.asarray(blurred, dtype=np.float32) / 255.0

    return feather(forest), feather(jungle)


def soften_climate_terrain(
    base_terrain: np.ndarray,
    meters_per_pixel: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Feather visual climate cover while preserving categorical gameplay cells."""
    radius = CLIMATE_TERRAIN_FEATHER_METERS / meters_per_pixel

    def feather(terrain_code: int) -> np.ndarray:
        encoded = Image.fromarray(
            np.where(base_terrain == terrain_code, 255, 0).astype(np.uint8),
        )
        blurred = encoded.filter(ImageFilter.GaussianBlur(radius=radius))
        return np.asarray(blurred, dtype=np.float32) / 255.0

    return (
        feather(TERRAIN_CODES["desert"]),
        feather(TERRAIN_CODES["tundra"]),
        feather(TERRAIN_CODES["ice"]),
    )


def _style_relief_region(
    elevation: np.ndarray,
    meters_per_pixel: float,
    base_terrain: np.ndarray,
    vegetation: np.ndarray,
) -> np.ndarray:
    water = base_terrain == TERRAIN_CODES["water"]
    land_stops = [
        (0.0, (174, 177, 125)),
        (120.0, (157, 164, 108)),
        (450.0, (135, 144, 93)),
        (900.0, (144, 126, 88)),
        (1_600.0, (158, 139, 108)),
        (2_600.0, (185, 174, 150)),
        (4_500.0, (218, 215, 197)),
    ]
    water_stops = [
        (-7_000.0, (39, 82, 105)),
        (-2_500.0, (51, 101, 121)),
        (-500.0, (71, 128, 145)),
        (0.0, (105, 157, 165)),
    ]
    rgb = interpolate_palette(np.maximum(elevation, 0.0), land_stops)
    water_rgb = interpolate_palette(np.minimum(elevation, 0.0), water_stops)
    rgb[water] = water_rgb[water]

    relief_fade = np.clip(
        (1_700.0 - np.maximum(elevation, 0.0)) / 1_400.0,
        0.18,
        1.0,
    )
    desert_cover, tundra_cover, ice_cover = soften_climate_terrain(
        base_terrain,
        meters_per_pixel,
    )
    open_land_cover = 1.0 - np.clip(
        desert_cover + tundra_cover + ice_cover,
        0.0,
        1.0,
    )
    climate_weights = np.stack(
        (
            open_land_cover * 0.12,
            desert_cover * 0.58,
            tundra_cover * 0.52,
            ice_cover * 0.70,
        ),
        axis=2,
    )
    climate_weights *= relief_fade[:, :, None]
    climate_weights[water] = 0.0
    climate_weight = climate_weights.sum(axis=2)
    climate_colors = np.asarray(
        (
            (158, 166, 108),
            (195, 166, 112),
            (151, 154, 126),
            (220, 224, 218),
        ),
        dtype=np.float32,
    )
    rgb = (
        rgb * (1.0 - climate_weight[:, :, None])
        + np.einsum("hwc,cd->hwd", climate_weights, climate_colors)
    )

    forest_weight, jungle_weight = soften_vegetation_cover(
        vegetation,
        meters_per_pixel,
    )
    forest_weight *= relief_fade
    jungle_weight *= relief_fade
    forest_weight[water] = 0.0
    jungle_weight[water] = 0.0
    feature_weights = forest_weight + jungle_weight
    rgb = (
        rgb * (1.0 - feature_weights[:, :, None])
        + np.asarray((91, 127, 78), dtype=np.float32) * forest_weight[:, :, None]
        + np.asarray((57, 105, 65), dtype=np.float32) * jungle_weight[:, :, None]
    )

    gradient_y, gradient_x = np.gradient(elevation, meters_per_pixel)
    normal_x = -gradient_x
    normal_y = -gradient_y
    normal_z = np.ones_like(elevation)
    length = np.sqrt(normal_x * normal_x + normal_y * normal_y + 1.0)
    normal_x /= length
    normal_y /= length
    normal_z /= length
    azimuth = math.radians(315.0)
    altitude = math.radians(42.0)
    light_x = math.sin(azimuth) * math.cos(altitude)
    light_y = -math.cos(azimuth) * math.cos(altitude)
    light_z = math.sin(altitude)
    shade = np.clip(
        normal_x * light_x + normal_y * light_y + normal_z * light_z,
        0.0,
        1.0,
    )
    land_light = 0.72 + shade * 0.48
    water_light = 0.90 + shade * 0.12
    light = np.where(water, water_light, land_light)
    rgb *= light[:, :, None]

    # Fixed elevation bands keep the relief readable at nearest-neighbor zoom.
    bands = np.mod(np.maximum(elevation, 0.0), 125.0) < 5.0
    rgb[bands & ~water] *= 0.94
    return np.clip(rgb, 0, 255).astype(np.uint8)


def style_relief(
    elevation: np.ndarray,
    meters_per_pixel: float,
    base_terrain: np.ndarray,
    vegetation: np.ndarray,
) -> Image.Image:
    """Style bounded strips with blur halos instead of full-size float RGB fields."""
    if elevation.shape != base_terrain.shape or elevation.shape != vegetation.shape:
        raise ValueError("Relief inputs must share one projected grid")
    height, width = elevation.shape
    stripe_rows = 512
    blur_halo = max(
        2,
        math.ceil(
            max(VEGETATION_FEATHER_METERS, CLIMATE_TERRAIN_FEATHER_METERS)
            / meters_per_pixel
            * 4.0
        ) + 2,
    )
    styled = np.empty((height, width, 3), dtype=np.uint8)
    for top in range(0, height, stripe_rows):
        bottom = min(height, top + stripe_rows)
        source_top = max(0, top - blur_halo)
        source_bottom = min(height, bottom + blur_halo)
        region = _style_relief_region(
            elevation[source_top:source_bottom],
            meters_per_pixel,
            base_terrain[source_top:source_bottom],
            vegetation[source_top:source_bottom],
        )
        crop_top = top - source_top
        styled[top:bottom] = region[crop_top:crop_top + bottom - top]
    return Image.fromarray(styled).quantize(
        colors=BASE_RELIEF_PALETTE_SIZE,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )


def resample_river_codes(
    rivers: np.ndarray,
    width: int,
    height: int,
) -> np.ndarray:
    """Downsample categorical river lines with max pooling so none disappear."""
    source_height, source_width = rivers.shape
    if (source_width, source_height) == (width, height):
        return rivers
    if source_width % width == 0 and source_height % height == 0:
        factor_x = source_width // width
        factor_y = source_height // height
        return rivers.reshape(height, factor_y, width, factor_x).max(axis=(1, 3))
    return np.asarray(
        Image.fromarray(rivers).resize((width, height), Image.Resampling.NEAREST),
        dtype=np.uint8,
    )


def overlay_rivers(image: Image.Image, rivers: np.ndarray) -> Image.Image:
    """Place crisp river classes into reserved palette slots."""
    if image.size != (rivers.shape[1], rivers.shape[0]):
        raise ValueError("River presentation and relief dimensions must match")
    if image.mode != "P":
        image = image.convert("RGB").quantize(
            colors=BASE_RELIEF_PALETTE_SIZE,
            method=Image.Quantize.MEDIANCUT,
            dither=Image.Dither.NONE,
        )
    indices = np.asarray(image, dtype=np.uint8).copy()
    indices[rivers == 1] = RIVER_MINOR_PALETTE_INDEX
    indices[rivers == 2] = RIVER_MAJOR_PALETTE_INDEX
    result = Image.frombytes("P", image.size, indices.tobytes(order="C"))
    palette = list(image.getpalette() or [])
    palette.extend([0] * (768 - len(palette)))
    palette[RIVER_MINOR_PALETTE_INDEX * 3 : RIVER_MINOR_PALETTE_INDEX * 3 + 3] = (
        RIVER_MINOR_COLOR
    )
    palette[RIVER_MAJOR_PALETTE_INDEX * 3 : RIVER_MAJOR_PALETTE_INDEX * 3 + 3] = (
        RIVER_MAJOR_COLOR
    )
    result.putpalette(palette[:768])
    return result


def write_tiles(
    image: Image.Image,
    output: Path,
    minimum_width: int = 1_024,
    rivers: np.ndarray | None = None,
) -> list[dict[str, int]]:
    levels: list[dict[str, int]] = []
    maximum_width = image.width
    widths = []
    width = minimum_width
    while width < maximum_width:
        widths.append(width)
        width *= 2
    widths.append(maximum_width)
    for level, width in enumerate(widths):
        height = round(image.height * width / image.width)
        rendered = image if width == maximum_width else image.resize(
            (width, height),
            Image.Resampling.LANCZOS,
        )
        if image.mode == "P" and rendered.mode != "P":
            rendered = rendered.convert("RGB").quantize(
                palette=image,
                dither=Image.Dither.NONE,
            )
        if rivers is not None:
            level_rivers = resample_river_codes(rivers, width, height)
            if width < 4_096:
                level_rivers[level_rivers == 1] = 0
            rendered = overlay_rivers(
                rendered,
                level_rivers,
            )
        columns = math.ceil(width / TILE_SIZE)
        rows = math.ceil(height / TILE_SIZE)
        level_directory = output / str(level)
        level_directory.mkdir(parents=True, exist_ok=True)
        for row in range(rows):
            for column in range(columns):
                tile = rendered.crop(
                    (
                        column * TILE_SIZE,
                        row * TILE_SIZE,
                        min((column + 1) * TILE_SIZE, width),
                        min((row + 1) * TILE_SIZE, height),
                    )
                )
                tile.save(level_directory / f"{column}_{row}.png", optimize=True)
        levels.append(
            {
                "level": level,
                "width": width,
                "height": height,
                "columns": columns,
                "rows": rows,
            }
        )
    return levels


def build_atlas_preview(
    styled: Image.Image,
    forward: Transformer,
    inverse: Transformer,
    extent_meters: int,
    pixel_size: int = 2_048,
) -> tuple[Image.Image, dict[str, int]]:
    longitude, latitude = theater_edge_geography(inverse, extent_meters / 2.0)
    west = float(longitude.min())
    east = float(longitude.max())
    south = float(latitude.min())
    north = float(latitude.max())
    source = np.asarray(styled.convert("RGB"), dtype=np.uint8)
    result = np.zeros((pixel_size, pixel_size, 4), dtype=np.uint8)
    longitudes = west + (np.arange(pixel_size) + 0.5) / pixel_size * (east - west)
    half_extent = extent_meters / 2.0
    for top in range(0, pixel_size, 128):
        bottom = min(pixel_size, top + 128)
        latitudes = north - (
            (np.arange(top, bottom) + 0.5) / pixel_size * (north - south)
        )
        longitude_grid, latitude_grid = np.meshgrid(longitudes, latitudes)
        local_x, local_y = forward.transform(longitude_grid, latitude_grid)
        valid = (
            (np.abs(local_x) <= half_extent)
            & (np.abs(local_y) <= half_extent)
        )
        source_x = np.clip(
            ((local_x + half_extent) / extent_meters * styled.width).astype(np.int32),
            0,
            styled.width - 1,
        )
        source_y = np.clip(
            ((half_extent - local_y) / extent_meters * styled.height).astype(np.int32),
            0,
            styled.height - 1,
        )
        sampled = source[source_y, source_x]
        result[top:bottom, :, :3] = sampled
        result[top:bottom, :, 3] = np.where(valid, 255, 0).astype(np.uint8)
    return Image.fromarray(result), {
        "westLongitudeE6": round(west * 1_000_000),
        "eastLongitudeE6": round(east * 1_000_000),
        "southLatitudeE6": round(south * 1_000_000),
        "northLatitudeE6": round(north * 1_000_000),
    }


def write_semantic_data(
    elevation: np.ndarray,
    base_terrain: np.ndarray,
    vegetation: np.ndarray,
    freshwater_strengths: np.ndarray,
    extent_meters: int,
    output: Path,
) -> dict[str, int | str]:
    width = extent_meters // SEMANTIC_METERS_PER_CELL
    source = Image.fromarray(elevation)
    sampled = np.asarray(
        source.resize((width, width), Image.Resampling.BILINEAR),
        dtype=np.float32,
    )
    sampled_base_terrain = np.asarray(
        Image.fromarray(base_terrain).resize(
            (width, width),
            Image.Resampling.NEAREST,
        ),
        dtype=np.uint8,
    )
    sampled_vegetation = np.asarray(
        Image.fromarray(vegetation).resize(
            (width, width),
            Image.Resampling.NEAREST,
        ),
        dtype=np.uint8,
    )
    if freshwater_strengths.shape != (width, width):
        raise ValueError("Freshwater strengths must use the semantic grid")
    encoded = np.clip(np.rint(sampled), -32768, 32767).astype("<i2")
    mask = Image.fromarray(
        np.where(
            sampled_base_terrain != TERRAIN_CODES["water"],
            255,
            0,
        ).astype(np.uint8),
    )
    mask.save(output / "land-mask.png", optimize=True)
    terrain = classify_terrain(
        sampled,
        SEMANTIC_METERS_PER_CELL,
        sampled_base_terrain,
    )
    land = sampled_base_terrain != TERRAIN_CODES["water"]
    climate_moisture = climate_moisture_from_cover(
        sampled_base_terrain,
        sampled_vegetation,
        SEMANTIC_METERS_PER_CELL,
    )
    moisture = compile_available_moisture(
        climate_moisture,
        freshwater_strengths,
        land,
        SEMANTIC_METERS_PER_CELL,
    )
    chunk_columns = math.ceil(width / SEMANTIC_CHUNK_SIZE)
    chunk_rows = math.ceil(width / SEMANTIC_CHUNK_SIZE)
    chunk_root = output / "semantic"
    chunk_root.mkdir(parents=True, exist_ok=True)
    for obsolete in chunk_root.glob("*.bin"):
        obsolete.unlink()
    for row in range(chunk_rows):
        top = row * SEMANTIC_CHUNK_SIZE
        bottom = min(width, top + SEMANTIC_CHUNK_SIZE)
        for column in range(chunk_columns):
            left = column * SEMANTIC_CHUNK_SIZE
            right = min(width, left + SEMANTIC_CHUNK_SIZE)
            chunk_width = right - left
            chunk_height = bottom - top
            header = struct.pack(
                "<4sHHHHI",
                b"GSSC",
                2,
                0,
                chunk_width,
                chunk_height,
                0,
            )
            payload = b"".join(
                (
                    terrain[top:bottom, left:right].tobytes(order="C"),
                    sampled_vegetation[top:bottom, left:right].tobytes(order="C"),
                    moisture[top:bottom, left:right].tobytes(order="C"),
                    encoded[top:bottom, left:right].tobytes(order="C"),
                )
            )
            (chunk_root / f"{column}_{row}.bin").write_bytes(header + payload)
    for obsolete_name in (
        "elevation.i16",
        "vegetation.u8",
        "river.u8",
        "terrain.u8",
    ):
        (output / obsolete_name).unlink(missing_ok=True)
    return {
        "width": width,
        "height": width,
        "metersPerCell": SEMANTIC_METERS_PER_CELL,
        "landMaskPath": "land-mask.png",
        "chunkSize": SEMANTIC_CHUNK_SIZE,
        "chunkColumns": chunk_columns,
        "chunkRows": chunk_rows,
        "chunkPath": "semantic/{column}_{row}.bin",
        "chunkEncoding": SEMANTIC_CHUNK_ENCODING,
        "moistureModelVersion": MOISTURE_MODEL_VERSION,
    }


def write_waterway_geometry(
    waterways: tuple[ProjectedWaterway, ...],
    output: Path,
) -> dict[str, int | str]:
    """Write stable projected OSM centerlines independently of presentation pixels."""
    regime_codes = {"unknown": 0, "perennial": 1, "intermittent": 2, "seasonal": 3}
    waterway_codes = {"river": 1, "stream": 2, "tidal_channel": 3}
    records: list[tuple[bytes, bytes]] = []
    total_points = 0
    for waterway_record in waterways:
        properties = waterway_record.properties
        local_x = waterway_record.local_x
        local_y = waterway_record.local_y
        source_id = str(properties.get("sourceId") or "way/0")
        try:
            way_id = int(source_id.rsplit("/", 1)[-1])
        except ValueError:
            way_id = 0
        display_class = properties.get("displayClass")
        if display_class not in ("minor", "major"):
            continue
        river_class = 2 if display_class == "major" else 1
        regime = regime_codes.get(str(properties.get("regime")), 0)
        waterway = waterway_codes.get(str(properties.get("waterway")), 0)
        default_width = 40.0 if river_class == 2 else 12.0
        width_meters = float(properties.get("widthMeters") or default_width)
        name = str(properties.get("name") or "").encode("utf-8")[:65_535]
        points = np.column_stack((local_x, local_y)).astype("<f4").tobytes(order="C")
        header = struct.pack(
            "<QBBBBfI",
            way_id,
            river_class,
            regime,
            waterway,
            0,
            width_meters,
            len(local_x),
        ) + struct.pack("<H", len(name))
        records.append((header + name, points))
        total_points += len(local_x)
    with (output / "waterways.bin").open("wb") as handle:
        handle.write(struct.pack("<4sHHII", b"GSHY", 1, 0, len(records), total_points))
        for header, points in records:
            handle.write(header)
            handle.write(points)
    return {
        "geometryPath": "waterways.bin",
        "geometryEncoding": WATERWAY_GEOMETRY_ENCODING,
        "geometryFeatureCount": len(records),
        "geometryPointCount": total_points,
    }


def compile_theater(arguments: argparse.Namespace) -> None:
    extent_meters = int(round(arguments.extent_km * 1_000))
    pixel_size = int(round(extent_meters / arguments.meters_per_pixel))
    if pixel_size < 1_024 or pixel_size & (pixel_size - 1):
        raise ValueError("The rendered theater width must be a power of two and at least 1024")
    if pixel_size % TILE_SIZE:
        raise ValueError("The rendered theater width must be divisible by the tile size")

    output = arguments.output
    output.mkdir(parents=True, exist_ok=True)
    projection_definition = (
        f"+proj=aeqd +lat_0={arguments.center_latitude} "
        f"+lon_0={arguments.center_longitude} +ellps=WGS84 +units=m +no_defs"
    )
    local_crs = CRS.from_proj4(projection_definition)
    inverse = Transformer.from_crs(local_crs, "EPSG:4326", always_xy=True)
    forward = Transformer.from_crs("EPSG:4326", local_crs, always_xy=True)
    bounds = theater_bounds(inverse, extent_meters / 2.0, arguments.source_zoom)
    print(
        f"Downloading/loading {bounds[1] - bounds[0] + 1} x "
        f"{bounds[3] - bounds[2] + 1} source tiles...",
        flush=True,
    )
    source, source_origin_x, source_origin_y = load_source_mosaic(
        arguments.cache,
        arguments.source_zoom,
        bounds,
    )
    source_elevation = decode_terrarium(source)
    del source
    print(f"Projecting {pixel_size:,} x {pixel_size:,} geography...", flush=True)
    global_base_terrain = load_base_terrain(arguments.base_terrain)
    global_vegetation = load_vegetation(arguments.vegetation)
    elevation, base_terrain, vegetation = project_geography(
        inverse,
        source_elevation,
        source_origin_x,
        source_origin_y,
        arguments.source_zoom,
        global_base_terrain,
        global_vegetation,
        pixel_size,
        extent_meters,
    )
    del source_elevation, global_base_terrain, global_vegetation
    print("Rasterizing detailed physical coastlines...", flush=True)
    land = rasterize_projected_mask(
        load_physical_geometry(
            arguments.physical_geometry_cache,
            LAND_GEOMETRY_FILES,
        ),
        forward,
        extent_meters,
        pixel_size,
    )
    lakes = rasterize_projected_mask(
        load_physical_geometry(
            arguments.physical_geometry_cache,
            LAKE_GEOMETRY_FILES,
        ),
        forward,
        extent_meters,
        pixel_size,
    )
    print(
        f"Loading OpenStreetMap waterways from the {OSM_SNAPSHOT} snapshot...",
        flush=True,
    )
    waterway_dataset = load_osm_waterways(
        arguments.osm_waterway_cache,
        theater_geographic_bounds(
            inverse,
            extent_meters / 2.0,
            arguments.center_longitude,
            halo_meters=128_000.0,
        ),
    )
    projected_waterways = load_projected_waterways(
        waterway_dataset.path,
        forward,
        extent_meters,
    )
    rivers = rasterize_projected_rivers(
        projected_waterways,
        extent_meters,
        pixel_size,
    )
    semantic_freshwater = rasterize_projected_freshwater(
        projected_waterways,
        extent_meters,
        extent_meters // SEMANTIC_METERS_PER_CELL,
    )
    base_terrain = apply_physical_water_mask(base_terrain, land, lakes)
    vegetation[~land | lakes] = 0
    rivers[~land | lakes] = 0
    del land, lakes
    print("Styling relief and writing the tile pyramid...", flush=True)
    styled = style_relief(
        elevation,
        arguments.meters_per_pixel,
        base_terrain,
        vegetation,
    )
    levels = write_tiles(styled, output / "tiles", rivers=rivers)
    semantic = write_semantic_data(
        elevation,
        base_terrain,
        vegetation,
        semantic_freshwater,
        extent_meters,
        output,
    )
    hydrography_geometry = write_waterway_geometry(
        projected_waterways,
        output,
    )
    atlas_preview, atlas_bounds = build_atlas_preview(
        overlay_rivers(styled, rivers),
        forward,
        inverse,
        extent_meters,
    )
    atlas_levels = write_tiles(atlas_preview, output / "atlas-preview")

    center_longitude_e6 = round(arguments.center_longitude * 1_000_000)
    center_latitude_e6 = round(arguments.center_latitude * 1_000_000)
    maximum_radius = math.sqrt(2.0) * extent_meters / 2.0
    earth_radius = 6_371_008.8
    angular_radius = maximum_radius / earth_radius
    tangential_scale = angular_radius / math.sin(angular_radius)
    manifest = {
        "formatVersion": 14,
        "id": arguments.id,
        "name": arguments.name,
        "kind": "regional-theater",
        "projection": {
            "type": "azimuthal-equidistant",
            "definition": projection_definition,
            "center": {
                "longitudeE6": center_longitude_e6,
                "latitudeE6": center_latitude_e6,
            },
        },
        "extent": {
            "widthMeters": extent_meters,
            "heightMeters": extent_meters,
        },
        "render": {
            "width": pixel_size,
            "height": pixel_size,
            "metersPerPixel": arguments.meters_per_pixel,
            "tileSize": TILE_SIZE,
            "paletteColors": TERRAIN_PALETTE_SIZE,
            "levels": levels,
        },
        "atlasPreview": {
            **atlas_bounds,
            "width": atlas_preview.width,
            "height": atlas_preview.height,
            "tileSize": TILE_SIZE,
            "levels": atlas_levels,
            "tilePath": "atlas-preview",
        },
        "semantic": semantic,
        "validation": {
            "maximumEstimatedScaleErrorPercent": round(
                (tangential_scale - 1.0) * 100.0,
                4,
            ),
        },
        "source": {
            "name": SOURCE_ATTRIBUTION,
            "url": "https://registry.opendata.aws/terrain-tiles/",
            "format": "Terrarium elevation PNG",
            "sourceZoom": arguments.source_zoom,
        },
        "naturalCoverSource": {
            "name": "Natural Earth II 1:10m idealized land cover v3.2.0",
            "url": "https://www.naturalearthdata.com/downloads/10m-raster-data/10m-natural-earth-2/",
            "format": "independent base-terrain and vegetation-density rasters",
        },
        "physicalGeometrySource": {
            "name": "Natural Earth 1:10m land, minor islands, and lakes",
            "url": "https://www.naturalearthdata.com/downloads/10m-physical-vectors/",
            "format": "WGS84 GeoJSON rasterized directly to the local Theater grid",
        },
        "hydrographySource": {
            "name": "OpenStreetMap natural waterways",
            "url": OSM_COPYRIGHT_URL,
            "format": "checksummed regional PBF extracts normalized to WGS84 GeoJSON and rasterized offline",
            "snapshot": waterway_dataset.snapshot,
            "normalizerVersion": NORMALIZER_VERSION,
            "normalizedHash": f"sha256:{waterway_dataset.normalized_hash}",
            "featureCount": waterway_dataset.feature_count,
            "attribution": OSM_ATTRIBUTION,
            "license": OSM_LICENSE,
            "extracts": [
                {
                    "id": source.source_id,
                    "url": source.url,
                    "md5": source.checksum,
                }
                for source in waterway_dataset.sources
            ],
            **hydrography_geometry,
        },
        "moistureModel": {
            "version": MOISTURE_MODEL_VERSION,
            "meaning": "long-term available moisture from climate supply and natural freshwater access",
            "climateAdapter": "Natural Earth II idealized natural cover",
            "drainageAdapter": "OSM natural freshwater network with Horton-Strahler prominence",
        },
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {output / 'manifest.json'}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--id", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--center-longitude", type=float, required=True)
    parser.add_argument("--center-latitude", type=float, required=True)
    parser.add_argument("--extent-km", type=float, default=768.0)
    parser.add_argument("--meters-per-pixel", type=float, default=93.75)
    parser.add_argument("--source-zoom", type=int, default=11)
    parser.add_argument("--cache", type=Path, default=Path(".cache/maps/terrarium"))
    parser.add_argument(
        "--physical-geometry-cache",
        type=Path,
        default=Path(".cache/maps"),
    )
    parser.add_argument(
        "--osm-waterway-cache",
        type=Path,
        default=Path(".cache/maps/osm-waterways"),
    )
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
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    try:
        compile_theater(parse_args())
    except KeyboardInterrupt:
        sys.exit(130)
