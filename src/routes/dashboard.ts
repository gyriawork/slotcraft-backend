import { Hono } from "hono";
import { getDb } from "../db.js";

export const dashboard = new Hono();

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

function daysBetween(a: string | Date, b: string | Date): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

const TOTAL_STEPS = 9;

dashboard.get("/", (c) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY updated_at DESC")
    .all() as ProjectRow[];
  const now = new Date();

  const projects = rows.map((row) => {
    let completedSteps = 0;
    let currentStep = 1;
    let simStatus: "passed" | "failed" | "running" | "not_run" = "not_run";
    let verifiedRtp: number | null = null;
    let targetRtp: number | null = null;
    let volatility: string | null = null;

    try {
      const sd = JSON.parse(row.step_data);
      for (let i = 1; i <= TOTAL_STEPS; i++) {
        if (sd[`step${i}`]) completedSteps++;
      }
      if (typeof sd.currentStep === "number") currentStep = sd.currentStep;
      else if (completedSteps > 0) currentStep = completedSteps;

      if (sd.step2) {
        targetRtp = sd.step2.target_rtp ?? null;
        volatility = sd.step2.volatility ?? null;
      }
      if (sd.step6) {
        verifiedRtp = sd.step6.rtp ?? null;
        simStatus = sd.step6.pass ? "passed" : "failed";
      }
    } catch { /* empty */ }

    // Derive dashboard status
    let dashStatus: "active" | "complete" | "draft" | "blocked" = row.status === "draft" ? "draft" : "active";
    if (simStatus === "failed") dashStatus = "blocked";
    if (currentStep >= TOTAL_STEPS && simStatus === "passed") dashStatus = "complete";

    const releaseDate = row.marketing_release ?? row.tech_release ?? null;
    const daysUntilRelease = releaseDate ? daysBetween(now, releaseDate) : null;
    const daysSinceUpdate = daysBetween(row.updated_at, now.toISOString());

    let nextAction = `Continue Step ${currentStep}`;
    if (dashStatus === "complete") nextAction = "Released";
    else if (dashStatus === "blocked") nextAction = "Fix simulation failure";

    return {
      id: row.id,
      name: row.name,
      game_type: row.game_type,
      brand: row.brand,
      team: row.team,
      created_by: row.created_by,
      current_step: currentStep,
      total_steps: TOTAL_STEPS,
      status: dashStatus,
      target_rtp: targetRtp,
      volatility,
      sim_status: simStatus,
      verified_rtp: verifiedRtp,
      icons_uploaded: 0,
      icons_total: 6,
      product_sheet_status: "missing" as const,
      target_release_date: releaseDate,
      last_updated_at: row.updated_at,
      last_updated_by: row.created_by,
      created_at: row.created_at,
      completed_at: dashStatus === "complete" ? row.updated_at : null,
      next_action: nextAction,
      days_until_release: daysUntilRelease,
      days_since_last_update: daysSinceUpdate,
      stale_steps: [] as number[],
    };
  });

  // Recent activity from project_history
  const historyRows = db
    .prepare(`SELECT ph.id, ph.project_id, p.name as project_name, p.created_by as user_name,
      ph.action, ph.changes as detail, ph.timestamp as created_at
      FROM project_history ph JOIN projects p ON ph.project_id = p.id
      ORDER BY ph.timestamp DESC LIMIT 10`)
    .all() as Array<{
      id: string; project_id: string; project_name: string; user_name: string;
      action: string; detail: string; created_at: string;
    }>;

  return c.json({ projects, recentActivity: historyRows });
});
