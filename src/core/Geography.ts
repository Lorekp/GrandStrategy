import { GAMEPLAY_CONFIG } from "../config/GameConfig";
import type { GeographicPosition } from "./model";

const EARTH_MEAN_RADIUS_METERS = GAMEPLAY_CONFIG.world.earthMeanRadiusMeters;

function radians(microdegrees: number): number {
  return (microdegrees / 1_000_000) * (Math.PI / 180);
}

export function geographicDistanceMeters(
  first: GeographicPosition,
  second: GeographicPosition,
): number {
  const firstLatitude = radians(first.latitudeE6);
  const secondLatitude = radians(second.latitudeE6);
  const latitudeDifference = secondLatitude - firstLatitude;
  const longitudeDifference =
    radians(second.longitudeE6) - radians(first.longitudeE6);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;
  return (
    2 *
    EARTH_MEAN_RADIUS_METERS *
    Math.asin(Math.min(1, Math.sqrt(haversine)))
  );
}
