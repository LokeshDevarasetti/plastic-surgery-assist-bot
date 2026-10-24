# Plastic Surgery Info Guide (free stack)

A public chatbot that explains plastic surgery in plain language using only abstracts from 12 approved peer-reviewed journals.

## How it works

1. A patient asks a question.
2. A small AI step decides whether it needs a literature search and turns the question into plain medical keywords.
3. The server searches **PubMed** (free, no key needed). The search is limited in code to your 12 journals, and every result is checked again against the approved list before the AI sees it. Anything else is thrown away.
4. The AI writes a short plain-language answer using **only** those abstracts, tags each claim with [1], [2]..., and says "I do not have a peer-reviewed source for that" when nothing fits.
5. The page shows only the sources the answer actually cited, each linking to its PubMed page.

The AI step uses any OpenAI-compatible service. The default is **Groq's free plan**.

## What is free

| Part | Service | Cost |
| --- | --- | --- |
| Literature search | PubMed E-utilities (NCBI) | Free, no key |
| AI model | Groq free plan (default) | Free, needs a free API key |
| Hosting and public link | Vercel Hobby plan | Free |

## Files to edit

| File | What it controls |
| --- | --- |
| `lib/journals.ts` | The 12 approved journals |
| `lib/prompts.ts` | All bot behavior, rules, and wording |
| `lib/pubmed.ts` | How PubMed is searched and filtered |
| `lib/llm.ts` | Which AI service and model is used |
| `lib/rateLimit.ts` | Usage limits (set by environment variables) |
| `app/page.tsx` | Chat page, greeting, starter questions |

## Step 1: Get a free AI key

1. Go to https://console.groq.com and sign up.
2. Open **API Keys** and create a key. Copy it.

## Step 2: Run it on your computer (optional test)

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local` and paste your key after `LLM_API_KEY=`.
3. Run:

```
npm install
npm run dev
```

4. Open http://localhost:3000 and work through the test checklist below.

## Step 3: Get a free public link (Vercel)

1. Create a free GitHub account and a new empty repository.
2. In this folder run:

```
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/plastic-surgery-bot.git
git push -u origin main
```

3. Go to https://vercel.com, sign up with GitHub, click **Add New, Project**, and import the repository.
4. Under **Environment Variables**, add `LLM_API_KEY` with your Groq key.
5. Click **Deploy**. Vercel gives you a public link you can share.

## Limits you should know about

- **Free AI tiers are small.** Reported Groq free limits are about 30 requests per minute and 1,000 per day, plus a cap on tokens per minute (check your own limits in the Groq console). Each question uses two AI calls, so a handful of people at once can hit the cap. When that happens, users see a "busy, try again" message. Keep `DAILY_REQUEST_LIMIT` at or below about 400.
- **Do not use Google's free Gemini tier for this.** Its terms say free-tier content is used to improve Google's products and may be read by human reviewers. Patient questions deserve better. Groq's data terms were not clear in what I found, so read them yourself before launch, and keep the "do not share personal details" notice on the page.
- **Abstracts only.** The bot sees abstracts, not full articles, so detail is limited.
- **Society guidelines are not searched directly.** ASPS, ISAPS, BAPRAS and EURAPS websites are not part of this free version. Guidelines only appear if they were published as papers in your 12 journals. The bot labels a region only if the abstract states one.
- **Costs are not available.** Peer-reviewed abstracts rarely contain current prices, so the bot says so, explains that surgeon fees are not the total cost, and points to ASPS and FAIR Health. Adding real price data would need a curated table you maintain.
- **PubMed rules.** NCBI asks for 3 or fewer requests per second and for its disclaimer to be visible in apps that use PubMed. The page footer links to it. PubMed abstracts can be copyrighted, so the bot summarizes them and links out rather than copying them.
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
