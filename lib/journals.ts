// The 12 approved journals. "iso" is the PubMed journal abbreviation used for searching
// and for double-checking every result before it reaches the AI.

export type Journal = { name: string; iso: string };

export const APPROVED_JOURNALS: Journal[] = [
  { name: "Plastic and Reconstructive Surgery", iso: "Plast Reconstr Surg" },
  { name: "Aesthetic Surgery Journal", iso: "Aesthet Surg J" },
  { name: "Journal of Plastic, Reconstructive & Aesthetic Surgery", iso: "J Plast Reconstr Aesthet Surg" },
  { name: "Aesthetic Plastic Surgery", iso: "Aesthetic Plast Surg" },
  { name: "Annals of Plastic Surgery", iso: "Ann Plast Surg" },
  { name: "Plastic and Reconstructive Surgery - Global Open", iso: "Plast Reconstr Surg Glob Open" },
  { name: "JPRAS Open", iso: "JPRAS Open" },
  { name: "Microsurgery", iso: "Microsurgery" },
  { name: "Journal of Reconstructive Microsurgery", iso: "J Reconstr Microsurg" },
  { name: "Journal of Craniofacial Surgery", iso: "J Craniofac Surg" },
  { name: "Clinics in Plastic Surgery", iso: "Clin Plast Surg" },
  { name: "Aesthetic Surgery Journal Open Forum", iso: "Aesthet Surg J Open Forum" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const APPROVED_ISO = new Set(APPROVED_JOURNALS.map((j) => norm(j.iso)));

export function isApprovedJournal(isoAbbreviation: string): boolean {
  return APPROVED_ISO.has(norm(isoAbbreviation));
}
