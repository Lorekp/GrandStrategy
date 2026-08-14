import { describe, expect, it } from "vitest";
import {
  advanceWorldMinutes,
  isScoutTravelMinute,
  scheduleScoutArrival,
} from "./WorldClock";
import { Localization } from "../localization/Localization";

describe("world clock", () => {
  it("advances dates and formats astronomical BCE years for players", () => {
    const start = { year: -9_999, month: 3, day: 1, hour: 23, minute: 59 };
    const next = advanceWorldMinutes(start, 1);
    expect(next).toEqual({ year: -9_999, month: 3, day: 2, hour: 0, minute: 0 });
    expect(new Localization("en").worldDateTime(next)).toBe(
      "2 Mar 10,000 BCE · 00:00",
    );
  });

  it("allows uninterrupted travel throughout the twelve-hour day", () => {
    expect(isScoutTravelMinute({ year: 1, month: 1, day: 1, hour: 6, minute: 49 })).toBe(true);
    expect(isScoutTravelMinute({ year: 1, month: 1, day: 1, hour: 6, minute: 50 })).toBe(true);
    expect(isScoutTravelMinute({ year: 1, month: 1, day: 1, hour: 13, minute: 59 })).toBe(true);
    expect(isScoutTravelMinute({ year: 1, month: 1, day: 1, hour: 17, minute: 59 })).toBe(true);
    expect(isScoutTravelMinute({ year: 1, month: 1, day: 1, hour: 18, minute: 0 })).toBe(false);
  });

  it("includes overnight rest without inserting hourly halts", () => {
    const sameDay = scheduleScoutArrival(
      { year: 1, month: 1, day: 1, hour: 6, minute: 45 },
      30,
    );
    expect(sameDay.arrival).toEqual({ year: 1, month: 1, day: 1, hour: 7, minute: 15 });
    expect(sameDay.elapsedClockMinutes).toBe(30);

    const departure = { year: 1, month: 1, day: 1, hour: 17, minute: 55 };
    const schedule = scheduleScoutArrival(departure, 10);
    expect(schedule.arrival).toEqual({ year: 1, month: 1, day: 2, hour: 6, minute: 5 });
    expect(schedule.elapsedClockMinutes).toBe(730);
  });
});
