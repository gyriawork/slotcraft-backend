import { describe, it, expect } from "vitest";
import app from "../index";

describe("Export Routes", () => {
  const wizardData = {
    step1: {
      game_type: "slot",
      variant: "video_slot",
      grid: { reels: 5, rows: 3 },
      win_mechanic: "fixed_paylines",
      paylines: 20,
      bet: { min: 0.2, max: 100, default: 1 },
      markets: ["mga", "ukgc"],
      market_constraints: { ukgc: { autoplay_disabled: true, bonus_buy_disabled: true } },
    },
    step2: {
      target_rtp: 96,
      volatility: "med_high",
      hit_frequency: 28,
      max_win: 5000,
      bonus_frequency: 150,
      rtp_variants: [96, 94, 92],
    },
    step3: {
      features: [
        { type: "wild", variant: "expanding", config: {} },
        { type: "bonus", variant: "free_spins", config: { count: 10 } },
      ],
      complexity_score: 5,
      estimated_dev_weeks: 4,
    },
    step4: {
      selected_concept: { source: "ai_generated", name: "Aztec Gold Rising", usp: "Progressive cascade" },
      theme: { description: "Aztec temple", usp_detail: "Cascade multiplier", bonus_narrative: "Temple chambers" },
      naming: { selected: "Tempest of Quetzalcoatl", alternatives: [], localization: {} },
      symbols: [{ id: "wild", name: "Wild", role: "wild" }],
      art_direction: {
        style: "3D realistic",
        palette: ["#FFD700"],
        sound: { ambient: "jungle", spin: "roll", win: "coins", bonus_trigger: "thunder", cascade: "crumble", max_win: "epic" },
      },
    },
    step5: {
      active_variant: "96.0",
      rtp_variants: {
        "96.0": {
          paytable: [{ symbol_id: "hp1", label: "Gold Mask", x3: 3, x4: 8, x5: 25 }],
          reel_strips: { reel1: { hp1: 5, lp1: 15, wild: 2 } },
          stops_per_reel: 22,
          analytical_rtp: 96.02,
        },
      },
      rtp_budget: { base_wins: 538, wild_substitution: 180, free_spins: 200, accumulator: 42 },
      target_rtp_tenths: 960,
    },
    step6: {
      rtp: 96.05,
      hit_frequency: 28.3,
      bonus_frequency: 6.7,
      max_win: 4850,
      volatility_sd: 12.4,
      spins: 100000,
      total_wagered: 100000,
      total_won: 96050,
      winning_spins: 28300,
      bonus_triggers: 667,
      distribution_buckets: [71700, 14150, 7075, 3538, 1769, 885, 442, 221, 110, 55, 28, 14, 13],
      timestamp: "2026-03-16T12:00:00Z",
      seed: 12345,
      pass: true,
    },
  };

  describe("POST /api/export/gdd", () => {
    it("returns 400 when no wizard data provided", async () => {
      const res = await app.request("/api/export/gdd", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
    });

    it("generates markdown GDD for full audience", async () => {
      const res = await app.request("/api/export/gdd", {
        method: "POST",
        body: JSON.stringify({
          wizard_data: wizardData,
          audience: "full",
          format: "markdown",
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.content).toContain("Tempest of Quetzalcoatl");
      expect(body.content).toContain("Game Overview");
      expect(body.content).toContain("96.0");
      expect(body.format).toBe("markdown");
    });

    it("generates JSON GDD", async () => {
      const res = await app.request("/api/export/gdd", {
        method: "POST",
        body: JSON.stringify({
          wizard_data: wizardData,
          audience: "full",
          format: "json",
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.format).toBe("json");
      const parsed = JSON.parse(body.content);
      expect(parsed.game_name).toBe("Tempest of Quetzalcoatl");
      expect(parsed.sections).toBeDefined();
    });

    it("filters sections by math audience", async () => {
      const res = await app.request("/api/export/gdd", {
        method: "POST",
        body: JSON.stringify({
          wizard_data: wizardData,
          audience: "math",
          format: "markdown",
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.content).toContain("Math Model");
      expect(body.content).toContain("Reel Strips");
      expect(body.content).toContain("Simulation Results");
      // Math audience should NOT contain theme or art sections
      expect(body.content).not.toContain("Theme & Visual");
      expect(body.content).not.toContain("Art & Sound");
    });

    it("filters sections by executive audience", async () => {
      const res = await app.request("/api/export/gdd", {
        method: "POST",
        body: JSON.stringify({
          wizard_data: wizardData,
          audience: "executive",
          format: "markdown",
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.content).toContain("Game Overview");
      // Executive gets only section 1
      expect(body.content).not.toContain("Reel Strips");
    });
  });
});
