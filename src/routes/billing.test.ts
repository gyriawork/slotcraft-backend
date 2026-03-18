import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { billing } from "./billing";
import { getDb, resetDb } from "../db";

const app = new Hono();
app.route("/api/billing", billing);

function req(path: string, opts?: RequestInit) {
  return app.request(`/api/billing${path}`, opts);
}

function jsonReq(path: string, body: unknown) {
  return req(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetDb();
  getDb(); // re-init with fresh schema
});

describe("Billing API", () => {
  describe("GET /subscription/:userId", () => {
    it("returns free plan for new user", async () => {
      const res = await req("/subscription/user-1");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.plan).toBe("free");
      expect(data.status).toBe("active");
      expect(data.seats_included).toBe(1);
    });

    it("returns existing subscription if present", async () => {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO subscriptions (id, user_id, plan, status, stripe_customer_id, stripe_subscription_id, seats_included, seats_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("sub-1", "user-2", "pro", "active", "cus_123", "sub_456", 3, 1, now, now);

      const res = await req("/subscription/user-2");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.plan).toBe("pro");
      expect(data.stripe_customer_id).toBe("cus_123");
      expect(data.seats_included).toBe(3);
    });
  });

  describe("GET /usage/:userId", () => {
    it("returns zero usage for new user", async () => {
      const res = await req("/usage/user-1");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.browser_sim_spins).toBe(0);
      expect(data.ai_review_calls).toBe(0);
      expect(data.server_sim_spins).toBe(0);
      expect(data.export_count).toBe(0);
    });

    it("returns current period usage", async () => {
      const db = getDb();
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      db.prepare(`
        INSERT INTO usage_records (id, user_id, period_start, period_end, browser_sim_spins, ai_review_calls, server_sim_spins, export_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("usage-1", "user-1", periodStart, periodEnd, 500000, 5, 0, 2, now.toISOString());

      const res = await req("/usage/user-1");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.browser_sim_spins).toBe(500000);
      expect(data.ai_review_calls).toBe(5);
      expect(data.export_count).toBe(2);
    });
  });

  describe("POST /usage/:userId/increment", () => {
    it("increments browser sim spins", async () => {
      const res = await jsonReq("/usage/user-1/increment", {
        type: "browser_sim_spins",
        amount: 100000,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.browser_sim_spins).toBe(100000);

      // Increment again
      const res2 = await jsonReq("/usage/user-1/increment", {
        type: "browser_sim_spins",
        amount: 50000,
      });
      const data2 = await res2.json();
      expect(data2.browser_sim_spins).toBe(150000);
    });

    it("increments ai review calls", async () => {
      const res = await jsonReq("/usage/user-1/increment", {
        type: "ai_review_calls",
        amount: 1,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ai_review_calls).toBe(1);
    });

    it("returns 400 for invalid type", async () => {
      const res = await jsonReq("/usage/user-1/increment", {
        type: "invalid_type",
        amount: 1,
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-positive amount", async () => {
      const res = await jsonReq("/usage/user-1/increment", {
        type: "browser_sim_spins",
        amount: 0,
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /limits/:userId", () => {
    it("returns free tier limits for free user", async () => {
      const res = await req("/limits/user-1");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.plan).toBe("free");
      expect(data.limits.projects).toBe(1);
      expect(data.limits.library_games).toBe(10);
      expect(data.limits.browser_sim_spins).toBe(1_000_000);
      expect(data.limits.server_sim_spins).toBe(0);
      expect(data.limits.ai_review_calls).toBe(10);
      expect(data.limits.seats).toBe(1);
    });

    it("returns pro tier limits for pro user", async () => {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO subscriptions (id, user_id, plan, status, seats_included, seats_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("sub-1", "user-1", "pro", "active", 3, 1, now, now);

      const res = await req("/limits/user-1");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.plan).toBe("pro");
      expect(data.limits.projects).toBe(-1); // unlimited
      expect(data.limits.library_games).toBe(500);
      expect(data.limits.browser_sim_spins).toBe(-1);
      expect(data.limits.server_sim_spins).toBe(100_000_000);
      expect(data.limits.ai_review_calls).toBe(500);
      expect(data.limits.seats).toBe(3);
    });

    it("includes usage and percentage in response", async () => {
      const db = getDb();
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      db.prepare(`
        INSERT INTO usage_records (id, user_id, period_start, period_end, browser_sim_spins, ai_review_calls, server_sim_spins, export_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("usage-1", "user-1", periodStart, periodEnd, 800000, 8, 0, 0, now.toISOString());

      const res = await req("/limits/user-1");
      const data = await res.json();
      expect(data.usage.browser_sim_spins).toBe(800000);
      expect(data.usage.ai_review_calls).toBe(8);
      // 80% warning threshold
      expect(data.warnings.browser_sim_spins).toBe(true);
      expect(data.warnings.ai_review_calls).toBe(true);
    });
  });

  describe("POST /check-limit/:userId", () => {
    it("allows action within limits", async () => {
      const res = await jsonReq("/check-limit/user-1", {
        type: "browser_sim_spins",
        amount: 100000,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.allowed).toBe(true);
    });

    it("blocks action exceeding limit with upgrade message", async () => {
      const db = getDb();
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      db.prepare(`
        INSERT INTO usage_records (id, user_id, period_start, period_end, browser_sim_spins, ai_review_calls, server_sim_spins, export_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("usage-1", "user-1", periodStart, periodEnd, 1_000_000, 0, 0, 0, now.toISOString());

      const res = await jsonReq("/check-limit/user-1", {
        type: "browser_sim_spins",
        amount: 100000,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.allowed).toBe(false);
      expect(data.message).toBeDefined();
      expect(data.upgrade_required).toBe(true);
    });

    it("allows pro user with higher limits", async () => {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO subscriptions (id, user_id, plan, status, seats_included, seats_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("sub-1", "user-1", "pro", "active", 3, 1, now, now);

      const res = await jsonReq("/check-limit/user-1", {
        type: "browser_sim_spins",
        amount: 100000,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.allowed).toBe(true);
    });

    it("blocks free user from server simulation", async () => {
      const res = await jsonReq("/check-limit/user-1", {
        type: "server_sim_spins",
        amount: 1,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.allowed).toBe(false);
      expect(data.message).toContain("Pro");
    });

    it("allows 5% grace period over limit", async () => {
      const db = getDb();
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      // At 1M (100%) - should still allow small amounts within 5% grace
      db.prepare(`
        INSERT INTO usage_records (id, user_id, period_start, period_end, browser_sim_spins, ai_review_calls, server_sim_spins, export_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("usage-1", "user-1", periodStart, periodEnd, 1_000_000, 0, 0, 0, now.toISOString());

      // Small request within 5% grace (50K is 5% of 1M)
      const res = await jsonReq("/check-limit/user-1", {
        type: "browser_sim_spins",
        amount: 40000,
      });
      const data = await res.json();
      expect(data.allowed).toBe(true);
      expect(data.warning).toBeDefined();
    });
  });

  describe("Webhook idempotency", () => {
    it("records processed stripe event", async () => {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO stripe_events (event_id, event_type, processed_at) VALUES (?, ?, ?)`)
        .run("evt_123", "checkout.session.completed", now);

      // Check it exists
      const row = db.prepare("SELECT * FROM stripe_events WHERE event_id = ?").get("evt_123") as { event_id: string; event_type: string };
      expect(row).toBeDefined();
      expect(row.event_type).toBe("checkout.session.completed");
    });

    it("prevents duplicate event processing", async () => {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO stripe_events (event_id, event_type, processed_at) VALUES (?, ?, ?)`)
        .run("evt_123", "checkout.session.completed", now);

      // Inserting same event should fail
      expect(() => {
        db.prepare(`INSERT INTO stripe_events (event_id, event_type, processed_at) VALUES (?, ?, ?)`)
          .run("evt_123", "checkout.session.completed", now);
      }).toThrow();
    });
  });

  describe("POST /create-checkout", () => {
    it("returns 400 without userId", async () => {
      const res = await jsonReq("/create-checkout", { plan: "pro" });
      expect(res.status).toBe(400);
    });

    it("returns 400 without plan", async () => {
      const res = await jsonReq("/create-checkout", { userId: "user-1" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid plan", async () => {
      const res = await jsonReq("/create-checkout", { userId: "user-1", plan: "invalid" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /cancel", () => {
    it("returns 404 for user without subscription", async () => {
      const res = await jsonReq("/cancel", { userId: "user-1" });
      expect(res.status).toBe(404);
    });

    it("returns 400 for free plan user", async () => {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO subscriptions (id, user_id, plan, status, seats_included, seats_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("sub-1", "user-1", "free", "active", 1, 1, now, now);

      const res = await jsonReq("/cancel", { userId: "user-1" });
      expect(res.status).toBe(400);
    });
  });
});
