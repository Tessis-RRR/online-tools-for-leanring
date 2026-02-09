/**
 * Cloudflare Worker: secure proxy for LLM feedback (OpenAI)
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = isAllowedOrigin(origin);

    // Preflight (browser permission check). Do not edit.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    }

    // Only allow POST requests. Do not edit.
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Block disallowed origins. Do not edit.
    if (!allowedOrigin) {
      return new Response(JSON.stringify({ error: "Origin not allowed", origin }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse JSON body from the browser. Do not edit.
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
      });
    }

    // Values from frontend
    const responseText = String(body.response_text || "").trim();
    const learningObjective = String(body.learning_objective || "").trim();
    const criteria = Array.isArray(body.criteria) ? body.criteria.map(String) : [];

    // Guardrails. Do not edit.
    if (responseText.length < 10 || responseText.length > 2000) {
      return new Response(JSON.stringify({ error: "Response length out of range" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
      });
    }
    if (!learningObjective) {
      return new Response(JSON.stringify({ error: "Missing learning_objective" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
      });
    }

    // Secret must exist. Do not edit.
    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
      });
    }

    /* ============================ SECTION STUDENTS MUST EDIT ============================ */

// Keep this prompt short and specific. Write your own instructions below.
const systemPrompt =
  "You are a fair, supportive educational assessment assistant. " +
  "Grade an open-ended response ONLY using the provided learning objective and evaluation criteria. " +
  "Do not invent requirements, do not add new content to the learner’s response, and do not reference any policies. " +
  "Be criterion-referenced: explain what is correct/incorrect based on the objective/criteria. " +
  'Return ONLY valid JSON (no markdown, no extra text). The "verdict" MUST be exactly one of: "Correct", "Not quite right", "Incorrect".';

// Students edit this.
// This is where you include the values sent from the frontend.
// You can change the wording around them, but keep the variables.
const userPrompt =
  `Learning objective:\n${learningObjective}\n\n` +
  `Evaluation criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n` +
  `Learner response:\n${responseText}\n\n` +
  "EVALUATION INSTRUCTIONS:\n" +
  "- Evaluate the learner response against the learning objective and each evaluation criterion.\n" +
  "- Decide a verdict:\n" +
  '  * "Correct" = meets the learning objective and most/all criteria with no major errors.\n' +
  '  * "Not quite right" = partially meets the objective; missing one or more important parts or has minor errors.\n' +
  '  * "Incorrect" = does not meet the objective; major misunderstandings or missing key requirements.\n' +
  "- In your summary (1–3 sentences), explicitly reference the learning objective or at least one criterion.\n" +
  "- For criteria_feedback: for EACH criterion in the criteria list, output an object:\n" +
  '  { "criterion": "<exact criterion text>", "met": true/false, "comment": "<brief, specific explanation tied to the learner response>" }\n' +
  "- next_step must be ONE concrete, actionable improvement that would most improve the response.\n\n" +
  "OUTPUT FORMAT (return ONLY JSON, exactly these keys):\n" +
  "- verdict\n" +
  "- summary\n" +
  "- criteria_feedback\n" +
  "- next_step\n";


    // Call OpenAI Responses API (server-side). Do not edit.
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
      return new Response(JSON.stringify({ error: "OpenAI error", detail: err.slice(0, 300) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
      });
    }

    const data = await openaiResp.json();

    // Extract JSON text from OpenAI Responses API. Do not edit.
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
          openai_response_preview: JSON.stringify(data).slice(0, 800),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
        }
      );
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
    });
  },
};

// Do not edit this helper.
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

/**
 * CUSTOMIZE THIS FUNCTION (students must do this):
 * GitHub Pages origin is only the base domain:
 *   https://yourusername.github.io
 * NOT your GitHub profile URL (https://github.com/yourusername)
 */
function isAllowedOrigin(origin) {
  if (!origin) return null;

  // Optional: allow Captivate preview on localhost while testing
  if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;

  // Replace with YOUR GitHub Pages base domain:
  // Example: if (origin === "https://tessis-rrr.github.io") return origin;
  if (origin === "https://Tessis-RRR.github.io") return origin;

  return null;
}

// Do not edit this function.
function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
