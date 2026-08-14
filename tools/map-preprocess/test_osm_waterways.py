from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from osm_waterways import (
    PinnedPbfSource,
    load_osm_waterways,
    natural_waterway_kind,
    normalize_pbf_waterways,
    select_geofabrik_extracts,
    strahler_orders,
    waterway_width_meters,
)


class OsmWaterwaysTest(unittest.TestCase):
    def test_accepts_explicit_metric_widths_without_inventing_precision(self) -> None:
        self.assertEqual(waterway_width_meters({"width": "2.5 m"}), 2.5)
        self.assertIsNone(waterway_width_meters({}))
        self.assertIsNone(waterway_width_meters({"width": "wide"}))

    def test_accepts_natural_and_rejects_artificial_waterways(self) -> None:
        self.assertEqual(natural_waterway_kind({"waterway": "river"}), "river")
        self.assertEqual(natural_waterway_kind({"waterway": "stream"}), "stream")
        self.assertEqual(
            natural_waterway_kind({"waterway": "tidal_channel"}),
            "tidal_channel",
        )
        self.assertIsNone(natural_waterway_kind({"waterway": "canal"}))
        self.assertIsNone(
            natural_waterway_kind({"waterway": "stream", "man_made": "yes"})
        )
        self.assertIsNone(
            natural_waterway_kind({"waterway": "river", "name": "Suez Canal"})
        )

    def test_strahler_order_is_derived_from_network_topology(self) -> None:
        ways = {
            10: ({}, (1, 5), "fixture"),
            20: ({}, (2, 5), "fixture"),
            30: ({}, (5, 9), "fixture"),
            40: ({}, (3, 7), "fixture"),
            50: ({}, (4, 7), "fixture"),
            60: ({}, (7, 9), "fixture"),
            70: ({}, (9, 10), "fixture"),
        }

        orders = strahler_orders(ways)

        self.assertEqual(orders[10], 1)
        self.assertEqual(orders[30], 2)
        self.assertEqual(orders[60], 2)
        self.assertEqual(orders[70], 3)

    def test_selects_smallest_extracts_across_theater_samples(self) -> None:
        index = {
            "type": "FeatureCollection",
            "features": [
                self.feature("continent", None, -20, -20, 20, 20),
                self.feature("west", "continent", -10, -10, 0, 10),
                self.feature("east", "continent", 0, -10, 10, 10),
            ],
        }

        selected = select_geofabrik_extracts(index, (-5, -5, 5, 5))

        self.assertEqual(
            [feature["properties"]["id"] for feature in selected],
            ["east", "west"],
        )

    def test_pbf_normalization_keeps_unnamed_streams_and_is_deterministic(self) -> None:
        xml = """<?xml version='1.0' encoding='UTF-8'?>
<osm version='0.6'>
  <node id='1' lat='30.0' lon='31.0'/>
  <node id='2' lat='30.1' lon='31.1'/>
  <node id='3' lat='30.2' lon='31.2'/>
  <way id='20'><nd ref='1'/><nd ref='2'/><tag k='waterway' v='stream'/><tag k='intermittent' v='yes'/></way>
  <way id='10'><nd ref='2'/><nd ref='3'/><tag k='waterway' v='river'/><tag k='name' v='Nile'/></way>
  <way id='30'><nd ref='1'/><nd ref='3'/><tag k='waterway' v='canal'/></way>
</osm>"""
        with TemporaryDirectory() as directory:
            source_path = Path(directory) / "fixture.osm"
            source_path.write_text(xml, encoding="utf-8")
            source = PinnedPbfSource("fixture", "fixture", "0" * 32, source_path)
            normalized = normalize_pbf_waterways((source,))

        features = normalized["features"]
        self.assertEqual([feature["id"] for feature in features], ["osm-way-10", "osm-way-20"])
        self.assertEqual(features[0]["properties"]["waterway"], "river")
        self.assertEqual(features[0]["properties"]["streamOrder"], 1)
        self.assertEqual(features[0]["properties"]["displayClass"], "none")
        self.assertGreater(features[0]["properties"]["freshwaterStrength"], 0)
        self.assertEqual(features[1]["properties"]["regime"], "intermittent")
        self.assertEqual(features[1]["properties"]["displayClass"], "none")
        self.assertGreater(features[1]["properties"]["freshwaterStrength"], 0)
        self.assertNotIn("name", features[1]["properties"])

    def test_nearby_theaters_reuse_source_normalization(self) -> None:
        normalized = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": "osm-way-10",
                    "properties": {"sourceId": "way/10"},
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[31.0, 30.0], [31.2, 30.2]],
                    },
                },
                {
                    "type": "Feature",
                    "id": "osm-way-20",
                    "properties": {"sourceId": "way/20"},
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[40.0, 40.0], [40.2, 40.2]],
                    },
                },
            ],
        }
        source = PinnedPbfSource(
            "fixture",
            "fixture",
            "0" * 32,
            Path("fixture.osm.pbf"),
        )
        with TemporaryDirectory() as directory, patch(
            "osm_waterways.load_pinned_sources",
            return_value=(source,),
        ), patch(
            "osm_waterways.normalize_pbf_waterways",
            return_value=normalized,
        ) as normalize:
            first = load_osm_waterways(
                Path(directory),
                (29.8, 30.8, 30.4, 31.4),
            )
            second = load_osm_waterways(
                Path(directory),
                (29.9, 30.9, 30.5, 31.5),
            )

        self.assertEqual(normalize.call_count, 1)
        self.assertEqual(first.feature_count, 1)
        self.assertEqual(second.feature_count, 1)

    @staticmethod
    def feature(
        source_id: str,
        parent: str | None,
        west: float,
        south: float,
        east: float,
        north: float,
    ) -> dict[str, object]:
        properties: dict[str, object] = {
            "id": source_id,
            "urls": {"pbf": f"https://example.com/{source_id}-latest.osm.pbf"},
        }
        if parent:
            properties["parent"] = parent
        return {
            "type": "Feature",
            "properties": properties,
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [west, south], [east, south], [east, north],
                    [west, north], [west, south],
                ]],
            },
        }


if __name__ == "__main__":
    unittest.main()
