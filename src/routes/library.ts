import { Hono } from "hono";
import { getDb } from "../db.js";

export const library = new Hono();

interface GameRow {
  id: string;
  project_id: string | null;
  name: string;
  game_type: string;
  source: string;
  parameters: string;
  ai_analysis: string | null;
  ai_analyzed_at: string | null;
  status: string;
  release_date: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

function rowToGame(row: GameRow) {
  return {
    ...row,
    parameters: JSON.parse(row.parameters),
    ai_analysis: row.ai_analysis ? JSON.parse(row.ai_analysis) : null,
  };
}

const VALID_TYPES = ["slot", "crash", "table"];
const VALID_STATUSES = ["live", "development", "archived", "concept"];

function validateGame(data: {
  name?: string;
  game_type?: string;
  parameters?: { rtp?: number };
  status?: string;
}): string | null {
  if (data.name !== undefined && !data.name.trim()) return "Name is required";
  if (data.game_type !== undefined && !VALID_TYPES.includes(data.game_type)) return "Invalid game_type";
  if (data.status !== undefined && !VALID_STATUSES.includes(data.status)) return "Invalid status";
  if (data.parameters?.rtp !== undefined) {
    const rtp = data.parameters.rtp;
    if (typeof rtp !== "number" || rtp < 80 || rtp > 99.9) return "RTP must be between 80 and 99.9";
  }
  return null;
}

// List games with optional filters
library.get("/games", (c) => {
  const db = getDb();
  const type = c.req.query("type");
  const search = c.req.query("search");
  const status = c.req.query("status");

  let sql = "SELECT * FROM game_library WHERE 1=1";
  const params: string[] = [];

  if (type && VALID_TYPES.includes(type)) {
    sql += " AND game_type = ?";
    params.push(type);
  }
  if (status && VALID_STATUSES.includes(status)) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (search) {
    sql += " AND name LIKE ?";
    params.push(`%${search}%`);
  }

  sql += " ORDER BY updated_at DESC";

  const rows = db.prepare(sql).all(...params) as GameRow[];
  return c.json(rows.map(rowToGame));
});

// Get single game
library.get("/games/:id", (c) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM game_library WHERE id = ?").get(c.req.param("id")) as GameRow | undefined;
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(rowToGame(row));
});

// Create game
library.post("/games", async (c) => {
  const body = await c.req.json<{
    name: string;
    game_type: string;
    parameters?: Record<string, unknown>;
    status?: string;
    release_date?: string;
    project_id?: string;
  }>();

  const error = validateGame(body);
  if (error) return c.json({ error }, 400);

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO game_library (id, project_id, name, game_type, source, parameters, status, release_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`
  ).run(
    id,
    body.project_id || null,
    body.name.trim(),
    body.game_type,
    JSON.stringify(body.parameters || {}),
    body.status || "development",
    body.release_date || null,
    now,
    now
  );

  const row = db.prepare("SELECT * FROM game_library WHERE id = ?").get(id) as GameRow;
  return c.json(rowToGame(row), 201);
});

// Update game
library.patch("/games/:id", async (c) => {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM game_library WHERE id = ?").get(c.req.param("id")) as GameRow | undefined;
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    parameters?: Record<string, unknown>;
    status?: string;
    release_date?: string;
  }>();

  const error = validateGame(body);
  if (error) return c.json({ error }, 400);

  const now = new Date().toISOString();
  const name = body.name !== undefined ? body.name.trim() : existing.name;
  const status = body.status !== undefined ? body.status : existing.status;
  const releaseDate = body.release_date !== undefined ? body.release_date : existing.release_date;
  const parameters = body.parameters !== undefined
    ? JSON.stringify({ ...JSON.parse(existing.parameters), ...body.parameters })
    : existing.parameters;

  db.prepare(
    "UPDATE game_library SET name = ?, parameters = ?, status = ?, release_date = ?, updated_at = ? WHERE id = ?"
  ).run(name, parameters, status, releaseDate, now, c.req.param("id"));

  const updated = db.prepare("SELECT * FROM game_library WHERE id = ?").get(c.req.param("id")) as GameRow;
  return c.json(rowToGame(updated));
});

// Delete game
library.delete("/games/:id", (c) => {
  const db = getDb();
  const row = db.prepare("SELECT id FROM game_library WHERE id = ?").get(c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  db.prepare("DELETE FROM game_library WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

// CSV Import
library.post("/import", async (c) => {
  const body = await c.req.json<{
    rows: Array<{
      name: string;
      game_type: string;
      rtp?: number;
      volatility?: string;
      reels?: number;
      rows?: number;
      paylines?: number;
      max_win?: number;
      hit_frequency?: number;
      features?: string[];
      theme?: string;
      status?: string;
      release_date?: string;
    }>;
  }>();

  if (!Array.isArray(body.rows)) {
    return c.json({ error: "rows must be an array" }, 400);
  }

  const db = getDb();
  const now = new Date().toISOString();
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;

  // Get existing names for duplicate detection
  const existingNames = new Set(
    (db.prepare("SELECT name FROM game_library").all() as Array<{ name: string }>).map((r) =>
      r.name.toLowerCase()
    )
  );

  const insert = db.prepare(
    `INSERT INTO game_library (id, name, game_type, source, parameters, status, release_date, created_at, updated_at)
     VALUES (?, ?, ?, 'csv_import', ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];

      // Validate
      if (!row.name?.trim()) {
        errors.push({ row: i, reason: "Name is required" });
        continue;
      }
      if (!VALID_TYPES.includes(row.game_type)) {
        errors.push({ row: i, reason: `Invalid game_type: ${row.game_type}` });
        continue;
      }
      if (row.rtp !== undefined && (row.rtp < 80 || row.rtp > 99.9)) {
        errors.push({ row: i, reason: `RTP out of range: ${row.rtp}` });
        continue;
      }

      // Duplicate check
      if (existingNames.has(row.name.toLowerCase())) {
        errors.push({ row: i, reason: `duplicate: "${row.name}" already exists` });
        continue;
      }

      const parameters = {
        rtp: row.rtp,
        volatility: row.volatility,
        reels: row.reels,
        rows: row.rows,
        paylines: row.paylines,
        max_win: row.max_win,
        hit_frequency: row.hit_frequency,
        features: row.features,
        theme: row.theme,
      };

      insert.run(
        crypto.randomUUID(),
        row.name.trim(),
        row.game_type,
        JSON.stringify(parameters),
        row.status || "development",
        row.release_date || null,
        now,
        now
      );
      existingNames.add(row.name.toLowerCase());
      imported++;
    }
  });

  transaction();

  return c.json({ imported, errors, total: body.rows.length });
});

// Portfolio analytics
library.get("/analytics", (c) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM game_library").all() as GameRow[];
  const games = rows.map(rowToGame);

  const rtps: number[] = [];
  const volatilities: Record<string, number> = {};
  const themes: Record<string, number> = {};
  const features: Record<string, number> = {};

  for (const game of games) {
    const p = game.parameters as Record<string, unknown>;
    if (typeof p.rtp === "number") rtps.push(p.rtp);
    if (typeof p.volatility === "string") {
      volatilities[p.volatility] = (volatilities[p.volatility] ?? 0) + 1;
    }
    if (typeof p.theme === "string") {
      themes[p.theme] = (themes[p.theme] ?? 0) + 1;
    }
    if (Array.isArray(p.features)) {
      for (const f of p.features) {
        if (typeof f === "string") {
          features[f] = (features[f] ?? 0) + 1;
        }
      }
    }
  }

  const avgRtp = rtps.length > 0 ? rtps.reduce((a, b) => a + b, 0) / rtps.length : null;
  const rtpRange = rtps.length > 0 ? { min: Math.min(...rtps), max: Math.max(...rtps) } : { min: 0, max: 0 };

  return c.json({
    total_games: games.length,
    avg_rtp: avgRtp,
    rtp_range: rtpRange,
    volatility_distribution: volatilities,
    theme_distribution: themes,
    feature_popularity: features,
  });
});
