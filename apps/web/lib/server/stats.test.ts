import { describe, expect, it } from "vitest";
import { conversations, decisions, messages } from "@/db/schema";
import { getLoginStats, loginStatsHandler } from "./stats";
import { fakeTicketService, NOW, request, testDeps } from "./test-deps";

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("getLoginStats", () => {
  it("computes the three numbers from the sample data", async () => {
    // The numbers of the design: replies take 8 s on average, 13 of the 18 closed conversations were
    // resolved by the agent, and 6 analysts are available.
    expect(await getLoginStats(await testDeps())).toEqual({
      firstResponseSeconds: 8,
      resolvedWithoutQueuePercent: 72,
      analystsOnline: 6,
    });
  });

  it("only counts the last 30 days", async () => {
    const deps = await testDeps();
    await deps.db.insert(conversations).values({
      id: "conv-old",
      employeeId: "emp-carla",
      state: "closed",
      outcome: "closed_by_analyst",
      messageCount: 1,
      createdAt: ago(31 * DAY),
      firstResponseAt: ago(31 * DAY - 600_000),
      closedAt: ago(30 * DAY + 1000),
    });
    expect(await getLoginStats(deps)).toMatchObject({ firstResponseSeconds: 8, resolvedWithoutQueuePercent: 72 });
  });

  it("has no numbers without conversations", async () => {
    const deps = await testDeps();
    await deps.db.delete(decisions);
    await deps.db.delete(messages);
    await deps.db.delete(conversations);
    expect(await getLoginStats(deps)).toEqual({
      firstResponseSeconds: null,
      resolvedWithoutQueuePercent: null,
      analystsOnline: 6,
    });
  });

  it("keeps the other numbers when the ticket-service is down", async () => {
    const deps = await testDeps({ ticketService: fakeTicketService({ down: true }) });
    expect(await getLoginStats(deps)).toEqual({
      firstResponseSeconds: 8,
      resolvedWithoutQueuePercent: 72,
      analystsOnline: null,
    });
  });
});

describe("GET /api/stats/login", () => {
  it("returns the numbers without a session", async () => {
    const response = await loginStatsHandler(request("/api/stats/login"), await testDeps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      firstResponseSeconds: 8,
      resolvedWithoutQueuePercent: 72,
      analystsOnline: 6,
    });
  });
});
