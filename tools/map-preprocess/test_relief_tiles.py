import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from PIL import Image

from build_relief_tiles import RIVER_COLOR, TERRAIN_PALETTE_COLORS, draw_rivers


def indexed_test_image(width: int = 64, height: int = 32) -> Image.Image:
    image = Image.new("P", (width, height), 0)
    image.putpalette([0, 0, 0] * 256)
    return image


class ReliefTilesTest(unittest.TestCase):
    def test_world_rivers_exclude_named_canals(self) -> None:
        features = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "name": "Natural River",
                        "featurecla": "River",
                        "scalerank": 1,
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-150, 30], [-30, 30]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "Suez Canal",
                        "featurecla": "River",
                        "scalerank": 1,
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-150, -30], [-30, -30]],
                    },
                },
            ],
        }
        with TemporaryDirectory() as directory:
            source = Path(directory) / "rivers.geojson"
            source.write_text(json.dumps(features), encoding="utf-8")
            land = Path(directory) / "land.geojson"
            land.write_text(
                json.dumps({
                    "type": "FeatureCollection",
                    "features": [{
                        "type": "Feature",
                        "properties": {},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[
                                [-180, -90], [0, -90], [0, 90],
                                [-180, 90], [-180, -90],
                            ]],
                        },
                    }],
                }),
                encoding="utf-8",
            )
            image = indexed_test_image()
            draw_rivers(image, source, land, level=3)

        river_index = TERRAIN_PALETTE_COLORS
        self.assertEqual(image.getpalette()[river_index * 3 : river_index * 3 + 3], list(RIVER_COLOR))
        self.assertGreater(sum(pixel == river_index for pixel in image.crop((0, 8, 64, 13)).getdata()), 0)
        self.assertEqual(sum(pixel == river_index for pixel in image.crop((0, 19, 64, 24)).getdata()), 0)

    def test_world_rivers_are_clipped_at_the_coast(self) -> None:
        rivers = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {
                    "name": "Natural River",
                    "featurecla": "River",
                    "scalerank": 1,
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-150, 0], [150, 0]],
                },
            }],
        }
        land = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [-180, -90], [0, -90], [0, 90],
                        [-180, 90], [-180, -90],
                    ]],
                },
            }],
        }
        with TemporaryDirectory() as directory:
            river_source = Path(directory) / "rivers.geojson"
            river_source.write_text(json.dumps(rivers), encoding="utf-8")
            land_source = Path(directory) / "land.geojson"
            land_source.write_text(json.dumps(land), encoding="utf-8")
            image = indexed_test_image()
            draw_rivers(image, river_source, land_source, level=3)

        river_index = TERRAIN_PALETTE_COLORS
        equator = image.height // 2
        self.assertGreater(sum(image.getpixel((x, equator)) == river_index for x in range(image.width // 2)), 0)
        self.assertEqual(sum(image.getpixel((x, equator)) == river_index for x in range(image.width // 2 + 1, image.width)), 0)


if __name__ == "__main__":
    unittest.main()
