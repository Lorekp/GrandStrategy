"""Semantic base terrain and vegetation derived from Natural Earth II colors.

The Natural Earth raster is an input dataset, never a runtime render lookup.
This module compiles it once into compact categorical cells shared by the
Regional Theater compiler and the global picker catalog.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from terrain_classification import TERRAIN_CODES


VEGETATION_CODES = {
    "none": 0,
    "forest-sparse": 1,
    "forest-light": 2,
    "forest-moderate": 3,
    "forest-dense": 4,
    "jungle-sparse": 5,
    "jungle-light": 6,
    "jungle-moderate": 7,
    "jungle-dense": 8,
}

RIVER_CODES = {
    "none": 0,
    "minor": 1,
    "major": 2,
}


@dataclass(frozen=True)
class ProjectedWaterway:
    properties: dict[str, object]
    local_x: np.ndarray
    local_y: np.ndarray


def classify_land_cover_rgb(
    rgb: np.ndarray,
    latitudes: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Compile independent base terrain and density-bearing vegetation features."""
    if rgb.ndim != 3 or rgb.shape[2] < 3:
        raise ValueError("Land-cover RGB must have shape (height, width, 3)")
    values = rgb[:, :, :3].astype(np.int16)
    red = values[:, :, 0]
    green = values[:, :, 1]
    blue = values[:, :, 2]

    terrain = np.full(red.shape, TERRAIN_CODES["plains"], dtype=np.uint8)
    vegetation = np.zeros(red.shape, dtype=np.uint8)
    blank_water = (red >= 252) & (green >= 252) & (blue >= 252)
    ice = (
        ~blank_water
        & (blue >= 232)
        & (blue - red >= 7)
        & (blue - green >= 5)
    )
    desert = (
        ~blank_water
        & ~ice
        & (red >= 180)
        & (red - green >= 12)
    )
    forest_candidate = (
        ~blank_water
        & ~ice
        & ~desert
        & (green - red >= 8)
        & (green - blue >= 20)
        & (red < 210)
    )
    jungle = forest_candidate & (red < 162) & (green - red >= 20)
    terrain[blank_water] = TERRAIN_CODES["water"]
    terrain[ice] = TERRAIN_CODES["ice"]
    terrain[desert] = TERRAIN_CODES["desert"]
    if latitudes is not None:
        if latitudes.shape != (rgb.shape[0],):
            raise ValueError("Latitude rows must match land-cover height")
        polar = np.abs(latitudes[:, None]) >= 60.0
        tundra = polar & ~blank_water & ~ice & ~desert & ~forest_candidate
        terrain[tundra] = TERRAIN_CODES["tundra"]

    # Natural Earth II is idealized color, not measured canopy. Its green
    # excess still gives a deterministic density proxy for the prototype.
    forest = forest_candidate & ~jungle
    vegetation[forest & (red >= 198)] = VEGETATION_CODES["forest-sparse"]
    vegetation[forest & (red >= 185) & (red < 198)] = VEGETATION_CODES["forest-light"]
    vegetation[forest & (red >= 170) & (red < 185)] = VEGETATION_CODES["forest-moderate"]
    vegetation[forest & (red < 170)] = VEGETATION_CODES["forest-dense"]
    vegetation[jungle & (red >= 175)] = VEGETATION_CODES["jungle-sparse"]
    vegetation[jungle & (red >= 160) & (red < 175)] = VEGETATION_CODES["jungle-light"]
    vegetation[jungle & (red >= 145) & (red < 160)] = VEGETATION_CODES["jungle-moderate"]
    vegetation[jungle & (red < 145)] = VEGETATION_CODES["jungle-dense"]
    return terrain, vegetation


def project_line(
    line: list[list[float]], width: int, height: int
) -> list[tuple[int, int]]:
    return [
        (
            round(((longitude + 180) / 360) * (width - 1)),
            round(((90 - latitude) / 180) * (height - 1)),
        )
        for longitude, latitude, *_ in line
    ]


def rasterize_land_mask(path: Path, width: int, height: int) -> np.ndarray:
    geojson = json.loads(path.read_text(encoding="utf-8"))
    mask = Image.new("1", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for feature in geojson["features"]:
        geometry = feature["geometry"]
        polygons = (
            [geometry["coordinates"]]
            if geometry["type"] == "Polygon"
            else geometry["coordinates"]
        )
        for polygon in polygons:
            if not polygon:
                continue
            draw.polygon(project_line(polygon[0], width, height), fill=1)
            for hole in polygon[1:]:
                draw.polygon(project_line(hole, width, height), fill=0)
    return np.asarray(mask, dtype=bool)


def _polygons(geometry: dict[str, object]) -> list[list[list[list[float]]]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        raise ValueError("GeoJSON geometry has no coordinate array")
    if geometry_type == "Polygon":
        return [coordinates]
    if geometry_type == "MultiPolygon":
        return coordinates
    raise ValueError(f"Unsupported mask geometry: {geometry_type}")


def _project_ring(
    ring: list[list[float]],
    forward: object,
    half_extent: float,
    pixels_per_meter: float,
) -> list[tuple[float, float]]:
    points = np.asarray(ring, dtype=np.float64)
    local_x, local_y = forward.transform(points[:, 0], points[:, 1])
    pixel_x = (np.asarray(local_x) + half_extent) * pixels_per_meter
    pixel_y = (half_extent - np.asarray(local_y)) * pixels_per_meter
    finite = np.isfinite(pixel_x) & np.isfinite(pixel_y)
    return list(zip(pixel_x[finite].tolist(), pixel_y[finite].tolist(), strict=True))


def rasterize_projected_mask(
    paths: list[Path],
    forward: object,
    extent_meters: float,
    pixel_size: int,
) -> np.ndarray:
    """Rasterize WGS84 polygons directly onto the local Theater pixel grid."""
    mask = Image.new("1", (pixel_size, pixel_size), 0)
    draw = ImageDraw.Draw(mask)
    half_extent = extent_meters / 2.0
    pixels_per_meter = pixel_size / extent_meters
    for path in paths:
        collection = json.loads(path.read_text(encoding="utf-8"))
        for feature in collection["features"]:
            geometry = feature.get("geometry")
            if not geometry:
                continue
            for polygon in _polygons(geometry):
                exterior = _project_ring(
                    polygon[0],
                    forward,
                    half_extent,
                    pixels_per_meter,
                )
                if len(exterior) < 3:
                    continue
                minimum_x = min(point[0] for point in exterior)
                maximum_x = max(point[0] for point in exterior)
                minimum_y = min(point[1] for point in exterior)
                maximum_y = max(point[1] for point in exterior)
                if (
                    maximum_x < 0
                    or maximum_y < 0
                    or minimum_x >= pixel_size
                    or minimum_y >= pixel_size
                ):
                    continue
                draw.polygon(exterior, fill=1)
                for hole in polygon[1:]:
                    projected_hole = _project_ring(
                        hole,
                        forward,
                        half_extent,
                        pixels_per_meter,
                    )
                    if len(projected_hole) >= 3:
                        draw.polygon(projected_hole, fill=0)
    return np.asarray(mask, dtype=bool)


def _lines(geometry: dict[str, object]) -> list[list[list[float]]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        raise ValueError("GeoJSON geometry has no coordinate array")
    if geometry_type == "LineString":
        return [coordinates]
    if geometry_type == "MultiLineString":
        return coordinates
    return []


def load_projected_waterways(
    path: Path,
    forward: object,
    extent_meters: float,
) -> tuple[ProjectedWaterway, ...]:
    """Parse and batch-project normalized waterway lines exactly once."""
    collection = json.loads(path.read_text(encoding="utf-8"))
    raw: list[tuple[dict[str, object], np.ndarray, np.ndarray]] = []
    for feature in collection["features"]:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            continue
        for line in _lines(geometry):
            if len(line) < 2:
                continue
            longitude = np.asarray([point[0] for point in line], dtype=np.float64)
            latitude = np.asarray([point[1] for point in line], dtype=np.float64)
            raw.append((properties, longitude, latitude))
    if not raw:
        return ()

    lengths = [len(longitude) for _, longitude, _ in raw]
    longitude = np.concatenate([item[1] for item in raw])
    latitude = np.concatenate([item[2] for item in raw])
    local_x, local_y = forward.transform(longitude, latitude)
    half_extent = extent_meters / 2.0
    projected: list[ProjectedWaterway] = []
    offset = 0
    for (properties, _, _), length in zip(raw, lengths, strict=True):
        end = offset + length
        line_x = local_x[offset:end]
        line_y = local_y[offset:end]
        offset = end
        if (
            float(np.max(line_x)) < -half_extent
            or float(np.min(line_x)) > half_extent
            or float(np.max(line_y)) < -half_extent
            or float(np.min(line_y)) > half_extent
        ):
            continue
        projected.append(ProjectedWaterway(properties, line_x, line_y))
    return tuple(projected)


def _waterway_pixels(
    waterway: ProjectedWaterway,
    half_extent: float,
    pixels_per_meter: float,
) -> list[tuple[float, float]]:
    pixel_x = (waterway.local_x + half_extent) * pixels_per_meter
    pixel_y = (half_extent - waterway.local_y) * pixels_per_meter
    return list(zip(pixel_x.tolist(), pixel_y.tolist(), strict=True))


def rasterize_projected_rivers(
    waterways: tuple[ProjectedWaterway, ...],
    extent_meters: float,
    pixel_size: int,
) -> np.ndarray:
    """Rasterize only automatically selected strategic river networks."""
    rivers = Image.new("L", (pixel_size, pixel_size), RIVER_CODES["none"])
    draw = ImageDraw.Draw(rivers)
    half_extent = extent_meters / 2.0
    pixels_per_meter = pixel_size / extent_meters
    collected: list[tuple[int, list[tuple[float, float]]]] = []
    for waterway in waterways:
        river_class = str(waterway.properties.get("displayClass") or "none")
        if river_class not in ("minor", "major"):
            continue
        collected.append(
            (
                RIVER_CODES[river_class],
                _waterway_pixels(waterway, half_extent, pixels_per_meter),
            )
        )

    # Minor rivers go down first so major channels remain visually continuous.
    for river_code in (RIVER_CODES["minor"], RIVER_CODES["major"]):
        physical_width = 125 if river_code == RIVER_CODES["minor"] else 375
        width = max(1, round(physical_width * pixels_per_meter))
        for code, points in collected:
            if code == river_code:
                draw.line(points, fill=code, width=width, joint="curve")
    return np.asarray(rivers, dtype=np.uint8).copy()


def rasterize_projected_freshwater(
    waterways: tuple[ProjectedWaterway, ...],
    extent_meters: float,
    pixel_size: int,
) -> np.ndarray:
    """Rasterize all natural fresh drainage as moisture-source strength."""
    half_extent = extent_meters / 2.0
    pixels_per_meter = pixel_size / extent_meters
    collected: list[tuple[int, list[tuple[float, float]]]] = []
    for waterway in waterways:
        strength = int(waterway.properties.get("freshwaterStrength") or 0)
        if strength <= 0:
            continue
        collected.append(
            (
                min(255, strength),
                _waterway_pixels(waterway, half_extent, pixels_per_meter),
            )
        )
    # Weak sources first ensures a strong river wins at a confluence.
    image = Image.new("L", (pixel_size, pixel_size), 0)
    draw = ImageDraw.Draw(image)
    for strength, points in sorted(collected, key=lambda item: item[0]):
        draw.line(points, fill=strength, width=1, joint="curve")
    return np.asarray(image, dtype=np.uint8).copy()


def apply_physical_water_mask(
    surface_cover: np.ndarray,
    land: np.ndarray,
    lakes: np.ndarray,
) -> np.ndarray:
    """Replace coarse raster shorelines with locally rasterized physical vectors."""
    if surface_cover.shape != land.shape or surface_cover.shape != lakes.shape:
        raise ValueError("Surface cover and physical masks must have matching shapes")
    refined = surface_cover.copy()
    water = TERRAIN_CODES["water"]
    newly_resolved_land = land & ~lakes & (refined == water)
    refined[newly_resolved_land] = TERRAIN_CODES["plains"]
    refined[~land | lakes] = water
    return refined


def sample_equirectangular(
    source: np.ndarray,
    longitudes: np.ndarray,
    latitudes: np.ndarray,
) -> np.ndarray:
    height, width = source.shape
    sample_x = np.floor(((longitudes + 180) % 360) / 360 * width).astype(np.int32)
    sample_y = np.floor((90 - latitudes) / 180 * height).astype(np.int32)
    return source[np.clip(sample_y, 0, height - 1), sample_x]


def load_categorical(path: Path, allowed_codes: set[int], label: str) -> np.ndarray:
    Image.MAX_IMAGE_PIXELS = None
    with Image.open(path) as image:
        values = np.asarray(image.convert("L"), dtype=np.uint8)
    unknown = np.setdiff1d(np.unique(values), np.asarray(sorted(allowed_codes)))
    if unknown.size:
        raise ValueError(f"Unknown {label} codes: {unknown.tolist()}")
    return values


def load_base_terrain(path: Path) -> np.ndarray:
    return load_categorical(path, set(TERRAIN_CODES.values()), "base-terrain")


def load_vegetation(path: Path) -> np.ndarray:
    return load_categorical(path, set(VEGETATION_CODES.values()), "vegetation")
