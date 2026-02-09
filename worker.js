/**
 * Cloudflare Worker: secure proxy for LLM feedback (OpenAI)
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = isAllowedOrigin(origin);

    // ---------- Preflight ----------
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin),
      });
    }

    // ---------- Method guard ----------
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // ---------- Origin guard ----------
    if (!allowedOrigin) {
      return new Response(
        JSON.stringify({ error: "Origin not allowed", origin }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    // ---------- Parse JSON ----------
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(allowedOrigin),
          },
        }
      );
    }

    // ---------- Extract fields ----------
    const responseText = String(body.response_text || "").trim();
    const learningObjective = String(body.learning_objective || "").trim();
    const criteria = Array.isArray(body.criteria)
      ? body.criteria.map(String)
      : [];

    // ---------- Guardrails ----------
    if (responseText.length < 10 || responseText.length > 2000) {
      return new Response(
        JSON.stringify({ error: "Response length out of range" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(allowedOrigin),
          },
        }
      );
    }

    if (!learningObjective) {
      return new Response(
        JSON.stringify({ error: "Missing learning_objective" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(allowedOrigin),
          },
        }
      );
    }

    if (!env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(allowedOrigin),
          },
        }
      );
    }

    /* ===================== STUDENT-EDITABLE PROMPTS ===================== */

    const systemPrompt =
      "You are a fair, supportive educational assessment assistant. " +
      "Grade an open-ended response ONLY using the provided learning objective and evaluation criteria. " +
      "Do not invent requirements or add new content. " +
      "Be criterion-referenced and concise. " +
      'Return ONLY valid JSON. The verdict MUST be one of: "Correct", "Not quite right", "Incorrect".';

    const userPrompt =
      `Learning objective:\n${learningObjective}\n\n` +
      `Evaluation criteria:\n${criteria
        .map((c, i) => `${i + 1}. ${c}`)
        .join("\n")}\n\n` +
      `Learner response:\n${responseText}\n\n` +
      "EVALUATION INSTRUCTIONS:\n" +
      "- Evaluate the response against the objective and EACH criterion.\n" +
      "- Provide:\n" +
      '  verdict ("Correct" | "Not quite right" | "Incorrect")\n' +
      "  summary (1–3 sentences)\n" +
      "  criteria_feedback (one item per criterion)\n" +
      "  next_step (ONE actionable improvement)\n" +
      "Return ONLY JSON.";

    // ---------- Call OpenAI ----------
    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        text: { format: { type: "json_object" } },
      }),
    });

    if (!openaiResp.ok) {
      const err = await openaiResp.text();
      return new Response(
        JSON.stringify({ error: "OpenAI error", detail: err.slice(0, 300) }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(allowedOrigin),
          },
        }
      );
    }

    const data = await openaiResp.json();

    // ---------- Extract JSON text ----------
    const jsonText =
      (typeof data.output_text === "string" && data.output_text.trim()) ||
      extractTextFromResponsesOutput(data) ||
      "";

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return new Response(
        JSON.stringify({
          error: "Model returned non-JSON",
          raw: jsonText.slice(0, 400),
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(allowedOrigin),
          },
        }
      );
    }

    // ---------- Success ----------
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(allowedOrigin),
      },
    });
  },
};

// ---------- Helpers ----------

function extractTextFromResponsesOutput(d) {
  try {
    const out = Array.isArray(d.output) ? d.output : [];
    for (const item of out) {
      const content = Array.isArray(item.content) ? item.content : [];
      for (const c of content) {
        if (c && typeof c.text === "string" && c.text.trim()) {
          return c.text.trim();
        }
      }
    }
    return "";
  } catch {
    return "";
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return null;

  // Allow Captivate preview
  if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;

  // ✅ YOUR GitHub Pages site (must be lowercase)
  if (origin === "https://tessis-rrr.github.io") return origin;

  return null;
}

function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
