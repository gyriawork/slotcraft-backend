import { Hono } from "hono";
import { getDb } from "../db.js";

export const onboarding = new Hono();

const SAMPLE_STEP_DATA = {
  currentStep: 4,
  step1: {
    game_type: "slot",
    variant: "video_slot",
    grid: { reels: 5, rows: 3 },
    paylines: 20,
    bet_range: { min: 0.2, max: 100 },
    markets: ["mga", "ukgc"],
    market_constraints: {},
  },
  step2: {
    target_rtp: 96.0,
    volatility: "medium",
    hit_frequency: 28.5,
    max_win: 5000,
    bonus_frequency: 150,
  },
  step3: {
    features: [
      { type: "wild", variant: "expanding", config: {} },
      { type: "bonus", variant: "free_spins", config: { count: 10, retrigger_spins: 5, max_total: 50 } },
      { type: "enhancer", variant: "accumulator", config: {} },
    ],
    complexity_score: 9,
    estimated_dev_weeks: 8,
  },
};

onboarding.post("/sample-project", (c) => {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = "Sample: Egyptian Treasures";

  db.prepare(
    "INSERT INTO projects (id, name, game_type, status, step_data, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?)"
  ).run(id, name, "slot", JSON.stringify(SAMPLE_STEP_DATA), now, now);

  db.prepare(
    "INSERT INTO project_history (id, project_id, action, changes, timestamp) VALUES (?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), id, "created", "Sample project created during onboarding", now);

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as {
    id: string; name: string; game_type: string; status: string; step_data: string; created_at: string; updated_at: string;
  };

  return c.json({ ...row, step_data: JSON.parse(row.step_data) }, 201);
});

onboarding.get("/status", (c) => {
  const db = getDb();
  const projectCount = (db.prepare("SELECT COUNT(*) as count FROM projects WHERE status != 'archived'").get() as { count: number }).count;
  return c.json({
    has_projects: projectCount > 0,
    project_count: projectCount,
  });
});
