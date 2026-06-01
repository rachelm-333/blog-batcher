import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

interface Props {
  businessId: number;
  initial: {
    yearsInBusiness?: number | null;
    clientsServed?: number | null;
    awardsAccreditations?: string | null;
  };
  onNext: () => void;
  onBack: () => void;
}

export default function Step7SocialProof({ businessId, initial, onNext, onBack }: Props) {
  const [years, setYears] = useState(initial.yearsInBusiness?.toString() ?? "");
  const [clients, setClients] = useState(initial.clientsServed?.toString() ?? "");
  const [awards, setAwards] = useState(initial.awardsAccreditations ?? "");

  const updateBusiness = trpc.business.update.useMutation();

  const handleSave = async () => {
    try {
      await updateBusiness.mutateAsync({
        businessId,
        yearsInBusiness: years ? parseInt(years, 10) : undefined,
        clientsServed: clients ? parseInt(clients, 10) : undefined,
        awardsAccreditations: awards || undefined,
      });
      toast.success("Social proof saved.");
      onNext();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save.");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Social Proof & E-E-A-T Signals</h2>
        <p className="text-muted-foreground">
          Google's E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) framework
          rewards businesses that demonstrate real-world credibility. These signals are woven into
          every article.
        </p>
        <div className="mt-3 flex gap-2 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
          <span>
            Articles that include E-E-A-T signals consistently rank higher and are more likely to
            be cited by AI search engines like Perplexity and ChatGPT.
          </span>
        </div>
      </div>

      <div className="space-y-5 max-w-lg">
        <div className="space-y-2">
          <Label>Years in Business</Label>
          <Input
            type="number"
            min={0}
            value={years}
            onChange={(e) => setYears(e.target.value)}
            placeholder="e.g. 12"
          />
          <p className="text-xs text-muted-foreground">
            Used in phrases like "With over 12 years of experience…"
          </p>
        </div>

        <div className="space-y-2">
          <Label>Number of Clients Served</Label>
          <Input
            type="number"
            min={0}
            value={clients}
            onChange={(e) => setClients(e.target.value)}
            placeholder="e.g. 500"
          />
          <p className="text-xs text-muted-foreground">
            Used in phrases like "Trusted by over 500 businesses…"
          </p>
        </div>

        <div className="space-y-2">
          <Label>Awards, Certifications & Accreditations</Label>
          <Textarea
            value={awards}
            onChange={(e) => setAwards(e.target.value)}
            placeholder="e.g. AHPRA registered, Winner of the 2023 Brisbane Business Award, ISO 9001 certified"
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            List any awards, industry certifications, or professional accreditations.
          </p>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleSave} disabled={updateBusiness.isPending}>
          {updateBusiness.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {years || clients || awards ? "Save & Continue" : "Skip & Continue"}
        </Button>
      </div>
    </div>
  );
}
