"""Build a compact, palette-quantized relief tile pyramid for the game client."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance

from physical_geography import is_natural_river_feature


TILE_SIZE = 1024
LEVEL_WIDTHS = (2048, 4096, 8192, 16384)
TERRAIN_PALETTE_COLORS = 63
TOTAL_PALETTE_COLORS = 64
MASK_WIDTH = 2048
MASK_HEIGHT = 1024
RIVER_COLOR = (44, 143, 174)


def styled(image: Image.Image) -> Image.Image:
    """Pull the source toward a subdued printed-atlas palette."""
    image = image.convert("RGB")
    image = ImageEnhance.Color(image).enhance(0.78)
    image = ImageEnhance.Contrast(image).enhance(1.1)
    return ImageEnhance.Brightness(image).enhance(1.02)


def project_line(
    line: list[list[float]], width: int, height: int
) -> list[tuple[int, int]]:
    return [
        (
            round(((longitude + 180) / 360) * (width - 1)),
            round(((90 - latitude) / 180) * (height - 1)),
        )
        for longitude, latitude, *_ in line
    ]


def rasterize_land_mask(land_source: Path, width: int, height: int) -> Image.Image:
    geojson = json.loads(land_source.read_text(encoding="utf-8"))
    mask = Image.new("1", (width, height), 0)
    draw = ImageDraw.Draw(mask)

    for feature in geojson["features"]:
        geometry = feature["geometry"]
        polygons = (
            [geometry["coordinates"]]
            if geometry["type"] == "Polygon"
            else geometry["coordinates"]
        )
        for polygon in polygons:
            if not polygon:
                continue
            draw.polygon(
                project_line(polygon[0], width, height), fill=1
            )
            for hole in polygon[1:]:
                draw.polygon(
                    project_line(hole, width, height), fill=0
                )
    return mask


def build_land_mask(land_source: Path, output: Path) -> None:
    mask = rasterize_land_mask(land_source, MASK_WIDTH, MASK_HEIGHT)

    rgba = Image.new("RGBA", mask.size, (255, 255, 255, 255))
    rgba.putalpha(mask)
    rgba.save(output / "land-mask.png", optimize=True)


def draw_rivers(
    image: Image.Image,
    river_source: Path,
    land_source: Path,
    level: int,
) -> None:
    """Draw progressively denser drainage with crisp, atlas-blue pixels."""
    geojson = json.loads(river_source.read_text(encoding="utf-8"))
    maximum_scalerank = (2, 4, 6, 8)[level]
    palette = image.getpalette()
    if palette is None:
        raise ValueError("Expected indexed relief before drawing rivers")
    river_palette_index = TERRAIN_PALETTE_COLORS
    river_color_offset = river_palette_index * 3
    palette[river_color_offset : river_color_offset + 3] = RIVER_COLOR
    image.putpalette(palette)
    river_mask = Image.new("1", image.size, 0)
    draw = ImageDraw.Draw(river_mask)

    for feature in geojson["features"]:
        if not is_natural_river_feature(feature):
            continue
        if feature["properties"]["scalerank"] > maximum_scalerank:
            continue
        geometry = feature["geometry"]
        lines = (
            [geometry["coordinates"]]
            if geometry["type"] == "LineString"
            else geometry["coordinates"]
        )
        for line in lines:
            points = project_line(line, image.width, image.height)
            if len(points) > 1:
                draw.line(points, fill=1, width=1)

    land_mask = rasterize_land_mask(land_source, image.width, image.height)
    image.paste(
        river_palette_index,
        mask=ImageChops.logical_and(river_mask, land_mask),
    )


def build_tiles(
    source: Path,
    land_source: Path,
    river_source: Path,
    output: Path,
    preview: Path,
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    preview.parent.mkdir(parents=True, exist_ok=True)
    # The official 1:10m world raster is 21600 x 10800 and intentionally
    # exceeds Pillow's generic upload-safety threshold.
    Image.MAX_IMAGE_PIXELS = None

    with Image.open(source) as original:
        if original.width != original.height * 2:
            raise ValueError(
                f"Expected a 2:1 equirectangular raster, got {original.size}"
            )

        palette_source = styled(
            original.resize((LEVEL_WIDTHS[0], LEVEL_WIDTHS[0] // 2), Image.Resampling.LANCZOS)
        )
        palette = palette_source.quantize(
            colors=TERRAIN_PALETTE_COLORS,
            method=Image.Quantize.MEDIANCUT,
            dither=Image.Dither.NONE,
        )
        palette.resize((1024, 512), Image.Resampling.NEAREST).convert("RGB").save(
            preview,
            optimize=True,
        )

        manifest_levels: list[dict[str, int]] = []
        for level, width in enumerate(LEVEL_WIDTHS):
            height = width // 2
            level_dir = output / str(level)
            level_dir.mkdir(parents=True, exist_ok=True)

            resized = styled(
                original.resize((width, height), Image.Resampling.LANCZOS)
            ).quantize(palette=palette, dither=Image.Dither.NONE)
            draw_rivers(resized, river_source, land_source, level)
            columns = width // TILE_SIZE
            rows = height // TILE_SIZE

            for row in range(rows):
                for column in range(columns):
                    left = column * TILE_SIZE
                    top = row * TILE_SIZE
                    tile = resized.crop(
                        (left, top, left + TILE_SIZE, top + TILE_SIZE)
                    )
                    tile.save(level_dir / f"{column}_{row}.png", optimize=True)

            manifest_levels.append(
                {
                    "level": level,
                    "width": width,
                    "height": height,
                    "columns": columns,
                    "rows": rows,
                }
            )

    manifest = {
        "formatVersion": 3,
        "projection": "equirectangular",
        "source": "Natural Earth II 1:10m with shaded relief and water v3.2.0",
        "sourceUrl": "https://naciscdn.org/naturalearth/10m/raster/NE2_HR_LC_SR_W.zip",
        "tileSize": TILE_SIZE,
        "paletteColors": TOTAL_PALETTE_COLORS,
        "riverColor": "#2c8fae",
        "levels": manifest_levels,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    build_land_mask(land_source, output)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("land_source", type=Path)
    parser.add_argument("river_source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--preview", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    build_tiles(
        arguments.source,
        arguments.land_source,
        arguments.river_source,
        arguments.output,
        arguments.preview,
    )
