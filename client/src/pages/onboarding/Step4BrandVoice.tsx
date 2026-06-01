import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type Archetype = "professional_authority" | "friendly_neighbour" | "bold_direct" | "inspiring_thought_leader";
type Formality = "very_formal" | "formal" | "semi_formal" | "conversational" | "casual";

const ARCHETYPES: { value: Archetype; label: string; description: string }[] = [
  {
    value: "professional_authority",
    label: "Professional Authority",
    description: "Expert, credible, data-driven. Trusted by industry peers.",
  },
  {
    value: "friendly_neighbour",
    label: "Friendly Neighbour",
    description: "Warm, approachable, community-focused. Feels like a trusted local.",
  },
  {
    value: "bold_direct",
    label: "Bold & Direct",
    description: "Confident, no-fluff, straight to the point. Cuts through the noise.",
  },
  {
    value: "inspiring_thought_leader",
    label: "Inspiring Thought Leader",
    description: "Visionary, motivational, big-picture thinking. Moves people to act.",
  },
];

const FORMALITY_OPTIONS: { value: Formality; label: string }[] = [
  { value: "very_formal", label: "Very Formal" },
  { value: "formal", label: "Formal" },
  { value: "semi_formal", label: "Semi-formal" },
  { value: "conversational", label: "Conversational" },
  { value: "casual", label: "Casual" },
];

interface Props {
  businessId: number;
  initial: {
    primaryArchetype?: Archetype;
    secondaryArchetype?: Archetype;
    namedPersona?: string;
    formalityLevel?: Formality;
    keyPhrases?: string[];
    phrasesToAvoid?: string[];
    styleNotes?: string;
    finalVoiceBrief?: string;
  };
  onNext: () => void;
  onBack: () => void;
}

export default function Step4BrandVoice({ businessId, initial, onNext, onBack }: Props) {
  const [primary, setPrimary] = useState<Archetype | undefined>(initial.primaryArchetype);
  const [secondary, setSecondary] = useState<Archetype | undefined>(initial.secondaryArchetype);
  const [namedPersona, setNamedPersona] = useState(initial.namedPersona ?? "");
  const [formality, setFormality] = useState<Formality | undefined>(initial.formalityLevel);
  const [keyPhrases, setKeyPhrases] = useState<string[]>(initial.keyPhrases ?? []);
  const [phrasesToAvoid, setPhrasesToAvoid] = useState<string[]>(initial.phrasesToAvoid ?? []);
  const [styleNotes, setStyleNotes] = useState(initial.styleNotes ?? "");
  const [finalVoiceBrief, setFinalVoiceBrief] = useState(initial.finalVoiceBrief ?? "");
  const [phraseInput, setPhraseInput] = useState("");
  const [avoidInput, setAvoidInput] = useState("");

  const saveBrandVoice = trpc.business.saveBrandVoice.useMutation();

  const addPhrase = () => {
    if (phraseInput.trim()) {
      setKeyPhrases((p) => [...p, phraseInput.trim()]);
      setPhraseInput("");
    }
  };
  const addAvoid = () => {
    if (avoidInput.trim()) {
      setPhrasesToAvoid((p) => [...p, avoidInput.trim()]);
      setAvoidInput("");
    }
  };

  const handleSave = async () => {
    try {
      await saveBrandVoice.mutateAsync({
        businessId,
        voice: {
          primaryArchetype: primary,
          secondaryArchetype: secondary,
          namedPersona: namedPersona || undefined,
          formalityLevel: formality,
          keyPhrases,
          phrasesToAvoid,
          styleNotes: styleNotes || undefined,
          finalVoiceBrief: finalVoiceBrief || undefined,
        },
      });
      toast.success("Brand voice saved.");
      onNext();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save.");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Brand Voice</h2>
        <p className="text-muted-foreground">
          Your brand voice drives how every article sounds. The Final Voice Brief at the bottom is
          what gets sent to the AI for every article — it's the most important field in your profile.
        </p>
      </div>

      {/* Archetypes */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Primary Voice Archetype</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ARCHETYPES.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => setPrimary(a.value === primary ? undefined : a.value)}
              className={cn(
                "text-left border rounded-lg p-4 transition-all",
                primary === a.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-primary/50"
              )}
            >
              <div className="font-medium text-sm">{a.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{a.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-base font-medium">Secondary Archetype (optional blend)</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ARCHETYPES.filter((a) => a.value !== primary).map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => setSecondary(a.value === secondary ? undefined : a.value)}
              className={cn(
                "text-left border rounded-lg p-4 transition-all",
                secondary === a.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-primary/50"
              )}
            >
              <div className="font-medium text-sm">{a.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{a.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Named Persona */}
      <div className="space-y-2">
        <Label>Named Persona (optional)</Label>
        <Input
          value={namedPersona}
          onChange={(e) => setNamedPersona(e.target.value)}
          placeholder="e.g. Simon Sinek, Alex Hormozi, Brené Brown"
        />
        <p className="text-xs text-muted-foreground">
          The AI will incorporate this person's writing style into your voice brief.
        </p>
      </div>

      {/* Formality */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Formality Level</Label>
        <div className="flex flex-wrap gap-2">
          {FORMALITY_OPTIONS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFormality(f.value === formality ? undefined : f.value)}
              className={cn(
                "px-4 py-2 rounded-full border text-sm font-medium transition-all",
                formality === f.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-primary/50"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Key Phrases */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Key Phrases</Label>
        <p className="text-xs text-muted-foreground -mt-2">
          Words or phrases your brand uses. These are woven into your articles.
        </p>
        <div className="flex gap-2">
          <Input
            value={phraseInput}
            onChange={(e) => setPhraseInput(e.target.value)}
            placeholder="Add a phrase and press Enter"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPhrase())}
          />
          <Button variant="outline" onClick={addPhrase} type="button">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {keyPhrases.map((p, i) => (
            <Badge key={i} variant="secondary" className="gap-1">
              {p}
              <button onClick={() => setKeyPhrases((prev) => prev.filter((_, idx) => idx !== i))}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      </div>

      {/* Phrases to Avoid */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Phrases to Avoid</Label>
        <p className="text-xs text-muted-foreground -mt-2">
          Words or patterns that feel wrong for your brand.
        </p>
        <div className="flex gap-2">
          <Input
            value={avoidInput}
            onChange={(e) => setAvoidInput(e.target.value)}
            placeholder="Add a phrase and press Enter"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAvoid())}
          />
          <Button variant="outline" onClick={addAvoid} type="button">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {phrasesToAvoid.map((p, i) => (
            <Badge key={i} variant="destructive" className="gap-1">
              {p}
              <button onClick={() => setPhrasesToAvoid((prev) => prev.filter((_, idx) => idx !== i))}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      </div>

      {/* Style Notes */}
      <div className="space-y-2">
        <Label>Style Notes</Label>
        <Textarea
          value={styleNotes}
          onChange={(e) => setStyleNotes(e.target.value)}
          placeholder="e.g. Use short sentences. Avoid passive voice. Always use 'you' not 'one'."
          rows={3}
        />
      </div>

      {/* Final Voice Brief */}
      <div className="space-y-2 border-t pt-6">
        <Label className="text-base font-medium">
          Final Voice Brief{" "}
          <span className="text-xs font-normal text-muted-foreground ml-1">
            — most important field
          </span>
        </Label>
        <p className="text-sm text-muted-foreground">
          This is compiled from all the sources above and sent to the AI for every article. Edit it
          directly. You can ignore all presets and write your own brief here.
        </p>
        <Textarea
          value={finalVoiceBrief}
          onChange={(e) => setFinalVoiceBrief(e.target.value)}
          placeholder="Write a complete voice brief here, or it will be auto-compiled from your selections above…"
          rows={6}
          className="font-mono text-sm"
        />
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleSave} disabled={saveBrandVoice.isPending}>
          {saveBrandVoice.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
