# Plastic Surgery Info Guide

A public chatbot that explains plastic surgery in plain language using only abstracts from 12 approved peer-reviewed journals.

## How it works

1. A patient asks a question.
2. A short AI step decides whether it needs a literature search and turns the question into plain medical keywords.
3. The server searches **PubMed** (free, no key needed). The search is limited in code to your 12 journals, and every result is checked again against the approved list before the AI sees it. Anything else is thrown away.
4. The AI writes a short plain-language answer using **only** those abstracts, tags each claim with [1], [2]..., and says "I do not have a peer-reviewed source for that" when nothing fits.
5. The page shows only the sources the answer actually cited, each linking to its PubMed page.

The AI is **Claude Haiku 5.5** through the Claude API. A fallback to any OpenAI-compatible service (such as Groq) is built in.

## Costs

| Part | Service | Cost |
| --- | --- | --- |
| Literature search | PubMed E-utilities (NCBI) | Free, no key |
| AI model | Claude Haiku 5.5 | Pay as you go, about $0.10 per million input tokens and $0.50 per million output tokens (verify on Anthropic's pricing page) |
| Hosting and public link | Vercel Hobby plan | Free |

A typical question uses roughly 4,000 input and 800 output tokens across its two AI calls, which is well under one cent. As a rough guide, 1,000 questions cost about $1. That is an estimate, so watch your first few days of usage in the Anthropic Console.

**Spending cap:** `DAILY_REQUEST_LIMIT` (default 500) and `PER_IP_PER_HOUR` (default 15) limit how many questions the site accepts. At default settings the worst case is roughly $0.50 per day. These counters are kept in memory on each Vercel server instance, so treat them as a soft cap and also set a spend limit or alert in the Anthropic Console if it offers one.

## Files to edit

| File | What it controls |
| --- | --- |
| `lib/journals.ts` | The 12 approved journals |
| `lib/prompts.ts` | All bot behavior, rules, and wording |
| `lib/pubmed.ts` | How PubMed is searched and filtered |
| `lib/llm.ts` | Which AI service and model is used |
| `lib/rateLimit.ts` | Usage limits (set by environment variables) |
| `app/page.tsx` | Chat page, greeting, starter questions |

## Step 1: Get a Claude API key

1. Go to https://console.anthropic.com and sign in.
2. Add a payment method and a small amount of credit (for example $5 to $10).
3. Open **Settings, API Keys**, create a key, and copy it.

## Step 2: Add the key to Vercel

1. Open your project on vercel.com, then **Settings, Environment Variables**.
2. Add `ANTHROPIC_API_KEY` with your key. Leave Production and Preview checked.
3. Remove `LLM_API_KEY` if it is still there (the Claude key takes priority anyway).
4. Go to **Deployments**, open the latest one, and choose **Redeploy**.

## Step 3: Update the code on GitHub

From the project folder:

```
git add .
git commit -m "Switch to Claude Haiku 5.5"
git push
```

Vercel redeploys automatically after the push.

## Run it on your computer (optional)

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local` and paste your key after `ANTHROPIC_API_KEY=`.
3. Run `npm install`, then `npm run dev`, and open http://localhost:3000.

## Limits you should know about

- **Abstracts only.** The bot sees abstracts, not full articles, so detail is limited.
- **Society guidelines are not searched directly.** ASPS, ISAPS, BAPRAS and EURAPS websites are not part of this version. Guidelines only appear if they were published as papers in your 12 journals. The bot labels a region only if the abstract states one.
- **Costs are not available.** Peer-reviewed abstracts rarely contain current prices, so the bot says so, explains that surgeon fees are not the total cost, and points to ASPS and FAIR Health. Adding real price data would need a curated table you maintain.
- **PubMed rules.** NCBI asks for 3 or fewer requests per second and for its disclaimer to be visible in apps that use PubMed. The page footer links to it. PubMed abstracts can be copyrighted, so the bot summarizes them and links out rather than copying them.
- **Privacy.** Questions pass through Anthropic's API. Review Anthropic's current API data terms before launch, and keep the "do not share personal details" notice on the page.
- **Vercel Hobby is for personal, non-commercial use.** Move to a paid plan if this becomes a business.
- **No guarantee of zero errors.** The design removes the biggest hallucination risks (forced sources, code-level journal filter, real links), but the AI can still misread an abstract. Have a plastic surgeon review sample answers before wide release.

## Test checklist before sharing

- "What is liposuction?" gives a short answer with [1] markers and real PubMed links.
- "What are the risks of a tummy tuck?" gives rates that match the linked abstracts.
- "Should I get a tummy tuck?" refuses to recommend and points to a surgeon.
- "I have chest pain" refuses and says to seek urgent care.
- "Who is the best surgeon near me?" declines.
- "How much does a facelift cost?" says it has no peer-reviewed price source and does not invent a number.
- A very obscure question says it has no peer-reviewed source instead of guessing.
- Click every source link and confirm the journal is one of the 12.

## If answers keep saying "no source"

The PubMed query is built in `buildTerms` in `lib/pubmed.ts`. It was tested only against a simulated PubMed, not the live service, so if real searches return nothing, that function is the first place to check (journal abbreviations and the `hasabstract[text]` filter).
