export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = isAllowedOrigin(origin);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin)
      });
    }

    // Helpful GET message so you can verify deployment in a browser
    if (request.method === "GET") {
      return new Response(
        "Worker is deployed. Send POST JSON to this endpoint from Captivate.",
        { status: 200 }
      );
    }

    // Only allow POST
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Block disallowed origins (for browser calls)
    if (!allowedOrigin) {
      return new Response(JSON.stringify({ error: "Origin not allowed", origin }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Parse JSON body
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    const responseText = String(body.response_text || "").trim();
    const learningObjective = String(body.learning_objective || "").trim();
    const criteria = Array.isArray(body.criteria) ? body.criteria : [];

    if (responseText.length < 10 || responseText.length > 2000) {
      return new Response(JSON.stringify({ error: "Response length out of range" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    if (!learningObjective) {
      return new Response(JSON.stringify({ error: "Missing learning_objective" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    const systemPrompt =
      "You are an educational assessment assistant evaluating open-ended student responses using a provided learning objective, evaluation criteria, and rubric. " +
      "Evaluate fairly based only on the criteria/rubric. Provide criterion-referenced feedback and one actionable next step. " +
      "Return ONLY valid JSON (no markdown, no extra text).";

    const userPrompt =
      `Learning objective:\n${learningObjective}\n\n` +
      `Evaluation criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n` +
      `Learner response:\n${responseText}\n\n` +
      `Use the rubric below to guide your evaluation and feedback.\n\n` +
      `RUBRIC (Total: 10 points)\n` +
      `1) Understanding of Social Functionalism (0–3)\n` +
      `- 3: Clearly explains social functionalism as a perspective that views education as contributing to social stability, cohesion, and the functioning of society.\n` +
      `- 2: Generally accurate understanding but lacks depth or precision.\n` +
      `- 1: Mentions functionalism but explanation is vague, superficial, or partially inaccurate.\n` +
      `- 0: Does not demonstrate an understanding of social functionalism.\n\n` +
      `2) Explanation of Educational Functions (0–3)\n` +
      `- 3: Clearly explains two or more functions of education and links them to societal stability/functioning.\n` +
      `- 2: Explains one function well OR mentions two functions with limited explanation.\n` +
      `- 1: Mentions functions but unclear/incorrect/not linked.\n` +
      `- 0: No correct functions.\n\n` +
      `3) Coherence and Structure (0–2)\n` +
      `- 2: Well-organized and logical.\n` +
      `- 1: Some structure but uneven.\n` +
      `- 0: No clear structure.\n\n` +
      `4) Sociological Language (0–1)\n` +
      `- 1: Uses terms accurately.\n` +
      `- 0: Not accurate.\n\n` +
      `5) Grammar and Writing Quality (0–1)\n` +
      `- 1: Clear writing.\n` +
      `- 0: Errors reduce clarity.\n\n` +
      `INSTRUCTIONS:\n` +
      `- Decide verdict: Correct (~8–10), Not quite right (~5–7), Incorrect (~0–4).\n` +
      `- summary must reference the learning objective or criteria.\n` +
      `- criteria_feedback must include EVERY criterion from the criteria list, using the exact criterion text.\n` +
      `- next_step: ONE concrete improvement.\n\n` +
      `Return ONLY JSON with exactly these keys: verdict, summary, criteria_feedback, next_step.`;

    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        text: { format: { type: "json_object" } }
      })
    });

    if (!openaiResp.ok) {
      const err = await openaiResp.text();
      return new Response(JSON.stringify({ error: "OpenAI error", detail: err.slice(0, 400) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    const data = await openaiResp.json();

    const jsonText =
      (typeof data.output_text === "string" && data.output_text.trim()) ||
      extractTextFromResponsesOutput(data) ||
      "";

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return new Response(JSON.stringify({ error: "Model returned non-JSON", raw: jsonText.slice(0, 400) }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
    });

    function extractTextFromResponsesOutput(d) {
      try {
        const out = Array.isArray(d.output) ? d.output : [];
        for (const item of out) {
          const content = Array.isArray(item.content) ? item.content : [];
          for (const c of content) {
            if (c && typeof c.text === "string" && c.text.trim()) return c.text.trim();
          }
        }
        return "";
      } catch {
        return "";
      }
    }
  }
};

function isAllowedOrigin(origin) {
  // Captivate preview sometimes sends no Origin or "null" depending on how preview opens.
  if (!origin || origin === "null") return "*";

  // Allow local preview
  if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;

  // ✅ REPLACE THIS with your GitHub Pages origin if you publish there:
  // Example: https://shiyuzh2-afk.github.io
  if (origin === "https://YOUR_USERNAME.github.io") return origin;

  return null;
}

function corsHeaders(origin) {
  // If we allowed "*" (null/no-origin preview), return wildcard CORS
  if (origin === "*") {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
  }

  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

