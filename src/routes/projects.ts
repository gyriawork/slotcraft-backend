import { Hono } from "hono";
import { getDb } from "../db.js";

export const projects = new Hono();

interface ProjectRow {
  id: string;
  name: string;
  game_type: string;
  status: string;
  step_data: string;
  brand: string;
  team: string;
  created_by: string;
  development_start: string | null;
  development_end: string | null;
  tech_release: string | null;
  pre_release: string | null;
  marketing_release: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow) {
  return { ...row, step_data: JSON.parse(row.step_data) };
}

function recordHistory(projectId: string, action: string, changes: string) {
  const db = getDb();
  db.prepare(
    "INSERT INTO project_history (id, project_id, action, changes, timestamp) VALUES (?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), projectId, action, changes, new Date().toISOString());
}

// List projects (excludes archived, includes progress summary)
projects.get("/", (c) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY updated_at DESC")
    .all() as ProjectRow[];

  const result = rows.map((row) => {
    let completedSteps = 0;
    let currentStep = 1;
    try {
      const sd = JSON.parse(row.step_data);
      for (let i = 1; i <= 9; i++) {
        if (sd[`step${i}`]) completedSteps++;
      }
      if (typeof sd.currentStep === "number") currentStep = sd.currentStep;
      else if (completedSteps > 0) currentStep = completedSteps;
    } catch { /* empty or invalid */ }

    return {
      id: row.id,
      name: row.name,
      game_type: row.game_type,
      status: row.status,
      brand: row.brand,
      team: row.team,
      created_by: row.created_by,
      development_start: row.development_start,
      development_end: row.development_end,
      tech_release: row.tech_release,
      pre_release: row.pre_release,
      marketing_release: row.marketing_release,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_steps: completedSteps,
      current_step: currentStep,
    };
  });

  return c.json(result);
});

// Get single project (includes step_data)
projects.get("/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  if (id === "history") return c.notFound();
  const row = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(rowToProject(row));
});

// Get project history
projects.get("/:id/history", (c) => {
  const db = getDb();
  const projectId = c.req.param("id");
  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) return c.json({ error: "Not found" }, 404);

  const rows = db
    .prepare("SELECT id, action, changes, timestamp FROM project_history WHERE project_id = ? ORDER BY timestamp DESC")
    .all(projectId) as Array<{ id: string; action: string; changes: string; timestamp: string }>;

  return c.json(rows);
});

// Create project
projects.post("/", async (c) => {
  const body = await c.req.json<{
    name: string; game_type: string;
    brand?: string; team?: string; created_by?: string;
    development_start?: string; development_end?: string;
    tech_release?: string; pre_release?: string; marketing_release?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "Name is required" }, 400);
  const gameType = body.game_type;
  if (!["slot", "crash", "table"].includes(gameType)) return c.json({ error: "Invalid game_type" }, 400);

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO projects (id, name, game_type, status, step_data, brand, team, created_by,
    development_start, development_end, tech_release, pre_release, marketing_release, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, body.name.trim(), gameType,
    body.brand ?? "", body.team ?? "", body.created_by ?? "",
    body.development_start ?? null, body.development_end ?? null,
    body.tech_release ?? null, body.pre_release ?? null, body.marketing_release ?? null,
    now, now);

  recordHistory(id, "created", `Created ${gameType} project "${body.name.trim()}"`);

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
  return c.json(rowToProject(project), 201);
});

// Update project
projects.patch("/:id", async (c) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(c.req.param("id")) as ProjectRow | undefined;
  if (!row) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{
    name?: string; status?: string; step_data?: Record<string, unknown>;
    brand?: string; team?: string; created_by?: string;
    development_start?: string | null; development_end?: string | null;
    tech_release?: string | null; pre_release?: string | null; marketing_release?: string | null;
  }>();
  const now = new Date().toISOString();

  const name = body.name !== undefined ? body.name.trim() : row.name;
  const status = body.status !== undefined ? body.status : row.status;
  const stepData = body.step_data !== undefined
    ? JSON.stringify({ ...JSON.parse(row.step_data), ...body.step_data })
    : row.step_data;
  const brand = body.brand !== undefined ? body.brand : row.brand;
  const team = body.team !== undefined ? body.team : row.team;
  const createdBy = body.created_by !== undefined ? body.created_by : row.created_by;
  const devStart = body.development_start !== undefined ? body.development_start : row.development_start;
  const devEnd = body.development_end !== undefined ? body.development_end : row.development_end;
  const techRel = body.tech_release !== undefined ? body.tech_release : row.tech_release;
  const preRel = body.pre_release !== undefined ? body.pre_release : row.pre_release;
  const mktRel = body.marketing_release !== undefined ? body.marketing_release : row.marketing_release;

  db.prepare(`UPDATE projects SET name=?, status=?, step_data=?, brand=?, team=?, created_by=?,
    development_start=?, development_end=?, tech_release=?, pre_release=?, marketing_release=?,
    updated_at=? WHERE id=?`
  ).run(name, status, stepData, brand, team, createdBy,
    devStart, devEnd, techRel, preRel, mktRel, now, c.req.param("id"));

  if (body.name !== undefined && body.name.trim() !== row.name) {
    recordHistory(c.req.param("id"), "renamed", `Renamed to "${name}"`);
  }
  if (body.status !== undefined && body.status !== row.status) {
    recordHistory(c.req.param("id"), "status_changed", `Status changed to ${status}`);
  }
  if (body.step_data !== undefined) {
    const stepKeys = Object.keys(body.step_data).filter((k) => k.startsWith("step"));
    if (stepKeys.length > 0) recordHistory(c.req.param("id"), "step_updated", `Updated ${stepKeys.join(", ")}`);
  }

  const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(c.req.param("id")) as ProjectRow;
  return c.json(rowToProject(updated));
});

// Duplicate project
projects.post("/:id/duplicate", (c) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(c.req.param("id")) as ProjectRow | undefined;
  if (!row) return c.json({ error: "Not found" }, 404);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = `${row.name} (Copy)`;

  db.prepare(`INSERT INTO projects (id, name, game_type, status, step_data, brand, team, created_by,
    development_start, development_end, tech_release, pre_release, marketing_release, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, row.game_type, row.step_data,
    row.brand, row.team, row.created_by,
    row.development_start, row.development_end, row.tech_release, row.pre_release, row.marketing_release,
    now, now);

  recordHistory(id, "created", `Duplicated from "${row.name}"`);

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
  return c.json(rowToProject(project), 201);
});

// Archive project (soft delete)
projects.delete("/:id", (c) => {
  const db = getDb();
  const row = db.prepare("SELECT id FROM projects WHERE id = ?").get(c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);

  const now = new Date().toISOString();
  db.prepare("UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ?").run(now, c.req.param("id"));
  recordHistory(c.req.param("id"), "archived", "Project archived");

  return c.json({ ok: true });
});
