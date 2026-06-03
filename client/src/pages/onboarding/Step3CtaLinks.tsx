import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2, Trash2, Plus, Link2 } from "lucide-react";

interface InternalLink {
  label: string;
  url: string;
}

interface Props {
  businessId: number;
  initial: {
    primaryCtaText?: string;
    primaryCtaUrl?: string;
    contactPageUrl?: string;
    bookingsPageUrl?: string;
    testimonialsPageUrl?: string;
    shopUrl?: string;
    otherInternalLinks?: InternalLink[];
  };
  onNext: () => void;
  onBack: () => void;
}

export default function Step3CtaLinks({ businessId, initial, onNext, onBack }: Props) {
  const [primaryCtaText, setPrimaryCtaText] = useState(initial.primaryCtaText ?? "");
  const [primaryCtaUrl, setPrimaryCtaUrl] = useState(initial.primaryCtaUrl ?? "");
  const [contactPageUrl, setContactPageUrl] = useState(initial.contactPageUrl ?? "");
  const [bookingsPageUrl, setBookingsPageUrl] = useState(initial.bookingsPageUrl ?? "");
  const [testimonialsPageUrl, setTestimonialsPageUrl] = useState(initial.testimonialsPageUrl ?? "");
  const [shopUrl, setShopUrl] = useState(initial.shopUrl ?? "");
  const [customLinks, setCustomLinks] = useState<InternalLink[]>(
    initial.otherInternalLinks ?? []
  );

  const updateBusiness = trpc.business.update.useMutation();

  const handleSave = async () => {
    const validCustomLinks = customLinks.filter(l => l.label.trim() && l.url.trim());
    const incompleteLinks = customLinks.filter(
      l => (l.label.trim() && !l.url.trim()) || (!l.label.trim() && l.url.trim())
    );
    if (incompleteLinks.length > 0) {
      toast.error("Each custom link needs both a name and a URL, or remove it.");
      return;
    }
    try {
      await updateBusiness.mutateAsync({
        businessId,
        primaryCtaText: primaryCtaText.trim() || undefined,
        primaryCtaUrl: primaryCtaUrl.trim() || undefined,
        contactPageUrl: contactPageUrl.trim() || undefined,
        bookingsPageUrl: bookingsPageUrl.trim() || undefined,
        testimonialsPageUrl: testimonialsPageUrl.trim() || undefined,
        shopUrl: shopUrl.trim() || undefined,
        otherInternalLinks: validCustomLinks.length > 0 ? validCustomLinks : undefined,
      });
      toast.success("CTA links saved.");
      onNext();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save.");
    }
  };

  const addCustomLink = () => {
    setCustomLinks(prev => [...prev, { label: "", url: "" }]);
  };

  const updateCustomLink = (index: number, field: "label" | "url", value: string) => {
    setCustomLinks(prev => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const removeCustomLink = (index: number) => {
    setCustomLinks(prev => prev.filter((_, i) => i !== index));
  };

  const optionalFields: {
    label: string;
    value: string;
    set: (v: string) => void;
    placeholder: string;
    hint: string;
  }[] = [
    {
      label: "Contact Page URL",
      value: contactPageUrl,
      set: setContactPageUrl,
      placeholder: "https://yourbusiness.com/contact",
      hint: "Leave blank to skip — AI will not reference a contact page.",
    },
    {
      label: "Bookings / Appointments URL",
      value: bookingsPageUrl,
      set: setBookingsPageUrl,
      placeholder: "https://yourbusiness.com/book",
      hint: "Leave blank to skip — AI will not mention bookings if this is empty.",
    },
    {
      label: "Testimonials / Reviews URL",
      value: testimonialsPageUrl,
      set: setTestimonialsPageUrl,
      placeholder: "https://yourbusiness.com/reviews",
      hint: "Leave blank to skip — AI will not reference testimonials.",
    },
    {
      label: "Shop URL",
      value: shopUrl,
      set: setShopUrl,
      placeholder: "https://yourbusiness.com/shop",
      hint: "Leave blank to skip — AI will not reference your shop.",
    },
  ];

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Internal CTA Links</h2>
        <p className="text-muted-foreground">
          These links are woven into your articles as natural internal links — directing readers to
          take action. Leave any field blank and the AI will not mention that page.
        </p>
      </div>

      <div className="space-y-5 max-w-xl">
        {/* Primary CTA */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            Primary Call-to-Action
          </span>
          <div className="space-y-1.5">
            <Label htmlFor="ctaText">Button Text</Label>
            <Input
              id="ctaText"
              value={primaryCtaText}
              onChange={e => setPrimaryCtaText(e.target.value)}
              placeholder="e.g. Book a free consultation"
            />
            <p className="text-xs text-muted-foreground">
              This is the main CTA woven into every article.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctaUrl">Button URL</Label>
            <Input
              id="ctaUrl"
              value={primaryCtaUrl}
              onChange={e => setPrimaryCtaUrl(e.target.value)}
              placeholder="https://yourbusiness.com/book"
            />
          </div>
        </div>

        {/* Optional page URLs */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Optional Pages
          </span>
          {optionalFields.map(f => (
            <div key={f.label} className="space-y-1.5">
              <Label>{f.label}</Label>
              <div className="flex gap-2">
                <Input
                  value={f.value}
                  onChange={e => f.set(e.target.value)}
                  placeholder={f.placeholder}
                  className="flex-1"
                />
                {f.value && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => f.set("")}
                    title="Clear this field"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{f.hint}</p>
            </div>
          ))}
        </div>

        {/* Custom internal links */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Custom Internal Links
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              Add any other pages you want the AI to reference in blog posts — e.g. "Resources",
              "Case Studies", "About Us".
            </p>
          </div>

          {customLinks.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              <Link2 className="h-4 w-4 shrink-0" />
              <span>No custom links added yet. Click below to add one.</span>
            </div>
          )}

          {customLinks.map((link, i) => (
            <div key={i} className="flex gap-2 items-end">
              <div className="flex-1 grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Link Name</Label>
                  <Input
                    value={link.label}
                    onChange={e => updateCustomLink(i, "label", e.target.value)}
                    placeholder="e.g. Resources"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">URL</Label>
                  <Input
                    value={link.url}
                    onChange={e => updateCustomLink(i, "url", e.target.value)}
                    placeholder="https://yourbusiness.com/resources"
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeCustomLink(i)}
                className="text-muted-foreground hover:text-destructive shrink-0 mb-0.5"
                title="Remove this link"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCustomLink}
            className="w-full border-dashed"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add internal link
          </Button>
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleSave} disabled={updateBusiness.isPending}>
          {updateBusiness.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
