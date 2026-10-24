// One small wrapper for the AI model.
//
// Default: Claude Haiku 5.5 through the Claude API (set ANTHROPIC_API_KEY).
// Fallback: any OpenAI-compatible service such as Groq (set LLM_API_KEY, and optionally
// LLM_BASE_URL and LLM_MODEL). If both keys exist, the Claude key is used.

import Anthropic from "@anthropic-ai/sdk";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export class LlmError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const provider: "anthropic" | "openai" | "none" = process.env.ANTHROPIC_API_KEY
  ? "anthropic"
  : process.env.LLM_API_KEY
  ? "openai"
  : "none";

export const llmConfigured = () => provider !== "none";

const MODEL =
  process.env.LLM_MODEL || (provider === "anthropic" ? "claude-haiku-5-5" : "openai/gpt-oss-120b");

// ---------- Claude API ----------

let anthropicClient: Anthropic | null = null;
function claude() {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

// Claude needs the system text separate, and chat turns that start with a user message
// and alternate between user and assistant.
function toClaudeParams(messages: ChatMsg[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else turns.push({ role: m.role, content: m.content });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return { system, turns };
}

function wrapClaudeError(err: unknown): never {
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") throw new LlmError(status, (err as Error).message);
  throw err;
}

// ---------- OpenAI-compatible (Groq etc.) ----------

const OPENAI_BASE = (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");

function openaiBody(messages: ChatMsg[], stream: boolean, maxTokens: number) {
  return JSON.stringify({
    model: MODEL,
    messages,
    stream,
    temperature: 0.2,
    max_tokens: maxTokens,
    ...(MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
  });
}

const openaiHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LLM_API_KEY}`,
});

// ---------- Public functions ----------

export async function complete(messages: ChatMsg[], maxTokens = 500): Promise<string> {
  if (provider === "anthropic") {
    const { system, turns } = toClaudeParams(messages);
    try {
      const res = await claude().messages.create(
        { model: MODEL, max_tokens: maxTokens, system, messages: turns },
        { timeout: 20000 }
      );
      return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    } catch (err) {
      wrapClaudeError(err);
    }
  }

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: openaiHeaders(),
    body: openaiBody(messages, false, Math.max(maxTokens, 600)),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new LlmError(res.status, await res.text().catch(() => ""));
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

export async function* streamChat(messages: ChatMsg[], maxTokens = 1500): AsyncGenerator<string> {
  if (provider === "anthropic") {
    const { system, turns } = toClaudeParams(messages);
    try {
      const stream = claude().messages.stream(
        { model: MODEL, max_tokens: maxTokens, system, messages: turns },
        { timeout: 50000 }
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
      return;
    } catch (err) {
      wrapClaudeError(err);
    }
  }

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: openaiHeaders(),
    body: openaiBody(messages, true, Math.max(maxTokens, 2500)),
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
