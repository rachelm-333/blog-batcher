/**
 * client/src/components/HelpLink.tsx
 *
 * Layer 11 — Contextual help icon.
 *
 * Usage:
 *   <HelpLink slug="connect-wordpress" />
 *   <HelpLink slug="authority-standard" label="What is the Authority Standard?" />
 *
 * Clicking opens /support#slug in a new tab.
 */

import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface HelpLinkProps {
  /** The help article slug (e.g. "connect-wordpress") */
  slug: string;
  /** Optional tooltip label — defaults to "Learn more" */
  label?: string;
  /** Extra CSS classes for the icon */
  className?: string;
}

export function HelpLink({ slug, label = "Learn more", className = "" }: HelpLinkProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={`/support#${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className={`inline-flex items-center justify-center h-4 w-4 rounded-full text-muted-foreground hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
          onClick={(e) => {
            // Open in new tab but also navigate client-side if same tab
            e.stopPropagation();
          }}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </a>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
