/**
 * DataForSEO API helper for Blog Batcher.
 *
 * Covers two endpoints used in Stage 3:
 *   1. Google Ads Keywords Data — monthly search volume, competition, CPC
 *   2. Google SERP — People Also Ask questions
 *
 * All calls use Basic Auth with the credentials stored in ENV.
 * Docs: https://docs.dataforseo.com/v3/
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

  // DataForSEO allows max 1000 keywords per task; we chunk just in case
  const chunks: string[][] = [];
  for (let i = 0; i < keywords.length; i += 100) {
    chunks.push(keywords.slice(i, i + 100));
  }

  const results: KeywordDataResult[] = [];

  for (const chunk of chunks) {
    const body = chunk.map((kw) => ({
      keywords: [kw],
      location_code: locationCode,
      language_code: languageCode,
      date_from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
    }));

    type DFSResponse = {
      status_code: number;
      tasks?: Array<{
        status_code: number;
        result?: Array<{
          keyword: string;
          keyword_info?: {
            search_volume?: number;
            competition?: number;
            cpc?: number;
          };
        }>;
      }>;
    };

    const data = await dfsPost<DFSResponse>(
      "/keywords_data/google_ads/search_volume/live",
      body
    );

    if (data.status_code !== 20000) {
      console.warn("[DataForSEO] Non-200 status:", data.status_code);
      // Return nulls for this chunk rather than throwing
      for (const kw of chunk) {
        results.push({ keyword: kw, monthlySearchVolume: null, competitionLevel: null, cpc: null });
      }
      continue;
    }

    for (const task of data.tasks ?? []) {
      for (const item of task.result ?? []) {
        const info = item.keyword_info;
        const comp = info?.competition ?? null;
        let competitionLevel: "high" | "medium" | "low" | null = null;
        if (comp !== null) {
          if (comp >= 0.67) competitionLevel = "high";
          else if (comp >= 0.34) competitionLevel = "medium";
          else competitionLevel = "low";
        }
        results.push({
          keyword: item.keyword,
          monthlySearchVolume: info?.search_volume ?? null,
          competitionLevel,
          cpc: info?.cpc ?? null,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Keyword suggestions — for the "swap" feature
// Returns up to 10 related keyword suggestions for a given seed keyword.
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
      result?: Array<{
        keyword: string;
        keyword_info?: {
          search_volume?: number;
          competition?: number;
          cpc?: number;
        };
      }>;
    }>;
  };

  const body = [
    {
      keyword: seedKeyword,
      location_code: locationCode,
      language_code: languageCode,
      limit,
      filters: [["keyword_info.search_volume", ">", 0]],
      order_by: ["keyword_info.search_volume,desc"],
    },
  ];

  const data = await dfsPost<DFSResponse>(
    "/keywords_data/google_ads/keywords_for_keywords/live",
    body
  );

  if (data.status_code !== 20000) {
    console.warn("[DataForSEO] Suggestions non-200:", data.status_code);
    return [];
  }

  const results: KeywordDataResult[] = [];
  for (const task of data.tasks ?? []) {
    for (const item of task.result ?? []) {
      const info = item.keyword_info;
      const comp = info?.competition ?? null;
      let competitionLevel: "high" | "medium" | "low" | null = null;
      if (comp !== null) {
        if (comp >= 0.67) competitionLevel = "high";
        else if (comp >= 0.34) competitionLevel = "medium";
        else competitionLevel = "low";
      }
      results.push({
        keyword: item.keyword,
        monthlySearchVolume: info?.search_volume ?? null,
        competitionLevel,
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

  const data = await dfsPost<DFSResponse>(
    "/serp/google/organic/live/advanced",
    body
  );

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
          // PAA block contains nested items
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
