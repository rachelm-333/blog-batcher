/**
 * Integrations Page — Layer 8 (redesigned)
 *
 * Platform-grid design inspired by the reference UI:
 * - "How connections work" explainer banner at the top
 * - CMS platform cards in a 3-column grid
 * - Each card has a prominent "Connect via Zapier" button (primary path)
 * - WordPress and Wix also offer a "Direct API" option (advanced)
 * - Guided setup modal walks users through the 3-step Zapier/Make setup
 * - Webhook URL paste-back field inside the modal completes the connection
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  Globe,
  Clock,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import { HelpLink } from "@/components/HelpLink";

// ---------------------------------------------------------------------------
// CMS platform definitions
// ---------------------------------------------------------------------------

interface CMSPlatform {
  id: string;
  name: string;
  category: string;
  description: string;
  zapierSupport: "excellent" | "good" | "coming-soon";
  zapierSearchTerm: string; // what to search for in Zapier
  hasDirectApi: boolean;
  directApiFields?: DirectApiField[];
  directApiHelpText?: string;
  directApiHelpUrl?: string;
  // Step-by-step Zapier setup instructions
  zapierSteps: { title: string; detail: string }[];
  // Field mapping guide shown in step 3
  fieldMappings: { blogBatcherField: string; cmsField: string }[];
}

interface DirectApiField {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password" | "url" | "select";
  options?: { value: string; label: string }[];
  required: boolean;
  hint?: string;
  helpSlug?: string;
  helpLabel?: string;
}

const CMS_PLATFORMS: CMSPlatform[] = [
  {
    id: "wix",
    name: "Wix",
    category: "Website Builder",
    description: "Full SEO control including URL slug, focus keyword, meta title, meta description, image alt text, and schema.",
    zapierSupport: "excellent",
    zapierSearchTerm: "Wix",
    hasDirectApi: true,
    zapierSteps: [
      {
        title: "Open Zapier and create a new Zap",
        detail: "Go to zapier.com → Create Zap. Search for \"Webhooks by Zapier\" as the Trigger app. Select \"Catch Hook\" as the trigger event. Click Continue — Zapier will generate your unique webhook URL.",
      },
      {
        title: "Copy your Zapier webhook URL",
        detail: "Zapier will show you a URL like: https://hooks.zapier.com/hooks/catch/12345678/abcdefg/\n\nCopy this URL and paste it into the field below.",
      },
      {
        title: "Set up the Wix action in Zapier",
        detail: "Add an Action step → search for \"Wix Blog\". Select \"Create Blog Post\" or \"Publish Blog Post\". Connect your Wix account. Map the Blog Batcher fields to Wix using the field guide below.",
      },
      {
        title: "Turn on your Zap",
        detail: "Click \"Publish Zap\" in Zapier. Come back here, paste your webhook URL below, and click Test Connection to verify everything is working.",
      },
    ],
    fieldMappings: [
      { blogBatcherField: "title", cmsField: "Post Title" },
      { blogBatcherField: "body_html", cmsField: "Post Content (HTML)" },
      { blogBatcherField: "url_slug", cmsField: "Post Slug / URL" },
      { blogBatcherField: "meta_title", cmsField: "SEO Title" },
      { blogBatcherField: "meta_description", cmsField: "SEO Description" },
      { blogBatcherField: "focus_keyword", cmsField: "SEO Focus Keyword" },
      { blogBatcherField: "image_url", cmsField: "Featured Image URL" },
      { blogBatcherField: "image_alt_text", cmsField: "Featured Image Alt Text" },
      { blogBatcherField: "schema_json_ld", cmsField: "Custom Schema / JSON-LD" },
      { blogBatcherField: "publish_mode", cmsField: "Post Status (live/draft)" },
    ],
    directApiFields: [
      {
        key: "apiKey",
        label: "Wix API Key",
        placeholder: "IST.eyJlb...",
        type: "password",
        required: true,
        hint: "From Wix Developer Centre → API Keys",
        helpSlug: "wix-api-key",
        helpLabel: "How to get your Wix API Key",
      },
      {
        key: "siteId",
        label: "Wix Site ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        type: "text",
        required: true,
        hint: "Found in your Wix site URL or Developer Centre",
      },
      {
        key: "memberId",
        label: "Wix Member ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        type: "text",
        required: true,
        hint: "Your Wix account Member ID — found in Wix Developer Centre → Members",
        helpSlug: "wix-member-id",
        helpLabel: "How to find your Wix Member ID",
      },
    ],
    directApiHelpText: "Direct API publishes title, body, meta title, meta description, and excerpt. URL slug and focus keyword require Zapier or Make for full control.",
    directApiHelpUrl: "https://dev.wix.com/docs/rest/articles/getting-started/authentication",
  },
  {
    id: "wordpress",
    name: "WordPress",
    category: "CMS",
    description: "Publish with full SEO support. Works with Yoast, RankMath, AIOSEO, or no plugin.",
    zapierSupport: "excellent",
    zapierSearchTerm: "WordPress",
    hasDirectApi: true,
    zapierSteps: [
      {
        title: "Open Zapier and create a new Zap",
        detail: "Go to zapier.com → Create Zap. Search for \"Webhooks by Zapier\" as the Trigger app. Select \"Catch Hook\" as the trigger event. Click Continue to get your webhook URL.",
      },
      {
        title: "Copy your Zapier webhook URL",
        detail: "Copy the URL Zapier generates (e.g. https://hooks.zapier.com/hooks/catch/...) and paste it into the field below.",
      },
      {
        title: "Set up the WordPress action in Zapier",
        detail: "Add an Action step → search for \"WordPress\". Select \"Create Post\". Connect your WordPress site. Map the Blog Batcher fields using the guide below.",
      },
      {
        title: "Turn on your Zap",
        detail: "Click \"Publish Zap\" in Zapier. Come back here, paste your webhook URL, and click Test Connection.",
      },
    ],
    fieldMappings: [
      { blogBatcherField: "title", cmsField: "Post Title" },
      { blogBatcherField: "body_html", cmsField: "Post Content" },
      { blogBatcherField: "url_slug", cmsField: "Post Slug" },
      { blogBatcherField: "meta_title", cmsField: "Yoast: _yoast_wpseo_title / RankMath: rank_math_title" },
      { blogBatcherField: "meta_description", cmsField: "Yoast: _yoast_wpseo_metadesc / RankMath: rank_math_description" },
      { blogBatcherField: "focus_keyword", cmsField: "Yoast: _yoast_wpseo_focuskw / RankMath: rank_math_focus_keyword" },
      { blogBatcherField: "image_url", cmsField: "Featured Image URL" },
      { blogBatcherField: "schema_json_ld", cmsField: "Custom Field: _blog_batcher_schema" },
      { blogBatcherField: "publish_mode", cmsField: "Post Status" },
    ],
    directApiFields: [
      {
        key: "siteUrl",
        label: "WordPress Site URL",
        placeholder: "https://yoursite.com",
        type: "url",
        required: true,
        hint: "Include https:// — no trailing slash",
      },
      {
        key: "username",
        label: "WordPress Username",
        placeholder: "admin",
        type: "text",
        required: true,
      },
      {
        key: "applicationPassword",
        label: "Application Password",
        placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx",
        type: "password",
        required: true,
        hint: "Generated in WP Admin → Users → Profile → Application Passwords",
        helpSlug: "wordpress-application-password",
        helpLabel: "How to create a WordPress Application Password",
      },
      {
        key: "seoPlugin",
        label: "SEO Plugin",
        placeholder: "",
        type: "select",
        required: true,
        options: [
          { value: "yoast", label: "Yoast SEO" },
          { value: "rankmath", label: "RankMath" },
          { value: "aioseo", label: "All in One SEO (AIOSEO)" },
          { value: "none", label: "No SEO Plugin" },
        ],
        hint: "Blog Batcher will populate the correct meta fields for your plugin",
        helpSlug: "seo-plugins",
        helpLabel: "Which SEO plugin should I use?",
      },
    ],
    directApiHelpText: "Direct API publishes all content and SEO fields including slug, meta title, meta description, and focus keyword via your SEO plugin.",
    directApiHelpUrl: "https://wordpress.com/support/application-passwords/",
  },
  {
    id: "shopify",
    name: "Shopify",
    category: "E-commerce",
    description: "Publish blog posts to your Shopify store blog. Great for product-related content and SEO.",
    zapierSupport: "excellent",
    zapierSearchTerm: "Shopify",
    hasDirectApi: true,
    directApiFields: [
      {
        key: "storeDomain",
        label: "Store Domain",
        placeholder: "yourstore.myshopify.com",
        type: "text" as const,
        required: true,
        hint: "Your Shopify store domain — no https://, no trailing slash",
      },
      {
        key: "adminApiToken",
        label: "Admin API Access Token",
        placeholder: "shpat_xxxxxxxxxxxxxxxxxxxx",
        type: "password" as const,
        required: true,
        hint: "Shopify Admin → Settings → Apps → Develop apps → Create an app → Admin API access token",
        helpSlug: "shopify-admin-api-token",
        helpLabel: "How to get your Shopify Admin API token",
      },
      {
        key: "blogId",
        label: "Blog ID",
        placeholder: "123456789",
        type: "text" as const,
        required: true,
        hint: "Numeric ID of your Shopify blog — found in the blog URL in Shopify Admin",
        helpSlug: "shopify-blog-id",
        helpLabel: "How to find your Shopify Blog ID",
      },
    ],
    directApiHelpText: "Direct API publishes title, body HTML, URL slug (handle), meta title, meta description, and featured image to your Shopify blog.",
    directApiHelpUrl: "https://shopify.dev/docs/api/admin-rest/2024-01/resources/article",
    zapierSteps: [
      {
        title: "Open Zapier and create a new Zap",
        detail: "Go to zapier.com → Create Zap. Search for \"Webhooks by Zapier\" as the Trigger. Select \"Catch Hook\". Click Continue to get your webhook URL.",
      },
      {
        title: "Copy your Zapier webhook URL",
        detail: "Copy the URL Zapier generates and paste it into the field below.",
      },
      {
        title: "Set up the Shopify action in Zapier",
        detail: "Add an Action step → search for \"Shopify\". Select \"Create Blog Post\". Connect your Shopify store. Map the Blog Batcher fields using the guide below.",
      },
      {
        title: "Turn on your Zap",
        detail: "Click \"Publish Zap\" in Zapier. Come back here, paste your webhook URL, and click Test Connection.",
      },
    ],
    fieldMappings: [
      { blogBatcherField: "title", cmsField: "Article Title" },
      { blogBatcherField: "body_html", cmsField: "Article Body (HTML)" },
      { blogBatcherField: "url_slug", cmsField: "Handle / URL Slug" },
      { blogBatcherField: "meta_title", cmsField: "SEO Page Title" },
      { blogBatcherField: "meta_description", cmsField: "SEO Meta Description" },
      { blogBatcherField: "image_url", cmsField: "Image Source URL" },
      { blogBatcherField: "image_alt_text", cmsField: "Image Alt Text" },
      { blogBatcherField: "publish_mode", cmsField: "Published (true/false)" },
    ],
  },
  {
    id: "webflow",
    name: "Webflow",
    category: "Website Builder",
    description: "Publish CMS blog posts to Webflow with full SEO fields and rich content.",
    zapierSupport: "good",
    zapierSearchTerm: "Webflow",
    hasDirectApi: true,
    directApiFields: [
      {
        key: "apiToken",
        label: "API Token",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        type: "password" as const,
        required: true,
        hint: "Webflow Dashboard → Account Settings → Integrations → API Access → Generate API Token",
        helpSlug: "webflow-api-token",
        helpLabel: "How to get your Webflow API Token",
      },
      {
        key: "collectionId",
        label: "Blog Collection ID",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxx",
        type: "text" as const,
        required: true,
        hint: "Webflow Designer → CMS → your blog collection → settings → Collection ID",
        helpSlug: "webflow-collection-id",
        helpLabel: "How to find your Webflow Collection ID",
      },
    ],
    directApiHelpText: "Direct API publishes to your Webflow CMS Blog collection including title, body HTML, slug, meta title, meta description, and featured image.",
    directApiHelpUrl: "https://developers.webflow.com/reference/create-collection-item",
    zapierSteps: [
      {
        title: "Open Zapier and create a new Zap",
        detail: "Go to zapier.com → Create Zap. Search for \"Webhooks by Zapier\" as the Trigger. Select \"Catch Hook\". Click Continue to get your webhook URL.",
      },
      {
        title: "Copy your Zapier webhook URL",
        detail: "Copy the URL Zapier generates and paste it into the field below.",
      },
      {
        title: "Set up the Webflow action in Zapier",
        detail: "Add an Action step → search for \"Webflow\". Select \"Create Live Item\" (for your Blog CMS collection). Connect your Webflow account and select your Blog collection. Map the Blog Batcher fields using the guide below.",
      },
      {
        title: "Turn on your Zap",
        detail: "Click \"Publish Zap\" in Zapier. Come back here, paste your webhook URL, and click Test Connection.",
      },
    ],
    fieldMappings: [
      { blogBatcherField: "title", cmsField: "Name / Title field" },
      { blogBatcherField: "body_html", cmsField: "Rich Text / Body field" },
      { blogBatcherField: "url_slug", cmsField: "Slug field" },
      { blogBatcherField: "meta_title", cmsField: "SEO Title" },
      { blogBatcherField: "meta_description", cmsField: "SEO Description" },
      { blogBatcherField: "image_url", cmsField: "Featured Image URL" },
      { blogBatcherField: "image_alt_text", cmsField: "Featured Image Alt" },
    ],
  },
  {
    id: "squarespace",
    name: "Squarespace",
    category: "Website Builder",
    description: "Post articles to your Squarespace blog via Zapier automation or direct API.",
    zapierSupport: "good",
    zapierSearchTerm: "Squarespace",
    hasDirectApi: true,
    directApiFields: [
      {
        key: "personalAccessToken",
        label: "Personal Access Token",
        placeholder: "sqsp-pat-xxxxxxxxxxxxxxxxxxxx",
        type: "password" as const,
        required: true,
        hint: "Squarespace → Settings → Developer Tools → Personal Access Tokens → Generate Token (needs Blog Posts: Write permission)",
        helpSlug: "squarespace-access-token",
        helpLabel: "How to get your Squarespace Personal Access Token",
      },
    ],
    directApiHelpText: "Direct API publishes title, body HTML, URL slug, meta title, and meta description to your Squarespace blog.",
    directApiHelpUrl: "https://developers.squarespace.com/blog-posts",
    zapierSteps: [
      {
        title: "Open Zapier and create a new Zap",
        detail: "Go to zapier.com → Create Zap. Search for \"Webhooks by Zapier\" as the Trigger. Select \"Catch Hook\". Click Continue to get your webhook URL.",
      },
      {
        title: "Copy your Zapier webhook URL",
        detail: "Copy the URL Zapier generates and paste it into the field below.",
      },
      {
        title: "Set up the Squarespace action in Zapier",
        detail: "Add an Action step → search for \"Squarespace\". Select \"Create Blog Post\". Connect your Squarespace account. Map the Blog Batcher fields using the guide below.",
      },
      {
        title: "Turn on your Zap",
        detail: "Click \"Publish Zap\" in Zapier. Come back here, paste your webhook URL, and click Test Connection.",
      },
    ],
    fieldMappings: [
      { blogBatcherField: "title", cmsField: "Post Title" },
      { blogBatcherField: "body_html", cmsField: "Post Body (HTML)" },
      { blogBatcherField: "url_slug", cmsField: "URL Slug" },
      { blogBatcherField: "meta_title", cmsField: "SEO Title" },
      { blogBatcherField: "meta_description", cmsField: "SEO Description" },
      { blogBatcherField: "image_url", cmsField: "Thumbnail Image URL" },
    ],
  },
  {
    id: "ghost",
    name: "Ghost",
    category: "Publishing",
    description: "Publish to your Ghost blog with full content and SEO metadata via direct Admin API.",
    zapierSupport: "good",
    zapierSearchTerm: "Ghost",
    hasDirectApi: true,
    directApiFields: [
      {
        key: "adminUrl",
        label: "Ghost Admin URL",
        placeholder: "https://yourblog.ghost.io",
        type: "url" as const,
        required: true,
        hint: "Your Ghost site URL — include https://, no trailing slash",
      },
      {
        key: "staffAccessToken",
        label: "Staff Access Token",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        type: "password" as const,
        required: true,
        hint: "Ghost Admin → Settings → Integrations → Add custom integration → copy the Admin API Key",
        helpSlug: "ghost-admin-api-key",
        helpLabel: "How to get your Ghost Admin API Key",
      },
    ],
    directApiHelpText: "Direct API publishes title, HTML content, slug, meta title, meta description, and featured image to your Ghost blog.",
    directApiHelpUrl: "https://ghost.org/docs/admin-api/",
    zapierSteps: [
      {
        title: "Open Zapier and create a new Zap",
        detail: "Go to zapier.com → Create Zap. Search for \"Webhooks by Zapier\" as the Trigger. Select \"Catch Hook\". Click Continue to get your webhook URL.",
      },
      {
        title: "Copy your Zapier webhook URL",
        detail: "Copy the URL Zapier generates and paste it into the field below.",
      },
      {
        title: "Set up the Ghost action in Zapier",
        detail: "Add an Action step → search for \"Ghost\". Select \"Create Post\". Connect your Ghost site. Map the Blog Batcher fields using the guide below.",
      },
      {
        title: "Turn on your Zap",
        detail: "Click \"Publish Zap\" in Zapier. Come back here, paste your webhook URL, and click Test Connection.",
      },
    ],
    fieldMappings: [
      { blogBatcherField: "title", cmsField: "Post Title" },
      { blogBatcherField: "body_html", cmsField: "HTML Content" },
      { blogBatcherField: "url_slug", cmsField: "Slug" },
      { blogBatcherField: "meta_title", cmsField: "Meta Title" },
      { blogBatcherField: "meta_description", cmsField: "Meta Description" },
      { blogBatcherField: "focus_keyword", cmsField: "Tags (use as keyword tag)" },
      { blogBatcherField: "image_url", cmsField: "Feature Image URL" },
      { blogBatcherField: "image_alt_text", cmsField: "Feature Image Alt" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Zapier support badge
// ---------------------------------------------------------------------------

function ZapierSupportBadge({ level }: { level: CMSPlatform["zapierSupport"] }) {
  if (level === "excellent") {
    return <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Excellent Zapier support</span>;
  }
  if (level === "good") {
    return <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Good Zapier support</span>;
  }
  return <span className="text-xs font-medium text-muted-foreground">Coming soon</span>;
}

// ---------------------------------------------------------------------------
// Connection status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status || status === "not_connected") {
    return <Badge variant="secondary" className="text-xs">Not connected</Badge>;
  }
  if (status === "connected") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs gap-1">
        <CheckCircle2 className="w-3 h-3" /> Connected
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-xs gap-1">
        <XCircle className="w-3 h-3" /> Failed
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Guided setup modal
// ---------------------------------------------------------------------------

function SetupModal({
  platform,
  businessId,
  existingStatus,
  open,
  onClose,
  onSaved,
}: {
  platform: CMSPlatform;
  businessId: number;
  existingStatus?: { status: string | null; lastTestError: string | null; lastTestedAt: Date | null } | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"zapier" | "direct">("zapier");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [directFields, setDirectFields] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [copiedStep, setCopiedStep] = useState<number | null>(null);

  const saveMutation = trpc.integrations.save.useMutation({
    onSuccess: () => {
      toast.success(`${platform.name} connected successfully`);
      onSaved();
    },
    onError: (err) => toast.error("Could not save credentials", {
      description: err.message,
      duration: 8000,
    }),
  });

  const testMutation = trpc.integrations.testConnection.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`${platform.name} connection verified!`);
        onSaved();
        onClose();
      } else {
        toast.error(`Connection failed: ${result.error}`, { duration: 10000 });
      }
      setTesting(false);
    },
    onError: (err) => {
      toast.error("Connection test failed", { description: err.message, duration: 8000 });
      setTesting(false);
    },
  });

  const handleZapierConnect = async () => {
    if (!webhookUrl.trim()) {
      toast.error("Please paste your webhook URL first");
      return;
    }
    await saveMutation.mutateAsync({
      businessId,
      platform: "zapier",
      credentials: { webhookUrl: webhookUrl.trim() },
    });
    setTesting(true);
    testMutation.mutate({ businessId, platform: "zapier" });
  };

  const handleDirectConnect = async () => {
    if (!platform.directApiFields) return;
    const missing = platform.directApiFields.filter(f => f.required && !directFields[f.key]);
    if (missing.length) {
      toast.error(`Please fill in: ${missing.map(f => f.label).join(", ")}`);
      return;
    }
    const apiPlatform = platform.id as "wordpress" | "wix";
    await saveMutation.mutateAsync({
      businessId,
      platform: apiPlatform,
      credentials: directFields,
    });
    setTesting(true);
    testMutation.mutate({ businessId, platform: apiPlatform });
  };

  const copyToClipboard = (text: string, stepIdx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStep(stepIdx);
      setTimeout(() => setCopiedStep(null), 2000);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Connect {platform.name}
          </DialogTitle>
          <DialogDescription>
            Choose how you want to connect {platform.name} to Blog Batcher.
          </DialogDescription>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setActiveTab("zapier")}
            className={`flex-1 text-sm py-1.5 px-3 rounded-md font-medium transition-all ${
              activeTab === "zapier"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Zap className="w-3.5 h-3.5 inline mr-1.5" />
            Via Zapier or Make
            <Badge className="ml-2 text-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">Recommended</Badge>
          </button>
          {platform.hasDirectApi && (
            <button
              onClick={() => setActiveTab("direct")}
              className={`flex-1 text-sm py-1.5 px-3 rounded-md font-medium transition-all ${
                activeTab === "direct"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Globe className="w-3.5 h-3.5 inline mr-1.5" />
              Direct API
              <Badge variant="secondary" className="ml-2 text-xs">Advanced</Badge>
            </button>
          )}
        </div>

        {activeTab === "zapier" && (
          <div className="space-y-5">
            {/* Why Zapier */}
            <Alert className="border-primary/20 bg-primary/5">
              <Zap className="w-4 h-4 text-primary" />
              <AlertDescription className="text-sm">
                <strong>Why use Zapier or Make?</strong> Blog Batcher sends every SEO field — including URL slug, focus keyword, image alt text, and schema — to your webhook. Your Zap then maps these into {platform.name} with full control. No API restrictions.
              </AlertDescription>
            </Alert>

            {/* Step-by-step */}
            <div className="space-y-3">
              {platform.zapierSteps.map((step, idx) => (
                <div key={idx} className="flex gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">
                    {idx + 1}
                  </div>
                  <div className="flex-1 pt-0.5">
                    <p className="text-sm font-semibold">{step.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">{step.detail}</p>
                    {idx === 0 && (
                      <a
                        href={`https://zapier.com/apps/webhooks/integrations/${platform.zapierSearchTerm.toLowerCase()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-primary underline"
                      >
                        Open Zapier <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Field mapping guide */}
            <div>
              <p className="text-sm font-semibold mb-2">Field mapping guide</p>
              <div className="rounded-md border border-border overflow-hidden text-xs">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left px-3 py-2 font-semibold text-foreground">Blog Batcher field</th>
                      <th className="text-left px-3 py-2 font-semibold text-foreground">{platform.name} field</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {platform.fieldMappings.map((m) => (
                      <tr key={m.blogBatcherField} className="hover:bg-muted/30">
                        <td className="px-3 py-1.5 font-mono text-primary">{m.blogBatcherField}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{m.cmsField}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Separator />

            {/* Paste webhook URL */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Step 2 — Paste your webhook URL here</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://hooks.zapier.com/hooks/catch/... or https://hook.eu1.make.com/..."
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="text-sm"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Zapier: Webhooks by Zapier → Catch Hook URL &nbsp;·&nbsp; Make: Webhooks → Custom webhook URL
              </p>
            </div>

            {/* Last error */}
            {existingStatus?.lastTestError && (
              <Alert variant="destructive">
                <XCircle className="w-4 h-4" />
                <AlertDescription className="text-xs">{existingStatus.lastTestError}</AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full"
              onClick={handleZapierConnect}
              disabled={saveMutation.isPending || testing || testMutation.isPending}
            >
              {(saveMutation.isPending || testing || testMutation.isPending)
                ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                : <Zap className="w-4 h-4 mr-2" />}
              Save &amp; Test Connection
            </Button>
          </div>
        )}

        {activeTab === "direct" && platform.hasDirectApi && platform.directApiFields && (
          <div className="space-y-4">
            <Alert>
              <AlertDescription className="text-xs">
                {platform.directApiHelpText}{" "}
                {platform.directApiHelpUrl && (
                  <a
                    href={platform.directApiHelpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline inline-flex items-center gap-1"
                  >
                    Learn more <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              {platform.directApiFields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs font-medium">{field.label}</Label>
                    {field.helpSlug && field.helpLabel && (
                      <HelpLink slug={field.helpSlug} label={field.helpLabel} />
                    )}
                  </div>
                  {field.type === "select" ? (
                    <Select
                      value={directFields[field.key] ?? ""}
                      onValueChange={(v) => setDirectFields(prev => ({ ...prev, [field.key]: v }))}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={directFields[field.key] ?? ""}
                      onChange={(e) => setDirectFields(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="h-9 text-sm"
                    />
                  )}
                  {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                </div>
              ))}
            </div>

            {existingStatus?.lastTestError && (
              <Alert variant="destructive">
                <XCircle className="w-4 h-4" />
                <AlertDescription className="text-xs">{existingStatus.lastTestError}</AlertDescription>
              </Alert>
            )}

            {existingStatus?.lastTestedAt && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last tested: {new Date(existingStatus.lastTestedAt).toLocaleString()}
              </p>
            )}

            <Button
              className="w-full"
              onClick={handleDirectConnect}
              disabled={saveMutation.isPending || testing || testMutation.isPending}
            >
              {(saveMutation.isPending || testing || testMutation.isPending)
                ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                : <Globe className="w-4 h-4 mr-2" />}
              Save &amp; Test Connection
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Platform card (grid item)
// ---------------------------------------------------------------------------

function PlatformCard({
  platform,
  businessId,
  existingStatus,
  onSaved,
}: {
  platform: CMSPlatform;
  businessId: number;
  existingStatus?: { status: string | null; lastTestError: string | null; lastTestedAt: Date | null } | null;
  onSaved: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const isConnected = existingStatus?.status === "connected";

  return (
    <>
      <Card className={`flex flex-col transition-all hover:shadow-md ${isConnected ? "border-emerald-500/40" : ""}`}>
        <CardContent className="pt-5 pb-4 flex flex-col gap-3 flex-1">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{platform.name}</p>
              <p className="text-xs text-muted-foreground">{platform.category}</p>
            </div>
            <StatusBadge status={existingStatus?.status} />
          </div>

          {/* Description */}
          <p className="text-xs text-muted-foreground leading-relaxed flex-1">{platform.description}</p>

          {/* Zapier support level */}
          <ZapierSupportBadge level={platform.zapierSupport} />

          {/* Connect button */}
          <button
            onClick={() => setModalOpen(true)}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            <span className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              {isConnected ? "Manage connection" : "Connect via Zapier"}
            </span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </CardContent>
      </Card>

      <SetupModal
        platform={platform}
        businessId={businessId}
        existingStatus={existingStatus}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={onSaved}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntegrationsPage() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  const { data: business } = trpc.business.get.useQuery(undefined, {
    enabled: !!user,
  });

  const businessId = business?.id;

  const { data: integrationsList, refetch } = trpc.integrations.get.useQuery(
    { businessId: businessId! },
    { enabled: !!businessId }
  );

  if (authLoading) return null;
  if (!user) {
    navigate("/");
    return null;
  }

  const getStatus = (platformId: string) => {
    // For Zapier-connected platforms, check the zapier integration status
    return integrationsList?.find(i => i.platform === platformId || i.platform === "zapier") ?? null;
  };

  const getDirectStatus = (platformId: string) => {
    return integrationsList?.find(i => i.platform === platformId) ?? null;
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-2xl font-bold">CMS Integrations</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Connect your CMS to publish articles directly from Blog Batcher.
            </p>
          </div>
          <HelpLink slug="connecting-your-cms" label="How to connect your CMS" />
        </div>

        {/* How connections work */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-3">
              <Zap className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-foreground">How connections work</p>
                <p className="mt-1 text-muted-foreground">
                  Each integration uses <strong>Zapier</strong> or <strong>Make</strong> as the bridge. You create a Zap that triggers when Blog Batcher publishes an article, and it sends the full article payload — including URL slug, focus keyword, meta title, meta description, image alt text, and schema — directly to your CMS. No coding required. Once live, your articles publish automatically.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Platform grid */}
        {!businessId ? (
          <p className="text-sm text-muted-foreground">Complete your business profile first to connect integrations.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CMS_PLATFORMS.map((platform) => (
              <PlatformCard
                key={platform.id}
                platform={platform}
                businessId={businessId}
                existingStatus={getDirectStatus(platform.id) ?? getDirectStatus("zapier")}
                onSaved={() => refetch()}
              />
            ))}
          </div>
        )}

        {/* Make alternative */}
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-500/15 flex items-center justify-center shrink-0">
                <span className="text-purple-600 dark:text-purple-400 text-xs font-bold">M</span>
              </div>
              <div className="text-sm">
                <p className="font-semibold">Prefer Make (formerly Integromat)?</p>
                <p className="mt-1 text-muted-foreground">
                  Make works exactly the same way. Create a scenario with <strong>Webhooks → Custom webhook</strong> as the trigger, copy the webhook URL, and paste it into the setup modal above. All the same fields and field mappings apply.
                </p>
                <a
                  href="https://www.make.com/en/help/tools/webhooks"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-xs text-primary underline font-medium"
                >
                  Set up Make webhook <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
