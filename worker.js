/*
  Cloudflare Worker: secure proxy for LLM feedback
 
  What this Worker does:
  1) Receives a learner response from a browser-based activity (Captivate, website, LMS embed)
  2) Uses a secret API key stored in Cloudflare (not in the browser, not in GitHub)
  3) Calls the LLM provider (OpenAI here)
  4) Returns structured JSON feedback to the browser
 
  What students MUST customize in this file:
  - systemPrompt (evaluation instructions)
  - userPrompt (how you present the learning objective, criteria, and response)
  - isAllowedOrigin() (add your GitHub Pages base domain)
 
  What students should NOT customize if you don't have JavaScript knowledge:
  - CORS/preflight handling
  - request parsing
  - OpenAI API call plumbing
  - JSON extraction and parsing
*/
 
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = isAllowedOrigin(origin);
 
    // Preflight (browser permission check).
    // Do not edit this section.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin)
      });
    }
 
    // Only allow POST requests.
    // Do not edit this section.
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
 
    // Block disallowed origins.
    // Do not edit this section.
    if (!allowedOrigin) {
      return new Response(JSON.stringify({ error: "Origin not allowed", origin }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }
 
    // Parse JSON body from the browser.
    // Do not edit this section.
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }
 
    // These values come from the frontend (Captivate, website, etc.).
    // Frontend sends:
    // - response_text: what the learner wrote
    // - learning_objective: what you want them to demonstrate
    // - criteria: how you will judge quality/correctness
    const responseText = String(body.response_text || "").trim();
    const learningObjective = String(body.learning_objective || "").trim();
    const criteria = Array.isArray(body.criteria) ? body.criteria : [];
 
    // Simple guardrails.
    // Do not edit this section.
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
 
    // The API key must be stored as a Cloudflare Secret named OPENAI_API_KEY.
    // Do not edit this section.
    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }
 
    /*
      ============================
      SECTION STUDENTS MUST EDIT
      ============================
 
      Your job is to write the evaluation prompts.
 
      You must edit:
      - systemPrompt: sets the model’s role and rules
      - userPrompt: gives the model the learning objective, criteria, and learner response
 
      Important requirements:
      - Your prompt MUST instruct the model to return ONLY JSON.
      - Your prompt MUST reference the learning objective or criteria in its feedback.
      - Verdict must be exactly one of:
          "Correct"
          "Not quite right"
          "Incorrect"
 
      Do not remove these template variables, they come from the frontend:
        ${learningObjective}  (string)
        ${criteria}           (array of strings)
        ${responseText}       (string)
    */
 
    // Students edit this.
    // Keep this prompt short and specific. Write your own instructions below.
    const systemPrompt =
      "You are an educational assessment assistant evaluating open-ended student responses using a provided learning objective, evaluation criteria, and rubric. " +
      "Evaluate responses fairly, focus on conceptual accuracy and completeness, and avoid introducing new ideas or rewriting the learner’s text. " +
      "Base judgments on the rubric and criteria, and provide clear, criterion-referenced explanatory feedback with one actionable next step. " +
      "Return ONLY valid JSON (no markdown, no extra text).";
 
    // Students edit this.
    // This is where you include the values sent from the frontend.
    // You can change the wording around them, but keep the variables.
    const userPrompt =
      `Learning objective:\n${learningObjective}\n\n` +
      `Evaluation criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n` +
      `Learner response:\n${responseText}\n\n` +
      `WRITE YOUR INSTRUCTIONS HERE FOR HOW TO EVALUATE.\n` +
      `Use the rubric below to guide your evaluation and feedback.\n\n` +
      `RUBRIC (Total: 10 points)\n` +
      `1) Understanding of Social Functionalism (0–3)\n` +
      `- 3: Clearly explains social functionalism as a perspective that views education as contributing to social stability, cohesion, and the functioning of society.\n` +
      `- 2: Generally accurate understanding but lacks depth or precision.\n` +
      `- 1: Mentions functionalism but explanation is vague, superficial, or partially inaccurate.\n` +
      `- 0: Does not demonstrate an understanding of social functionalism.\n\n` +
      `2) Explanation of Educational Functions (0–3)\n` +
      `- 3: Clearly explains two or more functions of education (e.g., socialization, skill provision, social placement/sorting, manifest or latent functions) and links them to societal stability/functioning.\n` +
      `- 2: Explains one function well OR mentions two functions with limited explanation.\n` +
      `- 1: Mentions functions but explanations are unclear, incorrect, or not linked to stability/functioning.\n` +
      `- 0: Does not correctly identify any functions.\n\n` +
      `3) Coherence and Structure (0–2)\n` +
      `- 2: Well-organized (e.g., brief claim/intro → functions explained → link to stability → wrap-up); ideas flow logically.\n` +
      `- 1: Some structure, but uneven development or loose connections.\n` +
      `- 0: Lacks clear structure or logical flow.\n\n` +
      `4) Sociological Language and Clarity (0–1)\n` +
      `- 1: Uses relevant sociological terms accurately (e.g., socialization, cohesion, meritocracy, manifest/latent functions).\n` +
      `- 0: Little/no relevant terminology or terms used inaccurately.\n\n` +
      `5) Grammar and Writing Quality (0–1)\n` +
      `- 1: Grammar/spelling/sentence clarity do not impede understanding.\n` +
      `- 0: Frequent errors reduce clarity/readability.\n\n` +
      `EVALUATION INSTRUCTIONS\n` +
      `- Evaluate the learner response against the learning objective, the provided criteria list, and the rubric above.\n` +
      `- Determine a verdict based on overall quality:\n` +
      `  * Correct: Strongly meets the learning objective; typically aligns with most criteria and would score ~8–10 on the rubric.\n` +
      `  * Not quite right: Partially meets the learning objective; key elements missing/underdeveloped; typically ~5–7.\n` +
      `  * Incorrect: Does not meet the learning objective; major misconceptions or missing requirements; typically ~0–4.\n` +
      `- In the summary, explicitly reference the learning objective or at least one evaluation criterion.\n` +
      `- For criteria_feedback: for EACH provided criterion in the criteria list, output:\n` +
      `  { "criterion": "<exact criterion text>", "met": true/false, "comment": "<brief, specific explanation tied to the rubric and learner text>" }\n` +
      `- If the response fails to explain at least TWO functions of education, mark the relevant criterion as not met and state this explicitly in comments.\n` +
      `- next_step must be ONE concrete, actionable improvement that would most increase the score (e.g., “Add a second function and link it to social stability using functionalist terms”).\n\n` +
      `Your output MUST be ONLY JSON with exactly these keys:\n` +
      `- verdict (must be: Correct, Not quite right, or Incorrect)\n` +
      `- summary (1 to 3 sentences, must reference the learning objective or criteria)\n` +
      `- criteria_feedback (array of objects with: criterion, met, comment)\n` +
      `- next_step (one concrete improvement suggestion)\n`;
 
 
    // Call OpenAI Responses API (server-side).
    // Do not edit this section.
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
      return new Response(JSON.stringify({ error: "OpenAI error", detail: err.slice(0, 300) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
      });
    }
 
    const data = await openaiResp.json();
 
    // Extract JSON text from OpenAI Responses API.
    // Do not edit this section.
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
          openai_response_preview: JSON.stringify(data).slice(0, 800)
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) }
        }
      );
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
 
/*
  CUSTOMIZE THIS FUNCTION (students must do this):
 
  Add the website origin that is allowed to call your Worker from the browser.
 
  GitHub Pages origin is only the base domain:
  https://yourusername.github.io
  Do NOT include your repo name after it.
*/
function isAllowedOrigin(origin) {
  if (!origin) return null;
 
  // Optional: allow Captivate preview on localhost while testing
  if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;
 
  // Students MUST customize this line:
  if (origin === "https://github.com/Tessis-RRR") return origin;
 
  return null;
}
 
// Do not edit this function.
function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

