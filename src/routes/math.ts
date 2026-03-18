import { Hono } from "hono";

const mathRouter = new Hono();

interface MathGenRequest {
  grid: { reels: number; rows: number };
  target_rtp: number;        // e.g. 96.0
  volatility: string;        // low, med_low, med, med_high, high, extreme
  paylines: number;
  features: string[];        // feature variants: ["free_spins", "multiplier", "cascading"]
  symbols: Array<{
    id: string;
    name: string;
    role: "wild" | "scatter" | "high_pay" | "low_pay";
  }>;
  rtp_variants?: number[];   // e.g. [94.0, 95.0, 96.0]
}

interface PaytableRow {
  symbol_id: string;
  label: string;
  x3: number;
  x4: number;
  x5: number;
}

type ReelWeights = Record<string, number>;

interface RtpVariantData {
  paytable: PaytableRow[];
  reel_strips: Record<string, ReelWeights>;
  stops_per_reel: number;
  analytical_rtp: number;
}

interface RtpBudget {
  base_wins: number;
  wild_substitution: number;
  free_spins: number;
  accumulator: number;
}

// Volatility profiles: affect paytable spread and hit frequency
const VOLATILITY_PROFILES: Record<string, { spread: number; topPay: number; hitRate: number }> = {
  low:      { spread: 1.5, topPay: 500,   hitRate: 0.35 },
  med_low:  { spread: 2.0, topPay: 2000,  hitRate: 0.30 },
  med:      { spread: 2.5, topPay: 5000,  hitRate: 0.25 },
  med_high: { spread: 3.0, topPay: 10000, hitRate: 0.20 },
  high:     { spread: 4.0, topPay: 25000, hitRate: 0.15 },
  extreme:  { spread: 5.0, topPay: 50000, hitRate: 0.10 },
};

/** POST /api/math/generate — Generate a complete math model */
mathRouter.post("/generate", async (c) => {
  const body = await c.req.json<MathGenRequest>();

  if (!body.grid || !body.target_rtp || !body.symbols?.length) {
    return c.json({ error: "grid, target_rtp, and symbols are required" }, 400);
  }

  const { grid, target_rtp, volatility = "med", paylines, features = [], symbols } = body;
  const profile = VOLATILITY_PROFILES[volatility] || VOLATILITY_PROFILES.med;

  // Separate symbols by role
  const highPay = symbols.filter(s => s.role === "high_pay");
  const lowPay = symbols.filter(s => s.role === "low_pay");
  const wild = symbols.find(s => s.role === "wild");
  const scatter = symbols.find(s => s.role === "scatter");
  const regulars = [...highPay, ...lowPay];

  if (regulars.length === 0) {
    return c.json({ error: "At least one high_pay or low_pay symbol is required" }, 400);
  }

  // Generate RTP budget
  const hasFreespins = features.includes("free_spins");
  const hasAccumulator = features.includes("accumulator") || features.includes("cascading");
  const hasWild = !!wild;
  const budget = generateRtpBudget(target_rtp, hasWild, hasFreespins, hasAccumulator);

  // Generate paytable
  const paytable = generatePaytable(regulars, profile, grid.reels);

  // Generate reel strips for each RTP variant
  const variants = body.rtp_variants?.length ? body.rtp_variants : [target_rtp];
  const stopsPerReel = calculateStopsPerReel(grid, profile);
  const rtp_variants: Record<string, RtpVariantData> = {};

  for (const rtpTarget of variants) {
    const adjustedPaytable = adjustPaytableForRtp(paytable, rtpTarget, target_rtp);
    const reelStrips = generateReelStrips(
      regulars, wild, scatter, grid, stopsPerReel, adjustedPaytable, paylines, rtpTarget, profile
    );
    const analyticalRtp = calculateAnalyticalRtp(adjustedPaytable, reelStrips, grid, paylines, stopsPerReel);

    rtp_variants[rtpTarget.toFixed(1)] = {
      paytable: adjustedPaytable,
      reel_strips: reelStrips,
      stops_per_reel: stopsPerReel,
      analytical_rtp: Math.round(analyticalRtp * 10) / 10,
    };
  }

  return c.json({
    active_variant: target_rtp.toFixed(1),
    rtp_variants,
    rtp_budget: budget,
    target_rtp_tenths: Math.round(target_rtp * 10),
  });
});

function generateRtpBudget(
  targetRtp: number,
  hasWild: boolean,
  hasFreespins: boolean,
  hasAccumulator: boolean,
): RtpBudget {
  const targetTenths = Math.round(targetRtp * 10);

  // Base allocation heuristics
  let wildPct = hasWild ? 80 : 0;         // ~8% for wild substitution
  let fsPct = hasFreespins ? 150 : 0;     // ~15% for free spins
  let accPct = hasAccumulator ? 50 : 0;   // ~5% for accumulator

  const featurePct = wildPct + fsPct + accPct;
  const basePct = targetTenths - featurePct;

  // If base would be too low, redistribute
  if (basePct < 300) { // minimum 30% base
    const scale = (targetTenths - 300) / (featurePct || 1);
    wildPct = Math.round(wildPct * scale);
    fsPct = Math.round(fsPct * scale);
    accPct = Math.round(accPct * scale);
  }

  const actualBase = targetTenths - wildPct - fsPct - accPct;

  return {
    base_wins: actualBase,
    wild_substitution: wildPct,
    free_spins: fsPct,
    accumulator: accPct,
  };
}

function generatePaytable(
  regulars: MathGenRequest["symbols"],
  profile: typeof VOLATILITY_PROFILES["med"],
  reels: number,
): PaytableRow[] {
  const maxCols = Math.min(reels, 5);
  const rows: PaytableRow[] = [];

  // Sort: high_pay first (highest payout), then low_pay
  const sorted = [...regulars].sort((a, b) => {
    if (a.role !== b.role) return a.role === "high_pay" ? -1 : 1;
    return 0;
  });

  const total = sorted.length;

  for (let i = 0; i < total; i++) {
    const sym = sorted[i];
    const isHigh = sym.role === "high_pay";
    const rank = i; // 0 = highest pay

    // Base multiplier decreases with rank
    const baseMult = isHigh
      ? profile.topPay / (50 * Math.pow(profile.spread, rank))
      : 2.0 / Math.pow(1.3, rank - (total - sorted.filter(s => s.role === "low_pay").length));

    // Scale by match count: x3 = base, x4 = x3 * 2.5-3.5, x5 = x4 * 3-5
    const x3 = Math.round(Math.max(0.1, baseMult) * 10) / 10;
    const x4 = maxCols >= 4 ? Math.round(x3 * (2.5 + rank * 0.1) * 10) / 10 : 0;
    const x5 = maxCols >= 5 ? Math.round(x4 * (3.0 + rank * 0.2) * 10) / 10 : 0;

    rows.push({
      symbol_id: sym.id,
      label: sym.name,
      x3,
      x4: x4 || 0,
      x5: x5 || 0,
    });
  }

  return rows;
}

function adjustPaytableForRtp(
  paytable: PaytableRow[],
  rtpTarget: number,
  baseTarget: number,
): PaytableRow[] {
  if (Math.abs(rtpTarget - baseTarget) < 0.01) return paytable;
  const ratio = rtpTarget / baseTarget;
  return paytable.map(row => ({
    ...row,
    x3: Math.round(row.x3 * ratio * 10) / 10,
    x4: Math.round(row.x4 * ratio * 10) / 10,
    x5: Math.round(row.x5 * ratio * 10) / 10,
  }));
}

function calculateStopsPerReel(
  grid: { reels: number; rows: number },
  profile: typeof VOLATILITY_PROFILES["med"],
): number {
  // More stops = more granular control over probabilities
  // Higher volatility = more stops (rarer symbols)
  const base = 40 + grid.rows * 5;
  return Math.round(base * (1 + (profile.spread - 1.5) * 0.3));
}

function generateReelStrips(
  regulars: MathGenRequest["symbols"],
  wild: MathGenRequest["symbols"][0] | undefined,
  scatter: MathGenRequest["symbols"][0] | undefined,
  grid: { reels: number; rows: number },
  stopsPerReel: number,
  paytable: PaytableRow[],
  paylines: number,
  targetRtp: number,
  profile: typeof VOLATILITY_PROFILES["med"],
): Record<string, Record<string, number>> {
  const strips: Record<string, Record<string, number>> = {};

  for (let r = 0; r < grid.reels; r++) {
    const reelKey = `reel${r + 1}`;
    const weights: Record<string, number> = {};
    let remaining = stopsPerReel;

    // Wild: 1-3 stops per reel (rarer = higher volatility)
    if (wild) {
      const wildStops = Math.max(1, Math.round(3 / profile.spread));
      weights[wild.id] = wildStops;
      remaining -= wildStops;
    }

    // Scatter: 1-2 stops per reel
    if (scatter) {
      const scatterStops = Math.max(1, Math.round(2 / profile.spread));
      weights[scatter.id] = scatterStops;
      remaining -= scatterStops;
    }

    // Distribute remaining stops among regular symbols
    // High-pay symbols get fewer stops (rarer), low-pay get more
    const sorted = [...regulars].sort((a, b) => {
      if (a.role !== b.role) return a.role === "high_pay" ? -1 : 1;
      return 0;
    });

    const totalSymbols = sorted.length;
    let totalWeight = 0;
    const rawWeights: number[] = [];

    for (let i = 0; i < totalSymbols; i++) {
      const sym = sorted[i];
      const isHigh = sym.role === "high_pay";
      // High pay symbols are rarer (lower weight)
      const w = isHigh
        ? 1.0 / Math.pow(profile.spread, i * 0.5)
        : 2.0 + i * 0.3;
      rawWeights.push(w);
      totalWeight += w;
    }

    // Normalize to fill remaining stops
    for (let i = 0; i < totalSymbols; i++) {
      const stops = Math.max(1, Math.round((rawWeights[i] / totalWeight) * remaining));
      weights[sorted[i].id] = stops;
    }

    // Adjust to match exact stopsPerReel
    const currentTotal = Object.values(weights).reduce((a, b) => a + b, 0);
    const diff = stopsPerReel - currentTotal;
    if (diff !== 0 && sorted.length > 0) {
      // Add/remove from the most common symbol (last low_pay)
      const lastSym = sorted[sorted.length - 1].id;
      weights[lastSym] = Math.max(1, weights[lastSym] + diff);
    }

    strips[reelKey] = weights;
  }

  return strips;
}

function calculateAnalyticalRtp(
  paytable: PaytableRow[],
  reelStrips: Record<string, Record<string, number>>,
  grid: { reels: number; rows: number },
  paylines: number,
  stopsPerReel: number,
): number {
  // Simplified analytical RTP: sum of (probability * payout) for each symbol/count combo
  // Only considers 3-of-a-kind on a single payline for approximation
  let totalContribution = 0;

  for (const row of paytable) {
    const symId = row.symbol_id;

    // Probability of 3-of-a-kind on first 3 reels of a single payline
    let prob3 = 1;
    for (let r = 0; r < Math.min(3, grid.reels); r++) {
      const reelKey = `reel${r + 1}`;
      const symWeight = reelStrips[reelKey]?.[symId] || 0;
      prob3 *= symWeight / stopsPerReel;
    }

    totalContribution += prob3 * row.x3 * paylines;

    // 4-of-a-kind
    if (row.x4 > 0 && grid.reels >= 4) {
      let prob4 = prob3;
      const reel4Weight = reelStrips["reel4"]?.[symId] || 0;
      prob4 *= reel4Weight / stopsPerReel;
      totalContribution += prob4 * (row.x4 - row.x3) * paylines; // marginal contribution
    }

    // 5-of-a-kind
    if (row.x5 > 0 && grid.reels >= 5) {
      let prob5 = 1;
      for (let r = 0; r < 5; r++) {
        const reelKey = `reel${r + 1}`;
        const symWeight = reelStrips[reelKey]?.[symId] || 0;
        prob5 *= symWeight / stopsPerReel;
      }
      totalContribution += prob5 * (row.x5 - (row.x4 || row.x3)) * paylines;
    }
  }

  return totalContribution * 100; // Convert to percentage
}

export { mathRouter as math };
