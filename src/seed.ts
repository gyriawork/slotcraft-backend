/**
 * Seed script — inserts sample projects + library games into SQLite.
 * Safe to run multiple times (skips if data already exists).
 *
 * Usage: pnpm seed
 */
import { getDb } from "./db.js";

const db = getDb();

// ─── Check if already seeded ────────────────────────────────────────
const projectCount = (db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c;
const libraryCount = (db.prepare("SELECT COUNT(*) as c FROM game_library").get() as { c: number }).c;

if (projectCount > 0 && libraryCount > 0) {
  console.log(`DB already has ${projectCount} projects and ${libraryCount} library games. Skipping seed.`);
  process.exit(0);
}

// ─── Sample Projects ────────────────────────────────────────────────
const PROJECTS = [
  {
    id: "proj-001", name: "Tempest of Quetzalcoatl", game_type: "slot", status: "active",
    brand: "Evoplay", team: "Alpha", created_by: "Alex K.",
    step_data: {
      step1: { game_type: "slot", grid: { reels: 5, rows: 3 }, paylines: 20, name: "Tempest of Quetzalcoatl" },
      step2: { target_rtp: 96.0, volatility: "med-high" },
      step3: { features: ["Free Spins", "Wild Substitution", "Scatter Pay"] },
      step6: { rtp: 95.97, pass: true },
    },
    development_start: "2025-11-15", development_end: "2026-02-28",
    tech_release: "2026-03-15", pre_release: "2026-04-01", marketing_release: "2026-04-15",
    created_at: "2025-11-15T10:00:00Z", updated_at: "2026-03-01T14:30:00Z",
  },
  {
    id: "proj-002", name: "Love & Luck Joker", game_type: "slot", status: "active",
    brand: "Evoplay", team: "Beta", created_by: "Maria S.",
    step_data: {
      step1: { game_type: "slot", grid: { reels: 5, rows: 3 }, paylines: 10, name: "Love & Luck Joker" },
      step2: { target_rtp: 96.0, volatility: "high" },
      step3: { features: ["Free Spins", "Wild Substitution", "Multiplier"] },
      step6: { rtp: 96.01, pass: true },
    },
    development_start: "2025-12-01", development_end: "2026-03-15",
    tech_release: "2026-04-01", pre_release: "2026-04-20", marketing_release: "2026-05-01",
    created_at: "2025-12-01T09:00:00Z", updated_at: "2026-03-16T11:00:00Z",
  },
  {
    id: "proj-003", name: "Neon Samurai X", game_type: "slot", status: "active",
    brand: "Evoplay", team: "Alpha", created_by: "Alex K.",
    step_data: {
      step1: { game_type: "slot", grid: { reels: 6, rows: 4 }, paylines: 50, name: "Neon Samurai X" },
      step2: { target_rtp: 96.5, volatility: "high" },
      step3: { features: ["Free Spins", "Cascading Reels", "Wild Substitution", "Multiplier"] },
      step6: { rtp: 96.48, pass: true },
    },
    development_start: "2025-12-10", development_end: "2026-04-05",
    tech_release: "2026-05-01", pre_release: "2026-05-15", marketing_release: "2026-06-01",
    created_at: "2025-12-10T08:00:00Z", updated_at: "2026-04-05T16:00:00Z",
  },
  {
    id: "proj-004", name: "Rocket Blitz", game_type: "crash", status: "active",
    brand: "Slotopia", team: "Gamma", created_by: "Denis R.",
    step_data: {
      step1: { game_type: "crash", name: "Rocket Blitz" },
      step2: { target_rtp: 97.0 },
      step6: { rtp: 97.42, pass: false },
    },
    development_start: "2026-01-05", development_end: "2026-05-01",
    tech_release: "2026-04-05", pre_release: null, marketing_release: null,
    created_at: "2026-01-05T10:00:00Z", updated_at: "2026-03-17T09:00:00Z",
  },
  {
    id: "proj-005", name: "Dragon Palace Megaways", game_type: "slot", status: "active",
    brand: "Evoplay", team: "Beta", created_by: "Maria S.",
    step_data: {
      step1: { game_type: "slot", grid: { reels: 6, rows: 7 }, paylines: 117649, name: "Dragon Palace Megaways" },
      step2: { target_rtp: 96.2, volatility: "ultra" },
      step3: { features: ["Megaways", "Free Spins", "Cascading Reels", "Multiplier"] },
    },
    development_start: "2026-01-20", development_end: "2026-06-15",
    tech_release: "2026-05-20", pre_release: null, marketing_release: null,
    created_at: "2026-01-20T10:00:00Z", updated_at: "2026-03-17T09:00:00Z",
  },
  {
    id: "proj-006", name: "Lightning Blackjack Pro", game_type: "table", status: "active",
    brand: "Slotopia", team: "Gamma", created_by: "Denis R.",
    step_data: {
      step1: { game_type: "table", name: "Lightning Blackjack Pro" },
      step2: { target_rtp: 99.1, volatility: "low" },
    },
    development_start: "2026-02-01", development_end: "2026-07-01",
    tech_release: "2026-06-15", pre_release: null, marketing_release: null,
    created_at: "2026-02-01T10:00:00Z", updated_at: "2026-03-17T09:00:00Z",
  },
  {
    id: "proj-007", name: "Aztec Gold Rush", game_type: "slot", status: "draft",
    brand: "Evoplay", team: "Alpha", created_by: "Alex K.",
    step_data: {
      step1: { game_type: "slot", grid: { reels: 5, rows: 3 }, paylines: 25, name: "Aztec Gold Rush" },
      step2: { target_rtp: 95.5, volatility: "med" },
      step3: { features: ["Free Spins", "Wild Substitution", "Scatter Pay"] },
    },
    development_start: null, development_end: null,
    tech_release: null, pre_release: null, marketing_release: null,
    created_at: "2026-02-15T10:00:00Z", updated_at: "2026-03-17T09:00:00Z",
  },
  {
    id: "proj-008", name: "Fortune Tiger 88", game_type: "slot", status: "draft",
    brand: "Evoplay", team: "Beta", created_by: "Maria S.",
    step_data: {
      step1: { game_type: "slot", grid: { reels: 5, rows: 3 }, paylines: 88, name: "Fortune Tiger 88" },
    },
    development_start: null, development_end: null,
    tech_release: null, pre_release: null, marketing_release: null,
    created_at: "2026-03-01T10:00:00Z", updated_at: "2026-03-17T09:00:00Z",
  },
];

// ─── Sample Library Games ───────────────────────────────────────────
const LIBRARY_GAMES = [
  { id: "lib-001", name: "Tempest of Quetzalcoatl", game_type: "slot", source: "wizard", status: "live", project_id: "proj-001", release_date: "2026-03-01", parameters: { rtp: 96.0, volatility: "med-high", reels: 5, rows: 3, paylines: 20, max_win: 4875, hit_frequency: 27.6, theme: "Aztec Mythology", brand: "Evoplay", features: ["Wild","Cascade","Accum","FS","Scatter"], ai_score: 8.1, created_by: "Alex K.", team: "Alpha" }, ai_analysis: { overall: 8.1 }, ai_analyzed_at: "2026-02-20T10:00:00Z" },
  { id: "lib-002", name: "Love & Luck Joker", game_type: "slot", source: "wizard", status: "live", project_id: "proj-002", release_date: "2026-03-16", parameters: { rtp: 96.0, volatility: "high", reels: 5, rows: 3, paylines: 10, max_win: 3537, hit_frequency: 31, theme: "Romance", brand: "Evoplay", features: ["Wild","FS","Multiplier","Respin"], ai_score: 7.2, created_by: "Maria S.", team: "Beta" }, ai_analysis: { overall: 7.2 }, ai_analyzed_at: "2026-02-22T10:00:00Z" },
  { id: "lib-003", name: "Neon Samurai X", game_type: "slot", source: "wizard", status: "live", project_id: "proj-003", release_date: "2026-04-05", parameters: { rtp: 96.5, volatility: "high", reels: 6, rows: 4, paylines: 50, max_win: 5200, hit_frequency: 24, theme: "Cyberpunk", brand: "Evoplay", features: ["Wild","Cascade","FS","Multiplier"], ai_score: 7.8, created_by: "Alex K.", team: "Alpha" }, ai_analysis: { overall: 7.8 }, ai_analyzed_at: "2026-03-01T10:00:00Z" },
  { id: "lib-004", name: "Rocket Blitz", game_type: "crash", source: "wizard", status: "development", project_id: "proj-004", release_date: null, parameters: { rtp: 97.0, theme: "Space", brand: "Slotopia", features: ["Auto Cashout","Multiplier"], ai_score: 6.5, created_by: "Denis R.", team: "Gamma" }, ai_analysis: { overall: 6.5 }, ai_analyzed_at: "2026-03-05T10:00:00Z" },
  { id: "lib-005", name: "Dragon Palace Megaways", game_type: "slot", source: "wizard", status: "development", project_id: "proj-005", release_date: null, parameters: { rtp: 96.2, volatility: "ultra", reels: 6, rows: 7, paylines: 117649, max_win: 15000, hit_frequency: 18, theme: "Chinese", brand: "Evoplay", features: ["Megaways","FS","Cascade","Multiplier","Wild"], ai_score: 8.5, created_by: "Maria S.", team: "Beta" }, ai_analysis: { overall: 8.5 }, ai_analyzed_at: "2026-03-10T10:00:00Z" },
  { id: "lib-006", name: "Lightning Blackjack Pro", game_type: "table", source: "wizard", status: "development", project_id: "proj-006", release_date: null, parameters: { rtp: 99.1, volatility: "low", max_win: 500, hit_frequency: 42, theme: "Casino", brand: "Slotopia", features: ["Lightning Round","Side Bet","Multiplier"], ai_score: 7.0, created_by: "Denis R.", team: "Gamma" }, ai_analysis: { overall: 7.0 }, ai_analyzed_at: "2026-03-08T10:00:00Z" },
  { id: "lib-007", name: "Crash Royale", game_type: "crash", source: "manual", status: "development", project_id: null, release_date: null, parameters: { rtp: 97.0, theme: "Royal Palace", brand: "Slotopia", features: ["Auto Cashout","Multiplier","Social"], ai_score: 5.8, created_by: "Denis R.", team: "Gamma" }, ai_analysis: { overall: 5.8 }, ai_analyzed_at: "2026-03-12T10:00:00Z" },
  { id: "lib-008", name: "Aztec Gold Rush", game_type: "slot", source: "wizard", status: "development", project_id: "proj-007", release_date: null, parameters: { rtp: 95.5, volatility: "med", reels: 5, rows: 3, paylines: 25, max_win: 2500, hit_frequency: 32, theme: "Aztec Gold", brand: "Evoplay", features: ["Wild","FS","Scatter"], ai_score: 5.2, created_by: "Alex K.", team: "Alpha" }, ai_analysis: { overall: 5.2 }, ai_analyzed_at: "2026-03-14T10:00:00Z" },
  { id: "lib-009", name: "Fortune Tiger 88", game_type: "slot", source: "wizard", status: "development", project_id: "proj-008", release_date: null, parameters: { rtp: 96.0, volatility: "med-high", reels: 5, rows: 3, paylines: 88, max_win: 3000, hit_frequency: 28, theme: "Chinese", brand: "Evoplay", features: ["Wild","FS","Respin","Multiplier"], ai_score: 6.8, created_by: "Maria S.", team: "Beta" }, ai_analysis: { overall: 6.8 }, ai_analyzed_at: "2026-03-15T10:00:00Z" },
  { id: "lib-010", name: "European Roulette VIP", game_type: "table", source: "manual", status: "concept", project_id: null, release_date: null, parameters: { rtp: 97.3, volatility: "low", max_win: 35, hit_frequency: 48, theme: "Casino", brand: "Slotopia", features: ["Side Bet","VIP Mode"], created_by: "Denis R.", team: "Gamma" }, ai_analysis: null, ai_analyzed_at: null },
  { id: "lib-011", name: "Candy Cascade", game_type: "slot", source: "manual", status: "concept", project_id: null, release_date: null, parameters: { rtp: 96.0, volatility: "med", reels: 6, rows: 6, paylines: 0, max_win: 8000, theme: "Candy", brand: "Evoplay", features: ["Cascade","Multiplier","FS","Cluster"], created_by: "Alex K.", team: "Alpha" }, ai_analysis: null, ai_analyzed_at: null },
  { id: "lib-012", name: "Turbo Crash Pro", game_type: "crash", source: "manual", status: "concept", project_id: null, release_date: null, parameters: { rtp: 96.0, theme: "Racing", brand: "Slotopia", features: ["Auto Cashout","Turbo Mode","Multiplier"], max_win: 50000, created_by: "Denis R.", team: "Gamma" }, ai_analysis: null, ai_analyzed_at: null },
  { id: "lib-013", name: "Wild West Heist", game_type: "slot", source: "manual", status: "concept", project_id: null, release_date: null, parameters: { rtp: 96.5, volatility: "high", reels: 5, rows: 3, paylines: 30, max_win: 10000, theme: "Wild West", brand: "Evoplay", features: ["Wild","FS","Scatter","Multiplier","Bonus Buy"], created_by: "Maria S.", team: "Beta" }, ai_analysis: null, ai_analyzed_at: null },
  { id: "lib-014", name: "Mystic Gems Cluster", game_type: "slot", source: "manual", status: "concept", project_id: null, release_date: null, parameters: { rtp: 96.0, volatility: "med-high", reels: 7, rows: 7, paylines: 0, max_win: 6500, theme: "Gemstone", brand: "Slotopia", features: ["Cluster","Cascade","FS","Wild"], created_by: "Alex K.", team: "Alpha" }, ai_analysis: null, ai_analyzed_at: null },
];

// ─── Insert ─────────────────────────────────────────────────────────

const insertProject = db.prepare(`INSERT OR IGNORE INTO projects
  (id, name, game_type, status, step_data, brand, team, created_by,
   development_start, development_end, tech_release, pre_release, marketing_release,
   created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const insertGame = db.prepare(`INSERT OR IGNORE INTO game_library
  (id, project_id, name, game_type, source, parameters, ai_analysis, ai_analyzed_at,
   status, release_date, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const insertHistory = db.prepare(`INSERT INTO project_history
  (id, project_id, action, changes, timestamp) VALUES (?, ?, ?, ?, ?)`);

const txn = db.transaction(() => {
  for (const p of PROJECTS) {
    insertProject.run(
      p.id, p.name, p.game_type, p.status, JSON.stringify(p.step_data),
      p.brand, p.team, p.created_by,
      p.development_start, p.development_end, p.tech_release, p.pre_release, p.marketing_release,
      p.created_at, p.updated_at,
    );
    insertHistory.run(crypto.randomUUID(), p.id, "created", `Seeded: ${p.name}`, p.created_at);
  }

  const now = new Date().toISOString();
  for (const g of LIBRARY_GAMES) {
    insertGame.run(
      g.id, g.project_id ?? null, g.name, g.game_type, g.source,
      JSON.stringify(g.parameters),
      g.ai_analysis ? JSON.stringify(g.ai_analysis) : null,
      g.ai_analyzed_at,
      g.status, g.release_date ?? null, now, now,
    );
  }
});

txn();

const newProjectCount = (db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c;
const newLibraryCount = (db.prepare("SELECT COUNT(*) as c FROM game_library").get() as { c: number }).c;
console.log(`Seeded: ${newProjectCount} projects, ${newLibraryCount} library games.`);
