import { Hono } from "hono";
import { getDb } from "../db";
import crypto from "crypto";

export const billing = new Hono();

/** Plan limits per tier */
const PLAN_LIMITS = {
  free: {
    projects: 1,
    library_games: 10,
    browser_sim_spins: 1_000_000,
    server_sim_spins: 0,
    ai_review_calls: 10,
    export_formats: ["markdown"],
    seats: 1,
  },
  pro: {
    projects: -1, // unlimited
    library_games: 500,
    browser_sim_spins: -1, // unlimited
    server_sim_spins: 100_000_000,
    ai_review_calls: 500,
    export_formats: ["markdown", "pdf", "notion", "jira", "confluence", "json"],
    seats: 3,
  },
  enterprise: {
    projects: -1,
    library_games: -1,
    browser_sim_spins: -1,
    server_sim_spins: -1,
    ai_review_calls: -1,
    export_formats: ["markdown", "pdf", "notion", "jira", "confluence", "json"],
    seats: -1,
  },
} as const;

type PlanName = keyof typeof PLAN_LIMITS;

const UPGRADE_MESSAGES: Record<string, string> = {
  browser_sim_spins: "Monthly simulation budget reached. Upgrade to Pro for unlimited browser simulations.",
  server_sim_spins: "Server simulations require Pro. Free includes 1M browser preview.",
  ai_review_calls: "AI review limit reached. Pro includes 500/mo.",
  export_count: "PDF export requires Pro. Free exports Markdown.",
  projects: "Free includes 1 project. Upgrade to Pro for unlimited projects.",
  library_games: "Free library holds 10 games. Upgrade to Pro for 500.",
};

const VALID_USAGE_TYPES = ["browser_sim_spins", "server_sim_spins", "ai_review_calls", "export_count"] as const;

/** Grace period: 5% over limit before hard block */
const GRACE_PERCENT = 0.05;

interface SubscriptionRow {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  status: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  seats_included: number;
  seats_used: number;
  created_at: string;
  updated_at: string;
}

interface UsageRow {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  browser_sim_spins: number;
  server_sim_spins: number;
  ai_review_calls: number;
  export_count: number;
  updated_at: string;
}

function getSubscription(userId: string): SubscriptionRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(userId) as SubscriptionRow | undefined;
}

function getUserPlan(userId: string): PlanName {
  const sub = getSubscription(userId);
  if (!sub) return "free";
  return sub.plan as PlanName;
}

function getCurrentPeriodUsage(userId: string): UsageRow | null {
  const db = getDb();
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return db.prepare(
    "SELECT * FROM usage_records WHERE user_id = ? AND period_start = ?"
  ).get(userId, periodStart) as UsageRow | null;
}

function ensureUsageRecord(userId: string): UsageRow {
  const existing = getCurrentPeriodUsage(userId);
  if (existing) return existing;

  const db = getDb();
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const id = crypto.randomUUID();
  const updatedAt = now.toISOString();

  db.prepare(`
    INSERT INTO usage_records (id, user_id, period_start, period_end, browser_sim_spins, server_sim_spins, ai_review_calls, export_count, updated_at)
    VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)
  `).run(id, userId, periodStart, periodEnd, updatedAt);

  return getCurrentPeriodUsage(userId)!;
}

/** GET /subscription/:userId — get subscription details */
billing.get("/subscription/:userId", (c) => {
  const { userId } = c.req.param();
  const sub = getSubscription(userId);
  if (!sub) {
    return c.json({
      plan: "free",
      status: "active",
      seats_included: 1,
      seats_used: 1,
      stripe_customer_id: null,
      stripe_subscription_id: null,
    });
  }
  return c.json(sub);
});

/** GET /usage/:userId — get current period usage */
billing.get("/usage/:userId", (c) => {
  const { userId } = c.req.param();
  const usage = getCurrentPeriodUsage(userId);
  if (!usage) {
    return c.json({
      browser_sim_spins: 0,
      server_sim_spins: 0,
      ai_review_calls: 0,
      export_count: 0,
    });
  }
  return c.json({
    browser_sim_spins: usage.browser_sim_spins,
    server_sim_spins: usage.server_sim_spins,
    ai_review_calls: usage.ai_review_calls,
    export_count: usage.export_count,
  });
});

/** POST /usage/:userId/increment — increment a usage counter */
billing.post("/usage/:userId/increment", async (c) => {
  const { userId } = c.req.param();
  const body = await c.req.json();
  const { type, amount } = body;

  if (!VALID_USAGE_TYPES.includes(type)) {
    return c.json({ error: "Invalid usage type" }, 400);
  }
  if (!amount || amount <= 0) {
    return c.json({ error: "Amount must be positive" }, 400);
  }

  const usage = ensureUsageRecord(userId);
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`UPDATE usage_records SET ${type} = ${type} + ?, updated_at = ? WHERE id = ?`)
    .run(amount, now, usage.id);

  const updated = getCurrentPeriodUsage(userId)!;
  return c.json({
    browser_sim_spins: updated.browser_sim_spins,
    server_sim_spins: updated.server_sim_spins,
    ai_review_calls: updated.ai_review_calls,
    export_count: updated.export_count,
  });
});

/** GET /limits/:userId — get plan limits, usage, and warnings */
billing.get("/limits/:userId", (c) => {
  const { userId } = c.req.param();
  const plan = getUserPlan(userId);
  const limits = PLAN_LIMITS[plan];
  const usage = getCurrentPeriodUsage(userId);

  const currentUsage = {
    browser_sim_spins: usage?.browser_sim_spins ?? 0,
    server_sim_spins: usage?.server_sim_spins ?? 0,
    ai_review_calls: usage?.ai_review_calls ?? 0,
    export_count: usage?.export_count ?? 0,
  };

  // Warnings at 80% threshold
  const warnings: Record<string, boolean> = {};
  for (const key of VALID_USAGE_TYPES) {
    const limit = limits[key as keyof typeof limits] as number;
    if (limit > 0) {
      warnings[key] = currentUsage[key] >= limit * 0.8;
    } else {
      warnings[key] = false;
    }
  }

  return c.json({
    plan,
    limits,
    usage: currentUsage,
    warnings,
  });
});

/** POST /check-limit/:userId — check if action is within limits */
billing.post("/check-limit/:userId", async (c) => {
  const { userId } = c.req.param();
  const body = await c.req.json();
  const { type, amount } = body;

  if (!VALID_USAGE_TYPES.includes(type)) {
    return c.json({ error: "Invalid usage type" }, 400);
  }

  const plan = getUserPlan(userId);
  const limits = PLAN_LIMITS[plan];
  const limit = limits[type as keyof typeof limits] as number;

  // Unlimited
  if (limit === -1) {
    return c.json({ allowed: true });
  }

  // Zero = not available on this plan
  if (limit === 0) {
    return c.json({
      allowed: false,
      message: UPGRADE_MESSAGES[type] || `${type} requires Pro plan.`,
      upgrade_required: true,
    });
  }

  const usage = getCurrentPeriodUsage(userId);
  const currentUsage = usage ? (usage[type as keyof UsageRow] as number) : 0;
  const afterUsage = currentUsage + (amount || 0);
  const hardLimit = limit * (1 + GRACE_PERCENT);

  if (afterUsage > hardLimit) {
    return c.json({
      allowed: false,
      message: UPGRADE_MESSAGES[type] || `${type} limit reached.`,
      upgrade_required: true,
    });
  }

  if (afterUsage > limit) {
    return c.json({
      allowed: true,
      warning: `You're over your ${type} limit. Usage will be restricted soon.`,
    });
  }

  return c.json({ allowed: true });
});

/** POST /create-checkout — create Stripe checkout session */
billing.post("/create-checkout", async (c) => {
  const body = await c.req.json();
  const { userId, plan, annual } = body;

  if (!userId) return c.json({ error: "userId required" }, 400);
  if (!plan) return c.json({ error: "plan required" }, 400);
  if (!["pro", "enterprise"].includes(plan)) {
    return c.json({ error: "Invalid plan. Must be 'pro' or 'enterprise'" }, 400);
  }

  // In production, this would create a real Stripe checkout session
  // For now, return a placeholder that the frontend can use
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return c.json({
      error: "Stripe not configured",
      code: "STRIPE_NOT_CONFIGURED",
    }, 503);
  }

  try {
    const stripe = (await import("stripe")).default;
    const stripeClient = new stripe(stripeSecretKey);

    // Get or create customer
    let sub = getSubscription(userId);
    let customerId = sub?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripeClient.customers.create({
        metadata: { userId },
      });
      customerId = customer.id;
    }

    const priceId = annual
      ? process.env[`STRIPE_PRICE_${plan.toUpperCase()}_ANNUAL`]
      : process.env[`STRIPE_PRICE_${plan.toUpperCase()}_MONTHLY`];

    if (!priceId) {
      return c.json({ error: "Price not configured for this plan" }, 503);
    }

    const session = await stripeClient.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/billing?canceled=true`,
      metadata: { userId, plan },
    });

    return c.json({ url: session.url });
  } catch (err) {
    return c.json({ error: "Failed to create checkout session", code: "CHECKOUT_ERROR" }, 500);
  }
});

/** POST /cancel — cancel subscription */
billing.post("/cancel", async (c) => {
  const body = await c.req.json();
  const { userId } = body;

  const sub = getSubscription(userId);
  if (!sub) {
    return c.json({ error: "No subscription found" }, 404);
  }
  if (sub.plan === "free") {
    return c.json({ error: "Cannot cancel free plan" }, 400);
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey || !sub.stripe_subscription_id) {
    // Mark as canceled in DB directly (for development)
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("UPDATE subscriptions SET status = 'canceled', plan = 'free', updated_at = ? WHERE id = ?")
      .run(now, sub.id);
    return c.json({ status: "canceled" });
  }

  try {
    const stripe = (await import("stripe")).default;
    const stripeClient = new stripe(stripeSecretKey);
    await stripeClient.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    return c.json({ status: "cancel_at_period_end" });
  } catch (err) {
    return c.json({ error: "Failed to cancel subscription", code: "CANCEL_ERROR" }, 500);
  }
});

/** POST /webhook — Stripe webhook handler */
billing.post("/webhook", async (c) => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !webhookSecret) {
    return c.json({ error: "Stripe not configured" }, 503);
  }

  const body = await c.req.text();
  const sig = c.req.header("stripe-signature");

  if (!sig) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  try {
    const stripe = (await import("stripe")).default;
    const stripeClient = new stripe(stripeSecretKey);
    const event = stripeClient.webhooks.constructEvent(body, sig, webhookSecret);

    const db = getDb();

    // Idempotency: check if already processed
    const existing = db.prepare("SELECT event_id FROM stripe_events WHERE event_id = ?").get(event.id);
    if (existing) {
      return c.json({ received: true, duplicate: true });
    }

    // Process event
    const now = new Date().toISOString();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan || "pro";
        if (userId && session.subscription) {
          const subId = typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;

          // Fetch subscription from Stripe for accurate data
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const stripeSub = await stripeClient.subscriptions.retrieve(subId) as any;

          const existingSub = getSubscription(userId);
          if (existingSub) {
            db.prepare(`
              UPDATE subscriptions SET
                stripe_customer_id = ?, stripe_subscription_id = ?, plan = ?, status = 'active',
                current_period_start = ?, current_period_end = ?, seats_included = ?,
                updated_at = ?
              WHERE user_id = ?
            `).run(
              session.customer, subId, plan,
              new Date(stripeSub.current_period_start * 1000).toISOString(),
              new Date(stripeSub.current_period_end * 1000).toISOString(),
              plan === "pro" ? 3 : 1,
              now, userId
            );
          } else {
            db.prepare(`
              INSERT INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end, seats_included, seats_used, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 1, ?, ?)
            `).run(
              crypto.randomUUID(), userId, session.customer, subId, plan,
              new Date(stripeSub.current_period_start * 1000).toISOString(),
              new Date(stripeSub.current_period_end * 1000).toISOString(),
              plan === "pro" ? 3 : 1,
              now, now
            );
          }
        }
        break;
      }
      case "invoice.payment_failed": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any;
        if (invoice.subscription) {
          const subId = typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription.id;
          db.prepare("UPDATE subscriptions SET status = 'past_due', updated_at = ? WHERE stripe_subscription_id = ?")
            .run(now, subId);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const stripeSub = event.data.object;
        db.prepare("UPDATE subscriptions SET status = 'canceled', plan = 'free', updated_at = ? WHERE stripe_subscription_id = ?")
          .run(now, stripeSub.id);
        break;
      }
      case "customer.subscription.updated": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stripeSub = event.data.object as any;
        const status = stripeSub.status === "active" ? "active"
          : stripeSub.status === "past_due" ? "past_due"
          : stripeSub.status === "trialing" ? "trialing"
          : "canceled";
        db.prepare(`
          UPDATE subscriptions SET status = ?,
            current_period_start = ?, current_period_end = ?,
            updated_at = ?
          WHERE stripe_subscription_id = ?
        `).run(
          status,
          new Date(stripeSub.current_period_start * 1000).toISOString(),
          new Date(stripeSub.current_period_end * 1000).toISOString(),
          now, stripeSub.id
        );
        break;
      }
    }

    // Record event as processed
    db.prepare("INSERT INTO stripe_events (event_id, event_type, processed_at) VALUES (?, ?, ?)")
      .run(event.id, event.type, now);

    return c.json({ received: true });
  } catch (err) {
    return c.json({ error: "Webhook processing failed" }, 400);
  }
});

/** POST /portal — create Stripe customer portal session */
billing.post("/portal", async (c) => {
  const body = await c.req.json();
  const { userId } = body;

  const sub = getSubscription(userId);
  if (!sub?.stripe_customer_id) {
    return c.json({ error: "No Stripe customer found" }, 404);
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return c.json({ error: "Stripe not configured" }, 503);
  }

  try {
    const stripe = (await import("stripe")).default;
    const stripeClient = new stripe(stripeSecretKey);
    const session = await stripeClient.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/billing`,
    });
    return c.json({ url: session.url });
  } catch (err) {
    return c.json({ error: "Failed to create portal session" }, 500);
  }
});
