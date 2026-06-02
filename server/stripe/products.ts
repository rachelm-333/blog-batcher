/**
 * server/stripe/products.ts
 * Central product catalogue for Blog Batcher.
 *
 * Prices are in AUD cents (placeholder amounts — to be confirmed before launch).
 * GST (10%) is collected automatically by Stripe's automatic_tax feature.
 * Do NOT go live with real card charges until Rachel confirms final prices.
 */

export type ProductKey = "citation_starter" | "citation_authority" | "credit_topup";

export interface Product {
  key: ProductKey;
  name: string;
  description: string;
  /** Price in AUD cents (excl. GST — Stripe adds GST automatically). */
  priceAud: number;
  /** Credits allocated on successful payment. */
  credits: number;
  /** Article pack size unlocked. Null for credit top-ups. */
  articleCount: number | null;
  /** Tier to upgrade user to on purchase. Null for credit top-ups. */
  tier: "standard" | "multi_business" | "agency" | null;
}

export const PRODUCTS: Record<ProductKey, Product> = {
  citation_starter: {
    key: "citation_starter",
    name: "Citation Starter — 20 Articles",
    description:
      "20 AI-powered, citation-optimised blog articles. Full 5-stage workflow. 25 credits included.",
    priceAud: 9700, // $97.00 AUD — PLACEHOLDER, confirm before launch
    credits: 25,
    articleCount: 20,
    tier: "standard",
  },
  citation_authority: {
    key: "citation_authority",
    name: "Citation Authority — 50 Articles",
    description:
      "50 AI-powered, citation-optimised blog articles. Full 5-stage workflow. 60 credits included.",
    priceAud: 19700, // $197.00 AUD — PLACEHOLDER, confirm before launch
    credits: 60,
    articleCount: 50,
    tier: "standard",
  },
  credit_topup: {
    key: "credit_topup",
    name: "Credit Top-Up — 5 Credits",
    description:
      "5 additional credits for article regeneration, keyword swaps, and extra features.",
    priceAud: 2700, // $27.00 AUD — PLACEHOLDER, confirm before launch
    credits: 5,
    articleCount: null,
    tier: null,
  },
};

export function getProduct(key: ProductKey): Product {
  const product = PRODUCTS[key];
  if (!product) throw new Error(`Unknown product key: ${key}`);
  return product;
}
