import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import numpy as np

from surface_cover import (
    apply_physical_water_mask,
    classify_land_cover_rgb,
    load_projected_waterways,
    rasterize_projected_freshwater,
    rasterize_projected_mask,
    rasterize_projected_rivers,
)
from terrain_classification import TERRAIN_CODES


class SurfaceCoverTest(unittest.TestCase):
    def test_representative_natural_earth_colors(self) -> None:
        colors = np.asarray(
            [[
                (255, 255, 255),  # blank ocean
                (141, 189, 147),  # Amazon forest
                (179, 206, 167),  # central European forest
                (226, 222, 179),  # Great Plains
                (232, 211, 194),  # Sahara
                (227, 235, 248),  # Greenland ice
            ]],
            dtype=np.uint8,
        )
        terrain, vegetation = classify_land_cover_rgb(colors)
        np.testing.assert_array_equal(
            terrain,
            np.asarray(
                [[
                    TERRAIN_CODES["water"],
                    TERRAIN_CODES["plains"],
                    TERRAIN_CODES["plains"],
                    TERRAIN_CODES["plains"],
                    TERRAIN_CODES["desert"],
                    TERRAIN_CODES["ice"],
                ]],
                dtype=np.uint8,
            ),
        )
        self.assertEqual(int(vegetation[0, 0]), 0)
        self.assertGreaterEqual(int(vegetation[0, 1]), 5)
        self.assertGreaterEqual(int(vegetation[0, 2]), 1)
        self.assertLessEqual(int(vegetation[0, 2]), 4)

    def test_open_polar_cover_becomes_tundra_without_replacing_forest(self) -> None:
        colors = np.asarray(
            [[(226, 222, 179), (179, 206, 167)]],
            dtype=np.uint8,
        )
        terrain, vegetation = classify_land_cover_rgb(
            colors,
            np.asarray([68.0]),
        )
        self.assertEqual(int(terrain[0, 0]), TERRAIN_CODES["tundra"])
        self.assertEqual(int(terrain[0, 1]), TERRAIN_CODES["plains"])
        self.assertGreater(int(vegetation[0, 1]), 0)

    def test_projected_rivers_preserve_major_and_minor_classes(self) -> None:
        class IdentityProjection:
            @staticmethod
            def transform(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
                return x, y

        feature_collection = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "name": "Major River",
                        "source": "OpenStreetMap",
                        "sourceId": "way/1",
                        "waterway": "river",
                        "displayClass": "major",
                        "regime": "unknown",
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-500, 0], [500, 0]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "Minor River",
                        "source": "OpenStreetMap",
                        "sourceId": "way/2",
                        "waterway": "stream",
                        "displayClass": "minor",
                        "regime": "unknown",
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[0, -500], [0, 500]],
                    },
                },
            ],
        }
        with TemporaryDirectory() as directory:
            source = Path(directory) / "rivers.geojson"
            source.write_text(json.dumps(feature_collection), encoding="utf-8")
            waterways = load_projected_waterways(
                source, IdentityProjection(), extent_meters=1_000
            )
            rivers = rasterize_projected_rivers(
                waterways, extent_meters=1_000, pixel_size=8
            )
        self.assertGreater(np.count_nonzero(rivers == 2), 4)
        self.assertGreater(np.count_nonzero(rivers == 1), 4)
        rivers[rivers == 1] = 0

    def test_projected_rivers_hide_small_streams_and_exclude_artificial_water(self) -> None:
        class IdentityProjection:
            @staticmethod
            def transform(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
                return x, y

        feature_collection = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "name": "Nile",
                        "waterway": "river",
                        "displayClass": "major",
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-400, 200], [400, 200]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "Suez Canal",
                        "waterway": "canal",
                        "displayClass": "none",
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-400, -200], [400, -200]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {
                        "waterway": "stream",
                        "displayClass": "none",
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-400, -350], [400, -350]],
                    },
                },
            ],
        }
        with TemporaryDirectory() as directory:
            source = Path(directory) / "rivers.geojson"
            source.write_text(json.dumps(feature_collection), encoding="utf-8")
            waterways = load_projected_waterways(
                source, IdentityProjection(), extent_meters=1_000
            )
            rivers = rasterize_projected_rivers(
                waterways, extent_meters=1_000, pixel_size=20
            )

        self.assertGreater(np.count_nonzero(rivers[:10]), 0)
        self.assertEqual(np.count_nonzero(rivers[12:16]), 0)
        self.assertEqual(np.count_nonzero(rivers[16:]), 0)

    def test_hidden_freshwater_still_contributes_to_moisture(self) -> None:
        class IdentityProjection:
            @staticmethod
            def transform(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
                return x, y

        feature_collection = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "waterway": "stream",
                        "displayClass": "none",
                        "freshwaterStrength": 96,
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-400, 0], [400, 0]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {
                        "waterway": "tidal_channel",
                        "displayClass": "none",
                        "freshwaterStrength": 0,
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[0, -400], [0, 400]],
                    },
                },
            ],
        }
        with TemporaryDirectory() as directory:
            source = Path(directory) / "freshwater.geojson"
            source.write_text(json.dumps(feature_collection), encoding="utf-8")
            waterways = load_projected_waterways(
                source, IdentityProjection(), extent_meters=1_000
            )
            freshwater = rasterize_projected_freshwater(
                waterways, extent_meters=1_000, pixel_size=20
            )

        self.assertGreater(np.count_nonzero(freshwater), 4)
        self.assertTrue(np.all(freshwater[freshwater > 0] == 96))

    def test_projected_vector_mask_preserves_pixel_scale_coast_detail(self) -> None:
        class IdentityProjection:
            @staticmethod
            def transform(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
                return x, y

        feature_collection = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-4, -4], [4, -4], [-4, 4], [-4, -4]]],
                },
            }],
        }
        with TemporaryDirectory() as directory:
            source = Path(directory) / "land.geojson"
            source.write_text(json.dumps(feature_collection), encoding="utf-8")
            mask = rasterize_projected_mask(
                [source],
                IdentityProjection(),
                extent_meters=8,
                pixel_size=8,
            )

        row_widths = [int(row.sum()) for row in mask]
        self.assertGreaterEqual(len(set(row_widths)), 6)
        self.assertTrue(mask[6, 1])
        self.assertFalse(mask[1, 6])

    def test_precise_land_and_lakes_replace_only_the_coarse_water_shape(self) -> None:
        coarse = np.full((4, 4), TERRAIN_CODES["water"], dtype=np.uint8)
        coarse[1:3, 1:3] = TERRAIN_CODES["plains"]
        land = np.zeros((4, 4), dtype=bool)
        land[:, :3] = True
        lakes = np.zeros((4, 4), dtype=bool)
        lakes[2, 1] = True

        result = apply_physical_water_mask(coarse, land, lakes)

        self.assertEqual(result[0, 0], TERRAIN_CODES["plains"])
        self.assertEqual(result[1, 1], TERRAIN_CODES["plains"])
        self.assertEqual(result[2, 1], TERRAIN_CODES["water"])
        self.assertTrue(np.all(result[:, 3] == TERRAIN_CODES["water"]))


if __name__ == "__main__":
    unittest.main()
