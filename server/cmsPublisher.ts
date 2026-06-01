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
}

export interface PublishResult {
  success: boolean;
  cmsPostId?: string;
  cmsPostUrl?: string;
  error?: string;
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
    let wpStatus: "publish" | "future" | "draft" = "publish";
    let wpDate: string | undefined;
    if (article.scheduledPublishAt) {
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
    // ── Step 1: Create draft post ────────────────────────────────────────────
    const createPayload: Record<string, unknown> = {
      post: {
        title: article.title,
        richContent: {
          nodes: [
            {
              type: "PARAGRAPH",
              nodes: [{ type: "TEXT", textData: { text: "" } }],
            },
          ],
        },
        // Wix Blog API accepts plain HTML via the htmlContent field
        htmlContent: article.bodyHtml,
        excerpt: article.metaDescription,
        seoData: {
          tags: [
            { type: "title", children: article.metaTitle },
            { type: "meta", props: { name: "description", content: article.metaDescription } },
            { type: "meta", props: { name: "keywords", content: article.focusKeyword } },
          ],
        },
        slug: article.urlSlug,
      },
    };

    if (article.scheduledPublishAt && article.scheduledPublishAt > new Date()) {
      createPayload.post = {
        ...(createPayload.post as object),
        scheduledPublishTime: article.scheduledPublishAt.toISOString(),
      };
    }

    const createRes = await fetch(
      "https://www.wixapis.com/blog/v3/posts/drafts",
      {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(createPayload),
      }
    );

    if (!createRes.ok) {
      const errText = await createRes.text();
      let errMsg = `Wix API error ${createRes.status}`;
      try {
        const parsed = JSON.parse(errText) as { message?: string };
        if (parsed.message) errMsg = parsed.message;
      } catch { /* use status */ }
      return { success: false, error: errMsg };
    }

    const createData = (await createRes.json()) as { draftPost?: { id?: string } };
    const draftId = createData.draftPost?.id;
    if (!draftId) {
      return { success: false, error: "Wix did not return a draft post ID" };
    }

    // ── Step 2: Publish the draft ────────────────────────────────────────────
    const publishRes = await fetch(
      `https://www.wixapis.com/blog/v3/posts/drafts/${draftId}/publish`,
      {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({}),
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

    const publishData = (await publishRes.json()) as { post?: { id?: string; url?: string } };
    return {
      success: true,
      cmsPostId: publishData.post?.id ?? draftId,
      cmsPostUrl: publishData.post?.url ?? "",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return { success: false, error: "Cannot reach Wix API — check your API key and Site ID" };
    }
    return { success: false, error: msg };
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
 * Send article payload to a Zapier webhook URL.
 * Zapier expects a JSON POST — no authentication on our side.
 */
export async function publishToZapier(
  credentials: ZapierCredentials,
  article: ArticlePayload
): Promise<PublishResult> {
  const payload = {
    title: article.title,
    body_html: article.bodyHtml,
    meta_title: article.metaTitle,
    meta_description: article.metaDescription,
    focus_keyword: article.focusKeyword,
    url_slug: article.urlSlug,
    schema_json_ld: article.schemaMarkup ?? null,
    image_url: article.imageUrl ?? null,
    image_alt_text: article.imageAltText ?? null,
    scheduled_publish_date: article.scheduledPublishAt
      ? article.scheduledPublishAt.toISOString()
      : null,
    level: article.level,
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
