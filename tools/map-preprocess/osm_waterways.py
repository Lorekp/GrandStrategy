"""Compile natural waterways from pinned OpenStreetMap PBF extracts.

Geofabrik's index chooses the smallest regional extracts intersecting a Theater.
Every release input is a dated PBF verified against its published checksum. The
browser receives only the existing static tiles and semantic river raster.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import md5, sha256
import heapq
import json
import math
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import osmium
except ImportError as error:
    raise SystemExit(
        "pyosmium is required. Install the pinned tool dependencies with: "
        "python -m pip install -r tools/map-preprocess/requirements.txt"
    ) from error

from hydrology import freshwater_strength, visible_river_class


GEOFABRIK_INDEX_URL = "https://download.geofabrik.de/index-v1.json"
OSM_SNAPSHOT = "2026-08-01"
OSM_SNAPSHOT_SUFFIX = "260801"
OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
OSM_ATTRIBUTION = "© OpenStreetMap contributors"
OSM_LICENSE = "Open Data Commons Open Database License 1.0"
NORMALIZER_VERSION = 5
ALLOWED_WATERWAYS = frozenset(("river", "stream", "tidal_channel"))
FALSE_VALUES = frozenset(("", "0", "false", "no", "none"))


@dataclass(frozen=True)
class PinnedPbfSource:
    source_id: str
    url: str
    checksum: str
    path: Path


@dataclass(frozen=True)
class OsmWaterwayDataset:
    path: Path
    snapshot: str
    normalized_hash: str
    feature_count: int
    sources: tuple[PinnedPbfSource, ...]


def _clean(value: object) -> str:
    return str(value or "").strip().casefold()


def natural_waterway_kind(tags: dict[str, object]) -> str | None:
    """Return the kind of an unambiguously natural OSM waterway."""
    waterway = _clean(tags.get("waterway"))
    if waterway not in ALLOWED_WATERWAYS:
        return None
    if _clean(tags.get("man_made")) not in FALSE_VALUES:
        return None
    if _clean(tags.get("artificial")) not in FALSE_VALUES:
        return None
    if "canal" in _clean(tags.get("name")):
        return None
    return waterway


def waterway_regime(tags: dict[str, object]) -> str:
    seasonal = _clean(tags.get("seasonal"))
    if seasonal not in FALSE_VALUES:
        return "seasonal"
    intermittent = _clean(tags.get("intermittent"))
    if intermittent not in FALSE_VALUES:
        return "intermittent"
    if intermittent in ("no", "false", "0") or seasonal in ("no", "false", "0"):
        return "perennial"
    return "unknown"


def waterway_width_meters(tags: dict[str, object]) -> float | None:
    """Parse an explicit OSM width without inventing precision from prose."""
    raw = str(tags.get("width") or "").strip().casefold()
    if not raw:
        return None
    if raw.endswith("m"):
        raw = raw[:-1].strip()
    try:
        width = float(raw.replace(",", "."))
    except ValueError:
        return None
    return round(width, 2) if 0.2 <= width <= 20_000 else None


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def _download_bytes(url: str, maximum_bytes: int = 32 * 1024 * 1024) -> bytes:
    request = Request(url, headers={"User-Agent": "GrandStrategy-map-compiler/1"})
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=60) as response:
                payload = response.read(maximum_bytes + 1)
            if len(payload) > maximum_bytes:
                raise RuntimeError(f"Source metadata exceeds {maximum_bytes} bytes")
            return payload
        except (HTTPError, OSError, URLError) as error:
            last_error = error
            time.sleep(attempt + 1)
    raise RuntimeError(f"Unable to download {url}") from last_error


def _download_file(url: str, destination: Path) -> None:
    if destination.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f"{destination.name}.tmp")
    request = Request(url, headers={"User-Agent": "GrandStrategy-map-compiler/1"})
    try:
        with urlopen(request, timeout=300) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        temporary.replace(destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _ring_contains(point: tuple[float, float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = float(previous[0]), float(previous[1])
        x2, y2 = float(current[0]), float(current[1])
        if (y1 > y) != (y2 > y):
            crossing_x = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing_x:
                inside = not inside
        previous = current
    return inside


def _polygon_contains(point: tuple[float, float], polygon: list[object]) -> bool:
    if not polygon or not _ring_contains(point, polygon[0]):
        return False
    return not any(_ring_contains(point, hole) for hole in polygon[1:])


def _geometry_contains(geometry: object, point: tuple[float, float]) -> bool:
    if not isinstance(geometry, dict):
        return False
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        return False
    if geometry.get("type") == "Polygon":
        return _polygon_contains(point, coordinates)
    if geometry.get("type") == "MultiPolygon":
        return any(_polygon_contains(point, polygon) for polygon in coordinates)
    return False


def _geometry_envelope(
    geometry: object,
) -> tuple[float, float, float, float] | None:
    if not isinstance(geometry, dict):
        return None
    coordinates = geometry.get("coordinates")
    points: list[tuple[float, float]] = []

    def collect(value: object) -> None:
        if not isinstance(value, list) or not value:
            return
        if (
            len(value) >= 2
            and isinstance(value[0], (int, float))
            and isinstance(value[1], (int, float))
        ):
            points.append((float(value[0]), float(value[1])))
            return
        for child in value:
            collect(child)

    collect(coordinates)
    if not points:
        return None
    longitudes, latitudes = zip(*points, strict=True)
    return min(longitudes), min(latitudes), max(longitudes), max(latitudes)


def _envelope_may_contain(
    envelope: tuple[float, float, float, float] | None,
    point: tuple[float, float],
) -> bool:
    if envelope is None:
        return True
    west, south, east, north = envelope
    longitude, latitude = point
    if not south <= latitude <= north:
        return False
    # A wide envelope may cross the antimeridian; keep it as a conservative hit.
    return east - west > 180.0 or west <= longitude <= east


def _sample_bounds(
    bounds: tuple[float, float, float, float],
    samples_per_axis: int = 9,
) -> list[tuple[float, float]]:
    south, west, north, east = bounds
    east_unwrapped = east if east > west else east + 360.0
    points: list[tuple[float, float]] = []
    for row in range(samples_per_axis):
        latitude = south + (north - south) * row / (samples_per_axis - 1)
        for column in range(samples_per_axis):
            longitude = west + (east_unwrapped - west) * column / (samples_per_axis - 1)
            points.append((((longitude + 180.0) % 360.0) - 180.0, latitude))
    return points


def select_geofabrik_extracts(
    index: object,
    bounds: tuple[float, float, float, float],
) -> list[dict[str, object]]:
    """Select the smallest published extracts covering a metric Theater sample."""
    if not isinstance(index, dict) or not isinstance(index.get("features"), list):
        raise ValueError("Geofabrik index is not a FeatureCollection")
    features = [feature for feature in index["features"] if isinstance(feature, dict)]
    child_ids = {
        str((feature.get("properties") or {}).get("parent"))
        for feature in features
        if isinstance(feature.get("properties"), dict)
    }
    leaves = [
        feature
        for feature in features
        if isinstance(feature.get("properties"), dict)
        and str(feature["properties"].get("id")) not in child_ids
        and isinstance(feature["properties"].get("urls"), dict)
        and feature["properties"]["urls"].get("pbf")
    ]
    indexed_leaves = [
        (
            feature,
            _geometry_envelope(feature.get("geometry")),
            len(_canonical_bytes(feature.get("geometry"))),
        )
        for feature in leaves
    ]
    selected: dict[str, dict[str, object]] = {}
    for point in _sample_bounds(bounds):
        matches = [
            (feature, geometry_size)
            for feature, envelope, geometry_size in indexed_leaves
            if _envelope_may_contain(envelope, point)
            and _geometry_contains(feature.get("geometry"), point)
        ]
        if not matches:
            continue
        # Leaf extracts may intentionally overlap. Prefer the shortest boundary
        # representation as a stable proxy for the most local published region.
        match = min(matches, key=lambda item: item[1])[0]
        source_id = str(match["properties"]["id"])
        selected[source_id] = match
    if not selected:
        raise ValueError("No Geofabrik PBF extract covers this Regional Theater")
    return [selected[source_id] for source_id in sorted(selected)]


def _dated_url(latest_url: str) -> str:
    suffix = "-latest.osm.pbf"
    if not latest_url.endswith(suffix):
        raise ValueError(f"Unexpected Geofabrik PBF URL: {latest_url}")
    return f"{latest_url[:-len(suffix)]}-{OSM_SNAPSHOT_SUFFIX}.osm.pbf"


def _parse_md5(payload: bytes) -> str:
    text = payload.decode("ascii").strip()
    checksum = text.split()[0].casefold() if text else ""
    if len(checksum) != 32 or any(character not in "0123456789abcdef" for character in checksum):
        raise ValueError("Geofabrik checksum response is invalid")
    return checksum


def _file_md5(path: Path) -> str:
    digest = md5(usedforsecurity=False)
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def load_pinned_sources(
    cache: Path,
    bounds: tuple[float, float, float, float],
) -> tuple[PinnedPbfSource, ...]:
    index_path = cache / "geofabrik-index-v1.json"
    if not index_path.exists():
        _atomic_write(index_path, _download_bytes(GEOFABRIK_INDEX_URL))
    index = json.loads(index_path.read_text(encoding="utf-8"))
    features = select_geofabrik_extracts(index, bounds)
    sources: list[PinnedPbfSource] = []
    for feature in features:
        properties = feature["properties"]
        source_id = str(properties["id"])
        url = _dated_url(str(properties["urls"]["pbf"]))
        destination = cache / OSM_SNAPSHOT / f"{source_id}-{OSM_SNAPSHOT_SUFFIX}.osm.pbf"
        checksum_path = destination.with_name(f"{destination.name}.md5")
        if not checksum_path.exists():
            _atomic_write(checksum_path, _download_bytes(f"{url}.md5", maximum_bytes=1024))
        checksum = _parse_md5(checksum_path.read_bytes())
        _download_file(url, destination)
        verified_path = destination.with_name(f"{destination.name}.verified.json")
        verified = None
        if verified_path.exists():
            verified = json.loads(verified_path.read_text(encoding="utf-8"))
        if not (
            isinstance(verified, dict)
            and verified.get("md5") == checksum
            and verified.get("size") == destination.stat().st_size
        ):
            actual_checksum = _file_md5(destination)
            if actual_checksum != checksum:
                destination.unlink(missing_ok=True)
                verified_path.unlink(missing_ok=True)
                raise ValueError(f"Checksum mismatch for {source_id} OpenStreetMap extract")
            _atomic_write(
                verified_path,
                _canonical_bytes({"md5": checksum, "size": destination.stat().st_size}) + b"\n",
            )
        sources.append(PinnedPbfSource(source_id, url, checksum, destination))
    return tuple(sources)


def strahler_orders(
    ways: dict[int, tuple[dict[str, str], tuple[int, ...], str]],
) -> dict[int, int]:
    """Return deterministic Horton-Strahler order for directed OSM way networks."""
    outgoing: dict[int, list[tuple[int, int]]] = {}
    indegree: dict[int, int] = {}
    nodes: set[int] = set()
    for way_id, (_, node_ids, _) in ways.items():
        for upstream, downstream in zip(node_ids, node_ids[1:]):
            outgoing.setdefault(upstream, []).append((downstream, way_id))
            indegree[downstream] = indegree.get(downstream, 0) + 1
            indegree.setdefault(upstream, indegree.get(upstream, 0))
            nodes.add(upstream)
            nodes.add(downstream)
    for edges in outgoing.values():
        edges.sort()
    queue = [node for node in nodes if indegree.get(node, 0) == 0]
    heapq.heapify(queue)
    maximum_incoming: dict[int, int] = {}
    maximum_count: dict[int, int] = {}
    orders = {way_id: 1 for way_id in ways}
    while queue:
        node = heapq.heappop(queue)
        maximum = maximum_incoming.get(node, 0)
        node_order = (
            1
            if maximum == 0
            else maximum + 1
            if maximum_count.get(node, 0) >= 2
            else maximum
        )
        for downstream, way_id in outgoing.get(node, ()):
            orders[way_id] = max(orders[way_id], node_order)
            prior = maximum_incoming.get(downstream, 0)
            if node_order > prior:
                maximum_incoming[downstream] = node_order
                maximum_count[downstream] = 1
            elif node_order == prior:
                maximum_count[downstream] = maximum_count.get(downstream, 0) + 1
            indegree[downstream] -= 1
            if indegree[downstream] == 0:
                heapq.heappush(queue, downstream)
    return orders


def normalize_pbf_waterways(
    sources: tuple[PinnedPbfSource, ...],
    bounds: tuple[float, float, float, float] | None = None,
) -> dict[str, object]:
    """Stream native-filtered PBF ways once and emit deterministic waterway lines."""
    ways: dict[int, tuple[dict[str, str], tuple[int, ...], str]] = {}
    coordinates_by_way: dict[int, list[list[float]]] = {}
    for source in sources:
        processor = (
            osmium.FileProcessor(source.path)
            .with_locations("sparse_mem_array")
            .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
            .with_filter(osmium.filter.KeyFilter("waterway"))
        )
        for way in processor:
            tags = {tag.k: tag.v for tag in way.tags}
            if natural_waterway_kind(tags) is None:
                continue
            node_ids = tuple(node.ref for node in way.nodes)
            if len(node_ids) < 2:
                continue
            coordinates = [
                [round(node.location.lon, 7), round(node.location.lat, 7)]
                for node in way.nodes
                if node.location.valid()
            ]
            if len(coordinates) < 2:
                continue
            if bounds is not None and not _line_bounds_intersect(coordinates, bounds):
                continue
            ways.setdefault(way.id, (tags, node_ids, source.source_id))
            coordinates_by_way.setdefault(way.id, coordinates)

    selected: dict[int, tuple[dict[str, str], tuple[int, ...], str]] = {}
    for way_id in sorted(ways):
        tags, node_ids, source_id = ways[way_id]
        if natural_waterway_kind(tags) is None:
            continue
        selected[way_id] = (tags, node_ids, source_id)

    orders = strahler_orders(selected)
    features: list[dict[str, object]] = []
    for way_id in sorted(selected):
        tags, node_ids, source_id = selected[way_id]
        coordinates = coordinates_by_way[way_id]
        waterway = natural_waterway_kind(tags)
        if waterway is None:
            continue
        regime = waterway_regime(tags)
        width_meters = waterway_width_meters(tags)
        stream_order = orders[way_id]
        display_class = visible_river_class(
            waterway,
            stream_order,
            width_meters,
            regime,
        )
        properties: dict[str, object] = {
            "source": "OpenStreetMap",
            "sourceExtract": source_id,
            "sourceId": f"way/{way_id}",
            "waterway": waterway,
            "streamOrder": stream_order,
            "displayClass": display_class or "none",
            "freshwaterStrength": freshwater_strength(
                waterway,
                stream_order,
                regime,
            ),
            "regime": regime,
        }
        if width_meters is not None:
            properties["widthMeters"] = width_meters
        name = str(tags.get("name") or "").strip()
        if name:
            properties["name"] = name
        features.append(
            {
                "type": "Feature",
                "id": f"osm-way-{way_id}",
                "properties": properties,
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _source_derivative_paths(
    cache: Path,
    source: PinnedPbfSource,
) -> tuple[Path, Path]:
    identity = {
        "normalizerVersion": NORMALIZER_VERSION,
        "snapshot": OSM_SNAPSHOT,
        "source": [source.source_id, source.checksum],
    }
    derivative_id = sha256(_canonical_bytes(identity)).hexdigest()
    root = cache / OSM_SNAPSHOT / "normalized-sources"
    return (
        root / f"{derivative_id}.geojson",
        root / f"{derivative_id}.metadata.json",
    )


def _load_or_normalize_source(
    cache: Path,
    source: PinnedPbfSource,
) -> dict[str, object]:
    normalized_path, metadata_path = _source_derivative_paths(cache, source)
    if normalized_path.exists() and metadata_path.exists():
        payload = normalized_path.read_bytes()
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("normalizedHash") != sha256(payload).hexdigest():
            raise ValueError("Cached OSM source hash does not match its metadata")
        return json.loads(payload)

    normalized = normalize_pbf_waterways((source,))
    payload = _canonical_bytes(normalized) + b"\n"
    metadata = {
        "normalizerVersion": NORMALIZER_VERSION,
        "snapshot": OSM_SNAPSHOT,
        "source": [source.source_id, source.checksum],
        "normalizedHash": sha256(payload).hexdigest(),
        "featureCount": len(normalized["features"]),
    }
    _atomic_write(normalized_path, payload)
    _atomic_write(metadata_path, _canonical_bytes(metadata) + b"\n")
    return normalized


def _clip_and_merge_waterways(
    collections: list[dict[str, object]],
    bounds: tuple[float, float, float, float],
) -> dict[str, object]:
    selected: dict[str, dict[str, object]] = {}
    for collection in collections:
        for feature in collection.get("features", []):
            if not isinstance(feature, dict):
                continue
            geometry = feature.get("geometry")
            if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
                continue
            coordinates = geometry.get("coordinates")
            if not isinstance(coordinates, list) or len(coordinates) < 2:
                continue
            if not _line_bounds_intersect(coordinates, bounds):
                continue
            feature_id = str(feature.get("id") or "")
            if not feature_id:
                properties = feature.get("properties")
                if not isinstance(properties, dict):
                    continue
                feature_id = str(properties.get("sourceId") or "")
            if feature_id:
                selected.setdefault(feature_id, feature)
    return {
        "type": "FeatureCollection",
        "features": [selected[feature_id] for feature_id in sorted(selected)],
    }


def _line_bounds_intersect(
    coordinates: list[list[float]],
    bounds: tuple[float, float, float, float],
) -> bool:
    south, west, north, east = bounds
    east_unwrapped = east if east > west else east + 360.0
    longitudes = [
        longitude if longitude >= west else longitude + 360.0
        for longitude, _ in coordinates
    ]
    latitudes = [latitude for _, latitude in coordinates]
    return not (
        max(longitudes) < west
        or min(longitudes) > east_unwrapped
        or max(latitudes) < south
        or min(latitudes) > north
    )


def load_osm_waterways(
    cache: Path,
    bounds: tuple[float, float, float, float],
) -> OsmWaterwayDataset:
    sources = load_pinned_sources(cache, bounds)
    source_identity = {
        "bounds": [round(value, 7) for value in bounds],
        "normalizerVersion": NORMALIZER_VERSION,
        "snapshot": OSM_SNAPSHOT,
        "sources": [[source.source_id, source.checksum] for source in sources],
    }
    derivative_id = sha256(_canonical_bytes(source_identity)).hexdigest()
    derivative_dir = cache / OSM_SNAPSHOT / "normalized"
    normalized_path = derivative_dir / f"{derivative_id}.geojson"
    metadata_path = derivative_dir / f"{derivative_id}.metadata.json"
    if normalized_path.exists() and metadata_path.exists():
        payload = normalized_path.read_bytes()
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        normalized_hash = sha256(payload).hexdigest()
        if metadata.get("normalizedHash") != normalized_hash:
            raise ValueError("Cached OSM waterway hash does not match its metadata")
        return OsmWaterwayDataset(
            normalized_path,
            OSM_SNAPSHOT,
            normalized_hash,
            int(metadata["featureCount"]),
            sources,
        )

    normalized = _clip_and_merge_waterways(
        [_load_or_normalize_source(cache, source) for source in sources],
        bounds,
    )
    payload = _canonical_bytes(normalized) + b"\n"
    normalized_hash = sha256(payload).hexdigest()
    metadata = {
        **source_identity,
        "normalizedHash": normalized_hash,
        "featureCount": len(normalized["features"]),
        "attribution": OSM_ATTRIBUTION,
        "license": OSM_LICENSE,
        "copyrightUrl": OSM_COPYRIGHT_URL,
    }
    _atomic_write(normalized_path, payload)
    _atomic_write(metadata_path, _canonical_bytes(metadata) + b"\n")
    return OsmWaterwayDataset(
        normalized_path,
        OSM_SNAPSHOT,
        normalized_hash,
        len(normalized["features"]),
        sources,
    )
