import { Hono } from "hono";
import { getDb } from "../db.js";

// Share links — mounted under /api/projects/:id/share
export const shareLinks = new Hono();

// Public share resolution — mounted under /api/share
export const shareResolve = new Hono();

// Comments — mounted under /api/projects/:id/comments
export const comments = new Hono();

interface ShareRow {
  id: string;
  project_id: string;
  token: string;
  permission: string;
  created_at: string;
  expires_at: string | null;
}

interface CommentRow {
  id: string;
  project_id: string;
  step: number | null;
  author_name: string;
  body: string;
  resolved: number;
  created_at: string;
}

function projectExists(projectId: string): boolean {
  const db = getDb();
  return !!db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
}

// --- Share Links ---

shareLinks.post("/:id/share", async (c) => {
  const projectId = c.req.param("id");
  if (!projectExists(projectId)) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{ permission?: string; expires_in_days?: number }>();
  const permission = body.permission ?? "view";
  if (!["view", "comment"].includes(permission)) {
    return c.json({ error: "Invalid permission. Must be 'view' or 'comment'" }, 400);
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  const expiresAt = body.expires_in_days
    ? new Date(Date.now() + body.expires_in_days * 86400000).toISOString()
    : null;

  db.prepare(
    "INSERT INTO share_links (id, project_id, token, permission, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, projectId, token, permission, now, expiresAt);

  return c.json({ id, token, permission, created_at: now, expires_at: expiresAt }, 201);
});

shareLinks.get("/:id/share", (c) => {
  const projectId = c.req.param("id");
  if (!projectExists(projectId)) return c.json({ error: "Not found" }, 404);

  const db = getDb();
  const rows = db
    .prepare("SELECT id, token, permission, created_at, expires_at FROM share_links WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as ShareRow[];

  return c.json(rows);
});

shareLinks.delete("/:id/share/:token", (c) => {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM share_links WHERE project_id = ? AND token = ?")
    .run(c.req.param("id"), c.req.param("token"));

  if (result.changes === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// --- Share Resolve (public) ---

shareResolve.get("/:token", (c) => {
  const db = getDb();
  const row = db
    .prepare("SELECT sl.*, p.id as pid, p.name, p.game_type, p.status, p.step_data, p.created_at as p_created, p.updated_at as p_updated FROM share_links sl JOIN projects p ON sl.project_id = p.id WHERE sl.token = ?")
    .get(c.req.param("token")) as (ShareRow & { pid: string; name: string; game_type: string; status: string; step_data: string; p_created: string; p_updated: string }) | undefined;

  if (!row) return c.json({ error: "Not found" }, 404);

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return c.json({ error: "Link expired" }, 410);
  }

  return c.json({
    permission: row.permission,
    project: {
      id: row.pid,
      name: row.name,
      game_type: row.game_type,
      status: row.status,
      step_data: JSON.parse(row.step_data),
      created_at: row.p_created,
      updated_at: row.p_updated,
    },
  });
});

// --- Comments ---

comments.get("/:id/comments", (c) => {
  const projectId = c.req.param("id");
  if (!projectExists(projectId)) return c.json({ error: "Not found" }, 404);

  const db = getDb();
  const step = c.req.query("step");

  let rows: CommentRow[];
  if (step) {
    rows = db
      .prepare("SELECT * FROM comments WHERE project_id = ? AND step = ? ORDER BY created_at DESC")
      .all(projectId, Number(step)) as CommentRow[];
  } else {
    rows = db
      .prepare("SELECT * FROM comments WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as CommentRow[];
  }

  return c.json(rows.map((r) => ({ ...r, resolved: r.resolved === 1 })));
});

comments.post("/:id/comments", async (c) => {
  const projectId = c.req.param("id");
  if (!projectExists(projectId)) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{ step?: number; author_name?: string; body?: string }>();

  if (!body.body?.trim()) {
    return c.json({ error: "body is required" }, 400);
  }
  if (!body.author_name?.trim()) {
    return c.json({ error: "author_name is required" }, 400);
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO comments (id, project_id, step, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, projectId, body.step ?? null, body.author_name.trim(), body.body.trim(), now);

  return c.json(
    {
      id,
      project_id: projectId,
      step: body.step ?? null,
      author_name: body.author_name.trim(),
      body: body.body.trim(),
      resolved: false,
      created_at: now,
    },
    201
  );
});

comments.patch("/:id/comments/:commentId", async (c) => {
  const db = getDb();
  const body = await c.req.json<{ resolved?: boolean }>();

  const row = db
    .prepare("SELECT * FROM comments WHERE id = ? AND project_id = ?")
    .get(c.req.param("commentId"), c.req.param("id")) as CommentRow | undefined;

  if (!row) return c.json({ error: "Not found" }, 404);

  if (body.resolved !== undefined) {
    db.prepare("UPDATE comments SET resolved = ? WHERE id = ?").run(body.resolved ? 1 : 0, row.id);
  }

  const updated = db.prepare("SELECT * FROM comments WHERE id = ?").get(row.id) as CommentRow;
  return c.json({ ...updated, resolved: updated.resolved === 1 });
});

comments.delete("/:id/comments/:commentId", (c) => {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM comments WHERE id = ? AND project_id = ?")
    .run(c.req.param("commentId"), c.req.param("id"));

  if (result.changes === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
