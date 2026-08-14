import type { WorldDateTime } from "./model";
import { GAMEPLAY_CONFIG } from "../config/GameConfig";

export const SCOUT_MARCH_START_HOUR = GAMEPLAY_CONFIG.scout.marchStartHour;
export const SCOUT_MARCH_END_HOUR = GAMEPLAY_CONFIG.scout.marchEndHour;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function assertWorldDateTime(time: WorldDateTime): void {
  if (!Number.isInteger(time.year) || time.year < -999_999 || time.year > 999_999) {
    throw new Error("World year must be a bounded integer");
  }
  if (!Number.isInteger(time.month) || time.month < 1 || time.month > 12) {
    throw new Error("World month must be between 1 and 12");
  }
  if (
    !Number.isInteger(time.day) ||
    time.day < 1 ||
    time.day > daysInMonth(time.year, time.month)
  ) {
    throw new Error("World day is invalid for its month");
  }
  if (!Number.isInteger(time.hour) || time.hour < 0 || time.hour > 23) {
    throw new Error("World hour must be between 0 and 23");
  }
  if (!Number.isInteger(time.minute) || time.minute < 0 || time.minute > 59) {
    throw new Error("World minute must be between 0 and 59");
  }
}

export function advanceWorldMinutes(
  source: WorldDateTime,
  minutes: number,
): WorldDateTime {
  assertWorldDateTime(source);
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new Error("World time can only advance by whole non-negative minutes");
  }
  let year = source.year;
  let month = source.month;
  let day = source.day;
  let totalMinutes = source.hour * 60 + source.minute + minutes;
  const elapsedDays = Math.floor(totalMinutes / (24 * 60));
  totalMinutes %= 24 * 60;
  day += elapsedDays;
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return {
    year,
    month,
    day,
    hour: Math.floor(totalMinutes / 60),
    minute: totalMinutes % 60,
  };
}

export function isScoutTravelMinute(time: WorldDateTime): boolean {
  return isDaytime(time);
}

export function isDaytime(time: WorldDateTime): boolean {
  return (
    time.hour >= SCOUT_MARCH_START_HOUR &&
    time.hour < SCOUT_MARCH_END_HOUR
  );
}

export interface ScheduledArrival {
  readonly arrival: WorldDateTime;
  readonly elapsedClockMinutes: number;
}

/** Adds active walking minutes while respecting the simplified daylight window. */
export function scheduleScoutArrival(
  departure: WorldDateTime,
  movingMinutes: number,
): ScheduledArrival {
  assertWorldDateTime(departure);
  if (!Number.isFinite(movingMinutes) || movingMinutes < 0) {
    throw new Error("Scout travel time must be a non-negative duration");
  }
  let current = { ...departure };
  let remaining = Math.ceil(movingMinutes);
  let elapsedClockMinutes = 0;

  while (remaining > 0) {
    if (current.hour < SCOUT_MARCH_START_HOUR) {
      const jump = (SCOUT_MARCH_START_HOUR - current.hour) * 60 - current.minute;
      current = advanceWorldMinutes(current, jump);
      elapsedClockMinutes += jump;
      continue;
    }
    if (current.hour >= SCOUT_MARCH_END_HOUR) {
      const jump =
        (24 - current.hour + SCOUT_MARCH_START_HOUR) * 60 - current.minute;
      current = advanceWorldMinutes(current, jump);
      elapsedClockMinutes += jump;
      continue;
    }
    const activeUntilCamp =
      (SCOUT_MARCH_END_HOUR - current.hour) * 60 - current.minute;
    const active = Math.min(remaining, activeUntilCamp);
    current = advanceWorldMinutes(current, active);
    elapsedClockMinutes += active;
    remaining -= active;
  }

  return { arrival: current, elapsedClockMinutes };
}
