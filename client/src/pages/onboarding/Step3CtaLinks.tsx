import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2 } from "lucide-react";

interface Props {
  businessId: number;
  initial: {
    primaryCtaText?: string;
    primaryCtaUrl?: string;
    contactPageUrl?: string;
    bookingsPageUrl?: string;
    testimonialsPageUrl?: string;
    shopUrl?: string;
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

  const updateBusiness = trpc.business.update.useMutation();

  const handleSave = async () => {
    try {
      await updateBusiness.mutateAsync({
        businessId,
        primaryCtaText: primaryCtaText || undefined,
        primaryCtaUrl: primaryCtaUrl || undefined,
        contactPageUrl: contactPageUrl || undefined,
        bookingsPageUrl: bookingsPageUrl || undefined,
        testimonialsPageUrl: testimonialsPageUrl || undefined,
        shopUrl: shopUrl || undefined,
      });
      toast.success("CTA links saved.");
      onNext();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save.");
    }
  };

  const fields = [
    {
      label: "Primary CTA Text",
      value: primaryCtaText,
      set: setPrimaryCtaText,
      placeholder: "e.g. Book a free consultation",
      hint: "This appears as the main call-to-action button text in your articles.",
    },
    {
      label: "Primary CTA URL",
      value: primaryCtaUrl,
      set: setPrimaryCtaUrl,
      placeholder: "https://yourbusiness.com/book",
    },
    {
      label: "Contact Page URL",
      value: contactPageUrl,
      set: setContactPageUrl,
      placeholder: "https://yourbusiness.com/contact",
    },
    {
      label: "Bookings / Appointments URL",
      value: bookingsPageUrl,
      set: setBookingsPageUrl,
      placeholder: "https://yourbusiness.com/book",
    },
    {
      label: "Testimonials / Reviews URL",
      value: testimonialsPageUrl,
      set: setTestimonialsPageUrl,
      placeholder: "https://yourbusiness.com/reviews",
    },
    {
      label: "Shop URL",
      value: shopUrl,
      set: setShopUrl,
      placeholder: "https://yourbusiness.com/shop",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Internal CTA Links</h2>
        <p className="text-muted-foreground">
          These links are woven into your articles as natural internal links — directing readers to
          take action. The more accurate these are, the better your conversion rate.
        </p>
      </div>

      <div className="space-y-5 max-w-xl">
        {fields.map((f) => (
          <div key={f.label} className="space-y-1.5">
            <Label>{f.label}</Label>
            <Input
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              placeholder={f.placeholder}
            />
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
      </div>

      <div className="flex justify-between pt-4">
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
