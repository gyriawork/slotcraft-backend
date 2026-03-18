import { describe, it, expect } from "vitest";
import app from "../index";

describe("AI Routes", () => {
  describe("POST /api/ai/concepts", () => {
    it("returns 400 when theme_input is missing", async () => {
      const res = await app.request("/api/ai/concepts", {
        method: "POST",
        body: JSON.stringify({ brief: { theme_input: "", audience: [], mood: [], references: [] } }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("theme_input is required");
    });

    it("returns 3 fallback concepts when no API key", async () => {
      const res = await app.request("/api/ai/concepts", {
        method: "POST",
        body: JSON.stringify({
          brief: {
            theme_input: "Ancient Egypt",
            audience: ["eu_mainstream"],
            mood: ["epic", "mystical"],
            references: ["Book of Dead"],
          },
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.concepts).toHaveLength(3);
      expect(body.source).toBe("fallback");
      // Verify concept structure
      for (const c of body.concepts) {
        expect(c).toHaveProperty("name");
        expect(c).toHaveProperty("usp");
        expect(c).toHaveProperty("description");
        expect(c).toHaveProperty("badge");
        expect(c).toHaveProperty("score");
        expect(typeof c.score).toBe("number");
      }
    });

    it("includes theme in concept names", async () => {
      const res = await app.request("/api/ai/concepts", {
        method: "POST",
        body: JSON.stringify({
          brief: { theme_input: "Viking Saga", audience: [], mood: [], references: [] },
        }),
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json();
      const names = body.concepts.map((c: { name: string }) => c.name);
      expect(names.some((n: string) => n.includes("Viking Saga"))).toBe(true);
    });
  });

  describe("POST /api/ai/theme-iterate", () => {
    it("returns 400 when direction is missing", async () => {
      const res = await app.request("/api/ai/theme-iterate", {
        method: "POST",
        body: JSON.stringify({ current_theme: { description: "test", usp_detail: "", bonus_narrative: "" } }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
    });

    it("returns modified theme with direction hint in fallback mode", async () => {
      const res = await app.request("/api/ai/theme-iterate", {
        method: "POST",
        body: JSON.stringify({
          direction: "Darker mood",
          current_theme: {
            description: "A vibrant jungle adventure",
            usp_detail: "Dynamic cascading reels",
            bonus_narrative: "Explore the temple",
          },
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.theme.description).toContain("Darker mood");
      expect(body.source).toBe("fallback");
    });
  });

  describe("POST /api/ai/review", () => {
    it("returns 400 when step is missing", async () => {
      const res = await app.request("/api/ai/review", {
        method: "POST",
        body: JSON.stringify({ step_data: {} }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when step_data is missing", async () => {
      const res = await app.request("/api/ai/review", {
        method: "POST",
        body: JSON.stringify({ step: 1 }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
    });

    it("returns fallback review for step 1", async () => {
      const res = await app.request("/api/ai/review", {
        method: "POST",
        body: JSON.stringify({
          step: 1,
          step_data: {
            game_type: "slot",
            variant: "video_slot",
            grid: { reels: 5, rows: 3 },
            paylines: 20,
          },
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.source).toBe("fallback");
      expect(body.review.score).toBeGreaterThanOrEqual(1);
      expect(body.review.score).toBeLessThanOrEqual(10);
      expect(["excellent", "good", "needs_work", "critical"]).toContain(body.review.verdict);
      expect(body.review.strengths.length).toBeGreaterThan(0);
      expect(body.review.suggestions.length).toBeGreaterThan(0);
    });

    it("returns fallback review for step 4 with symbol check", async () => {
      const res = await app.request("/api/ai/review", {
        method: "POST",
        body: JSON.stringify({
          step: 4,
          step_data: {
            theme: { description: "Viking saga" },
            naming: { selected_name: "Viking Gold" },
            symbols: [{ id: "s1", name: "Wild" }],
          },
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.review.suggestions.some((s: string) => s.toLowerCase().includes("symbol") || s.toLowerCase().includes("localization"))).toBe(true);
    });
  });

  describe("POST /api/ai/names", () => {
    it("returns 400 when theme is missing", async () => {
      const res = await app.request("/api/ai/names", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
    });

    it("returns 5 fallback name variants", async () => {
      const res = await app.request("/api/ai/names", {
        method: "POST",
        body: JSON.stringify({
          theme: "Viking Saga",
          game_type: "slot",
          mood: ["epic", "dark"],
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.names).toHaveLength(5);
      expect(body.source).toBe("fallback");
      for (const n of body.names) {
        expect(n).toHaveProperty("name");
        expect(n).toHaveProperty("reasoning");
        expect(typeof n.name).toBe("string");
        expect(n.name.length).toBeGreaterThan(0);
      }
    });
  });

  describe("POST /api/ai/symbol-review", () => {
    it("returns 400 when symbols is missing", async () => {
      const res = await app.request("/api/ai/symbol-review", {
        method: "POST",
        body: JSON.stringify({ theme: "Viking" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
    });

    it("returns fallback symbol review", async () => {
      const res = await app.request("/api/ai/symbol-review", {
        method: "POST",
        body: JSON.stringify({
          theme: "Viking Saga",
          symbols: [
            { id: "wild", name: "Odin", role: "wild" },
            { id: "scatter", name: "Runestone", role: "scatter" },
            { id: "h1", name: "Thor's Hammer", role: "high_pay" },
          ],
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.review).toHaveProperty("score");
      expect(body.review).toHaveProperty("feedback");
      expect(Array.isArray(body.review.feedback)).toBe(true);
      expect(body.source).toBe("fallback");
    });
  });

  describe("AI Review (additional)", () => {
    it("returns fallback review for step 5 with context", async () => {
      const res = await app.request("/api/ai/review", {
        method: "POST",
        body: JSON.stringify({
          step: 5,
          step_data: {
            active_variant: "96.0",
            rtp_budget: { base_wins: 538, wild_substitution: 180, free_spins: 200, accumulator: 42 },
          },
          context: { step1: { game_type: "slot" }, step2: { target_rtp: 96 } },
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.review.strengths).toContain("Paytable and reel strips configured");
    });
  });
});
