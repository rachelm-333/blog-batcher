/**
 * server/cmsPublisher.ts
 *
 * CMS Publisher Service — Layer 8
 * Handles publishing articles to WordPress, Wix, and Zapier webhook.
 * All external HTTP calls are isolated here so they can be mocked in tests.
 *
 * Supported platforms:
 *   - WordPress (REST API v2) with Yoast / RankMath / AIOSEO / None SEO plugin support
 *   - Wix (Blog API v3)
 *   - Zapier (webhook POST)
 *
 * Return shape for all publishers:
 *   { success: true, cmsPostId: string, cmsPostUrl: string }
 *   { success: false, error: string }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArticlePayload {
  title: string;
  bodyHtml: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  urlSlug: string;
  schemaMarkup: string | null;
  imageUrl: string | null;
  imageAltText: string | null;
  scheduledPublishAt: Date | null;
  /** Article level: cornerstone | pillar | cluster */
  level: string;
  /** If true, push to CMS as draft rather than live */
  publishAsDraft?: boolean;
}

export interface PublishResult {
  success: boolean;
  cmsPostId?: string;
  cmsPostUrl?: string;
  error?: string;
  /** raw API response snippet — used by the backfill smoke test for diagnosis */
  raw?: string;
}

export interface WordPressCredentials {
  siteUrl: string;
  username: string;
  applicationPassword: string;
  /** SEO plugin installed on the WordPress site. */
  seoPlugin: "yoast" | "rankmath" | "aioseo" | "none";
}

export interface WixCredentials {
  apiKey: string;
  siteId: string;
  /** Required for 3rd-party API key authentication. Wix member/account ID. */
  memberId?: string;
}

export interface ZapierCredentials {
  webhookUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a WordPress site URL — strip trailing slash, ensure https. */
function normaliseWpUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  return url;
}

/** Build the Basic Auth header value for WordPress Application Passwords. */
function wpBasicAuth(username: string, password: string): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

/** Map SEO plugin to its meta field names. */
function seoPluginFields(
  plugin: WordPressCredentials["seoPlugin"],
  metaTitle: string,
  metaDescription: string,
  focusKeyword: string
): Record<string, string> {
  switch (plugin) {
    case "yoast":
      return {
        _yoast_wpseo_title: metaTitle,
        _yoast_wpseo_metadesc: metaDescription,
        _yoast_wpseo_focuskw: focusKeyword,
      };
    case "rankmath":
      return {
        rank_math_title: metaTitle,
        rank_math_description: metaDescription,
        rank_math_focus_keyword: focusKeyword,
      };
    case "aioseo":
      return {
        _aioseo_title: metaTitle,
        _aioseo_description: metaDescription,
        _aioseo_keywords: focusKeyword,
      };
    case "none":
    default:
      return {
        _meta_title: metaTitle,
        _meta_description: metaDescription,
        _focus_keyword: focusKeyword,
      };
  }
}

// ---------------------------------------------------------------------------
// WordPress Publisher
// ---------------------------------------------------------------------------

/**
 * Publish an article to WordPress via the REST API v2.
 *
 * Steps:
 * 1. (Optional) Upload featured image via /wp-json/wp/v2/media
 * 2. Create post via /wp-json/wp/v2/posts
 * 3. Write SEO meta fields via /wp-json/wp/v2/posts/<id> (meta update)
 */
export async function publishToWordPress(
  credentials: WordPressCredentials,
  article: ArticlePayload
): Promise<PublishResult> {
  const base = normaliseWpUrl(credentials.siteUrl);
  const auth = wpBasicAuth(credentials.username, credentials.applicationPassword);
  const headers: Record<string, string> = {
    Authorization: auth,
    "Content-Type": "application/json",
    "User-Agent": "BlogBatcher/1.0",
  };

  try {
    // ── Step 1: Upload featured image (if provided) ─────────────────────────
    let featuredMediaId: number | undefined;
    if (article.imageUrl) {
      try {
        // Download the image and re-upload to WordPress media library
        const imgResponse = await fetch(article.imageUrl);
        if (imgResponse.ok) {
          const imgBuffer = await imgResponse.arrayBuffer();
          const contentType = imgResponse.headers.get("content-type") ?? "image/jpeg";
          const ext = contentType.split("/")[1]?.split(";")[0] ?? "jpg";
          const filename = `${article.urlSlug}-featured.${ext}`;
          const mediaRes = await fetch(`${base}/wp-json/wp/v2/media`, {
            method: "POST",
            headers: {
              Authorization: auth,
              "Content-Type": contentType,
              "Content-Disposition": `attachment; filename="${filename}"`,
              "User-Agent": "BlogBatcher/1.0",
            },
            body: imgBuffer,
          });
          if (mediaRes.ok) {
            const mediaData = (await mediaRes.json()) as { id: number };
            featuredMediaId = mediaData.id;
            // Set alt text via separate PATCH
            if (article.imageAltText) {
              await fetch(`${base}/wp-json/wp/v2/media/${featuredMediaId}`, {
                method: "POST",
                headers,
                body: JSON.stringify({ alt_text: article.imageAltText }),
              });
            }
          }
        }
      } catch {
        // Image upload failure is non-fatal — continue without featured image
        console.warn("[WP Publisher] Featured image upload failed, continuing without it");
      }
    }

    // ── Step 2: Determine publish status and date ────────────────────────────
    let wpStatus: "publish" | "future" | "draft" = article.publishAsDraft ? "draft" : "publish";
    let wpDate: string | undefined;
    if (!article.publishAsDraft && article.scheduledPublishAt) {
      const now = new Date();
      if (article.scheduledPublishAt > now) {
        wpStatus = "future";
        // WordPress expects local time in ISO format without timezone
        wpDate = article.scheduledPublishAt.toISOString().replace("Z", "");
      }
    }

    // ── Step 3: Build article body with schema JSON-LD appended ─────────────
    let body = article.bodyHtml;
    if (article.schemaMarkup) {
      body += `\n<script type="application/ld+json">${article.schemaMarkup}</script>`;
    }

    // ── Step 4: Create the post ──────────────────────────────────────────────
    const postPayload: Record<string, unknown> = {
      title: article.title,
      content: body,
      slug: article.urlSlug,
      status: wpStatus,
      excerpt: article.metaDescription,
    };
    if (wpDate) postPayload.date = wpDate;
    if (featuredMediaId) postPayload.featured_media = featuredMediaId;

    // Include SEO meta fields in the post creation payload
    const seoMeta = seoPluginFields(
      credentials.seoPlugin,
      article.metaTitle,
      article.metaDescription,
      article.focusKeyword
    );
    // Also store schema as a custom field for all plugin modes
    if (article.schemaMarkup) {
      seoMeta["_blog_batcher_schema"] = article.schemaMarkup;
    }
    postPayload.meta = seoMeta;

    const postRes = await fetch(`${base}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify(postPayload),
    });

    if (!postRes.ok) {
      const errBody = await postRes.text();
      let errMsg = `WordPress API error ${postRes.status}`;
      try {
        const parsed = JSON.parse(errBody) as { message?: string; code?: string };
        if (parsed.message) errMsg = parsed.message;
        if (parsed.code === "rest_cannot_create") errMsg = "Invalid API credentials or insufficient permissions";
        if (parsed.code === "rest_post_invalid_slug") errMsg = "URL slug already exists on this WordPress site";
      } catch {
        // use raw text if not JSON
        if (errBody.length < 200) errMsg = errBody;
      }
      return { success: false, error: errMsg };
    }

    const postData = (await postRes.json()) as { id: number; link: string };
    return {
      success: true,
      cmsPostId: String(postData.id),
      cmsPostUrl: postData.link,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return { success: false, error: "CMS connection timed out — check the site URL and ensure the site is reachable" };
    }
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// WordPress Connection Test
// ---------------------------------------------------------------------------

/**
 * Test WordPress credentials by calling /wp-json/wp/v2/users/me.
 * Returns { success, error? }.
 */
export async function testWordPressConnection(
  credentials: WordPressCredentials
): Promise<{ success: boolean; error?: string }> {
  const base = normaliseWpUrl(credentials.siteUrl);
  const auth = wpBasicAuth(credentials.username, credentials.applicationPassword);
  try {
    const res = await fetch(`${base}/wp-json/wp/v2/users/me`, {
      headers: {
        Authorization: auth,
        "User-Agent": "BlogBatcher/1.0",
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { name?: string; capabilities?: Record<string, boolean> };
      // Verify the user has publish_posts capability
      if (data.capabilities && !data.capabilities["publish_posts"]) {
        return { success: false, error: "This WordPress user does not have permission to publish posts" };
      }
      return { success: true };
    }
    if (res.status === 401) {
      return { success: false, error: "Invalid credentials — check your username and Application Password" };
    }
    if (res.status === 403) {
      return { success: false, error: "Access forbidden — ensure Application Passwords are enabled in WordPress" };
    }
    return { success: false, error: `WordPress returned HTTP ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return { success: false, error: "Cannot reach the WordPress site — check the URL and ensure the site is online" };
    }
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Wix Ricos Converter
// ---------------------------------------------------------------------------

/**
 * Convert HTML string to Wix Ricos (Rich Content) node tree.
 * Handles the HTML tags generated by our articleEngine:
 *   h1-h6, p, ul, ol, li, blockquote, strong, em, a, br
 * All other tags are treated as plain text.
 */
export function htmlToRicos(html: string): Record<string, unknown> {
  // Use a simple regex-based parser since we control the HTML structure
  const nodes: Record<string, unknown>[] = [];
  let idCounter = 0;
  const nextId = () => `n${++idCounter}`;

  /** Wrap text runs + inline decorations into TEXT nodes */
  function parseInlineHtml(innerHtml: string): Record<string, unknown>[] {
    const textNodes: Record<string, unknown>[] = [];
    // Strip all remaining tags except <strong>, <em>, <a>
    // Split on inline tags to extract decorations
    const parts = innerHtml.split(/(<strong[^>]*>.*?<\/strong>|<b[^>]*>.*?<\/b>|<em[^>]*>.*?<\/em>|<i[^>]*>.*?<\/i>|<a[^>]*>.*?<\/a>|<br\s*\/?>)/i);
    for (const part of parts) {
      if (!part) continue;
      const decorations: Record<string, unknown>[] = [];
      let text = part;

      if (/<strong|<b/i.test(part)) {
        text = part.replace(/<[^>]+>/g, "");
        decorations.push({ type: "BOLD" });
      } else if (/<em|<i/i.test(part)) {
        text = part.replace(/<[^>]+>/g, "");
        decorations.push({ type: "ITALIC" });
      } else if (/<a /i.test(part)) {
        const hrefMatch = part.match(/href=["']([^"']+)["']/i);
        text = part.replace(/<[^>]+>/g, "");
        if (hrefMatch) {
          // Wix Ricos target enum: 0=SELF, 1=BLANK, 2=PARENT, 3=TOP
          const targetAttr = part.match(/target=["']([^"']+)["']/i)?.[1] ?? "_blank";
          const targetEnum = targetAttr === "_self" ? 0 : targetAttr === "_parent" ? 2 : targetAttr === "_top" ? 3 : 1;
          decorations.push({ type: "LINK", linkData: { link: { url: hrefMatch[1], target: targetEnum } } });
        }
      } else if (/<br/i.test(part)) {
        text = "\n";
      } else {
        // Plain text — strip any stray tags
        text = part.replace(/<[^>]+>/g, "");
      }

      // Decode HTML entities
      text = text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");

      if (!text) continue;
      textNodes.push({
        type: "TEXT",
        id: nextId(),
        nodes: [],
        textData: { text, decorations },
      });
    }
    return textNodes.length > 0 ? textNodes : [{ type: "TEXT", id: nextId(), nodes: [], textData: { text: "", decorations: [] } }];
  }

  /** Wrap inline nodes in a PARAGRAPH */
  function makeParagraph(innerHtml: string): Record<string, unknown> {
    return {
      type: "PARAGRAPH",
      id: nextId(),
      nodes: parseInlineHtml(innerHtml),
      paragraphData: {},
    };
  }

  // ── Pre-process: flatten wrapper divs/sections so nested block content is never dropped ──
  // Strategy: scan the HTML character-by-character to find matching open/close tag pairs.
  // For each div/section/article/header wrapper, if its content contains block-level children,
  // replace the wrapper with just its inner content. Repeat until stable.
  function flattenWrappers(input: string): string {
    const WRAPPER_TAGS = new Set(["div", "section", "article", "header"]);
    const BLOCK_TAGS = new Set(["h1","h2","h3","h4","h5","h6","p","ul","ol","blockquote","div","section","article","header"]);

    // Find the matching close tag for an open tag starting at `openStart`.
    // Returns the index of the start of the closing tag, or -1 if not found.
    function findMatchingClose(html: string, tagName: string, openStart: number): number {
      const openTag = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, "gi");
      const closeTag = new RegExp(`<\\/${tagName}>`, "gi");
      openTag.lastIndex = openStart + 1; // skip the opening tag itself
      closeTag.lastIndex = openStart + 1;
      let depth = 1;
      let pos = openStart + 1;
      while (depth > 0 && pos < html.length) {
        openTag.lastIndex = pos;
        closeTag.lastIndex = pos;
        const nextOpen = openTag.exec(html);
        const nextClose = closeTag.exec(html);
        if (!nextClose) return -1;
        if (nextOpen && nextOpen.index < nextClose.index) {
          depth++;
          pos = nextOpen.index + nextOpen[0].length;
        } else {
          depth--;
          if (depth === 0) return nextClose.index;
          pos = nextClose.index + nextClose[0].length;
        }
      }
      return -1;
    }

    let result = input;
    for (let pass = 0; pass < 12; pass++) {
      const prev = result;
      // Find the first wrapper tag
      const wrapperPattern = /<(div|section|article|header)(\s[^>]*)?>/ ;
      const m = wrapperPattern.exec(result);
      if (!m) break;
      const tagName = m[1].toLowerCase();
      const openStart = m.index;
      const openEnd = openStart + m[0].length;
      const closeStart = findMatchingClose(result, tagName, openStart);
      if (closeStart === -1) break; // malformed HTML — stop
      const closeEnd = closeStart + `</${tagName}>`.length;
      const inner = result.slice(openEnd, closeStart);
      // If inner contains block-level tags, unwrap
      const innerTagMatch = /<(\w+)[\s>]/i.exec(inner);
      const hasBlockChild = innerTagMatch ? BLOCK_TAGS.has(innerTagMatch[1].toLowerCase()) : false;
      const hasAnyBlock = /<(h[1-6]|p|ul|ol|blockquote|div|section|article|header)[\s>]/i.test(inner);
      if (hasBlockChild || hasAnyBlock) {
        result = result.slice(0, openStart) + inner + result.slice(closeEnd);
      } else {
        // No block children — this wrapper is a leaf, skip past it
        // to avoid infinite loop. We replace it with a <p> so it gets parsed.
        result = result.slice(0, openStart) + `<p>${inner}</p>` + result.slice(closeEnd);
      }
      if (result === prev) break;
    }
    return result;
  }
  const flatHtml = flattenWrappers(html);

  // Tokenise the HTML into block-level elements
  // We process h1-h6, p, ul, ol, li, blockquote, and fall back to paragraph for anything else
  const blockPattern = /<(h[1-6]|p|ul|ol|blockquote|div|section|article|header|figure|figcaption)([^>]*?)>([\s\S]*?)<\/\1>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(flatHtml)) !== null) {
    // Capture any text between blocks as a paragraph
    const before = flatHtml.slice(lastIndex, match.index).trim();
    if (before) {
      const cleaned = before.replace(/<[^>]+>/g, "").trim();
      if (cleaned) nodes.push(makeParagraph(before));
    }
    lastIndex = match.index + match[0].length;

    const tag = (match[1] || "li").toLowerCase();
    const inner = (match[3] || match[5] || "").trim();

    if (tag.match(/^h[1-6]$/)) {
      const level = parseInt(tag[1]);
      // Map h1→1, h2→2, etc. (Wix HEADING levels 1-6)
      nodes.push({
        type: "HEADING",
        id: nextId(),
        nodes: parseInlineHtml(inner),
        headingData: { level, indentation: 0 },
      });
    } else if (tag === "blockquote") {
      nodes.push({
        type: "BLOCKQUOTE",
        id: nextId(),
        nodes: [makeParagraph(inner)],
        blockquoteData: { indentation: 1 },
      });
    } else if (tag === "ul") {
      // Parse li items inside the ul
      const liPattern = /<li[^>]*?>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      const listItems: Record<string, unknown>[] = [];
      while ((liMatch = liPattern.exec(inner)) !== null) {
        listItems.push({
          type: "LIST_ITEM",
          id: nextId(),
          nodes: [makeParagraph(liMatch[1].trim())],
        });
      }
      if (listItems.length > 0) {
        nodes.push({
          type: "BULLETED_LIST",
          id: nextId(),
          nodes: listItems,
        });
      }
    } else if (tag === "ol") {
      const liPattern = /<li[^>]*?>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      const listItems: Record<string, unknown>[] = [];
      while ((liMatch = liPattern.exec(inner)) !== null) {
        listItems.push({
          type: "LIST_ITEM",
          id: nextId(),
          nodes: [makeParagraph(liMatch[1].trim())],
        });
      }
      if (listItems.length > 0) {
        nodes.push({
          type: "ORDERED_LIST",
          id: nextId(),
          nodes: listItems,
        });
      }
    } else if (tag === "p" || tag === "div" || tag === "section" || tag === "article" || tag === "header") {
      if (inner.trim()) {
        // If inner still contains block-level tags (deeply nested), recurse via flatHtml pass
        const hasBlocks = /<(h[1-6]|p|ul|ol|blockquote)[ >]/i.test(inner);
        if (hasBlocks) {
          // Extract plain text to avoid losing content
          const textOnly = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          if (textOnly) nodes.push(makeParagraph(textOnly));
        } else {
          nodes.push(makeParagraph(inner));
        }
      }
    } else if (tag === "figure" || tag === "figcaption") {
      // Skip figure/figcaption wrappers — we don't have Wix media IDs
      const textOnly = inner.replace(/<[^>]+>/g, "").trim();
      if (textOnly) nodes.push(makeParagraph(textOnly));
    }
  }

  // Capture any trailing text after the last block
  const trailing = flatHtml.slice(lastIndex).trim();
  if (trailing) {
    const cleaned = trailing.replace(/<[^>]+>/g, "").trim();
    if (cleaned) nodes.push(makeParagraph(trailing));
  }

  // Ensure at least one node
  if (nodes.length === 0) {
    const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    nodes.push(makeParagraph(plainText || "(no content)"));
  }

  // Insert an empty PARAGRAPH spacer between every pair of nodes so Wix
  // renders visual spacing between headings, paragraphs, and lists.
  const spacedNodes: Record<string, unknown>[] = [];
  for (let i = 0; i < nodes.length; i++) {
    spacedNodes.push(nodes[i]);
    if (i < nodes.length - 1) {
      spacedNodes.push({
        type: "PARAGRAPH",
        id: nextId(),
        nodes: [{ type: "TEXT", id: nextId(), nodes: [], textData: { text: "", decorations: [] } }],
        paragraphData: {},
      });
    }
  }

  return { nodes: spacedNodes, metadata: { version: 1 } };
}

// ---------------------------------------------------------------------------
// Wix Publisher
// ---------------------------------------------------------------------------

/**
 * Publish an article to Wix via the Wix Blog API v3.
 * Wix Blog API: https://dev.wix.com/api/rest/wix-blog/blog/posts
 *
 * Flow:
 * 1. Create a draft post
 * 2. Publish the draft
 */
export async function publishToWix(
  credentials: WixCredentials,
  article: ArticlePayload
): Promise<PublishResult> {
  const { apiKey, siteId } = credentials;
  const baseHeaders: Record<string, string> = {
    Authorization: apiKey,
    "wix-site-id": siteId,
    "Content-Type": "application/json",
    "User-Agent": "BlogBatcher/1.0",
  };

  try {
    // ── Step 1: Create draft post ──────────────────────────────────────────────────────────────────────────────
    // NOTE: Wix Blog API v3 auto-generates the slug from the title.
    // The slug field in draftPost is read-only for 3rd-party apps.
    // memberId is required for 3rd-party API key authentication.

    // Pre-process body HTML before converting to Ricos:
    // 1. Remove the first <h1> tag (Wix renders the post title separately — having it in the body creates a duplicate)
    // 2. Remove the AI disclosure paragraph (it's a meta note, not article content)
    // 3. Prepend the featured image inline so it appears in the post body (Wix featured image only shows in post card/header, not body)
    let cleanBodyHtml = stripAiDisclosure(
      article.bodyHtml.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, ""), // strip first H1 (duplicate of title)
    );

    // NOTE: Do NOT prepend image HTML — the htmlToRicos converter skips <figure>/<img> tags.
    // Instead we inject a proper Ricos IMAGE node directly after conversion (see below).

    // Build excerpt from meta description (max 500 chars per Wix limit)
    const excerpt = article.metaDescription
      ? article.metaDescription.slice(0, 500)
      : undefined;

    // Build hashtags from focus keyword (Wix uses hashtags for keyword association)
    const hashtags = article.focusKeyword
      ? article.focusKeyword.split(/[,\s]+/).filter(Boolean).slice(0, 10)
      : [];

    // ── Step 1b: Import cover image into Wix Media Manager (if imageUrl provided) ──
    // Wix Blog API requires a Wix Media ID for cover images — external URLs are not accepted directly.
    // We import the image via the Wix Media Manager Import File API to get a media ID.
    let wixMediaId: string | null = null;
    if (article.imageUrl) {
      const wixInternalMatch = article.imageUrl.match(/^wix:image:\/\/v1\/([^/]+)/);
      if (wixInternalMatch) {
        // Already a Wix-hosted image — extract the media file ID directly.
        // The wix:image://v1/ path contains the full filename e.g. "abc123~mv2.png".
        // For the heroImage.id field, Wix expects just the base ID without the ~mv2.ext suffix.
        // For the image src url/id fields, the full filename is needed.
        wixMediaId = wixInternalMatch[1];
        console.log(`[Wix] Detected wix:image:// URL — using media ID directly: ${wixMediaId}`);
      } else if (article.imageUrl.startsWith("https://") || article.imageUrl.startsWith("http://")) {
        // External URL — import into Wix Media Manager first
        console.log(`[Wix] Importing external cover image from URL: ${article.imageUrl}`);
        try {
          const importRes = await fetch("https://www.wixapis.com/site-media/v1/files/import", {
            method: "POST",
            headers: baseHeaders,
            body: JSON.stringify({
              url: article.imageUrl,
              mediaType: "IMAGE",
              displayName: `${article.title} - Cover Image`,
            }),
          });
          const importText = await importRes.text();
          console.log(`[Wix] Image import response status: ${importRes.status}`);
          console.log(`[Wix] Image import response body: ${importText.slice(0, 500)}`);
          if (importRes.ok) {
            const importData = JSON.parse(importText) as { file?: { id?: string; operationStatus?: string } };
            const pendingId = importData.file?.id ?? null;
            console.log(`[Wix] Got media ID from import: ${pendingId} (status: ${importData.file?.operationStatus})`);

            if (pendingId) {
              // Wix media import is async — operationStatus starts as PENDING.
              // We must poll until READY (or timeout) before using the ID in a draft.
              // Poll every 1.5s for up to 15s.
              let ready = importData.file?.operationStatus === "READY";
              if (!ready) {
                console.log(`[Wix] Waiting for media import to complete...`);
                for (let attempt = 0; attempt < 10 && !ready; attempt++) {
                  await new Promise(r => setTimeout(r, 1500));
                  try {
                    const pollRes = await fetch(
                      `https://www.wixapis.com/site-media/v1/files/${encodeURIComponent(pendingId)}`,
                      { headers: baseHeaders }
                    );
                    if (pollRes.ok) {
                      const pollData = await pollRes.json() as { file?: { operationStatus?: string } };
                      const status = pollData.file?.operationStatus;
                      console.log(`[Wix] Media poll attempt ${attempt + 1}: status = ${status}`);
                      if (status === "READY") ready = true;
                    }
                  } catch (pollErr) {
                    console.log(`[Wix] Media poll error: ${pollErr}`);
                  }
                }
              }

              if (ready) {
                wixMediaId = pendingId;
                console.log(`[Wix] Media ready — using ID: ${wixMediaId}`);
              } else {
                console.log(`[Wix] Media import timed out waiting for READY — skipping cover image`);
              }
            }
          } else {
            console.log(`[Wix] Image import failed — continuing without cover image`);
          }
        } catch (err) {
          console.log(`[Wix] Image import exception: ${err}`);
        }
      } else {
        console.log(`[Wix] Unrecognised image URL format: ${article.imageUrl} — skipping cover image`);
      }
    } else {
      console.log(`[Wix] No imageUrl provided — skipping cover image`);
    }

    // Convert body HTML to Ricos richContent
    const richContent = htmlToRicos(cleanBodyHtml);

    // Inject a proper Ricos IMAGE node at the TOP of the content nodes so the image
    // appears inside the post body. The htmlToRicos converter skips <figure>/<img> tags
    // so we must inject directly. Format confirmed from Wix developer examples.
    if (wixMediaId) {
      const altText = article.imageAltText || article.title;
      const imageNode: Record<string, unknown> = {
        type: "IMAGE",
        id: "img1",
        nodes: [],
        imageData: {
          containerData: {
            width: { custom: "700px" },
            alignment: "CENTER",
            spoiler: { enabled: false },
            textWrap: true,
          },
          image: {
            src: {
              private: false,
              url: `https://static.wixstatic.com/media/${wixMediaId}`,
              id: wixMediaId,
            },
            altText,
          },
        },
      };
      // Insert image after the first paragraph node, with blank-line spacers above and below.
      // This places the featured image after the intro paragraph rather than at the very top.
      const spacerBefore: Record<string, unknown> = {
        type: "PARAGRAPH",
        id: "img-spacer-before",
        nodes: [{ type: "TEXT", id: "img-spacer-before-t", nodes: [], textData: { text: "", decorations: [] } }],
        paragraphData: {},
      };
      const spacerAfter: Record<string, unknown> = {
        type: "PARAGRAPH",
        id: "img-spacer-after",
        nodes: [{ type: "TEXT", id: "img-spacer-after-t", nodes: [], textData: { text: "", decorations: [] } }],
        paragraphData: {},
      };
      const nodes = richContent.nodes as Record<string, unknown>[];

      // We want to insert the image after the entire opening answer block.
      // The block consists of: [bold-question paragraph] [spacer] [answer paragraph]
      // After htmlToRicos + spacer insertion, the layout is:
      //   0: PARAGRAPH (question, has BOLD text node)
      //   1: PARAGRAPH (empty spacer)
      //   2: PARAGRAPH (answer text)
      //   3: PARAGRAPH (empty spacer)
      //   ...
      // Strategy: skip the first real paragraph + any following spacers, then skip
      // the second real paragraph, and insert after that.
      // A "spacer" paragraph is one whose only text node has empty text.
      const isSpacerNode = (n: Record<string, unknown>) => {
        if (n.type !== "PARAGRAPH") return false;
        const children = n.nodes as Record<string, unknown>[] | undefined;
        if (!children || children.length === 0) return true;
        return children.every(c => {
          const td = (c as Record<string, unknown>).textData as Record<string, unknown> | undefined;
          return !td || (td.text as string) === "";
        });
      };

      let realParaCount = 0;
      let insertAt = nodes.length; // fallback: append at end
      for (let i = 0; i < nodes.length; i++) {
        if (!isSpacerNode(nodes[i])) {
          realParaCount++;
          if (realParaCount === 2) {
            // Insert after this node (and any immediately following spacer)
            let j = i + 1;
            while (j < nodes.length && isSpacerNode(nodes[j])) j++;
            insertAt = j;
            break;
          }
        }
      }
      // If there's only one real paragraph (very short intro), fall back to after the first
      if (realParaCount < 2) {
        const firstParaIdx = nodes.findIndex(n => n.type === "PARAGRAPH");
        insertAt = firstParaIdx >= 0 ? firstParaIdx + 1 : 0;
      }

      nodes.splice(insertAt, 0, spacerBefore, imageNode, spacerAfter);
    }

    const draftBody: Record<string, unknown> = {
      draftPost: {
        title: article.title,
        richContent,
        memberId: credentials.memberId,
        ...(excerpt ? { excerpt } : {}),
        ...(hashtags.length > 0 ? { hashtags } : {}),
        // heroImage: Wix expects id = full filename (e.g. c79156_abc~mv2.png),
        // url = full wixstatic URL with filename.
        ...(wixMediaId ? {
          heroImage: {
            // Use the full filename as the id (e.g. c79156_abc123~mv2.png)
            // Wix media manager lookup uses the full filename, NOT the stripped base ID
            id: wixMediaId,
            url: `https://static.wixstatic.com/media/${wixMediaId}`,
            altText: article.imageAltText || article.focusKeyword || article.title,
          },
        } : {}),
        // SEO slug
        ...(article.urlSlug ? { seoSlug: article.urlSlug } : {}),
        seoData: {
          tags: [
            {
              type: "title",
              children: article.metaTitle || article.title,
              custom: false,
              isDisabled: false,
            },
            {
              type: "meta",
              props: { name: "description", content: article.metaDescription || "" },
              custom: false,
              isDisabled: false,
            },
            // Focus keyword — populates Wix SEO Assistant "Focus keyword" field
            ...(article.focusKeyword ? [{
              type: "meta",
              props: { name: "keywords", content: article.focusKeyword },
              custom: false,
              isDisabled: false,
            }] : []),
          ],
        },
      },
    };

    // Note: Wix scheduledPublishDate is read-only — scheduling is done via
    // firstPublishedDate on the /publish call (see Step 2 below)

    const createRes = await fetch(
      "https://www.wixapis.com/blog/v3/draft-posts",
      {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(draftBody),
      }
    );

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`[Wix] Draft creation failed — HTTP ${createRes.status}`);
      console.error(`[Wix] Response body: ${errText.slice(0, 2000)}`);
      let errMsg = `Wix API error ${createRes.status}`;
      try {
        const parsed = JSON.parse(errText) as { message?: string; details?: unknown };
        if (parsed.message) errMsg = `${parsed.message}${parsed.details ? ` — ${JSON.stringify(parsed.details)}` : ''}`;
      } catch { /* use status */ }
      return { success: false, error: errMsg };
    }

    const createData = (await createRes.json()) as { draftPost?: { id?: string } };
    const draftId = createData.draftPost?.id;
    if (!draftId) {
      return { success: false, error: "Wix did not return a draft post ID" };
    }

    // ── Step 2: Publish the draft (or leave as draft / scheduled) ──────────
    // If publishAsDraft is set, leave as draft — do NOT call publish endpoint
    if (article.publishAsDraft) {
      return {
        success: true,
        cmsPostId: draftId,
        cmsPostUrl: "",
      };
    }

    // Wix REST API has NO scheduling endpoint — calling /publish always publishes immediately.
    // For scheduled posts: leave as draft and let the Heartbeat job call publish at the right time.
    const isScheduled = article.scheduledPublishAt && article.scheduledPublishAt > new Date();
    if (isScheduled) {
      console.log(`[Wix] Scheduled post — leaving as draft. Heartbeat will publish at ${(article.scheduledPublishAt as Date).toISOString()}`);
      return {
        success: true,
        cmsPostId: draftId,
        cmsPostUrl: "",
      };
    }

    const publishRes = await fetch(
      `https://www.wixapis.com/blog/v3/draft-posts/${draftId}/publish`,
      {
        method: "POST",
        headers: baseHeaders,
        // memberId is required by Wix Blog v3 /publish endpoint to identify the post owner
        body: JSON.stringify(credentials.memberId ? { memberId: credentials.memberId } : {}),
      }
    );

    if (!publishRes.ok) {
      const errText = await publishRes.text();
      let errMsg = `Wix publish error ${publishRes.status}`;
      try {
        const parsed = JSON.parse(errText) as { message?: string };
        if (parsed.message) errMsg = parsed.message;
      } catch { /* use status */ }
      return { success: false, error: errMsg };
    }

    const publishData = (await publishRes.json()) as { post?: WixPostShape };
    const postId = publishData.post?.id ?? draftId;
    let cmsPostUrl = buildWixUrl(publishData.post);
    // The publish response often omits the URL — fetch the post to get it.
    if (!cmsPostUrl && postId) cmsPostUrl = await fetchWixPostUrl(baseHeaders, postId);
    return { success: true, cmsPostId: postId, cmsPostUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return { success: false, error: "Cannot reach Wix API — check your API key and Site ID" };
    }
    return { success: false, error: msg };
  }
}

/** Wix post URL comes back as { base, path } (or occasionally a plain string). */
interface WixPostShape {
  id?: string;
  url?: string | { base?: string; path?: string };
}

/** Build a usable absolute URL from a Wix post's url field ({base,path} or string). */
function buildWixUrl(post: WixPostShape | undefined): string {
  if (!post || !post.url) return "";
  const u = post.url;
  if (typeof u === "string") return u;
  const base = (u.base ?? "").replace(/\/+$/, "");
  const path = u.path ?? "";
  if (!base && !path) return "";
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Fetch a published Wix post to read its canonical URL (fallback when publish omits it). */
async function fetchWixPostUrl(headers: Record<string, string>, postId: string): Promise<string> {
  try {
    const res = await fetch(`https://www.wixapis.com/blog/v3/posts/${postId}`, { headers });
    if (!res.ok) return "";
    const data = (await res.json()) as { post?: WixPostShape };
    return buildWixUrl(data.post);
  } catch {
    return "";
  }
}

/** Look up a published Wix post's canonical URL from its stored post ID (repairs empty cmsPostUrl). */
export async function getWixPostUrlById(credentials: WixCredentials, postId: string): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: credentials.apiKey,
    "wix-site-id": credentials.siteId,
    "Content-Type": "application/json",
    "User-Agent": "BlogBatcher/1.0",
  };
  return fetchWixPostUrl(headers, postId);
}

// ---------------------------------------------------------------------------
// Wix — update an existing post's body and re-publish (Phase 2b backfill).
// Updates ONLY the rich content of the existing draft, then re-publishes it, so
// internal links can be switched on without creating a duplicate post.
// Fail-safe: if any step errors, the currently-live post is left untouched.
// ---------------------------------------------------------------------------

export async function updateWixPostBody(
  credentials: WixCredentials,
  postId: string,
  newBodyHtml: string,
): Promise<PublishResult> {
  const { apiKey, siteId } = credentials;
  const headers: Record<string, string> = {
    Authorization: apiKey,
    "wix-site-id": siteId,
    "Content-Type": "application/json",
    "User-Agent": "BlogBatcher/1.0",
  };
  try {
    const cleanBody = stripAiDisclosure(newBodyHtml.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, ""));
    const richContent = htmlToRicos(cleanBody);

    // Update the draft's rich content only.
    const patchRes = await fetch(`https://www.wixapis.com/blog/v3/draft-posts/${postId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ draftPost: { id: postId, richContent }, fieldMask: { paths: ["richContent"] } }),
    });
    const patchText = await patchRes.text();
    if (!patchRes.ok) {
      return { success: false, error: `Wix update failed (${patchRes.status})`, raw: patchText.slice(0, 1200) };
    }

    // Re-publish the updated draft.
    const pubRes = await fetch(`https://www.wixapis.com/blog/v3/draft-posts/${postId}/publish`, {
      method: "POST",
      headers,
      body: JSON.stringify(credentials.memberId ? { memberId: credentials.memberId } : {}),
    });
    const pubText = await pubRes.text();
    if (!pubRes.ok) {
      return { success: false, error: `Wix re-publish failed (${pubRes.status})`, raw: pubText.slice(0, 1200) };
    }
    let url = "";
    let id = postId;
    try {
      const data = JSON.parse(pubText) as { post?: WixPostShape };
      url = buildWixUrl(data.post);
      id = data.post?.id ?? postId;
    } catch { /* keep defaults */ }
    if (!url && id) url = await fetchWixPostUrl(headers, id);
    return { success: true, cmsPostId: id, cmsPostUrl: url, raw: pubText.slice(0, 600) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Look up a Wix post ID by its slug (fallback when cmsPostId wasn't stored). */
export async function findWixPostIdBySlug(
  credentials: WixCredentials,
  slug: string,
): Promise<string | null> {
  const { apiKey, siteId } = credentials;
  const headers: Record<string, string> = {
    Authorization: apiKey,
    "wix-site-id": siteId,
    "Content-Type": "application/json",
    "User-Agent": "BlogBatcher/1.0",
  };
  const cleanSlug = slug.replace(/^\/+/, "").replace(/\/+$/, "");
  try {
    const res = await fetch(
      `https://www.wixapis.com/blog/v3/posts/slugs/${encodeURIComponent(cleanSlug)}`,
      { headers },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { post?: { id?: string } };
    return data.post?.id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Wix Connection Test
// ---------------------------------------------------------------------------

export async function testWixConnection(
  credentials: WixCredentials
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://www.wixapis.com/blog/v3/posts?limit=1`,
      {
        headers: {
          Authorization: credentials.apiKey,
          "wix-site-id": credentials.siteId,
          "User-Agent": "BlogBatcher/1.0",
        },
      }
    );
    if (res.ok) return { success: true };
    if (res.status === 401 || res.status === 403) {
      return { success: false, error: "Invalid Wix API key or Site ID" };
    }
    return { success: false, error: `Wix API returned HTTP ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Zapier Publisher
// ---------------------------------------------------------------------------

/**
 * Send article payload to a Zapier or Make (Integromat) webhook URL.
 *
 * This is the recommended publish path for Wix users who need full SEO field
 * control (URL slug, focus keyword, image alt text, schema) that the Wix Blog
 * API v3 does not expose to 3rd-party apps.
 *
 * The payload is intentionally flat and comprehensive so that any automation
 * tool (Zapier, Make, n8n, Pabbly, etc.) can map every field to the target CMS
 * without needing to transform or enrich the data.
 *
 * Field reference:
 *   title                  — Post title (plain text)
 *   body_html              — Full article body as HTML
 *   meta_title             — SEO meta title (≤60 chars)
 *   meta_description       — SEO meta description (140–160 chars)
 *   focus_keyword          — Primary SEO keyword
 *   url_slug               — URL-safe slug (e.g. "best-pitch-deck-tips")
 *   excerpt                — Short preview blurb (≤500 chars, same as meta_description)
 *   schema_json_ld         — JSON-LD structured data string (or null)
 *   image_url              — Featured image URL (or null)
 *   image_alt_text         — Featured image alt text (or null)
 *   hashtags               — Array of keyword tags derived from focus_keyword
 *   article_level          — "cornerstone" | "pillar" | "cluster"
 *   publish_mode           — "live" | "draft" | "scheduled"
 *   scheduled_publish_date — ISO 8601 UTC datetime string (or null)
 *   source                 — Always "BlogBatcher" — use to identify the trigger in your Zap/scenario
 */
export async function publishToZapier(
  credentials: ZapierCredentials,
  article: ArticlePayload
): Promise<PublishResult> {
  // Derive hashtags from focus keyword (same logic as Wix direct path)
  const hashtags = article.focusKeyword
    ? article.focusKeyword.split(/[,\s]+/).filter(Boolean).slice(0, 10)
    : [];

  // Derive publish mode
  const publishMode = article.publishAsDraft
    ? "draft"
    : article.scheduledPublishAt && article.scheduledPublishAt > new Date()
      ? "scheduled"
      : "live";

  const payload = {
    // ── Core content ──────────────────────────────────────────────────────────
    title: article.title,
    body_html: article.bodyHtml,
    excerpt: article.metaDescription ? article.metaDescription.slice(0, 500) : null,

    // ── SEO fields (all fields — including those Wix API locks for 3rd parties)
    meta_title: article.metaTitle || article.title,
    meta_description: article.metaDescription || null,
    focus_keyword: article.focusKeyword || null,
    url_slug: article.urlSlug || null,
    hashtags,

    // ── Structured data ───────────────────────────────────────────────────────
    schema_json_ld: article.schemaMarkup ?? null,

    // ── Media ─────────────────────────────────────────────────────────────────
    image_url: article.imageUrl ?? null,
    image_alt_text: article.imageAltText ?? null,

    // ── Publishing metadata ───────────────────────────────────────────────────
    article_level: article.level,
    publish_mode: publishMode,
    scheduled_publish_date: article.scheduledPublishAt
      ? article.scheduledPublishAt.toISOString()
      : null,

    // ── Source identifier ─────────────────────────────────────────────────────
    source: "BlogBatcher",
  };

  try {
    const res = await fetch(credentials.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BlogBatcher/1.0",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return {
        success: false,
        error: `Zapier webhook returned HTTP ${res.status} — check your webhook URL is active`,
      };
    }

    // Zapier returns "1" or a JSON object on success
    return {
      success: true,
      cmsPostId: `zapier-${Date.now()}`,
      cmsPostUrl: credentials.webhookUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return { success: false, error: "Cannot reach Zapier webhook URL — check the URL is correct and the Zap is active" };
    }
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Zapier Connection Test
// ---------------------------------------------------------------------------

export async function testZapierConnection(
  credentials: ZapierCredentials
): Promise<{ success: boolean; error?: string }> {
  // Send a minimal test payload to the webhook
  const testPayload = { _test: true, source: "BlogBatcher", message: "Connection test" };
  try {
    const res = await fetch(credentials.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "BlogBatcher/1.0" },
      body: JSON.stringify(testPayload),
    });
    if (res.ok) return { success: true };
    return { success: false, error: `Zapier webhook returned HTTP ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Credential Encryption / Decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt CMS credentials for storage.
 * Uses AES-256-GCM via Node.js crypto.
 * The key is derived from JWT_SECRET (already available in env).
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { stripAiDisclosure } from "@shared/stripAiDisclosure";

function deriveKey(): Buffer {
  const secret = process.env.JWT_SECRET ?? "fallback-dev-secret";
  return createHash("sha256").update(secret).digest();
}

export function encryptCredentials(credentials: Record<string, string>): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv(hex):authTag(hex):ciphertext(hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptCredentials(encrypted: string): Record<string, string> | null {
  try {
    const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");
    if (!ivHex || !authTagHex || !ciphertextHex) return null;
    const key = deriveKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as Record<string, string>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shopify Publisher
// ---------------------------------------------------------------------------

export interface ShopifyCredentials {
  storeDomain: string;
  adminApiToken: string;
  blogId: string;
}

/**
 * Publish an article to Shopify via the Admin REST API.
 * Creates a blog article under the specified blog.
 */
export async function publishToShopify(
  credentials: ShopifyCredentials,
  article: ArticlePayload
): Promise<PublishResult> {
  const domain = credentials.storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${domain}/admin/api/2024-01/blogs/${credentials.blogId}/articles.json`;

  const published = !article.publishAsDraft &&
    !(article.scheduledPublishAt && article.scheduledPublishAt > new Date());

  const body: Record<string, unknown> = {
    article: {
      title: article.title,
      body_html: article.bodyHtml,
      published,
      handle: article.urlSlug || undefined,
      metafields: [
        { key: "title_tag", value: article.metaTitle || article.title, type: "single_line_text_field", namespace: "global" },
        { key: "description_tag", value: article.metaDescription || "", type: "single_line_text_field", namespace: "global" },
      ],
    },
  };

  if (article.imageUrl) {
    (body.article as Record<string, unknown>).image = { src: article.imageUrl, alt: article.imageAltText || "" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": credentials.adminApiToken,
        "User-Agent": "BlogBatcher/1.0",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Shopify API error ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json() as { article?: { id?: number; handle?: string } };
    const postId = String(data.article?.id ?? "");
    const postUrl = data.article?.handle
      ? `https://${domain}/blogs/${credentials.blogId}/${data.article.handle}`
      : undefined;

    return { success: true, cmsPostId: postId, cmsPostUrl: postUrl };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Webflow Publisher
// ---------------------------------------------------------------------------

export interface WebflowCredentials {
  apiToken: string;
  collectionId: string;
}

/**
 * Publish an article to Webflow CMS via the REST API v2.
 * Creates a CMS item in the specified Blog collection.
 */
export async function publishToWebflow(
  credentials: WebflowCredentials,
  article: ArticlePayload
): Promise<PublishResult> {
  const url = `https://api.webflow.com/v2/collections/${credentials.collectionId}/items`;

  const isDraft = article.publishAsDraft ||
    (article.scheduledPublishAt != null && article.scheduledPublishAt > new Date());

  const fieldData: Record<string, unknown> = {
    name: article.title,
    slug: article.urlSlug || undefined,
    "post-body": article.bodyHtml,
    "post-summary": article.metaDescription || "",
    "seo-title": article.metaTitle || article.title,
    "seo-description": article.metaDescription || "",
  };

  if (article.imageUrl) {
    fieldData["main-image"] = { url: article.imageUrl, alt: article.imageAltText || "" };
  }

  const body = {
    fieldData,
    isDraft,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials.apiToken}`,
        "User-Agent": "BlogBatcher/1.0",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Webflow API error ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json() as { id?: string; fieldData?: { slug?: string } };
    const postId = data.id ?? "";
    const slug = data.fieldData?.slug ?? article.urlSlug;

    return { success: true, cmsPostId: postId, cmsPostUrl: slug ? `(slug: ${slug})` : undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Squarespace Publisher
// ---------------------------------------------------------------------------

export interface SquarespaceCredentials {
  personalAccessToken: string;
}

/**
 * Publish an article to Squarespace via the Blog Posts API.
 * Requires a Personal Access Token with Blog Posts: Write permission.
 */
export async function publishToSquarespace(
  credentials: SquarespaceCredentials,
  article: ArticlePayload
): Promise<PublishResult> {
  const url = "https://api.squarespace.com/1.0/blog/posts";

  const isDraft = article.publishAsDraft ||
    (article.scheduledPublishAt != null && article.scheduledPublishAt > new Date());

  const body: Record<string, unknown> = {
    title: article.title,
    body: article.bodyHtml,
    urlSlug: article.urlSlug || undefined,
    seoData: {
      seoTitle: article.metaTitle || article.title,
      seoDescription: article.metaDescription || "",
    },
    status: isDraft ? "DRAFT" : "PUBLISHED",
  };

  if (article.imageUrl) {
    body.featuredMedia = { url: article.imageUrl, altText: article.imageAltText || "" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials.personalAccessToken}`,
        "User-Agent": "BlogBatcher/1.0",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Squarespace API error ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json() as { id?: string; urlSlug?: string };
    return {
      success: true,
      cmsPostId: data.id ?? "",
      cmsPostUrl: data.urlSlug ? `(slug: ${data.urlSlug})` : undefined,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Ghost Publisher
// ---------------------------------------------------------------------------

export interface GhostCredentials {
  adminUrl: string;
  staffAccessToken: string;
}

/**
 * Publish an article to Ghost via the Admin API.
 * Uses JWT authentication derived from the Staff Access Token (Admin API Key format: id:secret).
 */
export async function publishToGhost(
  credentials: GhostCredentials,
  article: ArticlePayload
): Promise<PublishResult> {
  // Ghost Admin API Key format: "id:secret" — split and create JWT
  const [keyId, keySecret] = credentials.staffAccessToken.split(":");
  if (!keyId || !keySecret) {
    return { success: false, error: "Invalid Ghost Admin API Key format. Expected format: id:secret" };
  }

  // Build JWT for Ghost Admin API
  const { createHmac } = await import("crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", kid: keyId, typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", Buffer.from(keySecret, "hex"))
    .update(signingInput)
    .digest("base64url");
  const jwt = `${signingInput}.${signature}`;

  const adminUrl = credentials.adminUrl.replace(/\/$/, "");
  const url = `${adminUrl}/ghost/api/admin/posts/`;

  const isDraft = article.publishAsDraft ||
    (article.scheduledPublishAt != null && article.scheduledPublishAt > new Date());

  const postBody: Record<string, unknown> = {
    title: article.title,
    html: article.bodyHtml,
    slug: article.urlSlug || undefined,
    status: isDraft ? "draft" : "published",
    meta_title: article.metaTitle || article.title,
    meta_description: article.metaDescription || "",
    og_title: article.metaTitle || article.title,
    og_description: article.metaDescription || "",
    twitter_title: article.metaTitle || article.title,
    twitter_description: article.metaDescription || "",
    tags: article.focusKeyword
      ? article.focusKeyword.split(/[,\s]+/).filter(Boolean).slice(0, 5).map(t => ({ name: t }))
      : [],
  };

  if (article.imageUrl) {
    postBody.feature_image = article.imageUrl;
    postBody.feature_image_alt = article.imageAltText || "";
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Ghost ${jwt}`,
        "User-Agent": "BlogBatcher/1.0",
      },
      body: JSON.stringify({ posts: [postBody] }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Ghost API error ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json() as { posts?: Array<{ id?: string; url?: string }> };
    const post = data.posts?.[0];
    return {
      success: true,
      cmsPostId: post?.id ?? "",
      cmsPostUrl: post?.url ?? undefined,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
