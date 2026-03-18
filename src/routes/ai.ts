import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";

const ai = new Hono();

interface ConceptRequest {
  brief: {
    theme_input: string;
    creative_direction: string;
    audience: string[];
    mood: string[];
    references: string[];
  };
  game_type?: string;
  variant?: string;
  features?: string[];
  grid?: { reels: number; rows: number };
  volatility?: string;
  target_rtp?: number;
}

interface ConceptCard {
  name: string;
  usp: string;
  description: string;
  badge?: string;
  score?: number;
  reasoning?: string;
  market_context?: string;
}

interface ThemeIteration {
  direction: string;
  current_theme: {
    description: string;
    usp_detail: string;
    bonus_narrative: string;
  };
  game_type?: string;
  features?: string[];
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.includes("REPLACE_ME")) return null;
  return new Anthropic({ apiKey: key });
}

/** POST /api/ai/concepts — Generate 3 game concepts from a creative brief */
ai.post("/concepts", async (c) => {
  const body = await c.req.json<ConceptRequest>();
  const { brief } = body;

  if (!brief?.theme_input?.trim()) {
    return c.json({ error: "theme_input is required" }, 400);
  }

  const client = getClient();
  if (!client) {
    // Fallback: return deterministic concepts when no API key
    return c.json({
      concepts: generateFallbackConcepts(brief),
      source: "fallback",
    });
  }

  const prompt = `You are a senior iGaming game designer. Generate exactly 3 slot game concept proposals based on this creative brief.

Theme/Setting: ${brief.theme_input}
${brief.creative_direction ? `Creative Direction: ${brief.creative_direction}` : ""}
Target Audience: ${brief.audience.join(", ") || "General"}
${brief.mood?.length ? `Visual Mood: ${brief.mood.join(", ")}` : ""}
Reference Games: ${brief.references.join(", ") || "None"}
${body.game_type ? `Game Type: ${body.game_type}` : ""}
${body.variant ? `Variant: ${body.variant}` : ""}
${body.grid ? `Grid: ${body.grid.reels}x${body.grid.rows}` : ""}
${body.volatility ? `Volatility: ${body.volatility}` : ""}
${body.target_rtp ? `Target RTP: ${body.target_rtp}%` : ""}
${body.features?.length ? `Selected Features/Mechanics: ${body.features.join(", ")}` : ""}

For each concept, provide:
- name: A compelling game title (2-4 words)
- usp: One-sentence unique selling point
- description: 2-3 sentence description of the game experience
- reasoning: 2-3 sentences explaining WHY this concept works for the given mechanics, grid, and volatility. Map specific mechanics to thematic metaphors.
- market_context: One sentence on how this differentiates from existing games in the market
- badge: One of "Best market fit", "Alternative angle", or "Wildcard"
- score: Market fit score 1-10

Respond with ONLY a JSON array of 3 objects. No markdown, no explanation.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const concepts: ConceptCard[] = JSON.parse(text);

    return c.json({ concepts, source: "ai" });
  } catch (err) {
    console.error("AI concept generation failed:", err);
    return c.json({
      concepts: generateFallbackConcepts(brief),
      source: "fallback",
      error: "AI generation failed, using fallback",
    });
  }
});

/** POST /api/ai/theme-iterate — Iterate on theme with freeform direction */
ai.post("/theme-iterate", async (c) => {
  const body = await c.req.json<ThemeIteration>();
  const { direction, current_theme } = body;

  if (!direction || !current_theme) {
    return c.json({ error: "direction and current_theme are required" }, 400);
  }

  const client = getClient();
  if (!client) {
    return c.json({
      theme: {
        description: `${current_theme.description} [${direction}]`,
        usp_detail: current_theme.usp_detail,
        bonus_narrative: current_theme.bonus_narrative,
      },
      reasoning: ["Fallback mode — AI iteration unavailable. Manual edit applied."],
      source: "fallback",
    });
  }

  const prompt = `You are a senior iGaming game designer. Take this existing slot game theme and rework it based on this instruction: "${direction}".

Current theme:
- Description: ${current_theme.description}
- USP Detail: ${current_theme.usp_detail}
- Bonus Narrative: ${current_theme.bonus_narrative}
${body.game_type ? `\nGame Type: ${body.game_type}` : ""}
${body.features?.length ? `Selected Mechanics: ${body.features.join(", ")}` : ""}

Rework the theme according to the instruction. Be creative but keep core identity unless explicitly asked to change it.

Respond with ONLY a JSON object with keys:
- description: Updated theme description
- usp_detail: Updated unique selling point detail
- bonus_narrative: Updated bonus narrative
- reasoning: Array of 3-4 bullet points explaining how mechanics map to thematic elements

No markdown, no explanation outside the JSON.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 768,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(text);

    return c.json({
      theme: { description: parsed.description, usp_detail: parsed.usp_detail, bonus_narrative: parsed.bonus_narrative },
      reasoning: parsed.reasoning || [],
      source: "ai",
    });
  } catch (err) {
    console.error("AI theme iteration failed:", err);
    return c.json({
      theme: {
        description: `${current_theme.description} [${direction}]`,
        usp_detail: current_theme.usp_detail,
        bonus_narrative: current_theme.bonus_narrative,
      },
      reasoning: ["AI iteration failed — showing manual edit fallback."],
      source: "fallback",
    });
  }
});

/** POST /api/ai/review — AI review of any wizard step */
ai.post("/review", async (c) => {
  const body = await c.req.json<{
    step: number;
    step_data: Record<string, unknown>;
    context?: Record<string, unknown>;
  }>();

  const { step, step_data, context } = body;
  if (!step || !step_data) {
    return c.json({ error: "step and step_data are required" }, 400);
  }

  const stepDescriptions: Record<number, string> = {
    1: "Game Setup (game type, grid, paylines, bet range, markets)",
    2: "Volatility & Metrics (RTP, volatility, hit frequency, max win, bonus frequency)",
    3: "Feature Builder (game mechanics selection and complexity)",
    4: "AI Concept (theme, naming, symbols, art direction)",
    5: "Math Model (paytable, reel strips, RTP budget)",
    6: "Simulation Results (Monte Carlo verification)",
    7: "HTML5 Prototype (visual config, feature toggles)",
    8: "GDD Export (document sections and audience targeting)",
  };

  const client = getClient();
  if (!client) {
    return c.json({
      review: generateFallbackReview(step, step_data),
      source: "fallback",
    });
  }

  const prompt = `You are a senior iGaming game design consultant reviewing a slot game design.

Step ${step}: ${stepDescriptions[step] || "Unknown step"}

Step data:
${JSON.stringify(step_data, null, 2)}

${context ? `Context from other steps:\n${JSON.stringify(context, null, 2)}` : ""}

Provide a concise review with:
1. score: Overall quality score 1-10
2. verdict: One of "excellent", "good", "needs_work", "critical"
3. strengths: Array of 1-3 short bullet points on what's good
4. issues: Array of 0-3 short bullet points on potential problems
5. suggestions: Array of 1-3 actionable improvement suggestions

Focus on iGaming industry standards, mathematical correctness, market viability, and regulatory compliance.

Respond with ONLY a JSON object. No markdown, no explanation.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const review = JSON.parse(text);

    return c.json({ review, source: "ai" });
  } catch (err) {
    console.error("AI review failed:", err);
    return c.json({
      review: generateFallbackReview(step, step_data),
      source: "fallback",
    });
  }
});

/** POST /api/ai/names — Generate 5 game name variants */
ai.post("/names", async (c) => {
  const body = await c.req.json<{
    theme: string;
    game_type?: string;
    mood?: string[];
    concept_name?: string;
  }>();

  if (!body.theme?.trim()) {
    return c.json({ error: "theme is required" }, 400);
  }

  const client = getClient();
  if (!client) {
    return c.json({
      names: generateFallbackNames(body.theme, body.concept_name),
      source: "fallback",
    });
  }

  const prompt = `You are a senior iGaming game naming specialist. Generate exactly 5 unique game name suggestions for a ${body.game_type || "slot"} game.

Theme: ${body.theme}
${body.concept_name ? `Working title: ${body.concept_name}` : ""}
${body.mood?.length ? `Mood: ${body.mood.join(", ")}` : ""}

Requirements:
- 2-4 words each
- Easy to pronounce in English
- Memorable and marketable
- Avoid overused prefixes ("Book of", "Rise of") unless highly relevant
- Consider trademark searchability

For each name provide:
- name: The game title
- reasoning: One sentence explaining why this name works

Respond with ONLY a JSON array of 5 objects. No markdown.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const names = JSON.parse(text);
    return c.json({ names, source: "ai" });
  } catch (err) {
    console.error("AI name generation failed:", err);
    return c.json({
      names: generateFallbackNames(body.theme, body.concept_name),
      source: "fallback",
    });
  }
});

/** POST /api/ai/symbol-review — Review symbol set (simple or holistic) */
ai.post("/symbol-review", async (c) => {
  const body = await c.req.json<{
    theme: string;
    symbols: Array<{ id: string; name: string; role: string }>;
    volatility?: string;
    holistic?: boolean;
  }>();

  if (!body.symbols?.length) {
    return c.json({ error: "symbols array is required" }, 400);
  }

  const client = getClient();

  // Holistic mode — structured review
  if (body.holistic) {
    if (!client) {
      return c.json({
        review: generateFallbackHolisticReview(body.symbols, body.theme),
        source: "fallback",
      });
    }

    const prompt = `You are an iGaming design consultant performing a holistic review of a complete symbol set for a "${body.theme}" themed slot game${body.volatility ? ` with ${body.volatility} volatility` : ""}.

Symbols:
${body.symbols.map((s) => `- ${s.name} (${s.role})`).join("\n")}

Evaluate the FULL SET and respond with a JSON object:
{
  "theme_fit": { "score": 1-10, "feedback": "1-2 sentences on how well symbols fit the theme world" },
  "distinctiveness": { "score": 1-10, "feedback": "1-2 sentences on visual distinctiveness — will players confuse any two symbols?" },
  "missing_archetypes": ["array of 0-3 symbol archetypes that would strengthen the set"],
  "overall_score": 1-10,
  "suggestions": ["array of 2-4 specific, actionable suggestions"]
}

Respond with ONLY the JSON object. No markdown.`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 768,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const review = JSON.parse(text);
      return c.json({ review, source: "ai" });
    } catch (err) {
      console.error("AI holistic symbol review failed:", err);
      return c.json({
        review: generateFallbackHolisticReview(body.symbols, body.theme),
        source: "fallback",
      });
    }
  }

  // Legacy simple mode
  if (!client) {
    return c.json({
      review: generateFallbackSymbolReview(body.symbols, body.theme),
      source: "fallback",
    });
  }

  const prompt = `You are an iGaming design consultant reviewing a symbol set for a ${body.theme} themed slot game.

Symbols:
${body.symbols.map((s) => `- ${s.name} (${s.role})`).join("\n")}

Review for:
1. Thematic consistency — do all symbols fit the theme?
2. Cultural sensitivity — any symbols that could offend in specific markets?
3. Visual hierarchy — are high-pay symbols clearly more impressive than low-pay?
4. Completeness — any obvious symbols missing for this theme?

Provide:
- score: 1-10 overall thematic fit
- feedback: Array of 3-5 short bullet points (mix of praise and suggestions)

Respond with ONLY a JSON object. No markdown.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const review = JSON.parse(text);
    return c.json({ review, source: "ai" });
  } catch (err) {
    console.error("AI symbol review failed:", err);
    return c.json({
      review: generateFallbackSymbolReview(body.symbols, body.theme),
      source: "fallback",
    });
  }
});

/** POST /api/ai/saturation-check — Check market saturation for a theme */
ai.post("/saturation-check", async (c) => {
  const body = await c.req.json<{ theme_keywords: string }>();
  if (!body.theme_keywords?.trim()) {
    return c.json({ error: "theme_keywords is required" }, 400);
  }

  const client = getClient();
  if (!client) {
    return c.json({
      saturation: {
        theme_label: body.theme_keywords,
        game_count: 0,
        saturation_pct: 0,
        top_competitors: [],
        hints: ["Market data unavailable — AI key not configured. Proceed with your creative vision."],
      },
      source: "fallback",
    });
  }

  const prompt = `You are an iGaming market analyst. Analyze the market saturation for this slot game theme: "${body.theme_keywords}".

Based on your knowledge of the iGaming industry, estimate:
1. How many existing slot games use this theme or a very similar theme?
2. What is the approximate saturation level (0-100%)?
3. Name the top 3 most notable competing games with this theme and their providers
4. Provide 2-3 hints for how a new game could differentiate itself in this space

Respond with ONLY a JSON object:
{
  "theme_label": "Cleaned/refined theme label",
  "game_count": estimated number,
  "saturation_pct": 0-100,
  "top_competitors": [{"name": "Game Name", "provider": "Provider"}],
  "hints": ["differentiation hint 1", "hint 2", "hint 3"]
}

No markdown.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const saturation = JSON.parse(text);
    return c.json({ saturation, source: "ai" });
  } catch (err) {
    console.error("AI saturation check failed:", err);
    return c.json({
      saturation: {
        theme_label: body.theme_keywords,
        game_count: 0,
        saturation_pct: 0,
        top_competitors: [],
        hints: ["Unable to check market saturation — proceed with your vision."],
      },
      source: "fallback",
    });
  }
});

/** POST /api/ai/generate-sound-direction — Generate sound descriptions from theme */
ai.post("/generate-sound-direction", async (c) => {
  const body = await c.req.json<{ theme: string; art_style: string; palette: string[] }>();
  if (!body.theme?.trim()) {
    return c.json({ error: "theme is required" }, 400);
  }

  const fallbackSounds = {
    ambient: "Atmospheric background matching the game theme",
    spin: "Smooth reel spin with satisfying mechanical feel",
    win: "Celebratory chime that scales with win size",
    bonus_trigger: "Dramatic buildup with triumphant reveal",
    cascade: "Cascading tones descending in pitch",
    max_win: "Epic orchestral crescendo with fanfare",
  };

  const client = getClient();
  if (!client) {
    return c.json({ sounds: fallbackSounds, source: "fallback" });
  }

  const prompt = `You are an iGaming sound designer. Create detailed sound direction descriptions for a "${body.theme}" themed slot game.

Art Style: ${body.art_style || "Not specified"}
Color Palette: ${body.palette?.join(", ") || "Not specified"}

For each of these 6 sound events, write a specific 1-2 sentence description of what the sound should feel like, including instruments, tone, and emotional quality. Tailor every description to the specific theme — NO generic descriptions.

Respond with ONLY a JSON object:
{
  "ambient": "description",
  "spin": "description",
  "win": "description",
  "bonus_trigger": "description",
  "cascade": "description",
  "max_win": "description"
}

No markdown.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const sounds = JSON.parse(text);
    return c.json({ sounds, source: "ai" });
  } catch (err) {
    console.error("AI sound generation failed:", err);
    return c.json({ sounds: fallbackSounds, source: "fallback" });
  }
});

/** Deterministic fallback for holistic symbol review */
function generateFallbackHolisticReview(
  symbols: Array<{ id: string; name: string; role: string }>,
  theme?: string
) {
  const hasWild = symbols.some((s) => s.role === "wild");
  const hasScatter = symbols.some((s) => s.role === "scatter");
  const highPay = symbols.filter((s) => s.role === "high_pay");
  const lowPay = symbols.filter((s) => s.role === "low_pay");

  const themeFit = hasWild && hasScatter ? 7 : 5;
  const distinctScore = symbols.length >= 8 ? 7 : 5;
  const missing: string[] = [];
  if (!hasWild) missing.push("Wild symbol");
  if (!hasScatter) missing.push("Scatter/Bonus symbol");
  if (highPay.length < 3) missing.push("Additional high-pay symbol for depth");

  return {
    theme_fit: { score: themeFit, feedback: theme ? `Symbol set for "${theme}" theme — verify all names fit the world.` : "Theme fit check requires a theme." },
    distinctiveness: { score: distinctScore, feedback: `${symbols.length} symbols — ${symbols.length >= 10 ? "good variety" : "consider adding more for visual diversity"}.` },
    missing_archetypes: missing,
    overall_score: Math.round((themeFit + distinctScore) / 2),
    suggestions: [
      "Ensure high-pay symbols are visually distinct from low-pay",
      "Verify symbol names resonate across target markets",
      ...(highPay.length < 4 ? ["Add another high-pay symbol for paytable depth"] : []),
    ],
  };
}

/** Deterministic fallback name generation */
function generateFallbackNames(theme: string, conceptName?: string) {
  const base = conceptName || theme;
  const words = base.split(/\s+/);
  const core = words[0];
  return [
    { name: `${core} Legends`, reasoning: "Classic suffix that evokes epic narratives" },
    { name: `${base} Rising`, reasoning: "Implies progression and building excitement" },
    { name: `${core} Fortune`, reasoning: "Clear win-potential messaging" },
    { name: `${base} Quest`, reasoning: "Adventure-driven narrative hook" },
    { name: `${core} Blaze`, reasoning: "Energy and intensity for high-volatility appeal" },
  ];
}

/** Deterministic fallback symbol review */
function generateFallbackSymbolReview(
  symbols: Array<{ id: string; name: string; role: string }>,
  theme?: string
) {
  const hasWild = symbols.some((s) => s.role === "wild");
  const hasScatter = symbols.some((s) => s.role === "scatter");
  const highPay = symbols.filter((s) => s.role === "high_pay");
  const lowPay = symbols.filter((s) => s.role === "low_pay");

  const feedback: string[] = [];
  if (hasWild && hasScatter) feedback.push("Wild and scatter symbols present — good foundation");
  if (!hasWild) feedback.push("Missing wild symbol — consider adding one");
  if (!hasScatter) feedback.push("Missing scatter symbol — needed for bonus triggers");
  if (highPay.length >= 3) feedback.push(`${highPay.length} high-pay symbols provide good pay table depth`);
  if (lowPay.length < 4) feedback.push("Consider adding more low-pay symbols for balanced distribution");
  if (theme) feedback.push(`Verify all symbol names align with "${theme}" theme for consistency`);

  const score = Math.min(10, 5 + (hasWild ? 1 : 0) + (hasScatter ? 1 : 0) + Math.min(highPay.length, 2) + Math.min(lowPay.length, 2));

  return { score, feedback };
}

/** Deterministic fallback review when no API key */
function generateFallbackReview(
  step: number,
  stepData: Record<string, unknown>
): {
  score: number;
  verdict: string;
  strengths: string[];
  issues: string[];
  suggestions: string[];
} {
  const dataKeys = Object.keys(stepData);
  const completeness = dataKeys.length;

  // Basic heuristic scoring based on data completeness
  const score = Math.min(10, Math.max(4, Math.round(completeness * 1.5)));
  const verdict =
    score >= 8 ? "good" : score >= 6 ? "needs_work" : "critical";

  const stepHints: Record<number, { strengths: string[]; suggestions: string[] }> = {
    1: {
      strengths: ["Game type and grid configuration defined", "Market selection specified"],
      suggestions: ["Consider adding more target markets for wider reach", "Review bet range against market regulations"],
    },
    2: {
      strengths: ["RTP and volatility targets set", "Hit frequency defined"],
      suggestions: ["Verify hit frequency aligns with volatility tier", "Consider adding more RTP variants for market flexibility"],
    },
    3: {
      strengths: ["Game mechanics selected", "Complexity score calculated"],
      suggestions: ["Ensure feature count aligns with development timeline", "Consider market restrictions on bonus buy features"],
    },
    4: {
      strengths: ["Theme and concept defined", "Symbol set configured"],
      suggestions: ["Ensure symbol names are culturally appropriate for all target markets", "Consider localization needs for game name"],
    },
    5: {
      strengths: ["Paytable and reel strips configured", "RTP budget allocated"],
      suggestions: ["Verify reel strip weights sum to stops_per_reel", "Check that RTP budget segments meet minimum thresholds"],
    },
    6: {
      strengths: ["Simulation completed with results", "Pass/fail determined"],
      suggestions: ["Run additional simulations with different seeds for confidence", "Verify hit frequency matches Step 2 target"],
    },
    7: {
      strengths: ["Prototype configuration set", "Feature toggles configured"],
      suggestions: ["Test with both stakeholder and designer views", "Consider enabling RTP debug for internal review"],
    },
    8: {
      strengths: ["GDD sections generated", "Audience targeting configured"],
      suggestions: ["Review sections for completeness before export", "Consider generating multiple audience variants"],
    },
  };

  const hints = stepHints[step] ?? {
    strengths: ["Step data provided"],
    suggestions: ["Review data for completeness"],
  };

  return {
    score,
    verdict,
    strengths: hints.strengths,
    issues: [],
    suggestions: hints.suggestions,
  };
}

/** Deterministic fallback when no API key */
function generateFallbackConcepts(
  brief: ConceptRequest["brief"]
): ConceptCard[] {
  const theme = brief.theme_input || "Mystical Adventure";
  return [
    {
      name: `${theme} Rising`,
      usp: "Progressive intensity mechanic tied to cascade depth",
      description: `Explore the world of ${theme.toLowerCase()} with escalating multipliers. Each cascade deepens the experience with growing rewards.`,
      reasoning: "Rising intensity matches cascade mechanics naturally — each collapse deepens the thematic immersion. Works well across volatility tiers.",
      market_context: "Differentiates with cascade-driven narrative progression, a less-explored combination in this theme space.",
      badge: "Best market fit",
      score: 8,
    },
    {
      name: `${theme} Legends`,
      usp: "Multi-level bonus with narrative progression",
      description: `A story-driven experience through ${theme.toLowerCase()} mythology. Players unlock chapters as they trigger bonus rounds.`,
      reasoning: "Narrative depth appeals to engagement-focused audiences. Multi-level bonus provides extended session variety.",
      market_context: "Story-driven slots are underrepresented in this theme — room for differentiation.",
      badge: "Alternative angle",
      score: 7,
    },
    {
      name: `${theme} Storm`,
      usp: "Chaotic wild system with unpredictable payouts",
      description: `High-volatility chaos meets ${theme.toLowerCase()} aesthetics. Random wild patterns create explosive win potential.`,
      reasoning: "Chaotic wild patterns create visual excitement and high-variance payouts. Appeals to thrill-seeking players.",
      market_context: "Random wild mechanics are popular but rarely paired with this specific theme.",
      badge: "Wildcard",
      score: 6,
    },
  ];
}

/** POST /api/ai/marketing-copy — Generate marketing copy for a game */
ai.post("/marketing-copy", async (c) => {
  const body = await c.req.json<{
    game_name: string;
    game_type: string;
    theme_description?: string;
    features?: string[];
    rtp?: number;
    volatility?: string;
    max_win?: number;
    grid?: { reels: number; rows: number };
  }>();

  if (!body.game_name?.trim()) {
    return c.json({ error: "game_name is required" }, 400);
  }

  const { game_name, game_type, theme_description, features, rtp, volatility, max_win, grid } = body;

  const client = getClient();
  if (!client) {
    return c.json({
      short_description: `${game_name} — an exciting ${game_type} experience with ${volatility} volatility and up to ${max_win}x max win.`,
      long_description: `Discover ${game_name}, a thrilling ${game_type} featuring ${features?.join(', ') || 'exciting mechanics'}. With ${rtp}% RTP and ${volatility} volatility, this game delivers an engaging player experience with massive win potential up to ${max_win}x.`,
      selling_points: [
        `Up to ${max_win}x max win potential`,
        `${volatility} volatility for exciting gameplay`,
        `${rtp}% RTP — competitive player returns`,
        `${features?.length || 0} unique features and mechanics`,
      ],
      source: "fallback",
    });
  }

  const prompt = `You are an iGaming marketing copywriter. Generate compelling marketing copy for a new casino game.

Game Name: ${game_name}
Game Type: ${game_type || "slot"}
${theme_description ? `Theme: ${theme_description}` : ""}
${features?.length ? `Features: ${features.join(", ")}` : ""}
${rtp ? `RTP: ${rtp}%` : ""}
${volatility ? `Volatility: ${volatility}` : ""}
${max_win ? `Max Win: ${max_win}x` : ""}
${grid ? `Grid: ${grid.reels}x${grid.rows}` : ""}

Generate:
- short_description: A punchy 1-2 sentence hook for marketing materials
- long_description: A detailed paragraph (3-5 sentences) describing the game experience, features, and appeal
- selling_points: An array of 4-6 bullet-point selling points for operator pitches

Write in professional iGaming marketing language. Highlight unique mechanics, win potential, and player experience.

Respond with ONLY a JSON object with keys: short_description, long_description, selling_points. No markdown.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const result = JSON.parse(text);

    return c.json({ ...result, source: "ai" });
  } catch (err) {
    console.error("AI marketing copy generation failed:", err);
    return c.json({
      short_description: `${game_name} — an exciting ${game_type} experience with ${volatility} volatility and up to ${max_win}x max win.`,
      long_description: `Discover ${game_name}, a thrilling ${game_type} featuring ${features?.join(', ') || 'exciting mechanics'}. With ${rtp}% RTP and ${volatility} volatility, this game delivers an engaging player experience with massive win potential up to ${max_win}x.`,
      selling_points: [
        `Up to ${max_win}x max win potential`,
        `${volatility} volatility for exciting gameplay`,
        `${rtp}% RTP — competitive player returns`,
        `${features?.length || 0} unique features and mechanics`,
      ],
      source: "fallback",
      error: "AI generation failed, using fallback",
    });
  }
});

/** POST /api/ai/press-release — Generate a press release for a game launch */
ai.post("/press-release", async (c) => {
  const body = await c.req.json<{
    game_name: string;
    game_type: string;
    theme_description?: string;
    features?: string[];
    rtp?: number;
    volatility?: string;
    max_win?: number;
    selling_points?: string[];
  }>();

  if (!body.game_name?.trim()) {
    return c.json({ error: "game_name is required" }, 400);
  }

  const { game_name, game_type, theme_description, features, rtp, volatility, max_win, selling_points } = body;

  const client = getClient();
  if (!client) {
    const featureList = features?.length ? features.join(", ") : "innovative mechanics";
    return c.json({
      press_release: `FOR IMMEDIATE RELEASE

NEW GAME LAUNCH: ${game_name}

[City, Date] — [Studio Name] today announced the launch of ${game_name}, a new ${game_type || "slot"} game ${theme_description ? `set in ${theme_description}` : "with an exciting theme"}.

${game_name} features ${featureList}, offering players ${volatility ? `${volatility} volatility gameplay` : "an engaging experience"} with ${max_win ? `up to ${max_win}x max win potential` : "significant win potential"}. ${rtp ? `The game delivers a competitive ${rtp}% RTP.` : ""}

${selling_points?.length ? `Key highlights include: ${selling_points.join("; ")}.` : ""}

${game_name} is available now across desktop and mobile platforms, fully certified for regulated markets.

###

About [Studio Name]
[Studio Name] is a leading iGaming content provider delivering innovative casino games to operators worldwide.

Media Contact:
[Name] | [Email] | [Phone]`,
      source: "fallback",
    });
  }

  const prompt = `You are an iGaming PR specialist. Write a professional press release announcing the launch of a new casino game.

Game Name: ${game_name}
Game Type: ${game_type || "slot"}
${theme_description ? `Theme: ${theme_description}` : ""}
${features?.length ? `Features: ${features.join(", ")}` : ""}
${rtp ? `RTP: ${rtp}%` : ""}
${volatility ? `Volatility: ${volatility}` : ""}
${max_win ? `Max Win: ${max_win}x` : ""}
${selling_points?.length ? `Key Selling Points: ${selling_points.join("; ")}` : ""}

Write a complete press release with:
- A compelling headline
- Dateline placeholder ([City, Date])
- 3-4 paragraphs covering the game's features, appeal, and availability
- A boilerplate "About [Studio Name]" section with placeholders
- Media contact placeholders

Use professional iGaming industry tone. Highlight what makes this game unique.

Respond with ONLY a JSON object with key: press_release (string). No markdown wrapping.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1536,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const result = JSON.parse(text);

    return c.json({ ...result, source: "ai" });
  } catch (err) {
    console.error("AI press release generation failed:", err);
    const featureList = features?.length ? features.join(", ") : "innovative mechanics";
    return c.json({
      press_release: `FOR IMMEDIATE RELEASE\n\nNEW GAME LAUNCH: ${game_name}\n\n[City, Date] — [Studio Name] today announced the launch of ${game_name}, a new ${game_type || "slot"} game. Featuring ${featureList}${max_win ? ` with up to ${max_win}x max win potential` : ""}.\n\n###\n\nAbout [Studio Name]\n[Studio Name] is a leading iGaming content provider.\n\nMedia Contact: [Name] | [Email]`,
      source: "fallback",
      error: "AI generation failed, using fallback",
    });
  }
});

/** POST /api/ai/social-copy — Generate social media copy + SEO metadata */
ai.post("/social-copy", async (c) => {
  const body = await c.req.json<{
    game_name: string;
    game_type: string;
    theme_description?: string;
    features?: string[];
    rtp?: number;
    volatility?: string;
    max_win?: number;
  }>();

  if (!body.game_name?.trim()) {
    return c.json({ error: "game_name is required" }, 400);
  }

  const { game_name, game_type, theme_description, features, rtp, volatility, max_win } = body;

  const client = getClient();
  if (!client) {
    return c.json({
      twitter: `🎰 Introducing ${game_name}! A ${volatility || "thrilling"} ${game_type || "slot"} experience${max_win ? ` with up to ${max_win}x max win` : ""}. Play now!`,
      linkedin: `We're excited to announce ${game_name}, our latest ${game_type || "slot"} game${theme_description ? ` featuring ${theme_description}` : ""}. ${features?.length ? `With ${features.length} unique mechanics including ${features.slice(0, 2).join(" and ")}` : "Packed with innovative features"}, ${game_name} delivers ${volatility ? `${volatility} volatility gameplay` : "an engaging player experience"}${rtp ? ` at ${rtp}% RTP` : ""}. Available now for operator integration.`,
      instagram: `✨ ${game_name} is HERE! ✨\n\n${theme_description ? `Step into ${theme_description}` : `Experience the thrill of ${game_name}`}${max_win ? ` with ${max_win}x max win potential` : ""}. ${volatility ? `${volatility} volatility` : "Pure excitement"} awaits! 🎰🔥`,
      hashtags: [
        `#${game_name.replace(/\s+/g, "")}`,
        "#iGaming",
        "#NewSlot",
        "#CasinoGames",
        "#OnlineSlots",
        `#${(game_type || "slot").replace(/\s+/g, "")}`,
      ],
      seo: {
        title: `${game_name} — ${game_type || "Slot"} Game | ${volatility || "Exciting"} Volatility`,
        meta_description: `Play ${game_name}, a ${volatility || "thrilling"} ${game_type || "slot"} game${features?.length ? ` featuring ${features.slice(0, 3).join(", ")}` : ""}. ${rtp ? `${rtp}% RTP` : "Competitive returns"}${max_win ? `, up to ${max_win}x max win` : ""}.`,
        keywords: [
          game_name.toLowerCase(),
          game_type?.toLowerCase() || "slot",
          "online casino",
          "new slot game",
          ...(features?.slice(0, 3).map((f) => f.toLowerCase()) || []),
          volatility?.toLowerCase() || "slot game",
        ],
      },
      source: "fallback",
    });
  }

  const prompt = `You are an iGaming social media and SEO specialist. Generate social media copy and SEO metadata for a new casino game.

Game Name: ${game_name}
Game Type: ${game_type || "slot"}
${theme_description ? `Theme: ${theme_description}` : ""}
${features?.length ? `Features: ${features.join(", ")}` : ""}
${rtp ? `RTP: ${rtp}%` : ""}
${volatility ? `Volatility: ${volatility}` : ""}
${max_win ? `Max Win: ${max_win}x` : ""}

Generate:
- twitter: A short, punchy tweet (max 280 chars) with 1-2 emojis announcing the game
- linkedin: A professional LinkedIn post (2-3 sentences) highlighting the game's business value for operators
- instagram: An engaging Instagram caption with emojis, line breaks, and a call to action
- hashtags: Array of 5-8 relevant hashtags (include game name, iGaming industry tags)
- seo: Object with:
  - title: SEO-optimized page title (50-60 chars)
  - meta_description: Meta description (150-160 chars)
  - keywords: Array of 6-10 relevant keywords

Tailor all copy to the iGaming B2B audience (operators, affiliates) while also appealing to players.

Respond with ONLY a JSON object with keys: twitter, linkedin, instagram, hashtags, seo. No markdown.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const result = JSON.parse(text);

    return c.json({ ...result, source: "ai" });
  } catch (err) {
    console.error("AI social copy generation failed:", err);
    return c.json({
      twitter: `🎰 Introducing ${game_name}! A ${volatility || "thrilling"} ${game_type || "slot"} experience${max_win ? ` with up to ${max_win}x max win` : ""}. Play now!`,
      linkedin: `We're excited to announce ${game_name}, our latest ${game_type || "slot"} game. Available now for operator integration.`,
      instagram: `✨ ${game_name} is HERE! ✨\n\n${max_win ? `${max_win}x max win potential` : "Pure excitement"} awaits! 🎰🔥`,
      hashtags: [`#${game_name.replace(/\s+/g, "")}`, "#iGaming", "#NewSlot", "#CasinoGames"],
      seo: {
        title: `${game_name} — ${game_type || "Slot"} Game`,
        meta_description: `Play ${game_name}, a ${volatility || "thrilling"} ${game_type || "slot"} game.`,
        keywords: [game_name.toLowerCase(), "online casino", "slot game"],
      },
      source: "fallback",
      error: "AI generation failed, using fallback",
    });
  }
});

export { ai };
