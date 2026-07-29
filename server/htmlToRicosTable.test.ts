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

describe("htmlToRicos — table support", () => {
  const html = `<table>
    <tr><th>Metric</th><th>Indicators</th><th>Frequency</th></tr>
    <tr><td>Awareness</td><td>Search volume, traffic</td><td>Monthly</td></tr>
    <tr><td>Retention</td><td>Repeat rate, churn</td><td>Quarterly</td></tr>
  </table>`;

  it("builds a TABLE node with rows and cells (not flattened)", () => {
    const ricos = htmlToRicos(html) as any;
    const table = findNode(ricos, "TABLE");
    expect(table).toBeTruthy();
    expect(table.nodes).toHaveLength(3); // 3 TABLE_ROW
    expect(table.nodes.every((r: any) => r.type === "TABLE_ROW")).toBe(true);
    expect(table.nodes[0].nodes).toHaveLength(3); // 3 cells
    expect(table.nodes[0].nodes.every((c: any) => c.type === "TABLE_CELL")).toBe(true);
  });

  it("preserves cell text inside paragraph nodes", () => {
    const ricos = htmlToRicos(html) as any;
    const table = findNode(ricos, "TABLE");
    const firstCellText = table.nodes[1].nodes[0].nodes[0].nodes[0].textData.text;
    expect(firstCellText).toBe("Awareness");
  });

  it("sets table dimensions matching the column/row counts", () => {
    const ricos = htmlToRicos(html) as any;
    const table = findNode(ricos, "TABLE");
    expect(table.tableData.dimensions.colsWidthRatio).toHaveLength(3);
    expect(table.tableData.dimensions.rowsHeight).toHaveLength(3);
  });

  it("uses Wix's required `tableCellData` field (not `cellData`) with borderColors", () => {
    const ricos = htmlToRicos(html) as any;
    const table = findNode(ricos, "TABLE");
    const cell = table.nodes[0].nodes[0];
    expect(cell.tableCellData).toBeTruthy();
    expect(cell.cellData).toBeUndefined();
    expect(cell.tableCellData.borderColors).toBeDefined();
  });

  it("styles the first row as a header (blue background, bold white text)", () => {
    const ricos = htmlToRicos(html) as any;
    const table = findNode(ricos, "TABLE");
    const headerCell = table.nodes[0].nodes[0];
    expect(headerCell.tableCellData.cellStyle.backgroundColor).toBe("#116DFF");
    const decos = headerCell.nodes[0].nodes[0].textData.decorations.map((d: any) => d.type);
    expect(decos).toContain("BOLD");
    expect(decos).toContain("COLOR");
    // Body cells must NOT have the header background.
    const bodyCell = table.nodes[1].nodes[0];
    expect(bodyCell.tableCellData.cellStyle.backgroundColor).toBeUndefined();
  });

  it("falls back to text (no crash) when the table has no rows", () => {
    const ricos = htmlToRicos(`<table><caption>empty</caption></table>`) as any;
    expect(findNode(ricos, "TABLE")).toBeNull(); // no rows → no TABLE node
  });
});
