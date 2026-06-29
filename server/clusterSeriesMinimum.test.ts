import { describe, it, expect } from "vitest";
import {
  RECOMMENDED_CLUSTERS_PER_PILLAR,
  MIN_SERIES_CLUSTERS_PER_PILLAR,
  getClusterSeriesWarning,
} from "../shared/architectureRules";

describe("Cluster-series minimum (SEO recommendation)", () => {
  it("recommends 4 clusters per pillar for a series", () => {
    expect(RECOMMENDED_CLUSTERS_PER_PILLAR).toBe(4);
    expect(MIN_SERIES_CLUSTERS_PER_PILLAR).toBe(4);
  });

  it("no warning for a deliberate standalone (0 clusters)", () => {
    expect(getClusterSeriesWarning(0)).toBeNull();
  });

  it("warns for a partial series (1–3 clusters)", () => {
    expect(getClusterSeriesWarning(1)).toContain("at least 4");
    expect(getClusterSeriesWarning(3)).toContain("at least 4");
  });

  it("no warning for a healthy series (4 or 5 clusters)", () => {
    expect(getClusterSeriesWarning(4)).toBeNull();
    expect(getClusterSeriesWarning(5)).toBeNull();
  });
});
