import { complete, streamChat, llmConfigured, LlmError, type ChatMsg } from "@/lib/llm";
import { searchApprovedJournals, type Article } from "@/lib/pubmed";
import { ROUTER_PROMPT, answerSystemPrompt, directSystemPrompt } from "@/lib/prompts";
import { checkLimits } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGES = 20;
const MAX_CHARS_PER_MESSAGE = 1500;
const MAX_ASSISTANT_CHARS = 6000; // earlier bot answers can be long; they are shortened, not rejected
const HISTORY_FOR_ANSWER = 8;
const HISTORY_ASSISTANT_CHARS = 1200;

const NO_SOURCE_TEXT =
  "I do not have a peer-reviewed source for that, so I would rather not guess. A board-certified plastic surgeon can answer this for you. Is there something else about plastic surgery I can look up?";
const COST_POINTER =
  " For cost information, the American Society of Plastic Surgeons (plasticsurgery.org) and FAIR Health (fairhealthconsumer.org) publish price data. A surgeon fee is not the total cost, and prices vary by surgeon and location, so ask for a written quote.";
const OUTAGE_TEXT = "I could not reach the medical journal database just now. Please try again in a moment.";
const DEFAULT_FOLLOWUPS =
  "FOLLOWUPS: What is liposuction? | What are the risks of a tummy tuck? | How long is recovery after a rhinoplasty?";

type ChatMessage = { role: "user" | "assistant"; content: string };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function validate(input: unknown): ChatMessage[] | null {
  if (!input || typeof input !== "object") return null;
  const msgs = (input as { messages?: unknown }).messages;
  if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > MAX_MESSAGES) return null;
  const out: ChatMessage[] = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const trimmed = content.trim();
    if (!trimmed) return null;
    if (role === "user") {
      if (trimmed.length > MAX_CHARS_PER_MESSAGE) return null;
      out.push({ role, content: trimmed });
    } else {
      out.push({ role, content: trimmed.slice(0, MAX_ASSISTANT_CHARS) });
    }
  }
  if (out[out.length - 1].role !== "user") return null;
  return out;
}

// Ask the model whether to search and what to search for. Falls back to searching the raw question.
async function route(messages: ChatMessage[]): Promise<{ search: boolean; query: string }> {
  const recent = messages.slice(-6);
  const transcript = recent.map((m) => `${m.role === "user" ? "Patient" : "Assistant"}: ${m.content.slice(0, 500)}`).join("\n");
  const last = messages[messages.length - 1].content;
  try {
    const raw = await complete(
      [
        { role: "system", content: ROUTER_PROMPT },
        { role: "user", content: transcript },
      ],
      600
    );
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.route === "direct") return { search: false, query: "" };
      if (parsed.route === "search" && typeof parsed.query === "string" && parsed.query.trim()) {
        return { search: true, query: parsed.query };
      }
    }
  } catch (err) {
    if (err instanceof LlmError && [401, 403, 429, 529].includes(err.status)) throw err;
  }
  return { search: true, query: last.slice(0, 120) };
}

function friendlyLlmError(err: unknown): string {
  if (err instanceof LlmError) {
    if (err.status === 429 || err.status === 529) return "The AI service is busy right now. Please wait a minute and try again.";
    if (err.status === 401 || err.status === 403) return "The server's AI key is not working. Please tell the site owner.";
  }
  return "Something went wrong. Please try again in a moment.";
}

export async function POST(req: Request) {
  if (!llmConfigured()) {
    return json({ error: "Server is not configured." }, 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const messages = validate(body);
  if (!messages) {
    return json({ error: `Your question is too long. Please keep it under ${MAX_CHARS_PER_MESSAGE} characters.` }, 400);
  }

  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  const limit = checkLimits(ip);
  if (!limit.ok) {
    const msg =
      limit.reason === "daily"
        ? "This free demo has reached its daily limit. Please try again tomorrow."
        : "You have sent a lot of questions in a short time. Please try again later.";
    return json({ error: msg }, 429, { "Retry-After": String(limit.retryAfterSec) });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        const decision = await route(messages);

        let articles: Article[] = [];
        if (decision.search) {
          send({ t: "status", v: "Searching peer-reviewed journals..." });
          let searchFailed = false;
          try {
            articles = await searchApprovedJournals(decision.query);
          } catch (err) {
            console.error("pubmed error", err);
            searchFailed = true;
          }
          send({ t: "meta", searched: true, found: articles.length });

          // No sources means no answer. This is decided in code, so the AI cannot answer from memory.
          if (articles.length === 0) {
            const last = messages[messages.length - 1].content;
            const text = searchFailed
              ? OUTAGE_TEXT
              : NO_SOURCE_TEXT + (/cost|price|afford|expens|how much/i.test(last) ? COST_POINTER : "");
            send({ t: "text", v: `${text}\n${DEFAULT_FOLLOWUPS}` });
            send({ t: "done" });
            return;
          }
        }

        const system = decision.search ? answerSystemPrompt(articles) : directSystemPrompt();
        const convo: ChatMsg[] = [
          { role: "system", content: system },
          ...messages.slice(-HISTORY_FOR_ANSWER).map((m) => ({
            role: m.role,
            content: m.role === "assistant" ? m.content.slice(0, HISTORY_ASSISTANT_CHARS) : m.content,
          })),
        ];

        send({ t: "status", v: "Writing answer..." });
        let full = "";
        for await (const piece of streamChat(convo)) {
          full += piece;
          send({ t: "text", v: piece });
        }

        // Show only the sources the answer actually cited
        const cited = new Set<number>();
        for (const m of full.matchAll(/\[(\d{1,2})\]/g)) cited.add(Number(m[1]));
        for (const n of [...cited].sort((a, b) => a - b)) {
          const a = articles[n - 1];
          if (a) send({ t: "cite", n, url: a.url, title: a.title, meta: `${a.journal}, ${a.year}` });
        }
        send({ t: "done" });
      } catch (err) {
        console.error("chat error", err);
        send({ t: "error", v: friendlyLlmError(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
