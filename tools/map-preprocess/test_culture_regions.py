from pathlib import Path
import unittest

import numpy as np
from PIL import Image


class CultureRegionRenderTest(unittest.TestCase):
    def test_compiled_coast_fade_is_continuous(self) -> None:
        path = (
            Path(__file__).resolve().parents[2]
            / "public"
            / "maps"
            / "cultures"
            / "coast-fade.png"
        )
        with Image.open(path) as image:
            self.assertEqual(image.size, (4_096, 2_048))
            self.assertEqual(image.mode, "L")
            coast_distance = np.asarray(image, dtype=np.uint8)

        # A binary field reproduces a rectangular coastline fringe. The coast
        # needs enough coverage grades for linear GPU sampling.
        coast_grades = np.unique(coast_distance)
        self.assertGreaterEqual(len(coast_grades), 12)
        self.assertTrue(np.any((coast_grades > 0) & (coast_grades < 255)))

    def test_compiled_borders_are_vector_paths_with_subcell_points(self) -> None:
        path = (
            Path(__file__).resolve().parents[2]
            / "public"
            / "maps"
            / "cultures"
            / "borders.json"
        )
        manifest = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["formatVersion"], 1)
        self.assertEqual((manifest["width"], manifest["height"]), (4_096, 2_048))
        self.assertGreater(len(manifest["paths"]), 20)
        coordinates = [
            coordinate
            for border in manifest["paths"]
            for coordinate in border["points"]
        ]
        self.assertGreater(sum(value != round(value) for value in coordinates), 100)


if __name__ == "__main__":
    unittest.main()
import json
