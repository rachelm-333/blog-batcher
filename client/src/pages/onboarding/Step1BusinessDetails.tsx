import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

interface Audience {
  label: string;
  description: string;
}

interface Props {
  businessId: number;
  initial: {
    name?: string;
    industry?: string;
    location?: string;
    serviceArea?: string;
    physicalAddress?: string;
    isPhysicalLocation?: boolean;
    abnBusinessRegistration?: string;
    uniqueValueProposition?: string;
    keywordExclusions?: string;
    audiences?: Audience[];
  };
  onNext: () => void;
  onBack: () => void;
}

export default function Step1BusinessDetails({ businessId, initial, onNext, onBack }: Props) {
  const [name, setName] = useState(initial.name ?? "");
  const [industry, setIndustry] = useState(initial.industry ?? "");
  const [location, setLocation] = useState(initial.location ?? "");
  const [serviceArea, setServiceArea] = useState(initial.serviceArea ?? "");
  const [physicalAddress, setPhysicalAddress] = useState(initial.physicalAddress ?? "");
  const [isPhysical, setIsPhysical] = useState(initial.isPhysicalLocation ?? false);
  const [abn, setAbn] = useState(initial.abnBusinessRegistration ?? "");
  const [uvp, setUvp] = useState(initial.uniqueValueProposition ?? "");
  const [keywordExclusions, setKeywordExclusions] = useState(initial.keywordExclusions ?? "");
  const [audiences, setAudiences] = useState<Audience[]>(
    initial.audiences?.length ? initial.audiences : [{ label: "", description: "" }]
  );

  const updateBusiness = trpc.business.update.useMutation();
  const saveAudiences = trpc.business.saveAudiences.useMutation();

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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Business Details</h2>
        <p className="text-muted-foreground">
          Review and edit the details we extracted from your website.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label>Business Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Industry / Category</Label>
          <Input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. Physiotherapy, Legal Services"
          />
        </div>
        <div className="space-y-2">
          <Label>Location</Label>
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
            <Label className="text-base font-medium">Target Audiences</Label>
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
    </div>
  );
}
