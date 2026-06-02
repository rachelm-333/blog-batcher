/**
 * shared/helpContent.ts
 *
 * Layer 11 — Support Centre help content.
 * All help articles are stored here as structured data so they can be
 * searched server-side and rendered client-side without a CMS.
 *
 * Each article has:
 *  - id: unique numeric ID
 *  - topicId: which category it belongs to
 *  - title: plain-language title
 *  - slug: URL-safe identifier (used for anchor links: /support#slug)
 *  - body: array of content blocks (heading, paragraph, code, list, tip, warning)
 *  - tags: keywords for search
 */

export type ContentBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "list"; items: string[] }
  | { type: "tip"; text: string }
  | { type: "warning"; text: string };

export interface HelpArticle {
  id: number;
  topicId: string;
  title: string;
  slug: string;
  body: ContentBlock[];
  tags: string[];
}

export interface HelpTopic {
  id: string;
  label: string;
  description: string;
  icon: string;
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------
export const HELP_TOPICS: HelpTopic[] = [
  { id: "getting-started", label: "Getting Started", description: "New to Blog Batcher? Start here.", icon: "Rocket" },
  { id: "business-profile", label: "Business Profile", description: "Setting up your business details and brand voice.", icon: "Building2" },
  { id: "blog-architecture", label: "Blog Architecture", description: "Cornerstone, Pillar, and Cluster articles explained.", icon: "Network" },
  { id: "keyword-research", label: "Keyword Research", description: "Finding and selecting the right keywords.", icon: "Search" },
  { id: "article-generation", label: "Article Generation", description: "Generating Authority Standard articles.", icon: "FileText" },
  { id: "review-editing", label: "Review & Editing", description: "Reviewing, editing, and approving articles.", icon: "CheckSquare" },
  { id: "publishing-scheduling", label: "Publishing & Scheduling", description: "Connecting your CMS and scheduling posts.", icon: "Calendar" },
  { id: "account-billing", label: "Account & Billing", description: "Credits, plans, and account settings.", icon: "CreditCard" },
];

// ---------------------------------------------------------------------------
// Help Articles
// ---------------------------------------------------------------------------
export const HELP_ARTICLES: HelpArticle[] = [

  // ── Getting Started ──────────────────────────────────────────────────────

  {
    id: 1,
    topicId: "getting-started",
    title: "How Blog Batcher works — the 5-stage pipeline",
    slug: "how-blog-batcher-works",
    tags: ["overview", "pipeline", "stages", "getting started", "how it works", "5 stages"],
    body: [
      { type: "paragraph", text: "Blog Batcher turns your business information into a full library of SEO-optimised blog posts. It does this in 5 stages, and you move through them in order." },
      { type: "heading", text: "Stage 1 — Business Profile" },
      { type: "paragraph", text: "You tell Blog Batcher about your business: your name, industry, location, target audience, and brand voice. This is the foundation for everything that follows. The more detail you provide, the better your articles will be." },
      { type: "heading", text: "Stage 2 — Blog Architecture" },
      { type: "paragraph", text: "You choose how many articles you want and what type they should be. Blog Batcher uses a Cornerstone → Pillar → Cluster structure. Think of it as a pyramid: one main topic at the top, supporting topics in the middle, and specific detailed articles at the base." },
      { type: "heading", text: "Stage 3 — Keyword Research" },
      { type: "paragraph", text: "Blog Batcher researches real search data to find the best keywords for each article. It also finds People Also Ask questions from Google — these become the opening answer blocks in your articles." },
      { type: "heading", text: "Stage 4 — Article Generation" },
      { type: "paragraph", text: "Blog Batcher writes all your articles using the 16-point Authority Standard. Each article gets a quality badge: Authority Ready (green), Strong (blue), or Needs Review (orange)." },
      { type: "heading", text: "Stage 5 — Review & Publish" },
      { type: "paragraph", text: "You review each article, make any edits you want, approve it, and then schedule it to publish to your CMS. Blog Batcher handles the publishing automatically on the date you set." },
      { type: "tip", text: "You can come back and continue from wherever you left off at any time. Your progress is saved automatically." },
    ],
  },

  {
    id: 2,
    topicId: "getting-started",
    title: "Your free trial — what's included",
    slug: "free-trial",
    tags: ["free trial", "credits", "upgrade", "purchase", "getting started"],
    body: [
      { type: "paragraph", text: "Your free trial includes one full Authority Standard article — the same quality as a paid article, not a watered-down version." },
      { type: "heading", text: "What you can do with your free article" },
      { type: "list", items: [
        "Read the full article",
        "See the quality badge (Authority Ready, Strong, or Needs Review)",
        "See all metadata: meta title, meta description, focus keyword, URL slug",
        "See the SEO score",
      ]},
      { type: "heading", text: "What requires a credit purchase" },
      { type: "list", items: [
        "Publishing to your CMS",
        "Downloading the article",
        "Exporting as HTML, Markdown, or ZIP",
        "Generating additional articles",
      ]},
      { type: "tip", text: "The free trial is limited to one article per account (email verified). You can purchase a credit pack at any time to unlock publishing and generate more articles." },
    ],
  },

  {
    id: 3,
    topicId: "getting-started",
    title: "Navigating the dashboard",
    slug: "navigating-dashboard",
    tags: ["dashboard", "navigation", "sidebar", "stages", "getting started"],
    body: [
      { type: "paragraph", text: "After you log in, you land on your Dashboard. This is your home base — it shows you where you are in the pipeline and what needs your attention." },
      { type: "heading", text: "The sidebar" },
      { type: "paragraph", text: "The left sidebar has links to every section of Blog Batcher. The stages are listed in order: Architecture, Keywords, Generate, Review, Publish & Schedule. You also have access to Integrations, Schedule Management, and this Help centre." },
      { type: "heading", text: "Stage progress" },
      { type: "paragraph", text: "The dashboard shows your current stage with a blue indicator. Completed stages show a green tick. Stages you haven't reached yet are greyed out." },
      { type: "heading", text: "Quick actions" },
      { type: "paragraph", text: "The Quick Actions panel shows a button to continue from wherever you left off. Click it to jump straight to your current stage." },
    ],
  },

  // ── Business Profile ─────────────────────────────────────────────────────

  {
    id: 4,
    topicId: "business-profile",
    title: "Setting up your business profile",
    slug: "business-profile-setup",
    tags: ["business profile", "brand voice", "target audience", "industry", "location", "onboarding"],
    body: [
      { type: "paragraph", text: "Your business profile is the foundation of every article Blog Batcher writes for you. The more detail you provide, the more accurate and on-brand your content will be." },
      { type: "heading", text: "Business Name" },
      { type: "paragraph", text: "Enter the exact name of your business as you want it to appear in articles. This is used when the article refers to your brand." },
      { type: "heading", text: "Industry" },
      { type: "paragraph", text: "Select the industry that best describes your business. This helps Blog Batcher choose the right tone, terminology, and content angle." },
      { type: "heading", text: "Location" },
      { type: "paragraph", text: "Enter your city, state, or country. This is used for local SEO — articles will naturally include location-relevant language." },
      { type: "heading", text: "Target Audience" },
      { type: "paragraph", text: "Describe who your ideal customer is. For example: 'Small business owners in Brisbane who want to grow their online presence.' The more specific, the better." },
      { type: "heading", text: "Brand Voice" },
      { type: "paragraph", text: "Describe how your brand sounds. For example: 'Professional but approachable. We avoid jargon and explain things simply.' This shapes the writing style of every article." },
      { type: "tip", text: "You can update your business profile at any time. Changes will apply to new articles — existing articles are not affected." },
    ],
  },

  {
    id: 5,
    topicId: "business-profile",
    title: "Managing multiple businesses",
    slug: "multiple-businesses",
    tags: ["multiple businesses", "business switcher", "accounts"],
    body: [
      { type: "paragraph", text: "Blog Batcher supports multiple businesses under one account. Each business has its own pipeline, articles, and CMS connection." },
      { type: "heading", text: "Switching between businesses" },
      { type: "paragraph", text: "On the Dashboard, use the business switcher dropdown at the top of the page. Select the business you want to work on and the dashboard will update to show that business's data." },
      { type: "heading", text: "Adding a new business" },
      { type: "paragraph", text: "Go to the Onboarding page and complete the business profile form for your new business. Each business uses credits from the same account balance." },
      { type: "tip", text: "Admin accounts (like the Blog Batcher team account) have unlimited businesses for testing at no cost." },
    ],
  },

  // ── Blog Architecture ────────────────────────────────────────────────────

  {
    id: 6,
    topicId: "blog-architecture",
    title: "Understanding Cornerstone, Pillar, and Cluster articles",
    slug: "cornerstone-pillar-cluster",
    tags: ["cornerstone", "pillar", "cluster", "architecture", "blog structure", "seo structure"],
    body: [
      { type: "paragraph", text: "Blog Batcher uses a three-tier content architecture that Google rewards. Think of it as a pyramid." },
      { type: "heading", text: "Cornerstone Article" },
      { type: "paragraph", text: "This is your most important article — the one that covers your main topic in depth. It's typically 2,000–3,500 words and targets your highest-value keyword. Every other article in your blog links back to it. You usually have one cornerstone article per topic cluster." },
      { type: "heading", text: "Pillar Articles" },
      { type: "paragraph", text: "Pillar articles cover the major sub-topics of your cornerstone. They're 1,500–2,500 words each and target secondary keywords. They link to the cornerstone and to the cluster articles below them." },
      { type: "heading", text: "Cluster Articles" },
      { type: "paragraph", text: "Cluster articles are the most specific. They answer one precise question or cover one narrow topic. They're 800–1,500 words and target long-tail keywords. They link up to the relevant pillar article." },
      { type: "tip", text: "A typical Blog Batcher setup has 1 cornerstone, 3–5 pillars, and 10–20 cluster articles. This gives Google a clear map of your expertise." },
      { type: "warning", text: "Don't skip the architecture step. The structure you set here determines how your articles link together, which is one of the most powerful on-page SEO signals." },
    ],
  },

  {
    id: 7,
    topicId: "blog-architecture",
    title: "How to choose the right number of articles",
    slug: "how-many-articles",
    tags: ["article count", "architecture", "how many articles", "blog size"],
    body: [
      { type: "paragraph", text: "The right number of articles depends on your goals, your industry, and how competitive your keywords are." },
      { type: "heading", text: "Minimum recommended" },
      { type: "paragraph", text: "For most businesses, a minimum of 10 articles (1 cornerstone, 3 pillars, 6 clusters) is enough to establish topical authority in a niche area." },
      { type: "heading", text: "For competitive industries" },
      { type: "paragraph", text: "In competitive industries (finance, legal, health, real estate), you'll need 20–50 articles to compete. Blog Batcher can generate all of them in one batch." },
      { type: "heading", text: "Publishing cadence matters" },
      { type: "paragraph", text: "It's better to publish consistently over time than to publish everything at once. Blog Batcher's scheduling system distributes your articles evenly over your chosen cadence (daily, every 2 days, weekly, etc.)." },
      { type: "tip", text: "Start with 10–20 articles for your first batch. You can always generate more later." },
    ],
  },

  // ── Keyword Research ─────────────────────────────────────────────────────

  {
    id: 8,
    topicId: "keyword-research",
    title: "How keyword research works in Blog Batcher",
    slug: "keyword-research-overview",
    tags: ["keyword research", "primary keyword", "search volume", "keyword difficulty", "DataForSEO"],
    body: [
      { type: "paragraph", text: "Blog Batcher uses real search data (via DataForSEO) to find the best keyword for each article. You don't need to do keyword research manually." },
      { type: "heading", text: "What Blog Batcher researches for each article" },
      { type: "list", items: [
        "Primary keyword — the main search term the article targets",
        "Search volume — how many people search for this term per month",
        "Keyword difficulty — how hard it is to rank for this term (0–100)",
        "People Also Ask questions — real questions from Google's PAA box",
      ]},
      { type: "heading", text: "Choosing a PAA question" },
      { type: "paragraph", text: "For each article, you select one People Also Ask question. This becomes the opening answer block of your article — a direct, concise answer to the question that Google can pull as a featured snippet." },
      { type: "tip", text: "Choose PAA questions that are specific and answerable in 2–3 sentences. Avoid vague questions." },
    ],
  },

  {
    id: 9,
    topicId: "keyword-research",
    title: "Understanding keyword difficulty and search volume",
    slug: "keyword-difficulty-search-volume",
    tags: ["keyword difficulty", "search volume", "competition", "ranking"],
    body: [
      { type: "paragraph", text: "When Blog Batcher researches keywords, it shows you two key metrics: search volume and keyword difficulty." },
      { type: "heading", text: "Search Volume" },
      { type: "paragraph", text: "This is how many people search for this keyword per month. Higher volume means more potential traffic, but also more competition. For local businesses, a keyword with 100–500 monthly searches is often more valuable than a national keyword with 10,000 searches." },
      { type: "heading", text: "Keyword Difficulty (0–100)" },
      { type: "paragraph", text: "This is a score from 0 to 100 that shows how hard it is to rank on page 1 of Google for this keyword. Lower is easier. For new blogs, aim for keywords with a difficulty below 40. As your domain authority grows, you can target harder keywords." },
      { type: "tip", text: "Blog Batcher automatically selects keywords with a good balance of search volume and difficulty. You can review and override the selection if you prefer a different keyword." },
    ],
  },

  {
    id: 10,
    topicId: "keyword-research",
    title: "Preventing keyword cannibalization",
    slug: "keyword-cannibalization",
    tags: ["keyword cannibalization", "duplicate keywords", "SEO", "keyword overlap"],
    body: [
      { type: "paragraph", text: "Keyword cannibalization happens when two or more of your articles target the same keyword. This confuses Google and hurts your rankings." },
      { type: "heading", text: "How Blog Batcher prevents it" },
      { type: "paragraph", text: "Blog Batcher checks every keyword against all other articles in your batch before assigning it. If two articles would target the same or very similar keyword, it selects a different keyword for one of them." },
      { type: "heading", text: "What counts as 'the same' keyword" },
      { type: "paragraph", text: "Semantically identical terms count as the same keyword — for example, 'Gold Coast marketing agency' and 'marketing agency Gold Coast' are treated as the same. But 'growth agency Gold Coast' and 'marketing agency Gold Coast' are treated as distinct." },
      { type: "warning", text: "If you manually override a keyword, make sure it doesn't duplicate a keyword already assigned to another article in your batch." },
    ],
  },

  // ── Article Generation ───────────────────────────────────────────────────

  {
    id: 11,
    topicId: "article-generation",
    title: "The 16-point Authority Standard explained",
    slug: "authority-standard",
    tags: ["authority standard", "16 point", "quality", "article quality", "generation", "SEO score"],
    body: [
      { type: "paragraph", text: "Every article Blog Batcher generates is checked against the 16-point Authority Standard — a quality framework designed to meet Google's E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) requirements." },
      { type: "heading", text: "The 16 points" },
      { type: "list", items: [
        "1. Primary keyword in title (H1)",
        "2. Primary keyword in first paragraph",
        "3. Primary keyword in meta title",
        "4. Primary keyword in meta description",
        "5. Primary keyword in URL slug",
        "6. PAA question answered in opening block",
        "7. Correct word count for article type",
        "8. Internal linking structure (links to cornerstone/pillar)",
        "9. H2 and H3 subheadings with secondary keywords",
        "10. Meta title under 60 characters",
        "11. Meta description under 160 characters",
        "12. Schema markup (FAQ or Article)",
        "13. Image alt text (if image provided)",
        "14. No keyword cannibalization",
        "15. Brand voice consistency",
        "16. AI-proofing check (reads naturally, not like AI)",
      ]},
      { type: "heading", text: "Quality badges" },
      { type: "paragraph", text: "After generation, each article receives a badge: Authority Ready (14–16 points, green), Strong (11–13 points, blue), or Needs Review (10 or fewer points, orange). Needs Review articles have a 'Lite Rewrite' option to improve them." },
      { type: "tip", text: "Articles that score 85% or above (14+ points) are marked Authority Ready and are ready to publish without edits." },
    ],
  },

  {
    id: 12,
    topicId: "article-generation",
    title: "What to do if article generation fails",
    slug: "generation-failed",
    tags: ["generation failed", "error", "retry", "generation error", "troubleshoot"],
    body: [
      { type: "paragraph", text: "Article generation occasionally fails due to AI service timeouts or network issues. Here's what to do." },
      { type: "heading", text: "Step 1: Wait 60 seconds and retry" },
      { type: "paragraph", text: "Most generation failures are temporary. Click the Retry button on the failed article. The system will attempt generation again from scratch." },
      { type: "heading", text: "Step 2: Check your credit balance" },
      { type: "paragraph", text: "If you have insufficient credits, generation will fail. Check your credit balance in the top navigation bar. If it's at 0, purchase a credit pack to continue." },
      { type: "heading", text: "Step 3: Contact support" },
      { type: "paragraph", text: "If the article continues to fail after two retries, use the Contact Support form at the bottom of this page. Include the article title and the error message you see." },
      { type: "warning", text: "Credits are not deducted for failed generations. You will only be charged when an article is successfully generated." },
    ],
  },

  // ── Review & Editing ─────────────────────────────────────────────────────

  {
    id: 13,
    topicId: "review-editing",
    title: "Reviewing and approving articles",
    slug: "reviewing-articles",
    tags: ["review", "approve", "editing", "article review", "status badge"],
    body: [
      { type: "paragraph", text: "After generation, every article goes into the Review stage. You can read it, edit it, and then approve it for publishing." },
      { type: "heading", text: "Article statuses" },
      { type: "list", items: [
        "Generated — article has been written, waiting for your review",
        "Pending Approval — you've read it and it's waiting for your approval",
        "Approved — you've approved it and it's ready to schedule for publishing",
        "Scheduled — it's in the publishing queue with a date set",
        "Published — it's live on your CMS",
        "Failed — the publish attempt failed (see Publishing & Scheduling for help)",
      ]},
      { type: "heading", text: "Editing an article" },
      { type: "paragraph", text: "Click on any article to open the editor. You can edit the title, body, meta title, meta description, and URL slug. Changes are saved automatically." },
      { type: "heading", text: "The Lite Rewrite option" },
      { type: "paragraph", text: "If an article is marked Needs Review (orange badge), you'll see a Lite Rewrite button. This sends the article back through the AI with instructions to improve the weakest points. It uses one credit." },
      { type: "tip", text: "You don't have to edit every article. Authority Ready articles (green badge) are ready to publish as-is." },
    ],
  },

  {
    id: 14,
    topicId: "review-editing",
    title: "Understanding the SEO score",
    slug: "seo-score",
    tags: ["SEO score", "score", "quality", "review", "85%"],
    body: [
      { type: "paragraph", text: "Every article has an SEO score from 0 to 100. This score measures how well the article is optimised for search engines based on the 16-point Authority Standard." },
      { type: "heading", text: "Score ranges" },
      { type: "list", items: [
        "85–100 (Authority Ready, green) — excellent. Ready to publish.",
        "70–84 (Strong, blue) — good. Minor improvements possible but publishable.",
        "0–69 (Needs Review, orange) — needs work. Use Lite Rewrite or edit manually.",
      ]},
      { type: "heading", text: "What affects the score" },
      { type: "paragraph", text: "The score is based on keyword placement, meta tag quality, word count, internal linking, schema markup, and readability. You can improve the score by editing the article and ensuring the primary keyword appears in the right places." },
      { type: "tip", text: "All articles must achieve a score of 85% or above before they are marked Authority Ready. If an article doesn't reach this threshold, use the Lite Rewrite option." },
    ],
  },

  // ── Publishing & Scheduling ──────────────────────────────────────────────

  {
    id: 15,
    topicId: "publishing-scheduling",
    title: "Connecting WordPress to Blog Batcher",
    slug: "connect-wordpress",
    tags: ["wordpress", "connect", "application password", "API", "CMS connection", "integration", "Yoast", "RankMath", "AIOSEO"],
    body: [
      { type: "paragraph", text: "Blog Batcher connects to WordPress using the WordPress REST API and Application Passwords. No plugin is required." },
      { type: "heading", text: "Step 1: Get your WordPress site URL" },
      { type: "paragraph", text: "Your WordPress URL is the address of your website — for example, https://yoursite.com. Make sure it's the root URL, not a page URL." },
      { type: "heading", text: "Step 2: Create an Application Password" },
      { type: "list", items: [
        "Log in to your WordPress admin dashboard",
        "Go to Users → Your Profile",
        "Scroll down to the Application Passwords section",
        "Enter a name (e.g. 'Blog Batcher') and click Add New Application Password",
        "Copy the password that appears — you won't be able to see it again",
      ]},
      { type: "heading", text: "Step 3: Enter your credentials in Blog Batcher" },
      { type: "paragraph", text: "Go to Integrations → WordPress. Enter your WordPress URL, your WordPress username, and the Application Password you just created. Click Test Connection." },
      { type: "heading", text: "SEO plugin support" },
      { type: "paragraph", text: "Blog Batcher automatically detects which SEO plugin you're using and writes to the correct fields:" },
      { type: "list", items: [
        "Yoast SEO — focus keyword written to _yoast_wpseo_focuskw",
        "RankMath — focus keyword written to rank_math_focus_keyword",
        "All in One SEO (AIOSEO) — focus keyword written to _aioseo_keywords",
        "No plugin — meta fields written as standard post meta",
      ]},
      { type: "warning", text: "Make sure your WordPress REST API is enabled. Some security plugins disable it. If the connection test fails, check your security plugin settings." },
    ],
  },

  {
    id: 16,
    topicId: "publishing-scheduling",
    title: "Connecting Wix to Blog Batcher",
    slug: "connect-wix",
    tags: ["wix", "connect", "API key", "site ID", "CMS connection", "integration"],
    body: [
      { type: "paragraph", text: "Blog Batcher connects to Wix using the Wix Headless API. You'll need an API key and your Site ID." },
      { type: "heading", text: "Step 1: Get your Wix API key" },
      { type: "list", items: [
        "Log in to your Wix account at manage.wix.com",
        "Go to API Keys (in the left sidebar under Settings)",
        "Click Generate API Key",
        "Give it a name (e.g. 'Blog Batcher') and select the Wix Blog permission",
        "Copy the API key — you won't be able to see it again",
      ]},
      { type: "heading", text: "Step 2: Get your Wix Site ID" },
      { type: "list", items: [
        "In manage.wix.com, go to Settings → General Info",
        "Your Site ID is shown under the site name",
        "It looks like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      ]},
      { type: "heading", text: "Step 3: Enter your credentials in Blog Batcher" },
      { type: "paragraph", text: "Go to Integrations → Wix. Enter your API key and Site ID. Click Test Connection." },
      { type: "tip", text: "Wix auto-generates slugs from the article title. You cannot set a custom slug via the Wix API — this is a Wix limitation, not a Blog Batcher limitation." },
    ],
  },

  {
    id: 17,
    topicId: "publishing-scheduling",
    title: "Connecting Shopify, Webflow, Squarespace, and Ghost",
    slug: "connect-other-cms",
    tags: ["shopify", "webflow", "squarespace", "ghost", "connect", "API", "CMS connection"],
    body: [
      { type: "paragraph", text: "Blog Batcher supports Shopify, Webflow, Squarespace, and Ghost in addition to WordPress and Wix." },
      { type: "heading", text: "Shopify" },
      { type: "paragraph", text: "Go to Shopify Admin → Apps → Develop Apps → Create an App. Give it Blog Batcher access to the Blogs and Articles API. Copy the Admin API access token. In Blog Batcher, go to Integrations → Shopify and enter your Shopify store URL (yourstore.myshopify.com) and the access token." },
      { type: "heading", text: "Webflow" },
      { type: "paragraph", text: "Go to Webflow → Project Settings → Integrations → API Access. Generate an API token with CMS access. Copy the token and your Site ID. In Blog Batcher, go to Integrations → Webflow and enter both." },
      { type: "heading", text: "Squarespace" },
      { type: "paragraph", text: "Go to Squarespace → Settings → Advanced → API Keys. Generate a key with Blog Posts permission. Copy the key. In Blog Batcher, go to Integrations → Squarespace and enter your API key and website URL." },
      { type: "heading", text: "Ghost" },
      { type: "paragraph", text: "Go to Ghost Admin → Settings → Integrations → Add Custom Integration. Copy the Admin API key and your Ghost URL. In Blog Batcher, go to Integrations → Ghost and enter both." },
      { type: "tip", text: "All CMS connections have a Test Connection button. Always test before scheduling articles." },
    ],
  },

  {
    id: 18,
    topicId: "publishing-scheduling",
    title: "Using Zapier with Blog Batcher",
    slug: "zapier-integration",
    tags: ["zapier", "webhook", "integration", "HubSpot", "Notion", "Medium", "automation"],
    body: [
      { type: "paragraph", text: "Blog Batcher's Zapier integration lets you push articles to any platform Zapier supports — HubSpot, Notion, Medium, Framer, and thousands more." },
      { type: "heading", text: "How it works" },
      { type: "paragraph", text: "When you approve or publish an article, Blog Batcher sends the article data as a JSON payload to your Zapier webhook URL. Zapier then routes it to whatever platform you've set up." },
      { type: "heading", text: "Setting up the Zapier webhook" },
      { type: "list", items: [
        "In Zapier, create a new Zap",
        "Choose 'Webhooks by Zapier' as the trigger",
        "Select 'Catch Hook' and copy the webhook URL",
        "In Blog Batcher, go to Integrations → Zapier and paste the webhook URL",
        "Click Test Connection — Blog Batcher will send a test payload",
        "In Zapier, confirm the test payload was received and set up your action",
      ]},
      { type: "heading", text: "What's in the payload" },
      { type: "list", items: [
        "title — article title",
        "body_html — full article as HTML",
        "meta_title — SEO meta title",
        "meta_description — SEO meta description",
        "slug — URL slug",
        "focus_keyword — primary keyword",
        "schema_json_ld — schema markup as JSON-LD",
        "image_url — featured image URL (if provided)",
        "alt_text — image alt text",
        "scheduled_publish_date — ISO 8601 date",
      ]},
    ],
  },

  {
    id: 19,
    topicId: "publishing-scheduling",
    title: "What to do if a publish fails",
    slug: "publish-failed",
    tags: ["publish failed", "error", "retry", "CMS connection", "troubleshoot", "publish failure"],
    body: [
      { type: "paragraph", text: "If an article fails to publish, you'll see a red 'Failed' badge on the article and a notification in your dashboard. Here's how to fix it." },
      { type: "heading", text: "Step 1: Check the error message" },
      { type: "paragraph", text: "Click on the failed article to see the error message. Common errors include:" },
      { type: "list", items: [
        "CMS connection timed out — your CMS was temporarily unavailable",
        "Invalid API credentials — your API key or Application Password has expired or been revoked",
        "Permission denied — your API key doesn't have the right permissions",
        "Rate limit exceeded — too many requests to your CMS in a short time",
      ]},
      { type: "heading", text: "Step 2: Fix the issue" },
      { type: "paragraph", text: "Go to Integrations and click Test Connection for your CMS. If the test fails, update your credentials. If the test passes, the issue was temporary." },
      { type: "heading", text: "Step 3: Retry the publish" },
      { type: "paragraph", text: "Once the connection is working, go to Schedule Management and click Retry on the failed article. Blog Batcher will attempt to publish it again." },
      { type: "tip", text: "Blog Batcher automatically retries a failed publish once after 15 minutes. If both attempts fail, you'll receive a notification and the article will be marked as Failed." },
    ],
  },

  {
    id: 20,
    topicId: "publishing-scheduling",
    title: "Setting your publishing cadence",
    slug: "publishing-cadence",
    tags: ["cadence", "schedule", "publishing frequency", "calendar", "consistent publishing"],
    body: [
      { type: "paragraph", text: "Consistent publishing is one of the most powerful SEO signals. Blog Batcher lets you set a publishing cadence and automatically distributes your articles across your chosen schedule." },
      { type: "heading", text: "Available cadences" },
      { type: "list", items: [
        "Every day",
        "Every 2 days",
        "Every 3 days",
        "Once per week",
        "Twice per week",
      ]},
      { type: "paragraph", text: "The maximum scheduling window is 12 months. Blog Batcher shows you a publishing calendar preview before you confirm." },
      { type: "warning", text: "We recommend not changing publish dates once they are set. Consistent publishing tells Google this site is active and authoritative. Changing dates disrupts this signal." },
      { type: "heading", text: "Cancelling or rescheduling" },
      { type: "paragraph", text: "You can cancel or reschedule individual articles in Schedule Management without affecting other articles in the queue." },
    ],
  },

  // ── Account & Billing ────────────────────────────────────────────────────

  {
    id: 21,
    topicId: "account-billing",
    title: "How credits work",
    slug: "credits",
    tags: ["credits", "billing", "balance", "top up", "purchase", "cost"],
    body: [
      { type: "paragraph", text: "Blog Batcher uses a credit system. You purchase credits and spend them to generate articles. Credits never expire." },
      { type: "heading", text: "What costs credits" },
      { type: "list", items: [
        "Generating an article — 1 credit per article",
        "Lite Rewrite — 1 credit per rewrite",
        "Publishing, downloading, and exporting are free once an article is generated",
      ]},
      { type: "heading", text: "Checking your balance" },
      { type: "paragraph", text: "Your credit balance is always visible in the navigation bar at the top of the screen. When your balance runs low, you'll see a prompt to top up." },
      { type: "heading", text: "Purchasing credits" },
      { type: "paragraph", text: "Go to Account & Billing to purchase a credit pack. Credits are added to your account immediately after payment." },
      { type: "tip", text: "Credits never expire, so you can purchase a large pack and use them over time." },
    ],
  },

  {
    id: 22,
    topicId: "account-billing",
    title: "Account settings and security",
    slug: "account-settings",
    tags: ["account", "password", "email", "settings", "security"],
    body: [
      { type: "paragraph", text: "You can manage your account settings from the Account section in the navigation." },
      { type: "heading", text: "Changing your password" },
      { type: "paragraph", text: "Go to Account → Security → Change Password. You'll need to enter your current password and your new password twice." },
      { type: "heading", text: "Changing your email address" },
      { type: "paragraph", text: "Go to Account → Profile → Email. Enter your new email address and click Save. You'll receive a verification email at the new address." },
      { type: "heading", text: "Forgot your password?" },
      { type: "paragraph", text: "On the login page, click 'Forgot password?' and enter your email address. You'll receive a password reset link within a few minutes." },
      { type: "tip", text: "If you don't receive the password reset email, check your spam folder. If it's not there, contact support." },
    ],
  },
];

// ---------------------------------------------------------------------------
// Search helper (used server-side)
// ---------------------------------------------------------------------------
export function searchHelpArticles(query: string): HelpArticle[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  return HELP_ARTICLES.filter((article) => {
    const titleMatch = article.title.toLowerCase().includes(q);
    const tagMatch = article.tags.some((tag) => tag.toLowerCase().includes(q));
    const bodyMatch = article.body.some((block) => {
      if (block.type === "paragraph" || block.type === "heading" || block.type === "tip" || block.type === "warning") {
        return block.text.toLowerCase().includes(q);
      }
      if (block.type === "list") {
        return block.items.some((item) => item.toLowerCase().includes(q));
      }
      return false;
    });
    return titleMatch || tagMatch || bodyMatch;
  });
}

/** Extract a short text snippet from an article body for search results */
export function getArticleSnippet(article: HelpArticle, query: string): string {
  const q = query.toLowerCase();
  for (const block of article.body) {
    if (block.type === "paragraph" || block.type === "tip" || block.type === "warning") {
      if (block.text.toLowerCase().includes(q)) {
        const idx = block.text.toLowerCase().indexOf(q);
        const start = Math.max(0, idx - 60);
        const end = Math.min(block.text.length, idx + 120);
        return (start > 0 ? "…" : "") + block.text.slice(start, end) + (end < block.text.length ? "…" : "");
      }
    }
  }
  // Fallback: first paragraph
  const first = article.body.find((b) => b.type === "paragraph");
  if (first && (first.type === "paragraph")) {
    return first.text.slice(0, 160) + (first.text.length > 160 ? "…" : "");
  }
  return "";
}
