import { describe, expect, it } from "vitest";
import { htmlSnapshotReview } from "./html-snapshot-review";

describe("HTML snapshot review", () => {
  it("scans the entire source while projecting only body text", () => {
    const html = `<html><head><style>.secret{display:none}</style></head><body>
      <h1 id="start">配置 &amp; 验证</h1><a href="#missing">跳转</a>
      <p id="start">第&#49;步</p><!-- hidden note -->
      <script>window.secret = "do not treat this as prose"</script>
    </body></html>`;
    const result = htmlSnapshotReview(html)!;
    expect(result.rawLength).toBe(html.length);
    expect(result.text).toContain("配置 & 验证");
    expect(result.text).toContain("第1步");
    expect(result.text).not.toContain("hidden note");
    expect(result.text).not.toContain("window.secret");
    expect(result.structuralIssues).toContain("重复 ID: start");
    expect(result.structuralIssues).toContain("失效页内锚点: #missing");
    expect(result.scripts).toHaveLength(1);
    expect(result.styles).toHaveLength(1);
  });

  it("does not certify an HTML fragment as a complete document", () => {
    expect(htmlSnapshotReview("<main>only a fragment</main>")).toBeUndefined();
  });
});
