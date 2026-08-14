"""Deterministic landform terrain from elevation and base climate cover."""

from __future__ import annotations

import numpy as np


TERRAIN_CODES = {
    "water": 0,
    "plains": 1,
    "hills": 2,
    "mountains": 3,
    "desert": 4,
    "tundra": 5,
    "ice": 6,
}


def classify_terrain(
    elevation: np.ndarray,
    meters_per_cell: float,
    base_terrain: np.ndarray,
) -> np.ndarray:
    if base_terrain.shape != elevation.shape:
        raise ValueError("Base terrain and elevation must have the same shape")
    unknown_codes = np.setdiff1d(
        np.unique(base_terrain),
        np.asarray(list(TERRAIN_CODES.values()), dtype=np.uint8),
    )
    if unknown_codes.size:
        raise ValueError(f"Unknown terrain codes: {unknown_codes.tolist()}")

    gradient_y, gradient_x = np.gradient(elevation, meters_per_cell)
    slope = np.hypot(gradient_x, gradient_y)
    # Coarse overview samples average away local relief. Scale the thresholds
    # toward a 2.5 km reference so catalog summaries remain comparable to the
    # 500 m Regional Theater grid without treating high plateaus as mountains.
    relief_resolution_factor = min(1.0, 2_500.0 / meters_per_cell)
    hill_slope = 0.10 * relief_resolution_factor
    mountain_slope = 0.22 * relief_resolution_factor
    terrain = base_terrain.astype(np.uint8, copy=True)
    land = base_terrain != TERRAIN_CODES["water"]
    terrain[~land] = TERRAIN_CODES["water"]
    terrain[land & (slope >= hill_slope)] = TERRAIN_CODES[
        "hills"
    ]
    terrain[land & (slope >= mountain_slope)] = TERRAIN_CODES[
        "mountains"
    ]
    terrain[
        land
        & (
            (base_terrain == TERRAIN_CODES["ice"])
            | (elevation >= 3_000.0)
        )
    ] = TERRAIN_CODES["ice"]
    return terrain
