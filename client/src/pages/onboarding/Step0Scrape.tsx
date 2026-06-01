import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Globe, RefreshCw } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Props {
  businessId: number | null;
  businessName: string;
  websiteUrl: string;
  onBusinessCreated: (id: number) => void;
  onScrapeComplete: (data: any) => void;
  onNext: () => void;
}

export default function Step0Scrape({
  businessId,
  businessName: initialName,
  websiteUrl: initialUrl,
  onBusinessCreated,
  onScrapeComplete,
  onNext,
}: Props) {
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [scraping, setScraping] = useState(false);

  const createBusiness = trpc.business.create.useMutation();
  const scrapeMutation = trpc.business.scrape.useMutation();

  const handleScrape = async () => {
    if (!name.trim()) {
      toast.error("Please enter your business name.");
      return;
    }
    if (!url.trim()) {
      toast.error("Please enter your website URL.");
      return;
    }

    // Normalise URL
    let normalised = url.trim();
    if (!normalised.startsWith("http://") && !normalised.startsWith("https://")) {
      normalised = "https://" + normalised;
    }

    setScraping(true);
    try {
      // Create business if not already created
      let bizId = businessId;
      if (!bizId) {
        const result = await createBusiness.mutateAsync({ name, websiteUrl: normalised });
        bizId = result.id;
        onBusinessCreated(bizId);
      }

      // Run AI scrape
      const result = await scrapeMutation.mutateAsync({
        businessId: bizId,
        businessName: name,
        websiteUrl: normalised,
      });

      if (result.success) {
        onScrapeComplete(result.data);
        toast.success("Website analysed! Review and edit the pre-filled fields below.");
        onNext();
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Scrape failed. Please try again.");
    } finally {
      setScraping(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Let's start with your website</h2>
        <p className="text-muted-foreground">
          Enter your business name and website URL. Blog Batcher will analyse your site and
          pre-fill your profile — you can review and edit everything before saving.
        </p>
      </div>

      <div className="space-y-5 max-w-lg">
        <div className="space-y-2">
          <Label htmlFor="bizName">Business Name</Label>
          <Input
            id="bizName"
            placeholder="e.g. Sunshine Physiotherapy"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={scraping}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bizUrl">Website URL</Label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="bizUrl"
              placeholder="https://yourbusiness.com.au"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="pl-9"
              disabled={scraping}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            We'll scrape your website to pre-fill your business profile.
          </p>
        </div>

        <Button
          onClick={handleScrape}
          disabled={scraping || !name.trim() || !url.trim()}
          size="lg"
          className="w-full"
        >
          {scraping ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Analysing your website…
            </>
          ) : businessId ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Re-scan Website
            </>
          ) : (
            <>
              <Globe className="mr-2 h-4 w-4" />
              Analyse Website
            </>
          )}
        </Button>

        {scraping && (
          <p className="text-sm text-muted-foreground text-center animate-pulse">
            This usually takes 15–30 seconds. We're reading your website, services, and brand voice…
          </p>
        )}
      </div>
    </div>
  );
}
