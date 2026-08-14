"""Shared source-data rules for compiling a pre-industrial physical map."""

from __future__ import annotations


def is_natural_river_feature(feature: dict[str, object]) -> bool:
    """Accept unambiguous natural rivers from mixed cartographic linework."""
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        return False
    if str(properties.get("featurecla", "")).strip().casefold() != "river":
        return False
    names = (
        value
        for key, value in properties.items()
        if str(key).casefold().startswith("name")
    )
    if not any(str(value).strip() for value in names if value is not None):
        # Natural Earth documents that this mixed layer contains some canals
        # without reliably classifying all of them. Unnamed minor linework is
        # therefore too ambiguous for a natural-only founding-era map.
        return False
    return not any(
        "canal" in str(value).casefold()
        for value in properties.values()
        if value is not None
    )
