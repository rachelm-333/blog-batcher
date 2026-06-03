import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import Step0Scrape from "./onboarding/Step0Scrape";
import Step1BusinessDetails from "./onboarding/Step1BusinessDetails";
import Step2Services from "./onboarding/Step2Services";
import Step3CtaLinks from "./onboarding/Step3CtaLinks";
import Step4BrandVoice from "./onboarding/Step4BrandVoice";
import Step5Competitors from "./onboarding/Step5Competitors";
import Step6PublishingPlatform from "./onboarding/Step6PublishingPlatform";
import Step7SocialProof from "./onboarding/Step7SocialProof";
import Step8Review from "./onboarding/Step8Review";

const STEPS = [
  "Website Scan",
  "Business Details",
  "Services",
  "CTA Links",
  "Brand Voice",
  "Competitors",
  "Publishing",
  "Social Proof",
  "Review",
];

export default function Onboarding() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  // ?new=1 means the user is adding a second (or third, etc.) business
  const isNewBusiness = new URLSearchParams(search).get("new") === "1";
  const [step, setStep] = useState(0);
  const [businessId, setBusinessId] = useState<number | null>(null);
  const [scrapeData, setScrapeData] = useState<any>(null);

  const utils = trpc.useUtils();
  // When adding a new business, skip loading the existing business to avoid redirect
  const { data: business, isLoading: bizLoading, refetch } = trpc.business.get.useQuery(undefined, {
    enabled: !!user && !isNewBusiness,
  });

  // If user already has a business, pre-populate and skip to step 1
  // (only when NOT adding a new business)
  useEffect(() => {
    if (!isNewBusiness && business) {
      setBusinessId(business.id);
      // If Stage 1 is already complete (currentStage > 1), redirect to dashboard
      if (business.currentStage > 1) {
        navigate("/dashboard");
      }
    }
  }, [business, navigate, isNewBusiness]);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login");
    }
  }, [authLoading, user, navigate]);

  if (authLoading || bizLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const next = async () => {
    // Refetch business data so Step 8 always shows the latest saved values
    await refetch();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const handleScrapeComplete = (data: any) => {
    setScrapeData(data);
    refetch();
  };

  const handleBusinessCreated = (id: number) => {
    setBusinessId(id);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="font-semibold text-lg tracking-tight">Blog Batcher</div>
          <div className="text-sm text-muted-foreground">
            Stage 1 of 5 — Business Profile
          </div>
        </div>
      </div>

      {/* Progress stepper */}
      <div className="border-b bg-muted/30">
        <div className="max-w-4xl mx-auto px-6 py-3">
          <div className="flex items-center gap-1 overflow-x-auto">
            {STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => i < step && setStep(i)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    i === step
                      ? "bg-primary text-primary-foreground"
                      : i < step
                      ? "bg-primary/20 text-primary cursor-pointer hover:bg-primary/30"
                      : "text-muted-foreground"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      i === step
                        ? "bg-primary-foreground text-primary"
                        : i < step
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted-foreground/30 text-muted-foreground"
                    }`}
                  >
                    {i < step ? "✓" : i + 1}
                  </span>
                  {label}
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className={`h-px w-4 ${i < step ? "bg-primary/40" : "bg-border"}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="max-w-4xl mx-auto px-6 py-10">
        {step === 0 && (
          <Step0Scrape
            businessId={businessId}
            businessName={business?.name ?? ""}
            websiteUrl={business?.websiteUrl ?? ""}
            onBusinessCreated={handleBusinessCreated}
            onScrapeComplete={handleScrapeComplete}
            onNext={next}
          />
        )}
        {step === 1 && businessId && (
          <Step1BusinessDetails
            businessId={businessId}
            initial={{
              name: business?.name ?? scrapeData?.name,
              industry: business?.industry ?? scrapeData?.industry,
              location: business?.location ?? scrapeData?.location,
              serviceArea: business?.serviceArea ?? scrapeData?.serviceArea,
              physicalAddress: business?.physicalAddress ?? undefined,
              isPhysicalLocation: business?.isPhysicalLocation ?? false,
              abnBusinessRegistration: business?.abnBusinessRegistration ?? undefined,
              uniqueValueProposition:
                business?.uniqueValueProposition ?? scrapeData?.uniqueValueProposition,
              keywordExclusions: business?.keywordExclusions ?? undefined,
              audiences: (business?.audiences ?? scrapeData?.audiences ?? []).map((a: any) => ({
                label: a.label ?? "",
                description: a.description ?? "",
              })),
            }}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 2 && businessId && (
          <Step2Services
            businessId={businessId}
            initial={(business?.services ?? scrapeData?.services ?? []).map((s: any) => ({
              name: s.name ?? "",
              pageUrl: s.pageUrl ?? "",
            }))}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 3 && businessId && (
          <Step3CtaLinks
            businessId={businessId}
            initial={{
              primaryCtaText: business?.primaryCtaText ?? scrapeData?.primaryCtaText,
              primaryCtaUrl: business?.primaryCtaUrl ?? scrapeData?.primaryCtaUrl,
              contactPageUrl: business?.contactPageUrl ?? scrapeData?.contactPageUrl,
              bookingsPageUrl: business?.bookingsPageUrl ?? scrapeData?.bookingsPageUrl,
              testimonialsPageUrl:
                business?.testimonialsPageUrl ?? scrapeData?.testimonialsPageUrl,
              shopUrl: business?.shopUrl ?? scrapeData?.shopUrl,
              otherInternalLinks: (business?.otherInternalLinks as any) ?? undefined,
            }}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 4 && businessId && (
          <Step4BrandVoice
            businessId={businessId}
            initial={{
              primaryArchetype: (business?.brandVoice?.primaryArchetype ?? scrapeData?.brandVoice?.primaryArchetype) ?? undefined,
              secondaryArchetype: business?.brandVoice?.secondaryArchetype ?? undefined,
              namedPersona: business?.brandVoice?.namedPersona ?? undefined,
              formalityLevel: (business?.brandVoice?.formalityLevel ?? scrapeData?.brandVoice?.formalityLevel) ?? undefined,
              keyPhrases: business?.brandVoice?.keyPhrases as string[] ?? scrapeData?.brandVoice?.keyPhrases ?? [],
              phrasesToAvoid: business?.brandVoice?.phrasesToAvoid as string[] ?? scrapeData?.brandVoice?.phrasesToAvoid ?? [],
              styleNotes: business?.brandVoice?.styleNotes ?? scrapeData?.brandVoice?.styleNotes,
              finalVoiceBrief: business?.brandVoice?.finalVoiceBrief ?? scrapeData?.brandVoice?.finalVoiceBrief,
            }}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 5 && businessId && (
          <Step5Competitors
            businessId={businessId}
            initial={(business?.competitors ?? scrapeData?.competitors ?? []).map((c: any) => ({
              name: c.name ?? "",
              websiteUrl: c.websiteUrl ?? "",
              description: c.description ?? "",
            }))}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 6 && businessId && (
          <Step6PublishingPlatform
            businessId={businessId}
            initial={{
              cmsPlatform: business?.cmsPlatform ?? undefined,
              wordpressSeoPlugin: business?.wordpressSeoPlugin ?? undefined,
            }}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 7 && businessId && (
          <Step7SocialProof
            businessId={businessId}
            initial={{
              yearsInBusiness: business?.yearsInBusiness,
              clientsServed: business?.clientsServed,
              awardsAccreditations: business?.awardsAccreditations,
            }}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 8 && businessId && (
          <Step8Review
            businessId={businessId}
            summary={{
              name: business?.name,
              industry: business?.industry ?? undefined,
              location: business?.location ?? undefined,
              audienceCount: business?.audiences?.length ?? 0,
              serviceCount: business?.services?.length ?? 0,
              competitorCount: business?.competitors?.length ?? 0,
              hasBrandVoice: !!business?.brandVoice?.finalVoiceBrief,
              cmsPlatform: business?.cmsPlatform ?? undefined,
              yearsInBusiness: business?.yearsInBusiness,
            }}
            onBack={back}
          />
        )}

        {/* Guard: if no businessId yet and step > 0, go back to step 0 */}
        {!businessId && step > 0 && (
          <div className="text-center py-20">
            <p className="text-muted-foreground mb-4">Please complete the website scan first.</p>
            <button
              onClick={() => setStep(0)}
              className="text-primary underline text-sm"
            >
              Go back to Step 1
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
