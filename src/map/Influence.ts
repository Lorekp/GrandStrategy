import type { Settlement } from "../core/model";
import type { TheaterPoint } from "./RegionalTheater";

export function organicInfluenceRadiusMeters(
  settlement: Settlement,
  angle: number,
): number {
  const phase = settlement.tribeId * 1.618;
  const variation =
    Math.sin(angle * 5 + phase) * 0.07 +
    Math.sin(angle * 11 - phase * 0.7) * 0.035 +
    Math.sin(angle * 17 + phase * 1.3) * 0.015;
  return settlement.influenceRadiusMeters * (1 + variation);
}

export function pointIsInsideInfluence(
  point: TheaterPoint,
  settlementPoint: TheaterPoint,
  settlement: Settlement,
  metersPerPixel: number,
): boolean {
  const deltaX = point.x - settlementPoint.x;
  const deltaY = point.y - settlementPoint.y;
  const distanceMeters = Math.hypot(deltaX, deltaY) * metersPerPixel;
  const angle = Math.atan2(deltaY, deltaX);
  return distanceMeters <= organicInfluenceRadiusMeters(settlement, angle);
}
