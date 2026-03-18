import { Hono } from "hono";

const exportRoute = new Hono();

type GddAudience = "full" | "math" | "art" | "dev" | "executive";
type GddFormat = "markdown" | "json" | "pdf" | "notion" | "jira" | "confluence";

const AUDIENCE_SECTIONS: Record<GddAudience, number[]> = {
  full: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  math: [7, 8, 9],
  art: [3, 10],
  dev: [2, 5, 6, 8, 11],
  executive: [1],
};

interface WizardData {
  step1?: {
    game_type: string;
    variant: string;
    grid: { reels: number; rows: number };
    win_mechanic: string;
    paylines: number;
    bet: { min: number; max: number; default: number };
    markets: string[];
    market_constraints: Record<string, Record<string, unknown>>;
  };
  step2?: {
    target_rtp: number;
    volatility: string;
    hit_frequency: number;
    max_win: number;
    bonus_frequency: number;
    rtp_variants: number[];
  };
  step3?: {
    features: Array<{ type: string; variant: string; config: Record<string, unknown> }>;
    complexity_score: number;
    estimated_dev_weeks: number;
  };
  step4?: {
    selected_concept?: { name: string; usp: string };
    theme?: { description: string; usp_detail: string; bonus_narrative: string };
    naming?: { selected: string };
    symbols?: Array<{ id: string; name: string; role: string }>;
    art_direction?: {
      style: string;
      palette: string[];
      sound: Record<string, string>;
    };
  };
  step5?: {
    active_variant: string;
    rtp_variants: Record<string, {
      paytable: Array<{ symbol_id: string; label: string; x3: number; x4: number; x5: number }>;
      reel_strips: Record<string, Record<string, number>>;
      stops_per_reel: number;
      analytical_rtp: number;
    }>;
    rtp_budget: { base_wins: number; wild_substitution: number; free_spins: number; accumulator: number };
    target_rtp_tenths: number;
  };
  step6?: {
    rtp: number;
    hit_frequency: number;
    bonus_frequency: number;
    max_win: number;
    volatility_sd: number;
    spins: number;
    total_wagered: number;
    total_won: number;
    winning_spins: number;
    bonus_triggers: number;
    distribution_buckets: number[];
    pass: boolean;
  };
  step7?: {
    visual_mode: string;
    ui_skin: string;
    view_type: string;
    speed: string;
    demo_balance: number | string;
  };
}

interface GddSection {
  number: number;
  title: string;
  content: string;
}

function buildGddSections(data: WizardData): GddSection[] {
  const gameName = data.step4?.naming?.selected || data.step1?.variant || "Untitled Game";

  return [
    {
      number: 1,
      title: "Game Overview",
      content: data.step4?.selected_concept
        ? `**${gameName}** — ${data.step4.selected_concept.usp}\n\nType: ${data.step1?.game_type || "slot"} | Variant: ${data.step1?.variant || "—"} | Grid: ${data.step1?.grid ? `${data.step1.grid.reels}x${data.step1.grid.rows}` : "—"}`
        : "No concept selected.",
    },
    {
      number: 2,
      title: "Configuration",
      content: data.step1
        ? `Grid: ${data.step1.grid.reels}x${data.step1.grid.rows} | Win Mechanic: ${data.step1.win_mechanic} | Paylines: ${data.step1.paylines}\nBet Range: ${data.step1.bet.min}–${data.step1.bet.max} (default ${data.step1.bet.default})\nMarkets: ${data.step1.markets.join(", ").toUpperCase()}`
        : "Step 1 not completed.",
    },
    {
      number: 3,
      title: "Theme & Visual",
      content: data.step4?.theme
        ? `Theme: ${data.step4.theme.description}\nUSP: ${data.step4.theme.usp_detail}\nBonus Narrative: ${data.step4.theme.bonus_narrative}`
        : "Step 4 not completed.",
    },
    {
      number: 4,
      title: "Symbols & Paytable",
      content: (() => {
        if (!data.step4?.symbols?.length) return "Not configured.";
        const symList = data.step4.symbols.map(s => `${s.name} (${s.role})`).join(", ");
        const v = data.step5?.active_variant;
        const variant = v ? data.step5?.rtp_variants?.[v] : null;
        return `Symbols: ${symList}${variant ? `\nPaytable rows: ${variant.paytable.length} | Stops/reel: ${variant.stops_per_reel}` : ""}`;
      })(),
    },
    {
      number: 5,
      title: "Features & Mechanics",
      content: data.step3?.features?.length
        ? data.step3.features.map(f => `- ${f.variant} (${f.type})`).join("\n")
        : "No features configured.",
    },
    {
      number: 6,
      title: "Bonus Specification",
      content: (() => {
        if (!data.step3?.features?.length) return "Not configured.";
        const bonuses = data.step3.features.filter(f => f.type === "bonus");
        if (!bonuses.length) return "No bonus features.";
        return bonuses.map(b => `**${b.variant}:** ${JSON.stringify(b.config)}`).join("\n");
      })(),
    },
    {
      number: 7,
      title: "Math Model & RTP",
      content: data.step5
        ? (() => {
            const b = data.step5.rtp_budget;
            const total = (b.base_wins + b.wild_substitution + b.free_spins + b.accumulator) / 10;
            return `Target RTP: ${data.step5.target_rtp_tenths / 10}%\nBudget: Base ${b.base_wins / 10}% + Wild ${b.wild_substitution / 10}% + FS ${b.free_spins / 10}% + Acc ${b.accumulator / 10}% = ${total}%\nVariants: ${Object.keys(data.step5.rtp_variants).join(", ")}`;
          })()
        : "Step 5 not completed.",
    },
    {
      number: 8,
      title: "Reel Strips",
      content: data.step5
        ? (() => {
            const v = data.step5.active_variant;
            const variant = data.step5.rtp_variants[v];
            if (!variant) return "No active variant.";
            return `Reel count: ${Object.keys(variant.reel_strips).length} | Stops/reel: ${variant.stops_per_reel}\nAnalytical RTP: ${variant.analytical_rtp}%`;
          })()
        : "Step 5 not completed.",
    },
    {
      number: 9,
      title: "Simulation Results",
      content: data.step6
        ? `Simulated RTP: ${data.step6.rtp.toFixed(2)}% (${data.step6.pass ? "PASS" : "FAIL"})\nSpins: ${data.step6.spins.toLocaleString()} | Hit Freq: ${data.step6.hit_frequency.toFixed(1)}%\nMax Win: ${data.step6.max_win.toFixed(0)}x | Volatility SD: ${data.step6.volatility_sd.toFixed(2)}\nBonus Triggers: ${data.step6.bonus_triggers.toLocaleString()}`
        : "Simulation not run.",
    },
    {
      number: 10,
      title: "Art & Sound Spec",
      content: data.step4?.art_direction
        ? `Style: ${data.step4.art_direction.style}\nPalette: ${data.step4.art_direction.palette.join(", ")}\nSound: ${Object.entries(data.step4.art_direction.sound).map(([k, v]) => `${k}: ${v}`).join(", ")}`
        : "Step 4 not completed.",
    },
    {
      number: 11,
      title: "UI Flow",
      content: data.step7
        ? `Visual Mode: ${data.step7.visual_mode} | Skin: ${data.step7.ui_skin}\nView: ${data.step7.view_type} | Speed: ${data.step7.speed} | Balance: ${data.step7.demo_balance}`
        : "Step 7 not completed.",
    },
    {
      number: 12,
      title: "Compliance",
      content: data.step1?.markets?.length
        ? `Markets: ${data.step1.markets.map(m => m.toUpperCase()).join(", ")}\n${
            Object.entries(data.step1.market_constraints || {})
              .map(([k, v]) => `${k.toUpperCase()}: ${Object.entries(v).filter(([, val]) => val).map(([key]) => key).join(", ")}`)
              .join("\n")
          }`
        : "No markets selected.",
    },
  ];
}

function toMarkdown(gameName: string, sections: GddSection[]): string {
  let md = `# Game Design Document: ${gameName}\n\n`;
  md += `*Generated: ${new Date().toISOString().slice(0, 10)}*\n\n---\n\n`;
  for (const s of sections) {
    md += `## ${s.number}. ${s.title}\n\n${s.content}\n\n`;
  }
  return md;
}

function toJson(gameName: string, sections: GddSection[]): string {
  return JSON.stringify({
    game_name: gameName,
    generated: new Date().toISOString(),
    sections: Object.fromEntries(sections.map(s => [s.title.toLowerCase().replace(/\s+/g, "_"), { number: s.number, content: s.content }])),
  }, null, 2);
}

/** POST /api/export/gdd — Generate a GDD document */
exportRoute.post("/gdd", async (c) => {
  const body = await c.req.json<{
    wizard_data?: WizardData;
    audience?: GddAudience;
    format?: GddFormat;
  }>();

  if (!body.wizard_data) {
    return c.json({ error: "wizard_data is required" }, 400);
  }

  const audience = body.audience || "full";
  const format = body.format || "markdown";
  const allSections = buildGddSections(body.wizard_data);
  const allowedNumbers = AUDIENCE_SECTIONS[audience] || AUDIENCE_SECTIONS.full;
  const sections = allSections.filter(s => allowedNumbers.includes(s.number));
  const gameName = body.wizard_data.step4?.naming?.selected || body.wizard_data.step1?.variant || "Untitled";

  let content: string;
  if (format === "json") {
    content = toJson(gameName, sections);
  } else {
    content = toMarkdown(gameName, sections);
  }

  return c.json({ content, format, audience, sections_count: sections.length });
});

export { exportRoute };
