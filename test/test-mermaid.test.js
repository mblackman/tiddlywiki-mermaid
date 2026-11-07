import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUNDLE_PATH = path.join(ROOT, "plugins", "mblackman", "mermaid", "files", "mermaid.min.js");

describe("Mermaid v11 Single-File Bundle", () => {
  test("bundle exists and has valid size (>2.5MB)", () => {
    assert.ok(fs.existsSync(BUNDLE_PATH), "mermaid.min.js must exist");
    const stat = fs.statSync(BUNDLE_PATH);
    const mb = stat.size / (1024 * 1024);
    assert.ok(mb > 2.5, `bundle size (${mb.toFixed(2)} MB) should be > 2.5MB`);
  });

  test("bundle has zero dynamic import() chunk references", () => {
    const code = fs.readFileSync(BUNDLE_PATH, "utf8");
    assert.equal(/import\(/.test(code), false, "bundle must have zero import() statements");
  });

  test("bundle exports initialize, render, and parse in CommonJS", () => {
    const code = fs.readFileSync(BUNDLE_PATH, "utf8");
    const mod = { exports: {} };
    const fn = new Function("module", "exports", "require", code);
    fn(mod, mod.exports, () => {});
    const api = mod.exports.default || mod.exports;

    assert.equal(typeof api.render, "function", "api.render must be a function");
    assert.equal(typeof api.initialize, "function", "api.initialize must be a function");
    assert.equal(typeof api.parse, "function", "api.parse must be a function");
  });

  test("bundle includes modern v11 diagrams", () => {
    const code = fs.readFileSync(BUNDLE_PATH, "utf8");
    assert.ok(/mindmap/i.test(code), "bundle must include mindmap");
    assert.ok(/kanban/i.test(code), "bundle must include kanban");
    assert.ok(/architecture/i.test(code), "bundle must include architecture");
    assert.ok(/xychart/i.test(code), "bundle must include xychart");
    assert.ok(/gitgraph/i.test(code), "bundle must include gitGraph");
  });
});

describe("TiddlyWiki Mermaid Plugin Integration", () => {
  let $tw;
  let MermaidWidget;

  before(async () => {
    try {
      execSync("node scripts/clean-runtime.mjs", { cwd: ROOT });
    } catch (e) {}

    // Set plugin path so TiddlyWiki discovers plugins/mblackman/mermaid
    process.env.TIDDLYWIKI_PLUGIN_PATH = path.join(ROOT, "plugins");
    const { TiddlyWiki } = await import("tiddlywiki");
    $tw = TiddlyWiki();
    $tw.boot.argv = [path.join(ROOT, "demo")];
    $tw.boot.boot();
    // Disable disk synchronization so temporary test tiddlers are purely in-memory
    $tw.syncer = null;
    $tw.syncadaptor = null;
    if ($tw.wiki.eventListeners) {
      $tw.wiki.eventListeners["change"] = [];
    }
    MermaidWidget = $tw.modules.execute("$:/plugins/mblackman/mermaid/widget.js").mermaid;
  });

  after(() => {
    try {
      execSync("node scripts/clean-runtime.mjs", { cwd: ROOT });
    } catch (e) {
      // ignore
    }
  });

  test("plugin is loaded and registered in shadow tiddlers", () => {
    const pluginTiddler = $tw.wiki.getTiddler("$:/plugins/mblackman/mermaid");
    assert.ok(pluginTiddler, "Plugin $:/plugins/mblackman/mermaid must be loaded");
    assert.equal(pluginTiddler.fields.version, "0.1.0");

    const widgetTiddler = $tw.wiki.getTiddler("$:/plugins/mblackman/mermaid/widget.js");
    assert.ok(widgetTiddler, "Widget tiddler must be loaded");
  });

  test("direct <$mermaid> widget renders synchronously into SSR HTML", () => {
    const html = $tw.wiki.renderText(
      "text/html",
      "text/vnd.tiddlywiki",
      '<$mermaid text="flowchart LR; A-->B;"/>'
    );
    assert.ok(html.includes("tc-mermaid-container"), "Must output tc-mermaid-container");
  });

  test("<$mermaid> supports align and class attributes", () => {
    const html = $tw.wiki.renderText(
      "text/html",
      "text/vnd.tiddlywiki",
      '<$mermaid align="left" class="my-custom-diagram" text="graph TD; A-->B;"/>'
    );
    assert.ok(html.includes("tc-mermaid-align-left"), "Must output tc-mermaid-align-left");
    assert.ok(html.includes("my-custom-diagram"), "Must output custom class");
  });

  test("<$mermaid> supports inline child body text fallback", () => {
    const html = $tw.wiki.renderText(
      "text/html",
      "text/vnd.tiddlywiki",
      '<$mermaid>\ngraph TD\n  A-->B\n</$mermaid>'
    );
    assert.ok(html.includes("tc-mermaid-container"), "Must output tc-mermaid-container");
  });

  test("<$mermaid> inline child body text preserves arrows and entities", () => {
    const parser = $tw.wiki.parseText(
      "text/vnd.tiddlywiki",
      '<$mermaid>\nflowchart TD\n    Alpha[Alpha Node] --> Beta[Beta Node]\n    Beta --- Gamma[Gamma Node]\n    Gamma -.-> Delta["Cats & Dogs"]\n</$mermaid>'
    );
    const widgetNode = parser.tree[0].children[0];
    const widget = new MermaidWidget(widgetNode, { wiki: $tw.wiki, document: $tw.fakeDocument });
    widget.execute();

    assert.ok(widget.sourceText.includes("Alpha[Alpha Node] --> Beta[Beta Node]"), "Arrows must retain hyphens: " + widget.sourceText);
    assert.ok(widget.sourceText.includes("Beta --- Gamma[Gamma Node]"), "3-dash links must retain hyphens: " + widget.sourceText);
    assert.ok(widget.sourceText.includes('Cats & Dogs'), "HTML entities must be decoded properly: " + widget.sourceText);

    // Test block mode (paragraphs inside widget body)
    const blockParser = $tw.wiki.parseText(
      "text/vnd.tiddlywiki",
      '<$mermaid>\n\nflowchart TD\n  X --> Y\n\n</$mermaid>'
    );
    const blockWidget = new MermaidWidget(blockParser.tree[0], { wiki: $tw.wiki, document: $tw.fakeDocument });
    blockWidget.execute();
    assert.ok(blockWidget.sourceText.includes("X --> Y"), "Block-mode widget must extract child paragraphs: " + blockWidget.sourceText);
  });

  test("global $codeblock intercepts WikiText ```mermaid codeblocks", () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: "TestWikiTextCodeblock",
      type: "text/vnd.tiddlywiki",
      text: "```mermaid\nflowchart TD\n  X-->Y\n```"
    }));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: "$:/StoryList",
      list: ["TestWikiTextCodeblock"]
    }));

    const rootWidget = $tw.wiki.makeTranscludeWidget("$:/core/ui/PageTemplate", { document: $tw.fakeDocument });
    const container = $tw.fakeDocument.createElement("div");
    rootWidget.render(container, null);

    assert.ok(container.innerHTML.includes("tc-mermaid-container"), "PageTemplate river must render tc-mermaid-container");
  });

  test("global $codeblock intercepts Markdown ```mermaid codeblocks", () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: "TestMarkdownCodeblock",
      type: "text/x-markdown",
      text: "# Markdown Note\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```"
    }));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: "$:/StoryList",
      list: ["TestMarkdownCodeblock"]
    }));

    const rootWidget = $tw.wiki.makeTranscludeWidget("$:/core/ui/PageTemplate", { document: $tw.fakeDocument });
    const container = $tw.fakeDocument.createElement("div");
    rootWidget.render(container, null);

    assert.ok(container.innerHTML.includes("tc-mermaid-container"), "Markdown note in river must render tc-mermaid-container");
    assert.equal(container.innerHTML.includes("Alice-&gt;&gt;Bob"), false, "Raw mermaid code should not be dumped as plain text");
  });

  test("global $codeblock passes non-mermaid codeblocks through to native highlighter", () => {
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: "TestJsCodeblock",
      type: "text/vnd.tiddlywiki",
      text: "```javascript\nconst meaningOfLife = 42;\n```"
    }));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: "$:/StoryList",
      list: ["TestJsCodeblock"]
    }));

    const rootWidget = $tw.wiki.makeTranscludeWidget("$:/core/ui/PageTemplate", { document: $tw.fakeDocument });
    const container = $tw.fakeDocument.createElement("div");
    rootWidget.render(container, null);

    assert.ok(container.innerHTML.includes("meaningOfLife"), "Must preserve code content");
    assert.ok(container.innerHTML.includes("<code"), "Must output <code> element");
  });

  test("theme resolution automatically detects dark palettes", () => {
    // Test dark palette detection
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: "$:/palettes/CustomDark",
      "color-scheme": "dark"
    }));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: "$:/Palette",
      text: "$:/palettes/CustomDark"
    }));

    const widget = new MermaidWidget(
      { type: "element", tag: "$mermaid", attributes: {} },
      { wiki: $tw.wiki, document: $tw.fakeDocument }
    );
    widget.execute();
    assert.equal(widget.resolveTheme(), "dark", "Must resolve to 'dark' for dark palette");

    // Test light palette
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: "$:/palettes/CustomLight",
      "color-scheme": "light"
    }));
    $tw.wiki.addTiddler(new $tw.Tiddler({
      title: "$:/Palette",
      text: "$:/palettes/CustomLight"
    }));
    assert.equal(widget.resolveTheme(), "default", "Must resolve to 'default' for light palette");
  });

  test("syntax error diagnostics format clean alert box without orphans", () => {
    const widget = new MermaidWidget(
      { type: "element", tag: "$mermaid", attributes: { text: { type: "string", value: "invalid syntax !!!" } } },
      { wiki: $tw.wiki, document: $tw.fakeDocument }
    );
    widget.execute();
    const container = $tw.fakeDocument.createElement("div");
    widget.showError(container, "Test syntax error message");

    assert.ok(container.innerHTML.includes("tc-mermaid-error"), "Must output tc-mermaid-error");
    assert.ok(container.innerHTML.includes("Test syntax error message"), "Must output error message text");
  });
});
