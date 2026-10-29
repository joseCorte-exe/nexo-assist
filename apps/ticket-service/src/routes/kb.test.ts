import { type KbArticle, SERVICE_SECRET_HEADER } from "@nexo/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createDb, migrateDb } from "../db";
import { seed } from "../seed";

const SECRET = "service-secret";
const clock = new Date("2026-10-26T13:00:00Z");

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  const db = createDb(":memory:");
  await migrateDb(db);
  await seed(db, clock);
  app = createApp({ db, serviceSecret: SECRET, adminKey: "admin", outageRate: 0, now: () => clock, random: () => 0.99 });
});

const search = (query: string | null, secret = SECRET) =>
  app.request(query === null ? "/kb/search" : `/kb/search?${new URLSearchParams({ q: query })}`, {
    headers: { [SERVICE_SECRET_HEADER]: secret },
  });

describe("GET /kb/search?q=", () => {
  it("answers the VPN 809 article first, with the content of Annex B", async () => {
    const response = await search("Minha VPN não conecta, dá erro 809");
    expect(response.status).toBe(200);
    const [first] = (await response.json()) as KbArticle[];
    expect(first).toEqual({
      id: "kb-vpn-809",
      title: "VPN com erro 809",
      content:
        "Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador. Vale apenas para Windows 10; no Windows 11, abra um chamado.",
      category: "network_vpn",
    });
  });

  it("finds the channel of each subject outside IT", async () => {
    const first = async (query: string) => ((await (await search(query)).json()) as KbArticle[])[0]?.id;
    expect(await first("rh")).toBe("kb-hr-channel");
    expect(await first("financeiro")).toBe("kb-finance-channel");
    expect(await first("facilities")).toBe("kb-facilities-channel");
  });

  it("answers an empty list when nothing is related", async () => {
    expect(await (await search("receita de bolo de cenoura")).json()).toEqual([]);
  });

  it("rejects a missing, empty or too long question", async () => {
    expect((await search(null)).status).toBe(400);
    expect((await search("   ")).status).toBe(400);
    expect((await search("a".repeat(201))).status).toBe(400);
  });

  it("needs the service secret", async () => {
    expect((await search("vpn", "wrong")).status).toBe(401);
  });
});
