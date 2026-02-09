/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
  async fetch(request, env) {
    // --- CORS preflight (required for Captivate / LMS / browsers) ---
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // --- Only allow POST ---
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      // --- Read prompt from request ---
      const { prompt } = await request.json();

      if (!prompt || typeof prompt !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid prompt" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }

      // --- Call OpenAI ---
      const openaiResponse = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            input: prompt,
            max_output_tokens: 250,
            temperature: 0.2
          })
        }
      );

      const data = await openaiResponse.json();

      // --- Extract text safely ---
      let text = "";
      if (data.output && Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.content && Array.isArray(item.content)) {
            for (const part of item.content) {
              if (part.type === "output_text") {
                text += part.text;
              }
            }
          }
        }
      }

      if (!text) {
        text = "No response generated.";
      }

      // --- Return clean JSON to Captivate ---
      return new Response(JSON.stringify({ text }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });

    } catch (err) {
      // --- Error handling ---
      return new Response(
        JSON.stringify({ error: "Worker error", details: err.message }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }
  }
};
