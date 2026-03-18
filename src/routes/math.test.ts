import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { math } from "./math";

const app = new Hono();
app.route("/api/math", math);

function req(body: unknown) {
  return app.request("/api/math/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE_REQUEST = {
  grid: { reels: 5, rows: 3 },
  target_rtp: 96.0,
  volatility: "med",
  paylines: 10,
  features: ["free_spins"],
  symbols: [
    { id: "wild", name: "Wild", role: "wild" },
    { id: "scatter", name: "Scatter", role: "scatter" },
    { id: "hp1", name: "Dragon", role: "high_pay" },
    { id: "hp2", name: "Phoenix", role: "high_pay" },
    { id: "lp1", name: "A", role: "low_pay" },
    { id: "lp2", name: "K", role: "low_pay" },
    { id: "lp3", name: "Q", role: "low_pay" },
    { id: "lp4", name: "J", role: "low_pay" },
  ],
};

describe("Math Model Generation API", () => {
  it("returns 400 for missing required fields", async () => {
    const res = await req({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for no regular symbols", async () => {
    const res = await req({
      ...BASE_REQUEST,
      symbols: [{ id: "wild", name: "Wild", role: "wild" }],
    });
    expect(res.status).toBe(400);
  });

  it("generates math model with correct structure", async () => {
    const res = await req(BASE_REQUEST);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.active_variant).toBe("96.0");
    expect(data.target_rtp_tenths).toBe(960);
    expect(data.rtp_budget).toBeDefined();
    expect(data.rtp_budget.base_wins).toBeGreaterThan(0);
    expect(data.rtp_variants["96.0"]).toBeDefined();
  });

  it("generates paytable with all regular symbols", async () => {
    const res = await req(BASE_REQUEST);
    const data = await res.json();
    const variant = data.rtp_variants["96.0"];

    expect(variant.paytable.length).toBe(6); // 2 high + 4 low
    expect(variant.paytable[0].x3).toBeGreaterThan(0);
    expect(variant.paytable[0].x5).toBeGreaterThan(variant.paytable[0].x3);

    // High pay symbols should pay more than low pay
    const hp1 = variant.paytable.find((r: { symbol_id: string }) => r.symbol_id === "hp1");
    const lp4 = variant.paytable.find((r: { symbol_id: string }) => r.symbol_id === "lp4");
    expect(hp1.x3).toBeGreaterThan(lp4.x3);
  });

  it("generates reel strips for all reels", async () => {
    const res = await req(BASE_REQUEST);
    const data = await res.json();
    const variant = data.rtp_variants["96.0"];

    expect(Object.keys(variant.reel_strips).length).toBe(5);
    expect(variant.reel_strips.reel1).toBeDefined();
    expect(variant.reel_strips.reel5).toBeDefined();

    // Wild and scatter should be on each reel
    expect(variant.reel_strips.reel1.wild).toBeGreaterThan(0);
    expect(variant.reel_strips.reel1.scatter).toBeGreaterThan(0);

    // Total stops should match
    const totalStops = Object.values(variant.reel_strips.reel1 as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(totalStops).toBe(variant.stops_per_reel);
  });

  it("generates multiple RTP variants", async () => {
    const res = await req({
      ...BASE_REQUEST,
      rtp_variants: [94.0, 95.0, 96.0],
    });
    const data = await res.json();

    expect(Object.keys(data.rtp_variants).length).toBe(3);
    expect(data.rtp_variants["94.0"]).toBeDefined();
    expect(data.rtp_variants["95.0"]).toBeDefined();
    expect(data.rtp_variants["96.0"]).toBeDefined();

    // Lower RTP variants should have lower payouts
    const pt94 = data.rtp_variants["94.0"].paytable[0];
    const pt96 = data.rtp_variants["96.0"].paytable[0];
    expect(pt94.x3).toBeLessThan(pt96.x3);
  });

  it("adjusts reel strips for volatility", async () => {
    const lowVol = await req({ ...BASE_REQUEST, volatility: "low" });
    const highVol = await req({ ...BASE_REQUEST, volatility: "high" });
    const lowData = await lowVol.json();
    const highData = await highVol.json();

    // Higher volatility should have more stops per reel (more granularity for rarer symbols)
    expect(highData.rtp_variants["96.0"].stops_per_reel).toBeGreaterThan(
      lowData.rtp_variants["96.0"].stops_per_reel
    );
  });

  it("RTP budget sums to target RTP tenths", async () => {
    const res = await req(BASE_REQUEST);
    const data = await res.json();
    const budget = data.rtp_budget;
    const sum = budget.base_wins + budget.wild_substitution + budget.free_spins + budget.accumulator;
    expect(sum).toBe(960);
  });

  it("RTP budget without features allocates everything to base", async () => {
    const res = await req({
      ...BASE_REQUEST,
      features: [],
      symbols: BASE_REQUEST.symbols.filter(s => s.role !== "wild" && s.role !== "scatter"),
    });
    const data = await res.json();
    expect(data.rtp_budget.base_wins).toBe(960);
    expect(data.rtp_budget.wild_substitution).toBe(0);
    expect(data.rtp_budget.free_spins).toBe(0);
  });
});
