/**
 * StageStepper — horizontal progress bar matching the mockup exactly
 * Shows all 6 stages with lime (complete), purple (active), gray (pending)
 *
 * currentStage: the highest stage the user has reached (controls which steps are unlocked)
 * activeStage:  optional override for which step shows as blue/active.
 *               If not provided, falls back to currentStage.
 *               Use this to highlight the correct step when the user is on a page
 *               that is ahead of their stored currentStage (e.g. Publish & Schedule = 6).
 */
import { useLocation } from "wouter";

const STAGES = [
  { id: 1, label: "Business profile",   path: "/onboarding" },
  { id: 2, label: "Blog architecture",  path: "/architecture" },
  { id: 3, label: "Keyword research",   path: "/keywords" },
  { id: 4, label: "Article generation", path: "/generate" },
  { id: 5, label: "Review & edit",      path: "/review" },
  { id: 6, label: "Publish & schedule", path: "/publish" },
];

interface Props {
  currentStage: number;
  activeStage?: number;
  onNavigate?: (path: string, stage: number) => void;
}

export default function StageStepper({ currentStage, activeStage, onNavigate }: Props) {
  const [, setLocation] = useLocation();
  // The step shown as blue = activeStage if provided, else currentStage
  const highlightedStage = activeStage ?? currentStage;

  function handleClick(stage: typeof STAGES[0]) {
    if (stage.id > currentStage) return; // locked
    if (onNavigate) onNavigate(stage.path, stage.id);
    else setLocation(stage.path);
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      padding: "10px 24px",
      background: "#ffffff",
      borderBottom: "1px solid #e5e7eb",
      overflowX: "auto",
      gap: 0,
      flexShrink: 0,
    }}>
      {STAGES.map((stage, idx) => {
        // A step is "complete" (lime) if it's before the highlighted step AND it's been reached
        const isComplete = stage.id < highlightedStage && stage.id <= currentStage;
        const isActive   = stage.id === highlightedStage;
        // Locked = beyond the furthest stage the user has reached
        const isLocked   = stage.id > currentStage;

        return (
          <div key={stage.id} style={{ display: "flex", alignItems: "center", flex: idx < STAGES.length - 1 ? "1" : "0" }}>
            {/* Step */}
            <button
              onClick={() => handleClick(stage)}
              disabled={isLocked}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: "none",
                border: "none",
                padding: "4px 6px",
                borderRadius: 6,
                cursor: isLocked ? "default" : "pointer",
                whiteSpace: "nowrap",
                transition: "background 160ms",
              }}
              onMouseEnter={e => {
                if (!isLocked) (e.currentTarget as HTMLButtonElement).style.background = "#f5f3ec";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "none";
              }}
            >
              {/* Circle */}
              <div style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 700,
                flexShrink: 0,
                background: isComplete ? "#D9F542" : isActive ? "#6e5afe" : "#f3f4f6",
                color: isComplete ? "#1a1a2e" : isActive ? "#ffffff" : "#9ca3af",
                border: isLocked ? "1.5px solid #e5e7eb" : "none",
              }}>
                {isComplete ? "✓" : stage.id}
              </div>
              {/* Label */}
              <span style={{
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "#6e5afe" : isLocked ? "#d1d5db" : "#4b5563",
              }}>
                {stage.label}
              </span>
            </button>

            {/* Connector line */}
            {idx < STAGES.length - 1 && (
              <div style={{
                flex: 1,
                height: 1,
                minWidth: 12,
                background: isComplete ? "#D9F542" : "#e5e7eb",
                margin: "0 2px",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
