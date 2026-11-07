#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, "dist");
const MERMAID_BUNDLE = path.join(ROOT_DIR, "plugins", "mblackman", "mermaid", "files", "mermaid.min.js");

if (!fs.existsSync(MERMAID_BUNDLE)) {
  console.log("Mermaid bundle missing, running npm run build:mermaid first...");
  execSync("npm run build:mermaid", { stdio: "inherit", cwd: ROOT_DIR });
}

fs.mkdirSync(DIST_DIR, { recursive: true });

console.log("Building plugin artifacts into dist/...");
execSync(
  "npx cross-env TIDDLYWIKI_PLUGIN_PATH=plugins tiddlywiki demo --output dist --build plugin",
  { stdio: "inherit", cwd: ROOT_DIR }
);

// Format mermaid-plugin.json as drag-and-drop array
const rawJsonPath = path.join(DIST_DIR, "mermaid-plugin.json");
if (fs.existsSync(rawJsonPath)) {
  const pluginObj = JSON.parse(fs.readFileSync(rawJsonPath, "utf8"));
  const dragDropBundle = Array.isArray(pluginObj) ? pluginObj : [pluginObj];
  fs.writeFileSync(
    rawJsonPath,
    JSON.stringify(dragDropBundle, null, 2),
    "utf8"
  );
  console.log("Formatted dist/mermaid-plugin.json as drag-and-drop JSON bundle.");
}

console.log("✅ Successfully built dist/mermaid.tid and dist/mermaid-plugin.json");
