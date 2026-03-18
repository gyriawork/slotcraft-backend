import { Hono } from "hono";

const simulation = new Hono();

const MAX_SPINS = 10_000_000;

interface SimConfig {
  reels: number;
  rows: number;
  reel_strips: Array<{ weights: Array<[SymbolDef, number]> }>;
  paytable: Array<{ symbol: SymbolDef; count: number; payout: number }>;
  paylines: number[][];
  features: {
    cascade_enabled: boolean;
    accumulator_tiers: Array<{ min_cascades: number; max_cascades: number; multiplier: number }>;
    free_spins_enabled: boolean;
    free_spin_awards: Record<string, number>;
    retrigger_spins: number;
    max_total_free_spins: number;
    wild_config: { wild_type: string | { Multiplier: number } | { Stacked: number } };
  };
  bet: number;
}

type SymbolDef = "Wild" | "Scatter" | { Regular: number };

function symbolKey(s: SymbolDef): string {
  if (s === "Wild") return "W";
  if (s === "Scatter") return "S";
  if (typeof s === "object" && "Regular" in s) return `R${s.Regular}`;
  return "?";
}

function isWild(s: SymbolDef): boolean {
  return s === "Wild";
}

function isScatter(s: SymbolDef): boolean {
  return s === "Scatter";
}

/** Simple xoshiro256** PRNG matching Rust implementation */
class Rng {
  private s: BigUint64Array;

  constructor(seed: number) {
    this.s = new BigUint64Array(4);
    // SplitMix64 seeding (same as Rust's seed_from_u64)
    let z = BigInt(seed) & 0xFFFFFFFFFFFFFFFFn;
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9E3779B97F4A7C15n) & 0xFFFFFFFFFFFFFFFFn;
      let t = z;
      t = ((t ^ (t >> 30n)) * 0xBF58476D1CE4E5B9n) & 0xFFFFFFFFFFFFFFFFn;
      t = ((t ^ (t >> 27n)) * 0x94D049BB133111EBn) & 0xFFFFFFFFFFFFFFFFn;
      t = (t ^ (t >> 31n)) & 0xFFFFFFFFFFFFFFFFn;
      this.s[i] = t;
    }
  }

  next(): bigint {
    const s = this.s;
    const result = (((s[1] * 5n) & 0xFFFFFFFFFFFFFFFFn) << 7n | ((s[1] * 5n) & 0xFFFFFFFFFFFFFFFFn) >> 57n) * 9n & 0xFFFFFFFFFFFFFFFFn;
    const t = (s[1] << 17n) & 0xFFFFFFFFFFFFFFFFn;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = ((s[3] << 45n) | (s[3] >> 19n)) & 0xFFFFFFFFFFFFFFFFn;
    return result;
  }

  nextBounded(bound: number): number {
    const n = this.next();
    return Number(n % BigInt(bound));
  }

  weightedRandom(weights: Array<[SymbolDef, number]>): SymbolDef {
    const total = weights.reduce((a, [, w]) => a + w, 0);
    let r = this.nextBounded(total);
    for (const [sym, w] of weights) {
      if (r < w) return sym;
      r -= w;
    }
    return weights[weights.length - 1][0];
  }
}

function spinReels(config: SimConfig, rng: Rng): SymbolDef[][] {
  const grid: SymbolDef[][] = [];
  for (let reel = 0; reel < config.reels; reel++) {
    const strip = config.reel_strips[reel];
    const total = strip.weights.reduce((a, [, w]) => a + w, 0);
    const stop = rng.nextBounded(total);
    const col: SymbolDef[] = [];
    for (let row = 0; row < config.rows; row++) {
      const pos = (stop + row) % total;
      let cum = 0;
      let sym = strip.weights[0][0];
      for (const [s, w] of strip.weights) {
        cum += w;
        if (pos < cum) { sym = s; break; }
      }
      col.push(sym);
    }
    grid.push(col);
  }
  return grid;
}

function evaluatePaylines(grid: SymbolDef[][], config: SimConfig): { win: number; scatterCount: number } {
  let totalWin = 0;
  let scatterCount = 0;

  // Count scatters
  for (const reel of grid) {
    for (const sym of reel) {
      if (isScatter(sym)) scatterCount++;
    }
  }

  // Evaluate each payline
  for (const payline of config.paylines) {
    const symbols = payline.map((row, reel) => grid[reel][row]);
    const first = symbols[0];

    // Try each possible match symbol (including wild substitution)
    let bestPay = 0;

    // Get all regular symbols that appear in the paytable
    const paytableSymbols = new Set(
      config.paytable
        .map(e => symbolKey(e.symbol))
        .filter(k => k.startsWith("R"))
    );

    for (const targetKey of paytableSymbols) {
      let count = 0;
      for (const sym of symbols) {
        if (symbolKey(sym) === targetKey || isWild(sym)) {
          count++;
        } else {
          break;
        }
      }

      if (count >= 3) {
        const entry = config.paytable.find(
          e => symbolKey(e.symbol) === targetKey && e.count === count
        );
        if (entry && entry.payout > bestPay) {
          bestPay = entry.payout;
        }
      }
    }

    // Also check if first symbol matches naturally
    if (!isWild(first) && !isScatter(first)) {
      const fk = symbolKey(first);
      let count = 0;
      for (const sym of symbols) {
        if (symbolKey(sym) === fk || isWild(sym)) {
          count++;
        } else {
          break;
        }
      }
      if (count >= 3) {
        const entry = config.paytable.find(
          e => symbolKey(e.symbol) === fk && e.count === count
        );
        if (entry && entry.payout > bestPay) {
          bestPay = entry.payout;
        }
      }
    }

    totalWin += bestPay;
  }

  return { win: totalWin, scatterCount };
}

function getBucket(winRatio: number): number {
  if (winRatio === 0) return 0;
  if (winRatio < 1) return 1;
  if (winRatio < 2) return 2;
  if (winRatio < 5) return 3;
  if (winRatio < 10) return 4;
  if (winRatio < 20) return 5;
  if (winRatio < 50) return 6;
  if (winRatio < 100) return 7;
  if (winRatio < 200) return 8;
  if (winRatio < 500) return 9;
  if (winRatio < 1000) return 10;
  if (winRatio < 5000) return 11;
  return 12;
}

interface ConvergencePoint {
  spin: number;
  rtp: number;
}

interface SimResult {
  spins: number;
  total_wagered: number;
  total_won: number;
  sum_win_squared: number;
  winning_spins: number;
  bonus_triggers: number;
  max_win: number;
  distribution_buckets: number[];
  rtp: number;
  hit_frequency: number;
  bonus_frequency: number;
  volatility_sd: number;
  convergence: ConvergencePoint[];
}

function runSimulation(config: SimConfig, spinCount: number, seed: number): SimResult {
  const rng = new Rng(seed);
  const buckets = new Array(13).fill(0);
  let totalWagered = 0;
  let totalWon = 0;
  let sumWinSquared = 0;
  let winningSpins = 0;
  let bonusTriggers = 0;
  let maxWin = 0;

  // Sample convergence at ~50 points
  const convergence: ConvergencePoint[] = [];
  const sampleInterval = Math.max(1, Math.floor(spinCount / 50));

  for (let i = 0; i < spinCount; i++) {
    totalWagered += config.bet;
    const grid = spinReels(config, rng);
    const { win, scatterCount } = evaluatePaylines(grid, config);

    const spinWin = win * config.bet;
    totalWon += spinWin;
    sumWinSquared += spinWin * spinWin;

    if (spinWin > 0) winningSpins++;
    if (spinWin > maxWin) maxWin = spinWin;

    const winRatio = spinWin / config.bet;
    buckets[getBucket(winRatio)]++;

    // Sample RTP convergence
    if ((i + 1) % sampleInterval === 0 || i === spinCount - 1) {
      convergence.push({
        spin: i + 1,
        rtp: totalWagered > 0 ? (totalWon / totalWagered) * 100 : 0,
      });
    }

    // Free spins trigger check
    if (config.features.free_spins_enabled && scatterCount >= 3) {
      bonusTriggers++;
      const fsCount = config.features.free_spin_awards[String(scatterCount)] || 0;
      for (let fs = 0; fs < fsCount; fs++) {
        const fsGrid = spinReels(config, rng);
        const fsResult = evaluatePaylines(fsGrid, config);
        const fsWin = fsResult.win * config.bet;
        totalWon += fsWin;
        if (fsWin > maxWin) maxWin = fsWin;
      }
    }
  }

  const rtp = totalWagered > 0 ? (totalWon / totalWagered) * 100 : 0;
  const hitFrequency = spinCount > 0 ? (winningSpins / spinCount) * 100 : 0;
  const bonusFrequency = spinCount > 0 ? (bonusTriggers / spinCount) * 100 : 0;

  const meanWin = spinCount > 0 ? totalWon / spinCount : 0;
  const variance = spinCount > 0 ? sumWinSquared / spinCount - meanWin * meanWin : 0;
  const volatilitySD = Math.sqrt(Math.max(0, variance));

  return {
    spins: spinCount,
    total_wagered: totalWagered,
    total_won: totalWon,
    sum_win_squared: sumWinSquared,
    winning_spins: winningSpins,
    bonus_triggers: bonusTriggers,
    max_win: maxWin,
    distribution_buckets: buckets,
    rtp,
    hit_frequency: hitFrequency,
    bonus_frequency: bonusFrequency,
    volatility_sd: volatilitySD,
    convergence,
  };
}

simulation.post("/run", async (c) => {
  const body = await c.req.json<{
    config?: SimConfig;
    spin_count?: number;
    seed?: number;
  }>();

  if (!body.config) {
    return c.json({ error: "config is required" }, 400);
  }
  if (!body.spin_count || body.spin_count <= 0) {
    return c.json({ error: "spin_count is required and must be positive" }, 400);
  }

  const spinCount = Math.min(body.spin_count, MAX_SPINS);
  const seed = body.seed ?? Math.floor(Math.random() * 2 ** 32);

  const result = runSimulation(body.config, spinCount, seed);
  return c.json(result);
});

export { simulation };
