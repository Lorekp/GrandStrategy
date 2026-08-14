import unittest

import numpy as np

from hydrology import (
    climate_moisture_from_cover,
    compile_available_moisture,
    freshwater_strength,
    visible_river_class,
)
from terrain_classification import TERRAIN_CODES


class HydrologyTest(unittest.TestCase):
    def test_climate_adapter_derives_smooth_relative_moisture_from_cover(self) -> None:
        size = 192
        terrain = np.full((size, size), TERRAIN_CODES["plains"], dtype=np.uint8)
        terrain[:, :64] = TERRAIN_CODES["desert"]
        vegetation = np.zeros((size, size), dtype=np.uint8)
        vegetation[:, 128:] = 6

        moisture = climate_moisture_from_cover(terrain, vegetation, 250.0)

        self.assertLess(int(moisture[96, 24]), int(moisture[96, 96]))
        self.assertLess(int(moisture[96, 96]), int(moisture[96, 168]))
        self.assertGreater(len(np.unique(moisture[96, 40:88])), 8)

    def test_freshwater_raises_available_moisture_without_wetting_ocean(self) -> None:
        size = 96
        climate = np.full((size, size), 28, dtype=np.uint8)
        freshwater = np.zeros((size, size), dtype=np.uint8)
        freshwater[:, 48] = 180
        land = np.ones((size, size), dtype=bool)
        land[:, :4] = False

        available = compile_available_moisture(climate, freshwater, land, 250.0)

        self.assertTrue(np.all(available[:, :4] == 0))
        self.assertGreater(int(available[48, 48]), int(available[48, 70]))
        self.assertGreater(int(available[48, 44]), int(available[48, 70]))

    def test_regime_changes_strength_but_not_by_region(self) -> None:
        perennial = freshwater_strength("stream", 2, "perennial")
        seasonal = freshwater_strength("stream", 2, "seasonal")
        intermittent = freshwater_strength("stream", 2, "intermittent")

        self.assertGreater(perennial, seasonal)
        self.assertGreater(seasonal, intermittent)
        self.assertEqual(freshwater_strength("tidal_channel", 8, "perennial"), 0)

    def test_visible_network_uses_order_width_and_regime_only(self) -> None:
        self.assertIsNone(visible_river_class("stream", 3, None, "perennial"))
        self.assertEqual(
            visible_river_class("stream", 4, None, "perennial"), "minor"
        )
        self.assertEqual(
            visible_river_class("river", 3, None, "perennial"), "minor"
        )
        self.assertEqual(
            visible_river_class("river", 5, None, "intermittent"), "major"
        )
        self.assertIsNone(visible_river_class("stream", 4, None, "seasonal"))
        self.assertEqual(
            visible_river_class("stream", 1, 8.0, "perennial"), "minor"
        )
        self.assertIsNone(
            visible_river_class("tidal_channel", 8, 100.0, "perennial")
        )


if __name__ == "__main__":
    unittest.main()
