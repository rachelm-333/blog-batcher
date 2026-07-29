import { describe, it, expect } from "vitest";
import { htmlToRicos } from "./cmsPublisher";

function findNode(ricos: any, type: string): any {
  const walk = (n: any): any => {
    if (!n) return null;
    if (n.type === type) return n;
    for (const c of n.nodes ?? []) { const r = walk(c); if (r) return r; }
    return null;
  };
  for (const n of ricos.nodes ?? []) { const r = walk(n); if (r) return r; }
  return null;
}

// Collect all text from a node subtree.
function allText(n: any): string {
  if (!n) return "";
  let t = n.textData?.text ?? "";
  for (const c of n.nodes ?? []) t += allText(c);
  return t;
}

describe("htmlToRicos — tables render as reliable bold-label lists (Wix drops TABLE nodes)", () => {
  const html = `<table>
    <tr><th>Metric</th><th>Indicators</th><th>Frequency</th></tr>
    <tr><td>Awareness</td><td>Search volume, traffic</td><td>Monthly</td></tr>
    <tr><td>Retention</td><td>Repeat rate, churn</td><td>Quarterly</td></tr>
  </table>`;

  it("produces a BULLETED_LIST, not a TABLE node", () => {
    const ricos = htmlToRicos(html) as any;
    expect(findNode(ricos, "TABLE")).toBeNull();
    const list = findNode(ricos, "BULLETED_LIST");
    expect(list).toBeTruthy();
    expect(list.nodes).toHaveLength(2); // 2 data rows (header row excluded)
  });

  it("uses the first cell as a bold label and appends header:value pairs", () => {
    const ricos = htmlToRicos(html) as any;
    const list = findNode(ricos, "BULLETED_LIST");
    const firstItemText = allText(list.nodes[0]);
    expect(firstItemText).toContain("Awareness");
    expect(firstItemText).toContain("Indicators: Search volume, traffic");
    expect(firstItemText).toContain("Frequency: Monthly");
    // The label must actually be bold.
    const para = list.nodes[0].nodes[0];
    const boldRun = (para.nodes as any[]).find((t) =>
      (t.textData?.decorations ?? []).some((d: any) => d.type === "BOLD"));
    expect(boldRun.textData.text).toBe("Awareness");
  });

  it("still works when the table is wrapped in <figure> (was flattened before)", () => {
    const wrapped = `<h2>Metrics</h2><figure class="table">${html}</figure><p>After.</p>`;
    const ricos = htmlToRicos(wrapped) as any;
    const list = findNode(ricos, "BULLETED_LIST");
    expect(list).toBeTruthy();
    expect(list.nodes).toHaveLength(2);
    // Surrounding content survives.
    expect(findNode(ricos, "HEADING")).toBeTruthy();
  });

  it("still works when the table sits inside a <div> wrapper", () => {
    const wrapped = `<div class="wrap"><p>Intro</p>${html}</div>`;
    const ricos = htmlToRicos(wrapped) as any;
    const list = findNode(ricos, "BULLETED_LIST");
    expect(list).toBeTruthy();
    expect(list.nodes).toHaveLength(2);
  });

  it("handles <thead>/<tbody> and keeps every data row", () => {
    const withSections = `<table><thead><tr><th>A</th><th>B</th></tr></thead>` +
      `<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>`;
    const ricos = htmlToRicos(withSections) as any;
    const list = findNode(ricos, "BULLETED_LIST");
    expect(list).toBeTruthy();
    expect(list.nodes).toHaveLength(2); // 2 body rows
  });

  it("a header-less table (all <td>) keeps every row as an item", () => {
    const noHeader = `<table><tr><td>Alpha</td><td>One</td></tr><tr><td>Beta</td><td>Two</td></tr></table>`;
    const ricos = htmlToRicos(noHeader) as any;
    const list = findNode(ricos, "BULLETED_LIST");
    expect(list.nodes).toHaveLength(2);
    expect(allText(list.nodes[0])).toContain("Alpha");
    expect(allText(list.nodes[0])).toContain("One");
  });

  it("drops an empty table with no data rows (no crash, no stray token)", () => {
    const ricos = htmlToRicos(`<p>Before</p><table><caption>empty</caption></table><p>After</p>`) as any;
    expect(findNode(ricos, "BULLETED_LIST")).toBeNull();
    // No leftover @@TABLE placeholder anywhere.
    const full = JSON.stringify(ricos);
    expect(full).not.toContain("@@TABLE");
  });
});
