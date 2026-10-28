import { describe, expect, it } from "vitest";
import { priorityFor } from "./priority";

describe("RN-01 priority", () => {
  it("is critical when something is stopped for a team or the company", () => {
    expect(priorityFor({ impact: "stopped", urgency: "none", affected: "my_team" })).toBe("critical");
    expect(priorityFor({ impact: "stopped", urgency: "none", affected: "company" })).toBe("critical");
  });

  it("is high when one person cannot work", () => {
    expect(priorityFor({ impact: "stopped", urgency: "none", affected: "only_me" })).toBe("high");
  });

  it("is high when a same-day commitment is at risk, even for a request", () => {
    expect(priorityFor({ impact: "degraded", urgency: "same_day", affected: "only_me" })).toBe("high");
    expect(priorityFor({ impact: "request", urgency: "same_day", affected: "only_me" })).toBe("high");
  });

  it("is medium when it gets in the way but there is a workaround, even for the team", () => {
    expect(priorityFor({ impact: "degraded", urgency: "none", affected: "only_me" })).toBe("medium");
    expect(priorityFor({ impact: "degraded", urgency: "none", affected: "my_team" })).toBe("medium");
  });

  it("is low for a request without urgency", () => {
    expect(priorityFor({ impact: "request", urgency: "none", affected: "only_me" })).toBe("low");
  });

  it("takes the first row that matches", () => {
    expect(priorityFor({ impact: "stopped", urgency: "same_day", affected: "company" })).toBe("critical");
  });
});
