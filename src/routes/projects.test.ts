import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { projects } from "./projects";
import { resetDb } from "../db";

const app = new Hono();
app.route("/api/projects", projects);

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  const url = path === "/" ? "/api/projects" : `/api/projects${path}`;
  return app.request(url, init);
}

describe("Projects API", () => {
  beforeEach(() => {
    resetDb(); // Fresh in-memory DB for each test
  });

  it("creates a project", async () => {
    const res = await req("POST", "/", { name: "Test Slot", game_type: "slot" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Test Slot");
    expect(data.game_type).toBe("slot");
    expect(data.status).toBe("draft");
    expect(data.id).toBeDefined();
  });

  it("rejects empty name", async () => {
    const res = await req("POST", "/", { name: "", game_type: "slot" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid game_type", async () => {
    const res = await req("POST", "/", { name: "Test", game_type: "poker" });
    expect(res.status).toBe(400);
  });

  it("lists projects", async () => {
    await req("POST", "/", { name: "List Test", game_type: "slot" });
    const res = await req("GET", "/");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
  });

  it("gets a single project", async () => {
    const createRes = await req("POST", "/", { name: "Get Test", game_type: "crash" });
    const created = await createRes.json();

    const res = await req("GET", `/${created.id}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Get Test");
  });

  it("returns 404 for unknown id", async () => {
    const res = await req("GET", "/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("updates a project", async () => {
    const createRes = await req("POST", "/", { name: "Update Test", game_type: "table" });
    const created = await createRes.json();

    const res = await req("PATCH", `/${created.id}`, { name: "Updated Name" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Name");
  });

  it("updates step_data with merge", async () => {
    const createRes = await req("POST", "/", { name: "Step Data Test", game_type: "slot" });
    const created = await createRes.json();

    // First update
    await req("PATCH", `/${created.id}`, { step_data: { step1: { grid: "5x3" } } });

    // Second update should merge, not replace
    await req("PATCH", `/${created.id}`, { step_data: { step2: { rtp: 96 } } });

    const getRes = await req("GET", `/${created.id}`);
    const data = await getRes.json();
    expect(data.step_data.step1).toEqual({ grid: "5x3" });
    expect(data.step_data.step2).toEqual({ rtp: 96 });
  });

  it("list endpoint returns progress instead of step_data", async () => {
    const createRes = await req("POST", "/", { name: "Omit Test", game_type: "slot" });
    const created = await createRes.json();
    await req("PATCH", `/${created.id}`, { step_data: { step1: { big: "data" }, step2: { rtp: 96 }, currentStep: 3 } });

    const listRes = await req("GET", "/");
    const list = await listRes.json();
    const found = list.find((p: { id: string }) => p.id === created.id);
    expect(found).toBeDefined();
    expect(found.step_data).toBeUndefined();
    expect(found.completed_steps).toBe(2);
    expect(found.current_step).toBe(3);
  });

  it("get endpoint includes step_data", async () => {
    const createRes = await req("POST", "/", { name: "Include Test", game_type: "crash" });
    const created = await createRes.json();
    await req("PATCH", `/${created.id}`, { step_data: { key: "value" } });

    const getRes = await req("GET", `/${created.id}`);
    const data = await getRes.json();
    expect(data.step_data).toBeDefined();
    expect(data.step_data.key).toBe("value");
  });

  it("duplicates a project with step_data", async () => {
    const createRes = await req("POST", "/", { name: "Original", game_type: "slot" });
    const created = await createRes.json();
    await req("PATCH", `/${created.id}`, { step_data: { step1: { grid: "5x3" }, step2: { rtp: 96 } } });

    const dupRes = await req("POST", `/${created.id}/duplicate`);
    expect(dupRes.status).toBe(201);
    const dup = await dupRes.json();
    expect(dup.name).toBe("Original (Copy)");
    expect(dup.id).not.toBe(created.id);
    expect(dup.status).toBe("draft");
    expect(dup.step_data.step1).toEqual({ grid: "5x3" });
    expect(dup.step_data.step2).toEqual({ rtp: 96 });
  });

  it("duplicate returns 404 for unknown project", async () => {
    const res = await req("POST", "/nonexistent/duplicate");
    expect(res.status).toBe(404);
  });

  it("archives a project (soft delete)", async () => {
    const createRes = await req("POST", "/", { name: "Delete Test", game_type: "slot" });
    const created = await createRes.json();

    const deleteRes = await req("DELETE", `/${created.id}`);
    expect(deleteRes.status).toBe(200);

    // Archived projects should not appear in list
    const listRes = await req("GET", "/");
    const list = await listRes.json();
    const found = list.find((p: { id: string }) => p.id === created.id);
    expect(found).toBeUndefined();
  });
});
