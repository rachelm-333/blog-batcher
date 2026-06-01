import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

interface Service {
  name: string;
  pageUrl: string;
}

interface Props {
  businessId: number;
  initial: Service[];
  onNext: () => void;
  onBack: () => void;
}

export default function Step2Services({ businessId, initial, onNext, onBack }: Props) {
  const [services, setServices] = useState<Service[]>(
    initial.length ? initial : [{ name: "", pageUrl: "" }]
  );

  const saveServices = trpc.business.saveServices.useMutation();

  const add = () => setServices((prev) => [...prev, { name: "", pageUrl: "" }]);
  const remove = (i: number) => setServices((prev) => prev.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof Service, value: string) =>
    setServices((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));

  const handleSave = async () => {
    const valid = services.filter((s) => s.name.trim());
    try {
      await saveServices.mutateAsync({
        businessId,
        services: valid.map((s, i) => ({
          name: s.name,
          pageUrl: s.pageUrl || undefined,
          sortOrder: i,
        })),
      });
      toast.success("Services saved.");
      onNext();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save.");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Services & Products</h2>
        <p className="text-muted-foreground">
          List your services or products. Adding the page URL helps Blog Batcher link directly to
          each service in your articles — improving conversions and internal linking.
        </p>
      </div>

      <div className="space-y-3">
        {services.map((service, i) => (
          <div key={i} className="flex gap-3 items-start border rounded-lg p-4 bg-muted/30">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Service / Product Name</Label>
                <Input
                  placeholder="e.g. Sports Physiotherapy"
                  value={service.name}
                  onChange={(e) => update(i, "name", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Page URL (optional)</Label>
                <Input
                  placeholder="https://yourbusiness.com/services/sports-physio"
                  value={service.pageUrl}
                  onChange={(e) => update(i, "pageUrl", e.target.value)}
                />
              </div>
            </div>
            {services.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(i)}
                className="mt-6 h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}

        <Button variant="outline" onClick={add} className="w-full" type="button">
          <Plus className="h-4 w-4 mr-2" /> Add Service
        </Button>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleSave} disabled={saveServices.isPending}>
          {saveServices.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
