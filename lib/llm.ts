// Talks to any OpenAI-compatible chat API. Default is Groq (free tier).
// Change LLM_BASE_URL, LLM_API_KEY and LLM_MODEL to use another provider.

const BASE_URL = (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const MODEL = process.env.LLM_MODEL || "openai/gpt-oss-120b";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export class LlmError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function body(messages: ChatMsg[], opts: { stream: boolean; maxTokens: number }) {
  return JSON.stringify({
    model: MODEL,
    messages,
    stream: opts.stream,
    temperature: 0.2,
    max_tokens: opts.maxTokens,
    // gpt-oss models are reasoning models, a low effort keeps answers fast and cheap
    ...(MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
  });
}

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.LLM_API_KEY}`,
  };
}

export async function complete(messages: ChatMsg[], maxTokens = 500): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: body(messages, { stream: false, maxTokens }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new LlmError(res.status, await res.text().catch(() => ""));
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

export async function* streamChat(messages: ChatMsg[], maxTokens = 2500): AsyncGenerator<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: body(messages, { stream: true, maxTokens }),
    signal: AbortSignal.timeout(50000),
  });
  if (!res.ok || !res.body) throw new LlmError(res.status, await res.text().catch(() => ""));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const payload = l.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const piece = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (piece) yield piece as string;
      } catch {
        // ignore partial or non-JSON lines
      }
    }
  }
}
