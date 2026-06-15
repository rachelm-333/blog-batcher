import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { ArrowRight, ArrowLeft, Loader2, Plus, Sparkles, X } from "lucide-react";
import { HelpLink } from "@/components/HelpLink";

interface Audience {
  label: string;
  description: string;
}

interface Props {
  businessId: number;
  scrapePartiallyFailed?: boolean;
  initial: {
    name?: string;
    industry?: string;
    location?: string;
    serviceArea?: string;
    physicalAddress?: string;
    isPhysicalLocation?: boolean;
    abnBusinessRegistration?: string;
    uniqueValueProposition?: string;
    problemsSolved?: string;
    keywordExclusions?: string;
    audiences?: Audience[];
  };
  onNext: () => void;
  onBack: () => void;
}

const INTERVIEW_QUESTIONS = [
  "Think of your best client result. What was their situation BEFORE they came to you? What were they dealing with?",
  "What were they frustrated with, struggling with, or worried about? What had they already tried that didn't work?",
  "What changed for them after working with you? What can they now do, feel, or achieve that they couldn't before?",
];

type ModalStep = "q1" | "q2" | "q3" | "loading" | "result";

export default function Step1BusinessDetails({ businessId, initial, scrapePartiallyFailed, onNext, onBack }: Props) {
  const [name, setName] = useState(initial.name ?? "");
  const [industry, setIndustry] = useState(initial.industry ?? "");
  const [location, setLocation] = useState(initial.location ?? "");
  const [serviceArea, setServiceArea] = useState(initial.serviceArea ?? "");
  const [physicalAddress, setPhysicalAddress] = useState(initial.physicalAddress ?? "");
  const [isPhysical, setIsPhysical] = useState(initial.isPhysicalLocation ?? false);
  const [abn, setAbn] = useState(initial.abnBusinessRegistration ?? "");
  const [uvp, setUvp] = useState(initial.uniqueValueProposition ?? "");
  const [problemsSolved, setProblemsSolved] = useState(initial.problemsSolved ?? "");
  const [keywordExclusions, setKeywordExclusions] = useState(initial.keywordExclusions ?? "");
  const [audiences, setAudiences] = useState<Audience[]>(
    initial.audiences?.length ? initial.audiences : [{ label: "", description: "" }]
  );

  // Interview modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>("q1");
  const [answers, setAnswers] = useState(["", "", ""]);
  const [generatedParagraph, setGeneratedParagraph] = useState("");

  const updateBusiness = trpc.business.update.useMutation();
  const saveAudiences = trpc.business.saveAudiences.useMutation();
  const generateProblemsSolved = trpc.business.generateProblemsSolved.useMutation();

  const addAudience = () => setAudiences((prev) => [...prev, { label: "", description: "" }]);
  const removeAudience = (i: number) => setAudiences((prev) => prev.filter((_, idx) => idx !== i));
  const updateAudience = (i: number, field: keyof Audience, value: string) =>
    setAudiences((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Business name is required.");
      return;
    }
    try {
      await Promise.all([
        updateBusiness.mutateAsync({
          businessId,
          name,
          industry: industry || undefined,
          location: location || undefined,
          serviceArea: serviceArea || undefined,
          physicalAddress: physicalAddress || undefined,
          isPhysicalLocation: isPhysical,
          abnBusinessRegistration: abn || undefined,
          uniqueValueProposition: uvp || undefined,
          problemsSolved: problemsSolved || undefined,
          keywordExclusions: keywordExclusions || undefined,
        }),
        saveAudiences.mutateAsync({
          businessId,
          audiences: audiences
            .filter((a) => a.label.trim())
            .map((a, i) => ({ label: a.label, description: a.description, sortOrder: i })),
        }),
      ]);
      toast.success("Business details saved.");
      onNext();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save. Please try again.");
    }
  };

  const saving = updateBusiness.isPending || saveAudiences.isPending;

  // ── Interview modal helpers ────────────────────────────────────────────────

  const openModal = () => {
    setAnswers(["", "", ""]);
    setGeneratedParagraph("");
    setModalStep("q1");
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const currentQuestionIndex = modalStep === "q1" ? 0 : modalStep === "q2" ? 1 : modalStep === "q3" ? 2 : -1;

  const handleNextQuestion = () => {
    if (modalStep === "q1") {
      if (!answers[0].trim()) { toast.error("Please answer the question before continuing."); return; }
      setModalStep("q2");
    } else if (modalStep === "q2") {
      if (!answers[1].trim()) { toast.error("Please answer the question before continuing."); return; }
      setModalStep("q3");
    } else if (modalStep === "q3") {
      if (!answers[2].trim()) { toast.error("Please answer the question before continuing."); return; }
      handleGenerate();
    }
  };

  const handleBack = () => {
    if (modalStep === "q2") setModalStep("q1");
    else if (modalStep === "q3") setModalStep("q2");
    else if (modalStep === "result") { setModalStep("q1"); setAnswers(["", "", ""]); setGeneratedParagraph(""); }
  };

  const handleGenerate = async () => {
    setModalStep("loading");
    try {
      const result = await generateProblemsSolved.mutateAsync({
        answer1: answers[0],
        answer2: answers[1],
        answer3: answers[2],
        businessName: name || "this business",
        industry: industry || "general",
      });
      setGeneratedParagraph(result.paragraph);
      setModalStep("result");
    } catch (err: any) {
      toast.error(err?.message ?? "Generation failed. Please try again.");
      setModalStep("q3");
    }
  };

  const handleUseThis = () => {
    setProblemsSolved(generatedParagraph);
    closeModal();
    toast.success("Problems Solved field updated.");
  };

  const handleTryAgain = () => {
    setAnswers(["", "", ""]);
    setGeneratedParagraph("");
    setModalStep("q1");
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Business Details</h2>
        <p className="text-muted-foreground">
          Review and edit the details we extracted from your website.
        </p>
      </div>

      {scrapePartiallyFailed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/40 bg-amber-400/8 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span>
            We couldn't extract details from this website automatically — this can happen with some website builders (Wix, Squarespace, Webflow). Please fill in your details below.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label>Business Name *</Label>
            <HelpLink slug="business-profile-setup" label="Why your business name matters" />
          </div>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label>Industry / Category</Label>
            <HelpLink slug="business-profile-setup" label="How industry affects your articles" />
          </div>
          <Input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. Physiotherapy, Legal Services"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label>Location</Label>
            <HelpLink slug="business-profile-setup" label="How location is used for local SEO" />
          </div>
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Brisbane QLD, Nationwide, Online Only"
          />
        </div>
        <div className="space-y-2">
          <Label>Service Area</Label>
          <Input
            value={serviceArea}
            onChange={(e) => setServiceArea(e.target.value)}
            placeholder="Where do you ship or service?"
          />
        </div>
        <div className="space-y-2">
          <Label>ABN / Business Registration</Label>
          <Input
            value={abn}
            onChange={(e) => setAbn(e.target.value)}
            placeholder="Optional — improves E-E-A-T credibility"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            id="isPhysical"
            checked={isPhysical}
            onCheckedChange={setIsPhysical}
          />
          <Label htmlFor="isPhysical">This business has a physical location</Label>
        </div>
        {isPhysical && (
          <div className="space-y-2">
            <Label>Physical Address</Label>
            <Input
              value={physicalAddress}
              onChange={(e) => setPhysicalAddress(e.target.value)}
              placeholder="Full street address"
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Unique Value Proposition</Label>
        <Textarea
          value={uvp}
          onChange={(e) => setUvp(e.target.value)}
          placeholder="What makes your business different? This appears in every article's E-E-A-T signals."
          rows={3}
        />
      </div>

      {/* Problems Solved — with AI interview helper */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>What problems do your customers have before they find you?</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openModal}
            className="text-xs gap-1.5 text-muted-foreground hover:text-foreground shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Help me write this →
          </Button>
        </div>
        <Textarea
          value={problemsSolved}
          onChange={(e) => setProblemsSolved(e.target.value)}
          placeholder="e.g. Most of our clients were managing 6 different tools and losing track of projects. They came to us frustrated with wasted hours and no single source of truth."
          rows={3}
        />
        <p className="text-xs text-muted-foreground">This is what your blog content will lead with — the pain the reader is in before your business solves it.</p>
      </div>

      <div className="space-y-2">
        <Label>Keyword Exclusions</Label>
        <Input
          value={keywordExclusions}
          onChange={(e) => setKeywordExclusions(e.target.value)}
          placeholder="Topics to exclude from keyword research, comma-separated"
        />
      </div>

      {/* Target Audiences */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <Label className="text-base font-medium">Target Audiences</Label>
              <HelpLink slug="business-profile-setup" label="How to describe your target audience" />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Who are your customers? Add 2–5 audience groups.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={addAudience} type="button">
            <Plus className="h-4 w-4 mr-1" /> Add Audience
          </Button>
        </div>

        <div className="space-y-3">
          {audiences.map((audience, i) => (
            <div key={i} className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Audience {i + 1}</span>
                {audiences.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAudience(i)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                <Input
                  placeholder="Label (e.g. Small Business Owners)"
                  value={audience.label}
                  onChange={(e) => updateAudience(i, "label", e.target.value)}
                />
                <Textarea
                  placeholder="What do they search for and why?"
                  value={audience.description}
                  onChange={(e) => updateAudience(i, "description", e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save & Continue
        </Button>
      </div>

      {/* ── AI Interview Modal ─────────────────────────────────────────────── */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Let's figure out what problems you solve</DialogTitle>
            <DialogDescription>
              Answer 3 quick questions — I'll write it for you.
            </DialogDescription>
          </DialogHeader>

          {/* Question steps */}
          {(modalStep === "q1" || modalStep === "q2" || modalStep === "q3") && (
            <div className="space-y-5 pt-1">
              {/* Progress indicator */}
              <div className="flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      i <= currentQuestionIndex ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
                <span className="text-xs text-muted-foreground whitespace-nowrap ml-1">
                  Question {currentQuestionIndex + 1} of 3
                </span>
              </div>

              {/* Question text */}
              <p className="text-sm font-medium text-foreground leading-relaxed">
                {INTERVIEW_QUESTIONS[currentQuestionIndex]}
              </p>

              {/* Answer textarea */}
              <Textarea
                value={answers[currentQuestionIndex]}
                onChange={(e) => {
                  const updated = [...answers];
                  updated[currentQuestionIndex] = e.target.value;
                  setAnswers(updated);
                }}
                placeholder="Type your answer here..."
                rows={4}
                autoFocus
              />

              {/* Navigation buttons */}
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={currentQuestionIndex === 0 ? closeModal : handleBack}
                  className="gap-1.5"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {currentQuestionIndex === 0 ? "Cancel" : "Back"}
                </Button>
                <Button
                  type="button"
                  onClick={handleNextQuestion}
                  className="gap-1.5"
                >
                  {modalStep === "q3" ? (
                    <>Write it for me <ArrowRight className="h-4 w-4" /></>
                  ) : (
                    <>Next <ArrowRight className="h-4 w-4" /></>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Loading state */}
          {modalStep === "loading" && (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm">Writing your answer...</p>
            </div>
          )}

          {/* Result state */}
          {modalStep === "result" && (
            <div className="space-y-5 pt-1">
              <div className="rounded-lg border bg-muted/40 p-4">
                <p className="text-sm text-foreground leading-relaxed">{generatedParagraph}</p>
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTryAgain}
                >
                  Try again
                </Button>
                <Button
                  type="button"
                  onClick={handleUseThis}
                  className="gap-1.5"
                >
                  Use this ✓
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
