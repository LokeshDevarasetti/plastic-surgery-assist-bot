"use client";

import { useEffect, useRef, useState } from "react";

type Source = { n: number; url: string; title: string; meta: string };
type Msg = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  followups?: string[];
  error?: boolean;
  found?: number; // number of journal abstracts found for this answer (only when a search ran)
};

const MAX_CHARS = 1500;

const GREETING =
  "Hi, and welcome. I explain plastic surgery in plain language, using peer-reviewed journals and professional guidelines. I am an educational tool, not a doctor, and this is not medical advice. Please talk to a qualified, board-certified plastic surgeon about your own situation.\n\nWhat is your question?";

const STARTERS = [
  "What is liposuction?",
  "I want to remove fat from my stomach. What are my options?",
  "What are the risks of a breast augmentation?",
  "How long is recovery after a rhinoplasty?",
];

// Split the model output into the visible answer and the follow-up questions.
function splitFollowups(text: string): { body: string; followups: string[] } {
  const idx = text.indexOf("FOLLOWUPS:");
  if (idx === -1) return { body: text.trimEnd(), followups: [] };
  const body = text.slice(0, idx).trimEnd();
  const followups = text
    .slice(idx + "FOLLOWUPS:".length)
    .split("|")
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 3);
  return { body, followups };
}

function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

// Small, safe renderer: paragraphs, bullet lists, headings and bold. No raw HTML.
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={blocks.length}>{renderInline(para.join(" "))}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length}>
          {list.map((li, i) => (
            <li key={i}>{renderInline(li)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
    } else if (/^[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*]\s+/, ""));
    } else if (/^#{1,4}\s+/.test(line)) {
      flushPara();
      flushList();
      blocks.push(<h4 key={blocks.length}>{line.replace(/^#{1,4}\s+/, "")}</h4>);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <>{blocks}</>;
}

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    const history = [...messages, { role: "user" as const, content: q }];
    // The greeting is local only, so skip it when sending to the API.
    const apiMessages = history
      .slice(1)
      .filter((m) => !m.error && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-16);

    setMessages([...history, { role: "assistant", content: "", sources: [] }]);
    setInput("");
    setBusy(true);
    setStatus("Thinking...");

    let raw = "";
    const sources: Source[] = [];

    const update = (patch: Partial<Msg>) =>
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
        return copy;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!res.ok || !res.body) {
        let msg = "Something went wrong. Please try again.";
        try {
          msg = (await res.json()).error || msg;
        } catch {}
        update({ content: msg, error: true });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.t === "text") {
            raw += ev.v;
            setStatus("");
            update({ content: splitFollowups(raw).body });
          } else if (ev.t === "status") {
            setStatus(ev.v);
          } else if (ev.t === "meta") {
            update({ found: ev.found });
          } else if (ev.t === "cite") {
            sources.push({ n: ev.n, url: ev.url, title: ev.title, meta: ev.meta });
            update({ sources: [...sources] });
          } else if (ev.t === "error") {
            update({ content: raw ? splitFollowups(raw).body : ev.v, error: !raw });
          }
        }
      }

      const { body, followups } = splitFollowups(raw);
      update({ content: body, followups, sources: [...sources] });
    } catch {
      update({ content: "Connection problem. Please try again.", error: true });
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  const showStarters = messages.length === 1;

  return (
    <main className="app">
      <header className="header">
        <h1>Plastic Surgery Info Guide</h1>
        <p>Plain-language answers from peer-reviewed sources</p>
      </header>

      <div className="disclaimer">
        Educational information only. Not medical advice. I cannot diagnose, recommend a procedure, or replace a
        board-certified plastic surgeon.
      </div>

      <div className="messages" aria-live="polite">
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          return (
            <div key={i} className={`row ${m.role}`}>
              <div className="bubble">
                {m.role === "user" ? (
                  m.content
                ) : m.content ? (
                  m.error ? (
                    <span className="error">{m.content}</span>
                  ) : (
                    <RichText text={m.content} />
                  )
                ) : (
                  isLast && busy && <span className="status">{status || "Thinking..."}</span>
                )}

                {m.role === "assistant" && isLast && busy && m.content && status && (
                  <div className="status">{status}</div>
                )}

                {m.role === "assistant" && m.found !== undefined && m.content && (
                  <div className="status" style={{ marginTop: 8 }}>
                    {m.found > 0
                      ? `Searched approved journals: ${m.found} abstract${m.found === 1 ? "" : "s"} found.`
                      : "Searched approved journals: no matching abstracts found."}
                  </div>
                )}

                {m.sources && m.sources.length > 0 && (
                  <div className="sources">
                    <strong>Sources (peer-reviewed abstracts)</strong>
                    <ol>
                      {m.sources.map((s) => (
                        <li key={s.url} value={s.n}>
                          <a href={s.url} target="_blank" rel="noopener noreferrer">
                            {s.title}
                          </a>{" "}
                          <span className="status">({s.meta}, via PubMed)</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {m.followups && m.followups.length > 0 && (
                  <div className="chips">
                    {m.followups.map((f) => (
                      <button key={f} className="chip" disabled={busy} onClick={() => ask(f)}>
                        {f}
                      </button>
                    ))}
                  </div>
                )}

                {i === 0 && showStarters && (
                  <div className="chips">
                    {STARTERS.map((s) => (
                      <button key={s} className="chip" disabled={busy} onClick={() => ask(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <textarea
          rows={2}
          value={input}
          maxLength={MAX_CHARS}
          placeholder="Ask about a plastic surgery procedure..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          aria-label="Your question"
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
      <div className="footer">
        Answers are based on abstracts from approved plastic surgery journals found through PubMed and may contain errors. Please do not share names or
        contact details.{" "}
        <a href="https://www.ncbi.nlm.nih.gov/home/about/policies/" target="_blank" rel="noopener noreferrer">
          NCBI disclaimer and copyright notice
        </a>
      </div>
    </main>
  );
}
