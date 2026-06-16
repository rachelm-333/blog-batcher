import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { useActiveBusiness } from "@/contexts/BusinessContext";
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
import Step8KeywordSeeds from "./onboarding/Step8KeywordSeeds";
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
  "Keyword Seeds",
  "Review",
];

export default function Onboarding() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  // ?new=1 means the user is adding a second (or third, etc.) business
  const isNewBusiness = searchParams.get("new") === "1";
  // ?edit=1 means the user is returning to edit their profile after stages are complete
  const isEditMode = searchParams.get("edit") === "1";
  const [step, setStep] = useState(0);
  const [businessId, setBusinessId] = useState<number | null>(null);
  const [scrapeData, setScrapeData] = useState<any>(null);

  const utils = trpc.useUtils();

  // Get the currently selected business from context
  const { selectedBizId, activeBusiness: contextBusiness } = useActiveBusiness();

  // In edit mode, load the selected business by ID (respects business switcher)
  // In new-business mode, skip loading to avoid stale cache
  // In first-time onboarding, use business.get (no businessId yet)
  const editBizId = isEditMode && selectedBizId ? selectedBizId : null;

  const { data: businessById, isLoading: bizByIdLoading } = trpc.business.getById.useQuery(
    { businessId: editBizId! },
    { enabled: !!editBizId && !!user }
  );

  // For first-time onboarding (no edit mode, no new mode), still use business.get
  const { data: businessGet, isLoading: bizGetLoading, refetch: refetchGet } = trpc.business.get.useQuery(undefined, {
    enabled: !!user && !isNewBusiness && !isEditMode,
  });

  // Determine which business data to use
  const business = isEditMode ? businessById : businessGet;
  const bizLoading = isEditMode ? bizByIdLoading : bizGetLoading;
  const refetch = isEditMode
    ? async () => { await utils.business.getById.invalidate({ businessId: editBizId! }); }
    : async () => { await refetchGet(); };

  // When adding a new business, treat existing business data as null to avoid
  // stale cache from previous business bleeding into the new business form fields.
  const bizData = isNewBusiness ? null : business;

  // If user already has a business, pre-populate and skip to step 1
  // (only when NOT adding a new business)
  useEffect(() => {
    if (!isNewBusiness && business) {
      setBusinessId(business.id);
      // If Stage 1 is already complete (currentStage > 1), redirect to dashboard
      // UNLESS we're in edit mode (?edit=1) — then stay and jump straight to step 1
      if (business.currentStage > 1 && !isEditMode) {
        navigate("/dashboard");
      } else if (business.currentStage > 1 && isEditMode && step === 0) {
        setStep(1);
      }
    }
  }, [business, navigate, isNewBusiness, isEditMode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Sanitise scraped string values — converts null, undefined, and the literal
  // string "null" to empty string so form fields are never pre-filled with "null".
  const cleanStr = (v: any): string =>
    v == null || v === "null" || v === "undefined" ? "" : String(v);

  // Detect a partially-failed scrape: key fields are all empty after scrape ran
  const scrapePartiallyFailed =
    scrapeData != null &&
    !cleanStr(scrapeData?.industry) &&
    !cleanStr(scrapeData?.location) &&
    !cleanStr(scrapeData?.uniqueValueProposition);

  const handleBusinessCreated = (id: number) => {
    setBusinessId(id);
  };

  const innerContent = (
    <div className={isEditMode ? "" : "min-h-screen bg-background"}>
      {/* Header — only shown in standalone (new/first-time) mode */}
      {!isEditMode && (
        <div className="border-b bg-card">
          <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="font-semibold text-lg tracking-tight">Blog Batcher</div>
            <div className="text-sm text-muted-foreground">
              Stage 1 of 5 — Business Profile
            </div>
          </div>
        </div>
      )}
      {/* Edit mode page title */}
      {isEditMode && (
        <div className="border-b bg-card px-6 py-4">
          <h1 className="text-lg font-semibold">Editing Business Profile</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Update your business details — changes apply to future article batches.</p>
        </div>
      )}

      {/* Progress stepper */}
      <div className="border-b bg-muted/30">
        <div className="max-w-4xl mx-auto px-6 py-3">
          <div className="flex items-center gap-1 overflow-x-auto">
            {STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => (isEditMode ? setStep(i) : i < step && setStep(i))}
                  disabled={!isEditMode && i > step}
                  title={isEditMode ? `Go to ${STEPS[i]}` : i < step ? `Go back to ${STEPS[i]}` : undefined}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    i === step
                      ? "bg-primary text-primary-foreground"
                      : i < step
                      ? "bg-primary/20 text-primary cursor-pointer hover:bg-primary/30"
                      : isEditMode
                      ? "bg-muted text-foreground cursor-pointer hover:bg-primary/20 hover:text-primary"
                      : "text-muted-foreground cursor-default"
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
            businessName={isNewBusiness ? "" : (business?.name ?? "")}
            websiteUrl={isNewBusiness ? "" : (business?.websiteUrl ?? "")}
            onBusinessCreated={handleBusinessCreated}
            onScrapeComplete={handleScrapeComplete}
            onNext={next}
          />
        )}
        {step === 1 && businessId && (
          <Step1BusinessDetails
            key={`step1-${businessId}`}
            businessId={businessId}
            initial={{
              name: cleanStr(bizData?.name ?? scrapeData?.name),
              industry: cleanStr(bizData?.industry ?? scrapeData?.industry),
              location: cleanStr(bizData?.location ?? scrapeData?.location),
              serviceArea: cleanStr(bizData?.serviceArea ?? scrapeData?.serviceArea),
              physicalAddress: cleanStr(bizData?.physicalAddress) || undefined,
              isPhysicalLocation: bizData?.isPhysicalLocation ?? false,
              abnBusinessRegistration: cleanStr(bizData?.abnBusinessRegistration) || undefined,
              uniqueValueProposition:
                cleanStr(bizData?.uniqueValueProposition ?? scrapeData?.uniqueValueProposition) || undefined,
              problemsSolved: bizData?.problemsSolved ?? undefined,
              keywordExclusions: bizData?.keywordExclusions ?? undefined,
              audiences: (
                // Priority: saved audiences > scrapeCache audiences > scrapeData audiences > empty
                (bizData?.audiences?.length
                  ? bizData.audiences
                  : (((bizData?.scrapeCache as any)?.audiences?.length)
                    ? (bizData?.scrapeCache as any).audiences
                    : (scrapeData?.audiences ?? [])))
              ).map((a: any) => ({
                label: a.label ?? "",
                description: a.description ?? "",
              })),
            }}
            scrapePartiallyFailed={scrapePartiallyFailed}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 2 && businessId && (
          <Step2Services
            businessId={businessId}
            initial={(bizData?.services ?? scrapeData?.services ?? []).map((s: any) => ({
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
              primaryCtaText: bizData?.primaryCtaText ?? scrapeData?.primaryCtaText,
              primaryCtaUrl: bizData?.primaryCtaUrl ?? scrapeData?.primaryCtaUrl,
              contactPageUrl: bizData?.contactPageUrl ?? scrapeData?.contactPageUrl,
              bookingsPageUrl: bizData?.bookingsPageUrl ?? scrapeData?.bookingsPageUrl,
              testimonialsPageUrl:
                bizData?.testimonialsPageUrl ?? scrapeData?.testimonialsPageUrl,
              shopUrl: bizData?.shopUrl ?? scrapeData?.shopUrl,
              otherInternalLinks: (bizData?.otherInternalLinks as any) ?? undefined,
            }}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 4 && businessId && (
          <Step4BrandVoice
            businessId={businessId}
            initial={{
              primaryArchetype: (bizData?.brandVoice?.primaryArchetype ?? scrapeData?.brandVoice?.primaryArchetype) ?? undefined,
              secondaryArchetype: bizData?.brandVoice?.secondaryArchetype ?? undefined,
              namedPersona: bizData?.brandVoice?.namedPersona ?? undefined,
              formalityLevel: (bizData?.brandVoice?.formalityLevel ?? scrapeData?.brandVoice?.formalityLevel) ?? undefined,
              keyPhrases: bizData?.brandVoice?.keyPhrases as string[] ?? scrapeData?.brandVoice?.keyPhrases ?? [],
              phrasesToAvoid: bizData?.brandVoice?.phrasesToAvoid as string[] ?? scrapeData?.brandVoice?.phrasesToAvoid ?? [],
              styleNotes: bizData?.brandVoice?.styleNotes ?? scrapeData?.brandVoice?.styleNotes,
              finalVoiceBrief: bizData?.brandVoice?.finalVoiceBrief ?? scrapeData?.brandVoice?.finalVoiceBrief,
            }}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 5 && businessId && (
          <Step5Competitors
            businessId={businessId}
            initial={(bizData?.competitors ?? scrapeData?.competitors ?? []).map((c: any) => ({
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
              cmsPlatform: bizData?.cmsPlatform ?? undefined,
              wordpressSeoPlugin: bizData?.wordpressSeoPlugin ?? undefined,
            }}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 7 && businessId && (
          <Step7SocialProof
            businessId={businessId}
            initial={{
              yearsInBusiness: bizData?.yearsInBusiness,
              clientsServed: bizData?.clientsServed,
              awardsAccreditations: bizData?.awardsAccreditations,
              linkedinUrl: bizData?.linkedinUrl,
              facebookUrl: bizData?.facebookUrl,
              instagramHandle: bizData?.instagramHandle,
            }}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 8 && businessId && (
          <Step8KeywordSeeds
            businessId={businessId}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 9 && businessId && (
          <Step8Review
            businessId={businessId}
            summary={{
              name: bizData?.name,
              industry: bizData?.industry ?? undefined,
              location: bizData?.location ?? undefined,
              audienceCount: bizData?.audiences?.length ?? 0,
              serviceCount: bizData?.services?.length ?? 0,
              competitorCount: bizData?.competitors?.length ?? 0,
              hasBrandVoice: !!bizData?.brandVoice?.finalVoiceBrief,
              cmsPlatform: bizData?.cmsPlatform ?? undefined,
              yearsInBusiness: bizData?.yearsInBusiness,
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

  if (isEditMode) {
    return <DashboardLayout>{innerContent}</DashboardLayout>;
  }
  return innerContent;
}
