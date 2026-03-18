import { describe, it, expect, beforeEach } from "vitest";
import app from "../index";
import { resetDb } from "../db";

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

describe("Version History API", () => {
  let projectId: string;

  beforeEach(async () => {
    resetDb();
    const res = await req("POST", "/api/projects", { name: "History Test", game_type: "slot" });
    const data = await res.json();
    projectId = data.id;
  });

  it("records history when project is updated", async () => {
    // Update step data
    await req("PATCH", `/api/projects/${projectId}`, {
      step_data: { step1: { grid: "5x3" } },
    });

    // Check history
    const res = await req("GET", `/api/projects/${projectId}/history`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty("action");
    expect(data[0]).toHaveProperty("timestamp");
    expect(data[0]).toHaveProperty("changes");
  });

  it("records creation event", async () => {
    const res = await req("GET", `/api/projects/${projectId}/history`);
    const data = await res.json();
    const createEvent = data.find((e: { action: string }) => e.action === "created");
    expect(createEvent).toBeDefined();
  });

  it("records step updates with step number", async () => {
    await req("PATCH", `/api/projects/${projectId}`, {
      step_data: { step2: { rtp: 96 } },
    });

    const res = await req("GET", `/api/projects/${projectId}/history`);
    const data = await res.json();
    const updateEvent = data.find((e: { action: string }) => e.action === "step_updated");
    expect(updateEvent).toBeDefined();
    expect(updateEvent.changes).toContain("step2");
  });

  it("records status change", async () => {
    await req("PATCH", `/api/projects/${projectId}`, { status: "active" });

    const res = await req("GET", `/api/projects/${projectId}/history`);
    const data = await res.json();
    const statusEvent = data.find((e: { action: string }) => e.action === "status_changed");
    expect(statusEvent).toBeDefined();
    expect(statusEvent.changes).toContain("active");
  });

  it("records rename", async () => {
    await req("PATCH", `/api/projects/${projectId}`, { name: "Renamed Game" });

    const res = await req("GET", `/api/projects/${projectId}/history`);
    const data = await res.json();
    const renameEvent = data.find((e: { action: string }) => e.action === "renamed");
    expect(renameEvent).toBeDefined();
    expect(renameEvent.changes).toContain("Renamed Game");
  });

  it("returns 404 for unknown project", async () => {
    const res = await req("GET", "/api/projects/nonexistent/history");
    expect(res.status).toBe(404);
  });

  it("returns empty history for newly-created project with only creation", async () => {
    const res = await req("GET", `/api/projects/${projectId}/history`);
    const data = await res.json();
    // Should have at least the creation event
    expect(data.length).toBeGreaterThanOrEqual(1);
  });
});
