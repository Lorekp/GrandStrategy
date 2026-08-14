"""Compile the Earth culture influence field into a compact high-resolution mask.

The browser decodes compact categorical and continuous masks once, then
recolors them on the GPU. Culture identity stays deterministic while border
and coastline presentation can interpolate without visible raster blocks.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from build_relief_tiles import rasterize_land_mask


WATER_INDEX = 255
UNINHABITED_SOUTH_LATITUDE = -60.0
EARTH_RADIUS_KM = 6_371.0088


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("public/maps/cultures/manifest.json"),
    )
    parser.add_argument(
        "--land-source",
        type=Path,
        default=Path(".cache/maps/ne_10m_land.geojson"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/maps/cultures/regions.png"),
    )
    parser.add_argument(
        "--coast-output",
        type=Path,
        default=Path("public/maps/cultures/coast-fade.png"),
    )
    parser.add_argument(
        "--border-output",
        type=Path,
        default=Path("public/maps/cultures/borders.json"),
    )
    parser.add_argument("--width", type=int, default=8_192)
    return parser.parse_args()


def approximate_field(manifest: dict, width: int, height: int) -> np.ndarray:
    """Match CultureInfluenceField's equirectangular display approximation."""
    coarse_width = min(width, 1_024)
    coarse_height = max(1, round(coarse_width * height / width))
    longitudes = (
        (np.arange(coarse_width, dtype=np.float64) + 0.5)
        / coarse_width
        * (2.0 * math.pi)
        - math.pi
    )
    latitudes = (
        math.pi / 2.0
        - (np.arange(coarse_height, dtype=np.float64) + 0.5)
        / coarse_height
        * math.pi
    )
    longitude_grid = longitudes[np.newaxis, :]
    latitude_grid = latitudes[:, np.newaxis]
    cosine_latitude = np.cos(latitude_grid)
    best_score = np.full((coarse_height, coarse_width), np.inf, dtype=np.float64)
    coarse = np.full((coarse_height, coarse_width), WATER_INDEX, dtype=np.uint8)

    cultures = manifest["cultures"]
    indexed_cultures = sorted(enumerate(cultures), key=lambda item: item[1]["id"])
    for culture_index, culture in indexed_cultures:
        for anchor in culture["anchors"]:
            anchor_longitude = math.radians(anchor["longitudeE6"] / 1_000_000)
            anchor_latitude = math.radians(anchor["latitudeE6"] / 1_000_000)
            influence_radians = (
                anchor["radiusKm"] * anchor["weight"] / EARTH_RADIUS_KM
            )
            longitude_delta = (
                longitude_grid - anchor_longitude + math.pi
            ) % (2.0 * math.pi) - math.pi
            latitude_delta = latitude_grid - anchor_latitude
            score = (
                latitude_delta * latitude_delta
                + (longitude_delta * cosine_latitude) ** 2
            ) / (influence_radians * influence_radians)
            better = score < best_score
            best_score[better] = score[better]
            coarse[better] = culture_index

    coarse[latitude_grid[:, 0] < math.radians(UNINHABITED_SOUTH_LATITUDE), :] = (
        WATER_INDEX
    )

    # Only culture-change bands need exact target-resolution evaluation. Interiors
    # are a lossless nearest expansion of the coarse classification.
    refine = np.zeros_like(coarse, dtype=bool)
    for offset_y in (-1, 0, 1):
        neighbor_y = np.clip(
            np.arange(coarse_height) + offset_y, 0, coarse_height - 1
        )
        rows = coarse[neighbor_y, :]
        for offset_x in (-1, 0, 1):
            refine |= np.roll(rows, offset_x, axis=1) != coarse

    scale_x = width // coarse_width
    scale_y = height // coarse_height
    if scale_x * coarse_width != width or scale_y * coarse_height != height:
        raise ValueError("Culture raster dimensions must be integer multiples of 1024x512")
    result = np.repeat(np.repeat(coarse, scale_y, axis=0), scale_x, axis=1)
    refine_high = np.repeat(np.repeat(refine, scale_y, axis=0), scale_x, axis=1)
    refine_y, refine_x = np.nonzero(refine_high)

    if refine_x.size:
        target_longitude = (
            (refine_x.astype(np.float64) + 0.5) / width * (2.0 * math.pi)
            - math.pi
        )
        target_latitude = (
            math.pi / 2.0
            - (refine_y.astype(np.float64) + 0.5) / height * math.pi
        )
        target_cosine = np.cos(target_latitude)
        target_score = np.full(refine_x.size, np.inf, dtype=np.float64)
        target_culture = np.full(refine_x.size, WATER_INDEX, dtype=np.uint8)
        for culture_index, culture in indexed_cultures:
            for anchor in culture["anchors"]:
                anchor_longitude = math.radians(anchor["longitudeE6"] / 1_000_000)
                anchor_latitude = math.radians(anchor["latitudeE6"] / 1_000_000)
                influence_radians = (
                    anchor["radiusKm"] * anchor["weight"] / EARTH_RADIUS_KM
                )
                longitude_delta = (
                    target_longitude - anchor_longitude + math.pi
                ) % (2.0 * math.pi) - math.pi
                latitude_delta = target_latitude - anchor_latitude
                score = (
                    latitude_delta * latitude_delta
                    + (longitude_delta * target_cosine) ** 2
                ) / (influence_radians * influence_radians)
                better = score < target_score
                target_score[better] = score[better]
                target_culture[better] = culture_index
        target_culture[
            target_latitude < math.radians(UNINHABITED_SOUTH_LATITUDE)
        ] = WATER_INDEX
        result[refine_y, refine_x] = target_culture

    return result


def _simplify_polyline(
    points: list[tuple[float, float]], tolerance: float
) -> list[tuple[float, float]]:
    """Iterative Ramer-Douglas-Peucker simplification."""
    if len(points) <= 2:
        return points
    source = np.asarray(points, dtype=np.float64)
    keep = np.zeros(len(points), dtype=bool)
    keep[0] = True
    keep[-1] = True
    stack = [(0, len(points) - 1)]
    tolerance_squared = tolerance * tolerance
    while stack:
        start, end = stack.pop()
        if end - start <= 1:
            continue
        segment = source[end] - source[start]
        candidates = source[start + 1 : end]
        length_squared = float(np.dot(segment, segment))
        if length_squared <= 1e-12:
            distance_squared = np.sum((candidates - source[start]) ** 2, axis=1)
        else:
            projection = np.clip(
                ((candidates - source[start]) @ segment) / length_squared,
                0.0,
                1.0,
            )
            closest = source[start] + projection[:, np.newaxis] * segment
            distance_squared = np.sum((candidates - closest) ** 2, axis=1)
        relative = int(np.argmax(distance_squared))
        if float(distance_squared[relative]) <= tolerance_squared:
            continue
        split = start + 1 + relative
        keep[split] = True
        stack.append((start, split))
        stack.append((split, end))
    return [tuple(point) for point in source[keep]]


def _chaikin(
    points: list[tuple[float, float]], closed: bool
) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    source = points[:-1] if closed and points[0] == points[-1] else points
    output: list[tuple[float, float]] = [] if closed else [source[0]]
    count = len(source) if closed else len(source) - 1
    for index in range(count):
        left = source[index]
        right = source[(index + 1) % len(source)]
        output.append((left[0] * 0.75 + right[0] * 0.25,
                       left[1] * 0.75 + right[1] * 0.25))
        output.append((left[0] * 0.25 + right[0] * 0.75,
                       left[1] * 0.25 + right[1] * 0.75))
    if not closed:
        output.append(source[-1])
    elif output:
        output.append(output[0])
    return output


def _trace_pair_segments(
    segments: list[tuple[tuple[int, int], tuple[int, int]]]
) -> list[list[tuple[int, int]]]:
    adjacency: dict[tuple[int, int], list[tuple[int, int]]] = {}
    unused: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    for left, right in segments:
        edge = (left, right) if left < right else (right, left)
        if edge in unused:
            continue
        unused.add(edge)
        adjacency.setdefault(left, []).append(right)
        adjacency.setdefault(right, []).append(left)

    paths: list[list[tuple[int, int]]] = []

    def consume(start: tuple[int, int], neighbor: tuple[int, int]) -> None:
        path = [start, neighbor]
        previous = start
        current = neighbor
        edge = (start, neighbor) if start < neighbor else (neighbor, start)
        unused.discard(edge)
        while True:
            candidates = []
            for candidate in adjacency[current]:
                candidate_edge = (
                    (current, candidate)
                    if current < candidate
                    else (candidate, current)
                )
                if candidate_edge in unused and candidate != previous:
                    candidates.append(candidate)
            if len(candidates) != 1:
                break
            following = candidates[0]
            following_edge = (
                (current, following)
                if current < following
                else (following, current)
            )
            unused.discard(following_edge)
            path.append(following)
            previous, current = current, following
            if current == start:
                break
        paths.append(path)

    for start, neighbors in adjacency.items():
        if len(neighbors) == 2:
            continue
        for neighbor in neighbors:
            edge = (start, neighbor) if start < neighbor else (neighbor, start)
            if edge in unused:
                consume(start, neighbor)
    while unused:
        start, neighbor = next(iter(unused))
        consume(start, neighbor)
    return paths


def culture_border_paths(
    cultures: np.ndarray,
    land: np.ndarray,
) -> list[dict]:
    height, width = cultures.shape
    segments: dict[
        tuple[int, int],
        list[tuple[tuple[int, int], tuple[int, int]]],
    ] = {}

    horizontal = (
        land[:, :-1]
        & land[:, 1:]
        & (cultures[:, :-1] != WATER_INDEX)
        & (cultures[:, 1:] != WATER_INDEX)
        & (cultures[:, :-1] != cultures[:, 1:])
    )
    for y, x in zip(*np.nonzero(horizontal), strict=True):
        pair = tuple(sorted((int(cultures[y, x]), int(cultures[y, x + 1]))))
        segments.setdefault(pair, []).append(((x + 1, y), (x + 1, y + 1)))

    vertical = (
        land[:-1, :]
        & land[1:, :]
        & (cultures[:-1, :] != WATER_INDEX)
        & (cultures[1:, :] != WATER_INDEX)
        & (cultures[:-1, :] != cultures[1:, :])
    )
    for y, x in zip(*np.nonzero(vertical), strict=True):
        pair = tuple(sorted((int(cultures[y, x]), int(cultures[y + 1, x]))))
        segments.setdefault(pair, []).append(((x, y + 1), (x + 1, y + 1)))

    output: list[dict] = []
    for pair, pair_segments in sorted(segments.items()):
        for traced in _trace_pair_segments(pair_segments):
            if len(traced) < 3:
                continue
            closed = traced[0] == traced[-1]
            if closed:
                source = traced[:-1]
                farthest = max(
                    range(1, len(source)),
                    key=lambda index: (
                        (source[index][0] - source[0][0]) ** 2
                        + (source[index][1] - source[0][1]) ** 2
                    ),
                )
                first = _simplify_polyline(source[: farthest + 1], 0.8)
                second = _simplify_polyline(source[farthest:] + [source[0]], 0.8)
                simplified = first + second[1:]
            else:
                simplified = _simplify_polyline(traced, 0.8)
            smoothed = _chaikin(simplified, closed)
            if len(smoothed) < 2:
                continue
            output.append({
                "cultures": list(pair),
                "points": [
                    round(coordinate, 2)
                    for point in smoothed
                    for coordinate in point
                ],
            })
    return output


def compile_regions(
    manifest_path: Path,
    land_source_path: Path,
    output_path: Path,
    coast_output_path: Path,
    border_output_path: Path,
    width: int,
) -> None:
    if width <= 0 or width % 1_024 != 0:
        raise ValueError("Culture raster width must be a positive multiple of 1024")
    height = width // 2
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if len(manifest["cultures"]) >= WATER_INDEX:
        raise ValueError("Culture raster supports at most 254 cultures")

    cultures = approximate_field(manifest, width, height)

    # Supersampling the canonical 1:10m vectors supplies sub-pixel coastline
    # coverage. The old 2048px binary land mask was the source of the visible
    # rectangular fringe when a culture was selected.
    # Preserve the previous 16K coastline sampling density while allowing the
    # culture field itself to carry twice as much boundary detail. Scaling the
    # supersample factor down at higher output resolutions avoids a needless
    # 32K-wide transient land mask during preprocessing.
    supersample = max(1, 16_384 // width)
    land_high = rasterize_land_mask(
        land_source_path,
        width * supersample,
        height * supersample,
    ).convert("L")
    land_coverage_image = land_high.resize(
        (width, height),
        resample=Image.Resampling.LANCZOS,
    )
    del land_high
    land_coverage = np.asarray(land_coverage_image, dtype=np.uint8).copy()
    land_coverage[cultures == WATER_INDEX] = 0

    # Coast coverage stays continuous so the overlay meets the high-resolution
    # land silhouette without a rectangular fringe. Culture boundaries are
    # presentation-only vector paths and do not alter the relief underneath.
    blurred_land = land_coverage_image.filter(ImageFilter.GaussianBlur(radius=1.5))
    coast_fade = np.minimum(
        land_coverage,
        np.asarray(blurred_land, dtype=np.uint8),
    ).astype(np.uint8)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    encoded = np.stack((cultures, land_coverage), axis=-1)
    Image.fromarray(encoded, mode="LA").save(
        output_path,
        format="PNG",
        optimize=True,
        compress_level=9,
    )
    print(
        f"Wrote {output_path} ({width}x{height}, "
        f"{output_path.stat().st_size / 1024:.1f} KiB)"
    )

    coast_output_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(coast_fade, mode="L").save(
        coast_output_path,
        format="PNG",
        optimize=True,
        compress_level=9,
    )
    print(
        f"Wrote {coast_output_path} ({width}x{height}, "
        f"{coast_output_path.stat().st_size / 1024:.1f} KiB)"
    )

    border_output_path.parent.mkdir(parents=True, exist_ok=True)
    border_manifest = {
        "formatVersion": 1,
        "width": width,
        "height": height,
        "paths": culture_border_paths(cultures, land_coverage >= 128),
    }
    border_output_path.write_text(
        json.dumps(border_manifest, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"Wrote {border_output_path} ({len(border_manifest['paths'])} paths, "
        f"{border_output_path.stat().st_size / 1024:.1f} KiB)"
    )


def main() -> None:
    args = parse_args()
    compile_regions(
        args.manifest,
        args.land_source,
        args.output,
        args.coast_output,
        args.border_output,
        args.width,
    )


if __name__ == "__main__":
    main()
