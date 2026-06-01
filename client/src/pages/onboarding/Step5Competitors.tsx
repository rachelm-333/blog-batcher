import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2, Plus, X, Info } from "lucide-react";

interface Competitor {
  name: string;
  websiteUrl: string;
  description: string;
}

interface Props {
  businessId: number;
  initial: Competitor[];
  onNext: () => void;
  onBack: () => void;
}

export default function Step5Competitors({ businessId, initial, onNext, onBack }: Props) {
  const [competitors, setCompetitors] = useState<Competitor[]>(
    initial.length ? initial.slice(0, 3) : []
  );

  const saveCompetitors = trpc.business.saveCompetitors.useMutation();

  const add = () => {
    if (competitors.length < 3) {
      setCompetitors((prev) => [...prev, { name: "", websiteUrl: "", description: "" }]);
    }
  };
  const remove = (i: number) => setCompetitors((prev) => prev.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof Competitor, value: string) =>
    setCompetitors((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)));

  const handleSave = async () => {
    const valid = competitors.filter((c) => c.name.trim());
    try {
      await saveCompetitors.mutateAsync({
        businessId,
        competitors: valid.map((c, i) => ({
          name: c.name,
          websiteUrl: c.websiteUrl || undefined,
          description: c.description || undefined,
          sortOrder: i,
        })),
      });
      toast.success("Competitors saved.");
      onNext();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save.");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Competitor Research</h2>
        <p className="text-muted-foreground">
          Optional — add up to 3 competitors. This helps Blog Batcher find keyword opportunities
          your competitors rank for that you don't.
        </p>
        <div className="mt-3 flex gap-2 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Adding competitors helps us find keyword opportunities your competitors rank for that
            you don't — giving your articles a strategic advantage.
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {competitors.map((c, i) => (
          <div key={i} className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Competitor {i + 1}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(i)}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Business Name</Label>
                <Input
                  placeholder="Competitor name"
                  value={c.name}
                  onChange={(e) => update(i, "name", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Website URL</Label>
                <Input
                  placeholder="https://competitor.com"
                  value={c.websiteUrl}
                  onChange={(e) => update(i, "websiteUrl", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Description (optional)</Label>
              <Textarea
                placeholder="Brief notes about this competitor…"
                value={c.description}
                onChange={(e) => update(i, "description", e.target.value)}
                rows={2}
              />
            </div>
          </div>
        ))}

        {competitors.length < 3 && (
          <Button variant="outline" onClick={add} className="w-full" type="button">
            <Plus className="h-4 w-4 mr-2" /> Add Competitor
          </Button>
        )}

        {competitors.length === 0 && (
          <p className="text-sm text-center text-muted-foreground py-4">
            No competitors added. You can skip this step — it's optional.
          </p>
        )}
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleSave} disabled={saveCompetitors.isPending}>
          {saveCompetitors.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {competitors.length === 0 ? "Skip & Continue" : "Save & Continue"}
        </Button>
      </div>
    </div>
  );
}
