/**
 * llmsTxt.ts — build a proper /llms.txt for a business (MAC-13).
 *
 * llms.txt is an emerging standard: a plain-Markdown file at the site root that
 * tells AI answer engines what the site is and links its most useful pages. This
 * builds one from the business profile + its published blog posts. Pure + testable.
 *
 * The file must be hosted at https://<domain>/llms.txt (HTTP 200) to satisfy MAC-13.
 */

export interface LlmsTxtInput {
  businessName: string;
  description?: string;          // one-line summary of the business
  about?: string;                // optional longer blurb
  websiteUrl?: string;
  keyPages?: Array<{ label: string; url: string }>;   // contact, services, shop, etc.
  posts?: Array<{ title: string; url: string; summary?: string }>; // published blog posts
}

/** Build the llms.txt markdown. Returns a ready-to-host string. */
export function buildLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [];
  lines.push(`# ${input.businessName.trim()}`);
  if (input.description?.trim()) lines.push("", `> ${input.description.trim()}`);
  if (input.about?.trim()) lines.push("", input.about.trim());

  const pages = (input.keyPages ?? []).filter((p) => p.url && p.label);
  if (input.websiteUrl?.trim()) {
    // Ensure the homepage is listed first under Key Pages.
    if (!pages.some((p) => p.url.replace(/\/+$/, "") === input.websiteUrl!.replace(/\/+$/, ""))) {
      pages.unshift({ label: "Home", url: input.websiteUrl.trim() });
    }
  }
  if (pages.length) {
    lines.push("", "## Key Pages");
    for (const p of pages) lines.push(`- [${p.label.trim()}](${p.url.trim()})`);
  }

  const posts = (input.posts ?? []).filter((p) => p.url && p.title);
  if (posts.length) {
    lines.push("", "## Blog");
    for (const p of posts) {
      const note = p.summary?.trim() ? `: ${p.summary.trim()}` : "";
      lines.push(`- [${p.title.trim()}](${p.url.trim()})${note}`);
    }
  }

  lines.push(""); // trailing newline
  return lines.join("\n");
}
