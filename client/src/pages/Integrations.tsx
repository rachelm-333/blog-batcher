/**
 * Integrations Page — Layer 8
 *
 * Allows users to connect their CMS (WordPress, Wix, Zapier) to Blog Batcher.
 * Matches the UI mockup: platform cards with connection status, credential forms,
 * and a Test Connection button.
 *
 * Coming Soon: Shopify, Webflow, Squarespace, Ghost
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Zap,
  Globe,
  Webhook,
  Clock,
} from "lucide-react";
import { HelpLink } from "@/components/HelpLink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = "wordpress" | "wix" | "zapier";

interface PlatformConfig {
  id: Platform;
  name: string;
  description: string;
  icon: React.ReactNode;
  available: boolean;
  fields: FieldDef[];
  helpUrl: string;
  helpText: string;
}

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password" | "url" | "select";
  options?: { value: string; label: string }[];
  required: boolean;
  hint?: string;
}

// ---------------------------------------------------------------------------
// Platform definitions
// ---------------------------------------------------------------------------

const PLATFORMS: PlatformConfig[] = [
  {
    id: "wordpress",
    name: "WordPress",
    description: "Publish directly to your WordPress site via REST API. Supports Yoast SEO, RankMath, AIOSEO, and no plugin.",
    icon: <Globe className="w-6 h-6 text-primary" />,
    available: true,
    helpUrl: "https://wordpress.com/support/application-passwords/",
    helpText: "You need an Application Password from WordPress Admin → Users → Your Profile → Application Passwords.",
    fields: [
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
      },
    ],
  },
  {
    id: "wix",
    name: "Wix",
    description: "Publish blog posts to your Wix site using the Wix Content API.",
    icon: <Globe className="w-6 h-6 text-purple-500" />,
    available: true,
    helpUrl: "https://dev.wix.com/docs/rest/articles/getting-started/authentication",
    helpText: "You need a Wix API Key and Site ID from the Wix Developer Centre.",
    fields: [
      {
        key: "apiKey",
        label: "Wix API Key",
        placeholder: "IST.eyJlb...",
        type: "password",
        required: true,
        hint: "From Wix Developer Centre → API Keys",
      },
      {
        key: "siteId",
        label: "Wix Site ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        type: "text",
        required: true,
        hint: "Found in your Wix site URL or Developer Centre",
      },
    ],
  },
  {
    id: "zapier",
    name: "Zapier Webhook",
    description: "Send article payloads to any Zapier webhook. Connect to any CMS, email tool, or automation.",
    icon: <Zap className="w-6 h-6 text-orange-500" />,
    available: true,
    helpUrl: "https://zapier.com/apps/webhook/integrations",
    helpText: "Create a Zap with a Webhooks by Zapier trigger (Catch Hook) and paste the webhook URL below.",
    fields: [
      {
        key: "webhookUrl",
        label: "Zapier Webhook URL",
        placeholder: "https://hooks.zapier.com/hooks/catch/...",
        type: "url",
        required: true,
        hint: "From your Zapier Catch Hook trigger",
      },
    ],
  },
];

const COMING_SOON = ["Shopify", "Webflow", "Squarespace", "Ghost"];

// ---------------------------------------------------------------------------
// Status badge
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
        <XCircle className="w-3 h-3" /> Connection failed
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Platform card
// ---------------------------------------------------------------------------

function PlatformCard({
  platform,
  businessId,
  existingStatus,
  onSaved,
}: {
  platform: PlatformConfig;
  businessId: number;
  existingStatus?: { status: string | null; lastTestError: string | null; lastTestedAt: Date | null } | null;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);

  const saveMutation = trpc.integrations.save.useMutation({
    onSuccess: () => {
      toast.success(`${platform.name} credentials saved`);
      onSaved();
    },
    onError: (err) => toast.error("Could not save credentials", {
      description: `${err.message}. Check that all required fields are filled in correctly.`,
      duration: 8000,
    }),
  });

  const testMutation = trpc.integrations.testConnection.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`${platform.name} connection verified successfully`);
      } else {
        toast.error(`Connection failed: ${result.error}`, {
          description: "Double-check your credentials and make sure your CMS is accessible. See the help icon above for setup instructions.",
          duration: 10000,
        });
      }
      onSaved();
      setTesting(false);
    },
    onError: (err) => {
      toast.error("Connection test failed", {
        description: `${err.message}. Make sure your CMS is online and the credentials are correct.`,
        duration: 8000,
      });
      setTesting(false);
    },
  });

  const handleSave = () => {
    const missing = platform.fields.filter(f => f.required && !fields[f.key]);
    if (missing.length) {
      toast.error(`Please fill in: ${missing.map(f => f.label).join(", ")}`);
      return;
    }
    saveMutation.mutate({ businessId, platform: platform.id, credentials: fields });
  };

  const handleTest = async () => {
    // Save first if fields are filled in
    const hasFields = platform.fields.some(f => fields[f.key]);
    if (hasFields) {
      await saveMutation.mutateAsync({ businessId, platform: platform.id, credentials: fields });
    }
    setTesting(true);
    testMutation.mutate({ businessId, platform: platform.id });
  };

  const isConnected = existingStatus?.status === "connected";

  return (
    <Card className={`transition-all ${isConnected ? "border-emerald-500/30" : ""}`}>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {platform.icon}
            <div>
              <CardTitle className="text-base">{platform.name}</CardTitle>
              <CardDescription className="text-xs mt-0.5">{platform.description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={existingStatus?.status} />
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          <Separator />

          {/* Help text */}
          <Alert>
            <AlertDescription className="text-xs">
              {platform.helpText}{" "}
              <a
                href={platform.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline inline-flex items-center gap-1"
              >
                Learn more <ExternalLink className="w-3 h-3" />
              </a>
            </AlertDescription>
          </Alert>

          {/* Fields */}
          <div className="space-y-3">
            {platform.fields.map((field) => (
              <div key={field.key} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-medium">{field.label}</Label>
                  {field.key === "seoPlugin" && <HelpLink slug="seo-plugins" label="Which SEO plugin should I use?" />}
                  {field.key === "applicationPassword" && <HelpLink slug="wordpress-application-password" label="How to create a WordPress Application Password" />}
                  {field.key === "apiKey" && <HelpLink slug="wix-api-key" label="How to get your Wix API Key" />}
                </div>
                {field.type === "select" ? (
                  <Select
                    value={fields[field.key] ?? ""}
                    onValueChange={(v) => setFields(prev => ({ ...prev, [field.key]: v }))}
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
                    value={fields[field.key] ?? ""}
                    onChange={(e) => setFields(prev => ({ ...prev, [field.key]: e.target.value }))}
                    className="h-9 text-sm"
                  />
                )}
                {field.hint && (
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                )}
              </div>
            ))}
          </div>

          {/* Last test error */}
          {existingStatus?.lastTestError && (
            <Alert variant="destructive">
              <XCircle className="w-4 h-4" />
              <AlertDescription className="text-xs">{existingStatus.lastTestError}</AlertDescription>
            </Alert>
          )}

          {/* Last tested */}
          {existingStatus?.lastTestedAt && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Last tested: {new Date(existingStatus.lastTestedAt).toLocaleString()}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Save Credentials
            </Button>
            <Button
              size="sm"
              onClick={handleTest}
              disabled={testing || testMutation.isPending}
            >
              {(testing || testMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Test Connection
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntegrationsPage() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  // Get the user's first business
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

  const getIntegrationStatus = (platform: Platform) => {
    return integrationsList?.find(i => i.platform === platform) ?? null;
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">CMS Integrations</h1>
            <HelpLink slug="connecting-your-cms" label="How to connect your CMS" />
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Connect your CMS to publish articles directly from Blog Batcher.
          </p>
        </div>

        {/* Available platforms */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Available</h2>
          {businessId ? (
            PLATFORMS.map((platform) => (
              <PlatformCard
                key={platform.id}
                platform={platform}
                businessId={businessId}
                existingStatus={getIntegrationStatus(platform.id)}
                onSaved={() => refetch()}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Complete your business profile first to connect integrations.</p>
          )}
        </div>

        {/* Coming soon */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Coming Soon</h2>
          <div className="grid grid-cols-2 gap-3">
            {COMING_SOON.map((name) => (
              <Card key={name} className="opacity-60">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{name}</CardTitle>
                    <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>

        {/* Webhook info */}
        <Card className="bg-muted/30">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <Webhook className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Using Zapier?</p>
                <p className="mt-1">
                  The Zapier webhook sends a JSON payload with all article fields (title, HTML body, meta title,
                  meta description, focus keyword, URL slug, schema JSON-LD, and scheduled publish date).
                  Use Zapier to route to Shopify, Webflow, Squarespace, Ghost, or any other platform.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
