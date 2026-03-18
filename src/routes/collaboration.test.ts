import { describe, it, expect, beforeAll } from "vitest";
import app from "../index";
import { getDb } from "../db";

let projectId: string;

beforeAll(async () => {
  const res = await app.request("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Collab Test", game_type: "slot" }),
    headers: { "Content-Type": "application/json" },
  });
  const body = await res.json();
  projectId = body.id;
});

describe("Share Links", () => {
  let shareToken: string;

  it("creates a share link for a project", async () => {
    const res = await app.request(`/api/projects/${projectId}/share`, {
      method: "POST",
      body: JSON.stringify({ permission: "view", expires_in_days: 7 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.permission).toBe("view");
    expect(body.expires_at).toBeDefined();
    shareToken = body.token;
  });

  it("creates a comment-permission share link", async () => {
    const res = await app.request(`/api/projects/${projectId}/share`, {
      method: "POST",
      body: JSON.stringify({ permission: "comment" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.permission).toBe("comment");
    // No expiry if not specified
    expect(body.expires_at).toBeNull();
  });

  it("lists share links for a project", async () => {
    const res = await app.request(`/api/projects/${projectId}/share`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(2);
  });

  it("resolves a share token to project data", async () => {
    const res = await app.request(`/api/share/${shareToken}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project.id).toBe(projectId);
    expect(body.project.name).toBe("Collab Test");
    expect(body.permission).toBe("view");
  });

  it("returns 404 for invalid share token", async () => {
    const res = await app.request("/api/share/invalid-token-xyz");
    expect(res.status).toBe(404);
  });

  it("revokes a share link", async () => {
    const res = await app.request(`/api/projects/${projectId}/share/${shareToken}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    // Token should no longer resolve
    const check = await app.request(`/api/share/${shareToken}`);
    expect(check.status).toBe(404);
  });

  it("returns 400 for invalid permission", async () => {
    const res = await app.request(`/api/projects/${projectId}/share`, {
      method: "POST",
      body: JSON.stringify({ permission: "admin" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown project", async () => {
    const res = await app.request("/api/projects/unknown-id/share", {
      method: "POST",
      body: JSON.stringify({ permission: "view" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
  });
});

describe("Comments", () => {
  let commentId: string;

  it("creates a comment on a project step", async () => {
    const res = await app.request(`/api/projects/${projectId}/comments`, {
      method: "POST",
      body: JSON.stringify({
        step: 1,
        author_name: "Alice",
        body: "The grid setup looks good, but consider 6x4 for megaways.",
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.step).toBe(1);
    expect(body.author_name).toBe("Alice");
    expect(body.body).toContain("grid setup");
    expect(body.resolved).toBe(false);
    commentId = body.id;
  });

  it("creates a general comment (no step)", async () => {
    const res = await app.request(`/api/projects/${projectId}/comments`, {
      method: "POST",
      body: JSON.stringify({
        author_name: "Bob",
        body: "Overall concept is strong.",
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.step).toBeNull();
  });

  it("lists comments for a project", async () => {
    const res = await app.request(`/api/projects/${projectId}/comments`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(2);
  });

  it("filters comments by step", async () => {
    const res = await app.request(`/api/projects/${projectId}/comments?step=1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].step).toBe(1);
  });

  it("resolves a comment", async () => {
    const res = await app.request(`/api/projects/${projectId}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ resolved: true }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolved).toBe(true);
  });

  it("deletes a comment", async () => {
    const res = await app.request(`/api/projects/${projectId}/comments/${commentId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const list = await app.request(`/api/projects/${projectId}/comments`);
    const body = await list.json();
    expect(body.length).toBe(1);
  });

  it("returns 400 when body is missing", async () => {
    const res = await app.request(`/api/projects/${projectId}/comments`, {
      method: "POST",
      body: JSON.stringify({ author_name: "Alice" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when author_name is missing", async () => {
    const res = await app.request(`/api/projects/${projectId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "Hello" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown project", async () => {
    const res = await app.request("/api/projects/unknown-id/comments");
    expect(res.status).toBe(404);
  });
});
