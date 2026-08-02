/**
 * contentRegister.ts — the per-business Content Register (SEO_HUB_SCOPE §2.2).
 *
 * A permanent ledger of everything a business has ever used across all batches:
 * primary + secondary/long-tail keywords, article titles, and slugs. New batches
 * consult it and must NOT reuse anything in it (cross-batch non-competition —
 * customers publish every batch on one blog, so batches must never compete).
 *
 * Derived live from the keywords + article_nodes tables, so it is always accurate
 * and self-maintaining: once a batch's keywords/titles/slugs are saved, they are
 * automatically part of the register for the next batch. Pure query + pure checks.
 */
import { eq } from "drizzle-orm";
import { keywords, articleNodes } from "../drizzle/schema";

export interface ContentRegister {
  /** Every primary + secondary/long-tail keyword used in OTHER batches. */
  keywords: string[];
  normKeywordSet: Set<string>;
  /** Normalised titles + slugs used in other batches. */
  titleSet: Set<string>;
  slugSet: Set<string>;
}

export function normalizeTerm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const STOP = new Set(["a","an","the","and","or","but","in","on","at","to","for","of","with","by","from","is","are","how","what","why","your","our"]);
function tokens(s: string): Set<string> {
  return new Set(normalizeTerm(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t)));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter++; });
  return inter / (a.size + b.size - inter);
}

/** Load the register for a business, excluding the batch currently being built. */
export async function loadContentRegister(
  db: any,
  businessId: number,
  excludeBatch?: number | null,
): Promise<ContentRegister> {
  const kwRows = await db
    .select({ pk: keywords.primaryKeyword, sk: keywords.secondaryKeywords, bn: keywords.batchNumber })
    .from(keywords)
    .where(eq(keywords.businessId, businessId));
  const kws: string[] = [];
  for (const r of kwRows as Array<{ pk: string | null; sk: unknown; bn: number | null }>) {
    if (excludeBatch != null && r.bn === excludeBatch) continue;
    if (r.pk) kws.push(r.pk);
    const sk = r.sk;
    if (Array.isArray(sk)) for (const s of sk) if (typeof s === "string" && s.trim()) kws.push(s);
  }

  const nodeRows = await db
    .select({ title: articleNodes.plannedTitle, slug: articleNodes.urlSlug, bn: articleNodes.batchNumber })
    .from(articleNodes)
    .where(eq(articleNodes.businessId, businessId));
  const titleSet = new Set<string>();
  const slugSet = new Set<string>();
  for (const r of nodeRows as Array<{ title: string | null; slug: string | null; bn: number | null }>) {
    if (excludeBatch != null && r.bn === excludeBatch) continue;
    if (r.title) titleSet.add(normalizeTerm(r.title));
    if (r.slug) slugSet.add(normalizeTerm(r.slug));
  }

  const uniqueKws = Array.from(new Set(kws));
  return {
    keywords: uniqueKws,
    normKeywordSet: new Set(uniqueKws.map(normalizeTerm)),
    titleSet,
    slugSet,
  };
}

/** True if a keyword is already in the register — exact OR semantic overlap (jaccard ≥ 0.75). */
export function keywordInRegister(keyword: string, reg: ContentRegister): boolean {
  const n = normalizeTerm(keyword);
  if (!n) return false;
  if (reg.normKeywordSet.has(n)) return true;
  const a = tokens(keyword);
  for (const rk of reg.keywords) {
    if (jaccard(a, tokens(rk)) >= 0.75) return true;
  }
  return false;
}

export function titleInRegister(title: string, reg: ContentRegister): boolean {
  return reg.titleSet.has(normalizeTerm(title));
}
export function slugInRegister(slug: string, reg: ContentRegister): boolean {
  return reg.slugSet.has(normalizeTerm(slug));
}
