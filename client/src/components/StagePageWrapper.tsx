/**
 * StagePageWrapper — wraps each workflow stage page
 * Provides: stage stepper, "STAGE N · LABEL" eyebrow, serif italic heading, subtitle, CTA
 */
import StageStepper from "./StageStepper";

interface Props {
  currentStage: number;
  stageNum: number;
  stageLabel: string;
  heading: React.ReactNode;
  subtitle?: string;
  ctaLabel?: string;
  ctaDisabled?: boolean;
  ctaLoading?: boolean;
  onCta?: () => void;
  ctaSecondary?: React.ReactNode;
  children: React.ReactNode;
}

export default function StagePageWrapper({
  currentStage,
  stageNum,
  stageLabel,
  heading,
  subtitle,
  ctaLabel,
  ctaDisabled,
  ctaLoading,
  onCta,
  ctaSecondary,
  children,
}: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Stage stepper */}
      <StageStepper currentStage={currentStage} />

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", background: "#faf9f5" }}>
        {/* Eyebrow + heading row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 6 }}>
              Stage {stageNum} · {stageLabel}
            </div>
            <h1 style={{ fontSize: 32, fontWeight: 800, color: "#1a1a2e", lineHeight: 1.15, margin: 0 }}>
              {heading}
            </h1>
            {subtitle && (
              <p style={{ fontSize: 14, color: "#6b7280", marginTop: 8 }}>{subtitle}</p>
            )}
          </div>
          {/* CTA button */}
          {ctaLabel && onCta && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 4 }}>
              {ctaSecondary}
              <button
                className="btn-primary"
                onClick={onCta}
                disabled={ctaDisabled || ctaLoading}
                style={{ opacity: ctaDisabled ? 0.5 : 1, cursor: ctaDisabled ? "not-allowed" : "pointer" }}
              >
                {ctaLoading ? "Working…" : ctaLabel}
              </button>
            </div>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}
