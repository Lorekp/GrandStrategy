import json
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
import unittest

import numpy as np
from pyproj import CRS, Transformer

from build_regional_theater import (
    decode_terrarium,
    project_geography,
    style_relief,
    write_semantic_data,
    write_waterway_geometry,
)
from terrain_classification import TERRAIN_CODES
from surface_cover import load_projected_waterways


class RegionalTheaterRenderTest(unittest.TestCase):
    def test_terrarium_decode_preserves_fractional_meters(self) -> None:
        source = np.asarray([[[128, 0, 0], [128, 1, 128]]], dtype=np.uint8)
        decoded = decode_terrarium(source)
        np.testing.assert_allclose(decoded, [[0.0, 1.5]])
        self.assertEqual(decoded.dtype, np.float32)

    def test_raster_geography_shares_one_projection_per_stripe(self) -> None:
        local = CRS.from_proj4(
            "+proj=aeqd +lat_0=30 +lon_0=31 +ellps=WGS84 +units=m +no_defs"
        )
        transformer = Transformer.from_crs(local, "EPSG:4326", always_xy=True)

        class CountingTransformer:
            def __init__(self) -> None:
                self.calls = 0

            def transform(
                self,
                local_x: np.ndarray,
                local_y: np.ndarray,
            ) -> tuple[np.ndarray, np.ndarray]:
                self.calls += 1
                return transformer.transform(local_x, local_y)

        inverse = CountingTransformer()
        source_elevation = np.arange(512 * 512, dtype=np.float32).reshape(512, 512)
        base_terrain = np.full((180, 360), 2, dtype=np.uint8)
        vegetation = np.full((180, 360), 4, dtype=np.uint8)

        elevation, projected_terrain, projected_vegetation = project_geography(
            inverse,
            source_elevation,
            0,
            0,
            1,
            base_terrain,
            vegetation,
            256,
            32_000,
        )

        self.assertEqual(inverse.calls, 2)
        self.assertEqual(elevation.shape, (256, 256))
        np.testing.assert_array_equal(projected_terrain, 2)
        np.testing.assert_array_equal(projected_vegetation, 4)

    def test_striped_relief_has_no_working_set_seam(self) -> None:
        height = 1_100
        width = 64
        elevation = np.tile(
            np.linspace(0, 1_200, width, dtype=np.float32),
            (height, 1),
        )
        terrain = np.full(
            (height, width), TERRAIN_CODES["plains"], dtype=np.uint8
        )
        vegetation = np.full((height, width), 3, dtype=np.uint8)

        styled = np.asarray(
            style_relief(elevation, 93.75, terrain, vegetation).convert("RGB")
        )

        np.testing.assert_array_equal(styled[511], styled[512])
        np.testing.assert_array_equal(styled[1_023], styled[1_024])

    def test_nile_theater_contains_projected_waterway_geometry(self) -> None:
        theater_root = (
            Path(__file__).resolve().parents[2]
            / "public"
            / "maps"
            / "theaters"
            / "world-r60-c79"
        )
        manifest = json.loads(
            (theater_root / "manifest.json").read_text(encoding="utf-8")
        )

        self.assertEqual(manifest["formatVersion"], 14)
        hydrography = manifest.get("hydrographySource")
        self.assertIsInstance(hydrography, dict)
        self.assertEqual(hydrography.get("snapshot"), "2026-08-01")
        self.assertEqual(
            hydrography.get("attribution"),
            "© OpenStreetMap contributors",
        )
        self.assertGreater(hydrography.get("featureCount", 0), 0)
        self.assertTrue(
            str(hydrography.get("normalizedHash", "")).startswith("sha256:")
        )
        geometry_path = hydrography.get("geometryPath")
        self.assertIsInstance(geometry_path, str)
        geometry = (theater_root / geometry_path).read_bytes()
        magic, version, _, feature_count, point_count = struct.unpack_from(
            "<4sHHII", geometry
        )
        self.assertEqual((magic, version), (b"GSHY", 1))
        self.assertGreater(feature_count, 0)
        self.assertGreater(point_count, feature_count * 2)

    def test_semantic_data_is_chunked_at_32_kilometres(self) -> None:
        size = 128
        elevation = np.full((size, size), 120, dtype=np.float32)
        terrain = np.full((size, size), TERRAIN_CODES["plains"], dtype=np.uint8)
        vegetation = np.full((size, size), 2, dtype=np.uint8)
        freshwater = np.zeros((size, size), dtype=np.uint8)
        freshwater[:, size // 2] = 180
        with TemporaryDirectory() as directory:
            output = Path(directory)
            manifest = write_semantic_data(
                elevation, terrain, vegetation, freshwater, 32_000, output
            )
            chunk = (output / "semantic" / "0_0.bin").read_bytes()

        self.assertEqual(manifest["metersPerCell"], 250)
        self.assertEqual(manifest["chunkSize"], 128)
        self.assertEqual(len(chunk), 16 + 128 * 128 * 5)
        self.assertEqual(struct.unpack_from("<4sH", chunk), (b"GSSC", 2))
        moisture = np.frombuffer(
            chunk,
            dtype=np.uint8,
            count=size * size,
            offset=16 + size * size * 2,
        ).reshape((size, size))
        self.assertGreater(int(moisture[size // 2, size // 2]), int(moisture[0, 0]))

    def test_waterway_geometry_preserves_real_width(self) -> None:
        local = CRS.from_proj4(
            "+proj=aeqd +lat_0=30 +lon_0=31 +ellps=WGS84 +units=m +no_defs"
        )
        forward = Transformer.from_crs("EPSG:4326", local, always_xy=True)
        collection = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[30.999, 30.0], [31.001, 30.0]],
                },
                "properties": {
                    "sourceId": "way/42",
                    "displayClass": "minor",
                    "regime": "perennial",
                    "waterway": "stream",
                    "widthMeters": 2.5,
                    "name": "Test Creek",
                },
            }],
        }
        with TemporaryDirectory() as directory:
            output = Path(directory)
            source = output / "waterways.geojson"
            source.write_text(json.dumps(collection), encoding="utf-8")
            waterways = load_projected_waterways(source, forward, 32_000)
            metadata = write_waterway_geometry(waterways, output)
            geometry = (output / "waterways.bin").read_bytes()

        self.assertEqual(metadata["geometryFeatureCount"], 1)
        self.assertAlmostEqual(struct.unpack_from("<f", geometry, 28)[0], 2.5)

    def test_vegetation_boundary_is_feathered_without_mutating_semantics(self) -> None:
        size = 128
        elevation = np.full((size, size), 200.0, dtype=np.float32)
        terrain = np.full(
            (size, size),
            TERRAIN_CODES["plains"],
            dtype=np.uint8,
        )
        vegetation = np.zeros((size, size), dtype=np.uint8)
        vegetation[:, size // 2 :] = 4
        semantic_before = vegetation.copy()

        styled = np.asarray(
            style_relief(elevation, 125.0, terrain, vegetation).convert("RGB"),
            dtype=np.uint8,
        )
        boundary_colors = np.unique(
            styled[size // 2, size // 2 - 12 : size // 2 + 12],
            axis=0,
        )

        self.assertGreaterEqual(len(boundary_colors), 5)
        np.testing.assert_array_equal(vegetation, semantic_before)

    def test_desert_boundary_is_feathered_without_mutating_semantics(self) -> None:
        size = 128
        elevation = np.full((size, size), 200.0, dtype=np.float32)
        terrain = np.full(
            (size, size),
            TERRAIN_CODES["plains"],
            dtype=np.uint8,
        )
        terrain[:, size // 2 :] = TERRAIN_CODES["desert"]
        vegetation = np.zeros((size, size), dtype=np.uint8)
        semantic_before = terrain.copy()

        styled = np.asarray(
            style_relief(elevation, 125.0, terrain, vegetation).convert("RGB"),
            dtype=np.uint8,
        )
        boundary_colors = np.unique(
            styled[size // 2, size // 2 - 12 : size // 2 + 12],
            axis=0,
        )

        self.assertGreaterEqual(len(boundary_colors), 5)
        np.testing.assert_array_equal(terrain, semantic_before)

if __name__ == "__main__":
    unittest.main()
