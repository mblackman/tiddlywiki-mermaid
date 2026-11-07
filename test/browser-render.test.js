import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUNDLE_PATH = path.join(ROOT, "plugins", "mblackman", "mermaid", "files", "mermaid.min.js");

describe("Mermaid v11 Offline Diagram Rendering in DOM", () => {
  let api;
  let dom;

  test("initializes DOM and loads bundled Mermaid library", () => {
    dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"root\"></div></body></html>");
    global.window = dom.window;
    global.document = dom.window.document;
    global.Element = dom.window.Element;
    global.SVGElement = dom.window.SVGElement;
    global.CSSStyleSheet = dom.window.CSSStyleSheet;

    if (!dom.window.SVGElement.prototype.getBBox) {
      dom.window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 });
    }

    dom.window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
      get: (target, prop) => {
        if (prop === "measureText") {
          return (text) => ({ width: String(text).length * 8 });
        }
        return () => {};
      }
    });

    const code = fs.readFileSync(BUNDLE_PATH, "utf8");
    const mod = { exports: {} };
    const fn = new Function("module", "exports", "require", code);
    fn(mod, mod.exports, () => {});
    api = mod.exports.default || mod.exports;

    assert.equal(typeof api.render, "function");
    api.initialize({ startOnLoad: false, theme: "default" });
  });

  const testCases = [
    ["Flowchart", "flowchart TD;\n  Start([Begin]) --> End([Finish]);"],
    ["Sequence", "sequenceDiagram\n  autonumber\n  Alice->>Bob: Hello"],
    ["Mindmap", "mindmap\n  root((TiddlyWiki))\n    Plugins\n      Mermaid"],
    ["GitGraph", "gitGraph\n  commit\n  branch feat\n  commit"],
    ["StateDiagram", "stateDiagram-v2\n  [*] --> Active\n  Active --> [*]"],
    ["ERDiagram", "erDiagram\n  CUSTOMER ||--o{ ORDER : places"],
    ["Kanban", "kanban\n  Todo\n    [Task 1]\n  Done\n    [Task 2]"],
    ["XYChart", "xychart-beta\n  title \"Metrics\"\n  x-axis [\"A\", \"B\", \"C\"]\n  y-axis \"Score\" 0 --> 100\n  bar [20, 60, 90]"]
  ];

  for (const [name, source] of testCases) {
    test(`renders ${name} diagram to valid inline SVG`, async () => {
      const id = "test-svg-" + name.toLowerCase();
      const result = await api.render(id, source);
      assert.ok(result.svg, `Diagram ${name} must produce SVG`);
      assert.ok(result.svg.includes("<svg"), `Diagram ${name} output must contain <svg> element`);
    });
  }

  test("handles malformed diagram syntax gracefully via rejected promise", async () => {
    await assert.rejects(
      async () => {
        await api.render("test-err-id", "flowchart TD\n  invalid @@ %% syntax");
      },
      (err) => {
        assert.ok(err, "Must reject with an error");
        return true;
      }
    );
  });

  after(() => {
    if (dom && dom.window) {
      dom.window.close();
    }
  });
});
