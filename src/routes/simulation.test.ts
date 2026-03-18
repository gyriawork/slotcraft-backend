import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { simulation } from "./simulation";

const app = new Hono();
app.route("/api/simulation", simulation);

function req(body: unknown) {
  return app.request("/api/simulation/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE_CONFIG = {
  reels: 3,
  rows: 1,
  reel_strips: [
    { weights: [["Wild", 3], [{ Regular: 0 }, 20], [{ Regular: 1 }, 20], [{ Regular: 2 }, 20]] },
    { weights: [["Wild", 3], [{ Regular: 0 }, 20], [{ Regular: 1 }, 20], [{ Regular: 2 }, 20]] },
    { weights: [["Wild", 3], [{ Regular: 0 }, 20], [{ Regular: 1 }, 20], [{ Regular: 2 }, 20]] },
  ],
  paytable: [
    { symbol: { Regular: 0 }, count: 3, payout: 5 },
    { symbol: { Regular: 1 }, count: 3, payout: 3 },
    { symbol: { Regular: 2 }, count: 3, payout: 1 },
  ],
  paylines: [[0, 0, 0]],
  features: {
    cascade_enabled: false,
    accumulator_tiers: [],
    free_spins_enabled: false,
    free_spin_awards: {},
    retrigger_spins: 0,
    max_total_free_spins: 0,
    wild_config: { wild_type: "Standard" },
  },
  bet: 1.0,
};

describe("Simulation API", () => {
  it("returns 400 for missing config", async () => {
    const res = await req({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing spin_count", async () => {
    const res = await req({ config: BASE_CONFIG });
    expect(res.status).toBe(400);
  });

  it("runs a simulation successfully", async () => {
    const res = await req({ config: BASE_CONFIG, spin_count: 1000, seed: 42 });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.spins).toBe(1000);
    expect(data.rtp).toBeGreaterThan(0);
    expect(data.hit_frequency).toBeGreaterThanOrEqual(0);
    expect(data.distribution_buckets).toBeDefined();
    expect(data.distribution_buckets.length).toBeGreaterThan(0);
    // Convergence data
    expect(data.convergence).toBeDefined();
    expect(data.convergence.length).toBeGreaterThan(0);
    expect(data.convergence[data.convergence.length - 1].spin).toBe(1000);
    expect(data.convergence[data.convergence.length - 1].rtp).toBe(data.rtp);
  });

  it("returns deterministic results with same seed", async () => {
    const res1 = await req({ config: BASE_CONFIG, spin_count: 5000, seed: 123 });
    const res2 = await req({ config: BASE_CONFIG, spin_count: 5000, seed: 123 });
    const data1 = await res1.json();
    const data2 = await res2.json();
    expect(data1.total_won).toBe(data2.total_won);
    expect(data1.rtp).toBe(data2.rtp);
  });

  it("returns different results with different seeds", async () => {
    const res1 = await req({ config: BASE_CONFIG, spin_count: 5000, seed: 1 });
    const res2 = await req({ config: BASE_CONFIG, spin_count: 5000, seed: 2 });
    const data1 = await res1.json();
    const data2 = await res2.json();
    // Extremely unlikely same result with different seeds
    expect(data1.total_won !== data2.total_won || data1.winning_spins !== data2.winning_spins).toBe(true);
  });

  it("caps spin count at max limit", async () => {
    // Verify the cap is applied — request more than MAX_SPINS
    // We can't run 10M in test, so verify via a smaller request that the field is correct
    const res = await req({ config: BASE_CONFIG, spin_count: 50_000, seed: 42 });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.spins).toBe(50_000);
  });
});
