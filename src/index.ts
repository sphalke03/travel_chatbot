import { AGENCY } from "./agency";

interface Env {
  AI: { run(model: string, input: unknown): Promise<{ response?: string }> };
}

const MODEL = "@cf/meta/llama-3.1-8b-instruct";

const SYSTEM = `You are the friendly enquiry assistant for a travel agency.
Answer ONLY using the agency details below. If the answer is not there, say you are not sure
and ask the customer to contact the agency using the contact details. Never invent prices,
dates, policies or availability. Keep replies short (max 4 sentences). If the customer wants
to book, collect their name, phone, destination and travel dates and tell them the team will call back.

AGENCY DETAILS:
${AGENCY}`;

// Best-effort rate limit per Worker instance: 10 messages per minute per IP.
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/api/chat") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return json({ reply: "Use POST." }, 405);
    }

    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (limited(ip)) {
      return json({ reply: "Too many messages, please wait a minute." }, 429);
    }

    let body: { messages?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ reply: "Invalid request." }, 400);
    }

    const raw = Array.isArray(body.messages) ? body.messages : [];
    const history = raw
      .filter(
        (m: any) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0
      )
      .slice(-8)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 800) }));

    if (history.length === 0) {
      return json({ reply: "Please type a question." }, 400);
    }

    try {
      const out = await env.AI.run(MODEL, {
        messages: [{ role: "system", content: SYSTEM }, ...history],
        max_tokens: 300,
      });
      return json({ reply: out.response || "Sorry, I could not generate an answer." });
    } catch {
      return json({ reply: "Sorry, I'm having trouble right now. Please call us directly." }, 500);
    }
  },
};
