/**
 * DataForSEO API helper for Blog Batcher.
 *
 * Covers two endpoints used in Stage 3:
 *   1. Google Ads Keywords Data — monthly search volume, competition, CPC
 *   2. Google SERP — People Also Ask questions
 *
 * All calls use Basic Auth with the credentials stored in ENV.
 * Docs: https://docs.dataforseo.com/v3/
 *
 * NOTE: The search_volume/live endpoint returns data at the TOP LEVEL of each
 * result item (not nested under keyword_info). competition is a string enum:
 * "HIGH" | "MEDIUM" | "LOW". This is different from the sandbox/task-based
 * endpoints which nest data under keyword_info.
 */

import { ENV } from "./_core/env";

const BASE_URL = "https://api.dataforseo.com/v3";

function authHeader(): string {
  const creds = Buffer.from(
    `${ENV.dataForSeoLogin}:${ENV.dataForSeoPassword}`
  ).toString("base64");
  return `Basic ${creds}`;
}

async function dfsPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`DataForSEO ${path} returned HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeywordDataResult {
  keyword: string;
  monthlySearchVolume: number | null;
  competitionLevel: "high" | "medium" | "low" | null;
  cpc: number | null;
}

export interface PAAResult {
  keyword: string;
  questions: string[];
}

// The actual shape returned by /keywords_data/google_ads/search_volume/live
// Data is at the TOP LEVEL of each result item (not nested under keyword_info)
interface DFSSearchVolumeItem {
  keyword: string;
  search_volume?: number | null;
  competition?: string | null;       // "HIGH" | "MEDIUM" | "LOW" | null
  competition_index?: number | null; // 0-100
  cpc?: number | null;
  monthly_searches?: Array<{ year: number; month: number; search_volume: number }>;
}

// The shape returned by /keywords_data/google_ads/keywords_for_keywords/live
// This endpoint DOES nest data under keyword_info
interface DFSKeywordForKeywordsItem {
  keyword: string;
  keyword_info?: {
    search_volume?: number | null;
    competition?: number | null; // 0-1 float
    cpc?: number | null;
  };
}

function parseCompetitionString(comp: string | null | undefined): "high" | "medium" | "low" | null {
  if (!comp) return null;
  switch (comp.toUpperCase()) {
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    case "LOW": return "low";
    default: return null;
  }
}

function parseCompetitionFloat(comp: number | null | undefined): "high" | "medium" | "low" | null {
  if (comp === null || comp === undefined) return null;
  if (comp >= 0.67) return "high";
  if (comp >= 0.34) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Keyword data — Google Ads Keywords Data API
// Returns MSV, competition, CPC for a list of keywords.
// ---------------------------------------------------------------------------
export async function getKeywordData(
  keywords: string[],
  locationCode = 2036, // Australia
  languageCode = "en"
): Promise<KeywordDataResult[]> {
  if (keywords.length === 0) return [];

  // DataForSEO allows max 1000 keywords per task; we chunk to be safe
  const chunks: string[][] = [];
  for (let i = 0; i < keywords.length; i += 100) {
    chunks.push(keywords.slice(i, i + 100));
  }

  const results: KeywordDataResult[] = [];

  for (const chunk of chunks) {
    // Send all keywords in a single task (not one task per keyword)
    const body = [
      {
        keywords: chunk,
        location_code: locationCode,
        language_code: languageCode,
      },
    ];

    type DFSResponse = {
      status_code: number;
      status_message?: string;
      tasks?: Array<{
        status_code: number;
        status_message?: string;
        result?: DFSSearchVolumeItem[];
      }>;
    };

    let data: DFSResponse;
    try {
      data = await dfsPost<DFSResponse>(
        "/keywords_data/google_ads/search_volume/live",
        body
      );
    } catch (err) {
      console.warn("[DataForSEO] Request failed:", err);
      for (const kw of chunk) {
        results.push({ keyword: kw, monthlySearchVolume: null, competitionLevel: null, cpc: null });
      }
      continue;
    }

    if (data.status_code !== 20000) {
      console.warn("[DataForSEO] Non-200 status:", data.status_code, data.status_message);
      for (const kw of chunk) {
        results.push({ keyword: kw, monthlySearchVolume: null, competitionLevel: null, cpc: null });
      }
      continue;
    }

    for (const task of data.tasks ?? []) {
      if (task.status_code !== 20000) {
        console.warn("[DataForSEO] Task error:", task.status_code, task.status_message);
        continue;
      }
      for (const item of task.result ?? []) {
        // Data is at the TOP LEVEL — not nested under keyword_info
        results.push({
          keyword: item.keyword,
          monthlySearchVolume: item.search_volume ?? null,
          competitionLevel: parseCompetitionString(item.competition),
          cpc: item.cpc ?? null,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Keyword suggestions — for the "swap" feature
// Returns up to 10 related keyword suggestions for a given seed keyword.
// This endpoint DOES nest data under keyword_info.
// ---------------------------------------------------------------------------
export async function getKeywordSuggestions(
  seedKeyword: string,
  locationCode = 2036,
  languageCode = "en",
  limit = 10
): Promise<KeywordDataResult[]> {
  type DFSResponse = {
    status_code: number;
    tasks?: Array<{
      status_code: number;
      result?: DFSKeywordForKeywordsItem[];
    }>;
  };

  const body = [
    {
      keyword: seedKeyword,
      location_code: locationCode,
      language_code: languageCode,
      limit,
      order_by: ["keyword_info.search_volume,desc"],
    },
  ];

  let data: DFSResponse;
  try {
    data = await dfsPost<DFSResponse>(
      "/keywords_data/google_ads/keywords_for_keywords/live",
      body
    );
  } catch (err) {
    console.warn("[DataForSEO] Suggestions request failed:", err);
    return [];
  }

  if (data.status_code !== 20000) {
    console.warn("[DataForSEO] Suggestions non-200:", data.status_code);
    return [];
  }

  const results: KeywordDataResult[] = [];
  for (const task of data.tasks ?? []) {
    for (const item of task.result ?? []) {
      // This endpoint nests data under keyword_info
      const info = item.keyword_info;
      results.push({
        keyword: item.keyword,
        monthlySearchVolume: info?.search_volume ?? null,
        competitionLevel: parseCompetitionFloat(info?.competition),
        cpc: info?.cpc ?? null,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// People Also Ask — Google SERP API
// Returns PAA questions for a list of keywords.
// ---------------------------------------------------------------------------
export async function getPAAQuestions(
  keywords: string[],
  locationCode = 2036,
  languageCode = "en"
): Promise<PAAResult[]> {
  if (keywords.length === 0) return [];

  const body = keywords.map((kw) => ({
    keyword: kw,
    location_code: locationCode,
    language_code: languageCode,
    depth: 1, // first level PAA only
  }));

  type DFSResponse = {
    status_code: number;
    tasks?: Array<{
      status_code: number;
      data?: { keyword: string };
      result?: Array<{
        type?: string;
        items?: Array<{
          type?: string;
          title?: string;
          items?: Array<{ type?: string; title?: string }>;
        }>;
      }>;
    }>;
  };

  let data: DFSResponse;
  try {
    data = await dfsPost<DFSResponse>(
      "/serp/google/organic/live/advanced",
      body
    );
  } catch (err) {
    console.warn("[DataForSEO] PAA request failed:", err);
    return keywords.map((kw) => ({ keyword: kw, questions: [] }));
  }

  if (data.status_code !== 20000) {
    console.warn("[DataForSEO] PAA non-200:", data.status_code);
    return keywords.map((kw) => ({ keyword: kw, questions: [] }));
  }

  const results: PAAResult[] = [];

  for (const task of data.tasks ?? []) {
    const kw = task.data?.keyword ?? "";
    const questions: string[] = [];

    for (const resultSet of task.result ?? []) {
      for (const item of resultSet.items ?? []) {
        if (item.type === "people_also_ask") {
          for (const paaItem of item.items ?? []) {
            if (paaItem.title) questions.push(paaItem.title);
          }
        }
      }
    }

    results.push({ keyword: kw, questions: questions.slice(0, 8) });
  }

  return results;
}
