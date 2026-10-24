import { XMLParser } from "fast-xml-parser";
import { APPROVED_JOURNALS, isApprovedJournal } from "./journals";

// PubMed E-utilities are free and need no key. Keep requests low (NCBI asks for 3 per second or fewer).
const BASE = process.env.PUBMED_BASE || "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TIMEOUT_MS = 9000;
const MAX_ARTICLES = 5;
const MAX_ABSTRACT_CHARS = 1100;

export type Article = {
  pmid: string;
  title: string;
  journal: string; // full name as listed by PubMed
  year: string;
  types: string[];
  abstract: string;
  url: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["PubmedArticle", "AbstractText", "PublicationType"].includes(name),
});

function flatten(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flatten).join(" ");
  if (typeof node === "object") {
    return Object.entries(node as Record<string, unknown>)
      .filter(([k]) => !k.startsWith("@_"))
      .map(([, v]) => flatten(v))
      .join(" ");
  }
  return "";
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`PubMed ${res.status}`);
  return res.json();
}

async function searchIds(term: string, retmax: number): Promise<string[]> {
  const url =
    `${BASE}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${retmax}` +
    `&term=${encodeURIComponent(term)}`;
  const data = await getJson(url);
  return data?.esearchresult?.idlist ?? [];
}

function buildTerms(keywords: string) {
  const journalClause = APPROVED_JOURNALS.map((j) => `"${j.iso}"[Journal]`).join(" OR ");
  const base = `(${keywords}) AND (${journalClause}) AND hasabstract[text]`;
  const strong = `${base} AND (systematic review[pt] OR meta-analysis[pt] OR randomized controlled trial[pt] OR practice guideline[pt] OR review[pt])`;
  return { base, strong };
}

async function fetchArticles(ids: string[]): Promise<Article[]> {
  if (ids.length === 0) return [];
  const res = await fetch(`${BASE}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`PubMed ${res.status}`);
  // Remove inline formatting tags (italic, bold, superscript...) so words in titles stay in order.
  const rawXml = (await res.text()).replace(/<\/?(?:i|b|u|sup|sub)(?:\s[^>]*)?>/g, "");
  const xml = parser.parse(rawXml);
  const items: any[] = xml?.PubmedArticleSet?.PubmedArticle ?? [];

  const out: Article[] = [];
  for (const it of items) {
    const cit = it?.MedlineCitation;
    const art = cit?.Article;
    if (!cit || !art) continue;

    const iso = flatten(art?.Journal?.ISOAbbreviation);
    // Safety net: drop anything not in the approved list, whatever the search returned.
    if (!isApprovedJournal(iso)) continue;

    const abstractParts: any[] = art?.Abstract?.AbstractText ?? [];
    const abstract = clean(
      abstractParts
        .map((p) => {
          const label = typeof p === "object" && p?.["@_Label"] ? `${p["@_Label"]}: ` : "";
          return label + flatten(p);
        })
        .join(" ")
    );
    if (!abstract) continue;

    const pd = art?.Journal?.JournalIssue?.PubDate;
    const year = flatten(pd?.Year) || (flatten(pd?.MedlineDate).match(/\d{4}/)?.[0] ?? "");
    const pmid = flatten(cit?.PMID).trim().split(" ")[0];

    out.push({
      pmid,
      title: clean(flatten(art?.ArticleTitle)),
      journal: clean(flatten(art?.Journal?.Title)),
      year,
      types: ((art?.PublicationTypeList?.PublicationType as any[]) ?? []).map((t) => clean(flatten(t))),
      abstract: abstract.length > MAX_ABSTRACT_CHARS ? abstract.slice(0, MAX_ABSTRACT_CHARS) + "..." : abstract,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    });
  }
  return out;
}

// Keep only letters, numbers, spaces and hyphens so the model cannot inject search operators.
export function sanitizeKeywords(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9\- ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["and", "or", "not"].includes(w.toLowerCase()))
    .slice(0, 8)
    .join(" ");
}

export async function searchApprovedJournals(keywordsRaw: string): Promise<Article[]> {
  let keywords = sanitizeKeywords(keywordsRaw);
  if (!keywords) return [];

  const run = async (kw: string) => {
    const { base, strong } = buildTerms(kw);
    const [strongIds, baseIds] = await Promise.all([searchIds(strong, 3), searchIds(base, 4)]);
    const ids = [...new Set([...strongIds, ...baseIds])].slice(0, MAX_ARTICLES + 2);
    return fetchArticles(ids);
  };

  let articles = await run(keywords);
  if (articles.length < 2) {
    // Broaden: use only the first two keywords
    const broader = keywords.split(" ").slice(0, 2).join(" ");
    if (broader && broader !== keywords) articles = await run(broader);
  }
  return articles.slice(0, MAX_ARTICLES);
}
