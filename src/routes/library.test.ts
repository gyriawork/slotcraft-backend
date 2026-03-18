import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { library } from "./library";
import { resetDb } from "../db";

const app = new Hono();
app.route("/api/library", library);

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`/api/library${path}`, init);
}

const VALID_GAME = {
  name: "Aztec Gold",
  game_type: "slot",
  parameters: {
    rtp: 96.5,
    volatility: "high",
    reels: 5,
    rows: 3,
    paylines: 25,
    max_win: 5000,
    hit_frequency: 28.5,
    features: ["wilds", "free_spins"],
    theme: "mythology",
  },
  status: "live",
  release_date: "2025-06-15",
};

describe("Game Library API", () => {
  beforeEach(() => {
    resetDb();
  });

  // --- CRUD ---

  it("creates a library game", async () => {
    const res = await req("POST", "/games", VALID_GAME);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Aztec Gold");
    expect(data.game_type).toBe("slot");
    expect(data.source).toBe("manual");
    expect(data.parameters.rtp).toBe(96.5);
    expect(data.id).toBeDefined();
  });

  it("rejects game with empty name", async () => {
    const res = await req("POST", "/games", { ...VALID_GAME, name: "" });
    expect(res.status).toBe(400);
  });

  it("rejects game with invalid game_type", async () => {
    const res = await req("POST", "/games", { ...VALID_GAME, game_type: "poker" });
    expect(res.status).toBe(400);
  });

  it("rejects game with RTP out of range", async () => {
    const res = await req("POST", "/games", {
      ...VALID_GAME,
      parameters: { ...VALID_GAME.parameters, rtp: 105 },
    });
    expect(res.status).toBe(400);
  });

  it("lists library games", async () => {
    await req("POST", "/games", VALID_GAME);
    await req("POST", "/games", { ...VALID_GAME, name: "Dragon Riches" });
    const res = await req("GET", "/games");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(2);
  });

  it("gets a single library game", async () => {
    const createRes = await req("POST", "/games", VALID_GAME);
    const created = await createRes.json();
    const res = await req("GET", `/games/${created.id}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Aztec Gold");
  });

  it("returns 404 for unknown game", async () => {
    const res = await req("GET", "/games/nonexistent");
    expect(res.status).toBe(404);
  });

  it("updates a library game", async () => {
    const createRes = await req("POST", "/games", VALID_GAME);
    const created = await createRes.json();
    const res = await req("PATCH", `/games/${created.id}`, { name: "Aztec Thunder" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Aztec Thunder");
  });

  it("deletes a library game", async () => {
    const createRes = await req("POST", "/games", VALID_GAME);
    const created = await createRes.json();
    const res = await req("DELETE", `/games/${created.id}`);
    expect(res.status).toBe(200);
    const list = await (await req("GET", "/games")).json();
    expect(list.length).toBe(0);
  });

  // --- CSV Import ---

  it("imports games from CSV data", async () => {
    const csvRows = [
      {
        name: "Fire Dragon",
        game_type: "slot",
        rtp: 96.0,
        volatility: "high",
        reels: 5,
        rows: 3,
        paylines: 20,
        max_win: 3000,
        theme: "fantasy",
        status: "live",
      },
      {
        name: "Crash Pilot",
        game_type: "crash",
        rtp: 97.0,
        volatility: "medium",
        max_win: 10000,
        theme: "aviation",
        status: "development",
      },
    ];
    const res = await req("POST", "/import", { rows: csvRows });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(2);
    expect(data.errors).toHaveLength(0);

    // Verify games exist
    const list = await (await req("GET", "/games")).json();
    expect(list.length).toBe(2);
    expect(list.find((g: { name: string }) => g.name === "Fire Dragon")).toBeDefined();
  });

  it("CSV import validates rows and reports errors", async () => {
    const csvRows = [
      { name: "Good Game", game_type: "slot", rtp: 96.0, volatility: "high" },
      { name: "", game_type: "slot", rtp: 96.0 }, // empty name
      { name: "Bad RTP", game_type: "slot", rtp: 120 }, // RTP > 99.9
    ];
    const res = await req("POST", "/import", { rows: csvRows });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
    expect(data.errors.length).toBe(2);
  });

  it("CSV import detects duplicates", async () => {
    await req("POST", "/games", VALID_GAME);
    const csvRows = [
      { name: "Aztec Gold", game_type: "slot", rtp: 96.5, volatility: "high" }, // duplicate
    ];
    const res = await req("POST", "/import", { rows: csvRows });
    const data = await res.json();
    expect(data.errors.length).toBe(1);
    expect(data.errors[0].reason).toContain("duplicate");
  });

  // --- Portfolio Analytics ---

  it("returns portfolio analytics", async () => {
    await req("POST", "/games", VALID_GAME);
    await req("POST", "/games", {
      ...VALID_GAME,
      name: "Low Vol Game",
      parameters: { ...VALID_GAME.parameters, rtp: 94.0, volatility: "low", theme: "fruit" },
    });

    const res = await req("GET", "/analytics");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total_games).toBe(2);
    expect(data.avg_rtp).toBeCloseTo(95.25, 1);
    expect(data.rtp_range.min).toBe(94.0);
    expect(data.rtp_range.max).toBe(96.5);
    expect(data.volatility_distribution).toBeDefined();
    expect(data.theme_distribution).toBeDefined();
    expect(data.feature_popularity).toBeDefined();
  });

  // --- Filtering ---

  it("filters games by type", async () => {
    await req("POST", "/games", VALID_GAME);
    await req("POST", "/games", { ...VALID_GAME, name: "Crash X", game_type: "crash" });
    const res = await req("GET", "/games?type=crash");
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("Crash X");
  });

  it("filters games by search", async () => {
    await req("POST", "/games", VALID_GAME);
    await req("POST", "/games", { ...VALID_GAME, name: "Dragon Riches" });
    const res = await req("GET", "/games?search=dragon");
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("Dragon Riches");
  });
});
