"""Deterministic available-moisture and visible-river compilation.

The module consumes map-derived fields rather than Earth-specific identities.
Earth supplies a climate baseline from natural cover and OSM drainage; a future
generated map can supply procedural climate and drainage through the same small
array interface.
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageFilter

from terrain_classification import TERRAIN_CODES


MOISTURE_MODEL_VERSION = 1
SECONDARY_STREAM_ORDER = 4
MAJOR_STREAM_ORDER = 6
SECONDARY_WIDTH_METERS = 8.0
MAJOR_WIDTH_METERS = 25.0
FRESHWATER_REACH_METERS = 2_000.0


def visible_river_class(
    waterway: str,
    stream_order: int,
    width_meters: float | None,
    regime: str,
) -> str | None:
    """Classify presentation from physical/network prominence, never place names."""
    if waterway == "tidal_channel":
        return None
    width = width_meters or 0.0
    # OSM's river/stream distinction is useful but inconsistent between
    # regions, so it contributes one order rather than deciding visibility.
    effective_order = stream_order + (1 if waterway == "river" else 0)
    major = width >= MAJOR_WIDTH_METERS or effective_order >= MAJOR_STREAM_ORDER
    if major:
        return "major"
    if regime in ("intermittent", "seasonal"):
        return None
    if width >= SECONDARY_WIDTH_METERS or effective_order >= SECONDARY_STREAM_ORDER:
        return "minor"
    return None


def freshwater_strength(
    waterway: str,
    stream_order: int,
    regime: str,
) -> int:
    """Encode stable freshwater influence for the semantic moisture compiler."""
    if waterway == "tidal_channel":
        return 0
    base = min(245, 72 + max(1, stream_order) * 27)
    if waterway == "river":
        base = min(245, base + 18)
    regime_factor = {
        "perennial": 1.0,
        # OSM assumes permanence when intermittent/seasonal is absent.
        "unknown": 1.0,
        "seasonal": 0.45,
        "intermittent": 0.25,
    }.get(regime, 1.0)
    return round(base * regime_factor)


def climate_moisture_from_cover(
    base_terrain: np.ndarray,
    vegetation: np.ndarray,
    meters_per_cell: float,
) -> np.ndarray:
    """Adapt idealized Earth cover to a smooth long-term climate-water baseline."""
    if base_terrain.shape != vegetation.shape:
        raise ValueError("Terrain and vegetation moisture inputs must match")
    terrain_percent = np.asarray(
        [0, 50, 48, 42, 8, 35, 5],
        dtype=np.uint8,
    )
    vegetation_floor_percent = np.asarray(
        [0, 55, 65, 75, 85, 70, 80, 90, 96],
        dtype=np.uint8,
    )
    if int(base_terrain.max(initial=0)) >= len(terrain_percent):
        raise ValueError("Unknown terrain code in moisture input")
    if int(vegetation.max(initial=0)) >= len(vegetation_floor_percent):
        raise ValueError("Unknown vegetation code in moisture input")
    percent = np.maximum(
        terrain_percent[base_terrain],
        vegetation_floor_percent[vegetation],
    ).astype(np.float32)
    land = base_terrain != TERRAIN_CODES["water"]
    # Climate transitions operate at synoptic rather than settlement scale.
    # Normalized convolution prevents salt water from drying coastal land.
    radius = max(0.5, 8_000.0 / meters_per_cell)
    weighted = Image.fromarray(np.rint(percent * land).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(radius=radius)
    )
    support = Image.fromarray(np.where(land, 255, 0).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(radius=radius)
    )
    weighted_values = np.asarray(weighted, dtype=np.float32)
    support_values = np.asarray(support, dtype=np.float32) / 255.0
    smoothed = np.divide(
        weighted_values,
        support_values,
        out=np.zeros_like(weighted_values),
        where=support_values > 0.01,
    )
    result = np.clip(np.rint(smoothed * 2.55), 0, 255).astype(np.uint8)
    result[~land] = 0
    return result


def compile_available_moisture(
    climate_moisture: np.ndarray,
    freshwater_strengths: np.ndarray,
    land: np.ndarray,
    meters_per_cell: float,
) -> np.ndarray:
    """Combine climate supply and freshwater access into one authoritative byte."""
    if (
        climate_moisture.shape != freshwater_strengths.shape
        or climate_moisture.shape != land.shape
    ):
        raise ValueError("Moisture inputs must share one grid")
    if meters_per_cell <= 0:
        raise ValueError("Moisture cell size must be positive")
    radius = max(0.5, FRESHWATER_REACH_METERS / meters_per_cell)
    source = freshwater_strengths.astype(np.float32) / 255.0
    blurred = np.asarray(
        Image.fromarray(freshwater_strengths).filter(
            ImageFilter.GaussianBlur(radius=radius)
        ),
        dtype=np.float32,
    ) / 255.0
    # A Gaussian applied to a one-cell line loses peak amplitude by roughly
    # sqrt(2*pi)*sigma. Restore that amplitude while retaining its distance falloff.
    influence = np.maximum(
        source,
        np.clip(blurred * math.sqrt(2.0 * math.pi) * radius, 0.0, 1.0),
    )
    climate = climate_moisture.astype(np.float32) / 255.0
    available = climate + (1.0 - climate) * influence
    result = np.clip(np.rint(available * 255.0), 0, 255).astype(np.uint8)
    result[~land] = 0
    return result
