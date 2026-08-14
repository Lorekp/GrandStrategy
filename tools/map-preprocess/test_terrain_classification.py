import unittest

import numpy as np

from terrain_classification import TERRAIN_CODES, classify_terrain


class TerrainClassificationTest(unittest.TestCase):
    def test_flat_base_cover_remains_plains(self) -> None:
        elevation = np.full((8, 8), 120.0, dtype=np.float32)
        surface_cover = np.full(
            elevation.shape,
            TERRAIN_CODES["plains"],
            dtype=np.uint8,
        )

        terrain = classify_terrain(
            elevation,
            meters_per_cell=500,
            base_terrain=surface_cover,
        )

        np.testing.assert_array_equal(terrain, surface_cover)

    def test_topography_overrides_flat_surface_cover(self) -> None:
        elevation = np.tile(
            np.arange(8, dtype=np.float32) * 250.0,
            (8, 1),
        )
        surface_cover = np.full(
            elevation.shape,
            TERRAIN_CODES["plains"],
            dtype=np.uint8,
        )
        terrain = classify_terrain(elevation, 500, surface_cover)
        np.testing.assert_array_equal(
            terrain,
            np.full(elevation.shape, TERRAIN_CODES["mountains"], dtype=np.uint8),
        )

    def test_surface_cover_defines_water_independently_of_elevation(self) -> None:
        elevation = np.full((8, 8), 100.0, dtype=np.float32)
        surface_cover = np.full(
            elevation.shape,
            TERRAIN_CODES["water"],
            dtype=np.uint8,
        )
        terrain = classify_terrain(elevation, 500, surface_cover)
        np.testing.assert_array_equal(terrain, surface_cover)


if __name__ == "__main__":
    unittest.main()
