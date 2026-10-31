import { describe, expect, it } from "vitest";
import { clockTime, dayAndMonth, dueIn, localDay, wallClock } from "./sao-paulo";

// 02:30Z on Tuesday 27 is 23:30 of Monday 26 in São Paulo (UTC-3).
const lateMonday = new Date("2026-10-27T02:30:00Z");

describe("São Paulo time", () => {
  it("reads the wall clock of São Paulo, whatever zone the server runs in", () => {
    const clock = wallClock(lateMonday);
    expect([clock.getUTCDate(), clock.getUTCHours(), clock.getUTCMinutes()]).toEqual([26, 23, 30]);
  });

  it("counts calendar days in São Paulo, not in UTC", () => {
    expect(localDay(new Date("2026-10-27T02:59:00Z")) - localDay(new Date("2026-10-26T03:00:00Z"))).toBe(0);
    expect(localDay(new Date("2026-10-27T03:00:00Z")) - localDay(lateMonday)).toBe(1);
  });

  it("says the time and the day as the screen and the agent write them", () => {
    expect(clockTime(lateMonday)).toBe("23:30");
    expect(clockTime(new Date("2026-10-26T12:05:00Z"))).toBe("09:05");
    expect(dayAndMonth(lateMonday)).toBe("26 out");
    expect(dayAndMonth(new Date("2026-11-02T13:00:00Z"))).toBe("2 nov");
  });
});

describe("dueIn", () => {
  const since = new Date("2026-10-26T13:00:00Z"); // Monday 26, 10:00 in São Paulo

  it("says in how many São Paulo days the deadline falls, with its time and day", () => {
    expect(dueIn(new Date("2026-10-26T16:43:00Z"), since)).toEqual({ days: 0, time: "13:43", day: "26 out" });
    expect(dueIn(new Date("2026-10-27T13:00:00Z"), since)).toEqual({ days: 1, time: "10:00", day: "27 out" });
    expect(dueIn(new Date("2026-10-29T20:05:00Z"), since)).toEqual({ days: 3, time: "17:05", day: "29 out" });
  });

  it("counts a deadline already past as today or before", () => {
    expect(dueIn(new Date("2026-10-23T13:00:00Z"), since).days).toBe(-3);
  });
});
