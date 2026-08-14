import unittest

import numpy as np

from build_global_theater_catalog import (
    clamp_terrarium_pixels,
    terrain_composition_permille,
)
from terrain_classification import TERRAIN_CODES


class GlobalTheaterCatalogTest(unittest.TestCase):
    def test_web_mercator_samples_clamp_at_the_poles(self) -> None:
        maximum_pixel = 256 * (1 << 5) - 1
        values = clamp_terrarium_pixels(
            np.asarray([-0.000_001, maximum_pixel + 0.1]),
            5,
        )
        np.testing.assert_array_equal(
            values,
            np.asarray([0.0, maximum_pixel]),
        )

    def test_composition_is_complete_and_exact(self) -> None:
        terrain = np.asarray(
            [[
                TERRAIN_CODES["water"],
                TERRAIN_CODES["plains"],
                TERRAIN_CODES["hills"],
            ]],
            dtype=np.uint8,
        )
        composition = terrain_composition_permille(terrain)
        self.assertEqual(sum(composition.values()), 1_000)
        self.assertEqual(composition["water"], 334)
        self.assertEqual(composition["plains"], 333)
        self.assertEqual(composition["hills"], 333)


if __name__ == "__main__":
    unittest.main()
