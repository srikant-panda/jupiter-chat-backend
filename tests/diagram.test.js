import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanD2Code,
  applyDirection,
  parseD2Error,
  sanitizeSvg,
  renderD2Diagram,
  validateD2Code,
} from "../services/d2.service.js";

test("D2 Service: cleanD2Code removes markdown fences and extra whitespace", () => {
  const fenced = "```d2\na -> b: test\n```";
  assert.equal(cleanD2Code(fenced), "a -> b: test");

  const fencedD2Lang = "```d2lang\nx -> y\n```";
  assert.equal(cleanD2Code(fencedD2Lang), "x -> y");

  const plain = "  foo -> bar  ";
  assert.equal(cleanD2Code(plain), "foo -> bar");
});

test("D2 Service: applyDirection modifies or sets top-level direction", () => {
  const codeWithoutDir = "a -> b";
  assert.equal(applyDirection(codeWithoutDir, "right"), "direction: right\na -> b");

  const codeWithDir = "direction: down\na -> b";
  assert.equal(applyDirection(codeWithDir, "right"), "direction: right\na -> b");
});

test("D2 Service: parseD2Error extracts friendly message and line numbers", () => {
  const jsonErr = new Error(
    JSON.stringify([
      { range: "index,0:5:5-0:10:10", errmsg: "index:3:5: connection missing destination" },
    ])
  );
  const parsed = parseD2Error(jsonErr);
  assert.equal(parsed.friendlyMessage, "Line 3:5: connection missing destination");
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].line, 3);
  assert.equal(parsed.errors[0].column, 5);
});

test("D2 Service: sanitizeSvg removes scripts, event handlers, and javascript urls", () => {
  const maliciousSvg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg">
  <script>alert("hack")</script>
  <a href="javascript:alert(1)"><text onload="evil()">Hello</text></a>
</svg>`;

  const sanitized = sanitizeSvg(maliciousSvg);
  assert.ok(!sanitized.includes("<?xml"));
  assert.ok(!sanitized.includes("<script"));
  assert.ok(!sanitized.includes("javascript:"));
  assert.ok(!sanitized.includes("onload="));
  assert.ok(sanitized.includes("<svg"));
  assert.ok(sanitized.includes("Hello"));
});

test("D2 Service: renders D2 diagram to sanitized SVG with Dagre, ELK, and TALA", async () => {
  const code = `
    direction: right
    ***.style.border-radius: 8
    client: Client { shape: person }
    api: API Gateway { shape: rectangle }
    db: Database { shape: cylinder }

    client -> api: Request
    api -> db: Query
  `;

  for (const layout of ["dagre", "elk", "tala"]) {
    const res = await renderD2Diagram({ code, layout, theme: "dark" });
    assert.ok(res.svg.startsWith("<svg"));
    assert.ok(res.svg.endsWith("</svg>"));
    assert.equal(res.layout, layout);
    assert.ok(!res.svg.includes("<script"));
  }
});

test("D2 Service: renders D2 diagram with light and dark themes", async () => {
  const code = "x -> y: ok";
  const darkRes = await renderD2Diagram({ code, theme: "dark" });
  assert.equal(darkRes.themeID, 100);

  const lightRes = await renderD2Diagram({ code, theme: "light" });
  assert.equal(lightRes.themeID, 0);
});

test("D2 Service: returns cached diagram SVG on repeated request", async () => {
  const code = "cache_test_node_a -> cache_test_node_b";
  const res1 = await renderD2Diagram({ code });
  assert.equal(res1.cached, false);

  const res2 = await renderD2Diagram({ code });
  assert.equal(res2.cached, true);
  assert.equal(res1.svg, res2.svg);
});

test("D2 Service: validation returns false with friendly error on invalid syntax", async () => {
  const invalidCode = "broken -> [[[ syntax";
  const val = await validateD2Code(invalidCode);
  assert.equal(val.valid, false);
  assert.ok(val.error.length > 0);
});

test("D2 Service: validation returns true on valid syntax", async () => {
  const validCode = "good -> valid: working";
  const val = await validateD2Code(validCode);
  assert.equal(val.valid, true);
});
