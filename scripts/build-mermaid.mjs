import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve("plugins/mblackman/mermaid/files");
const OUT_FILE = path.join(OUT_DIR, "mermaid.min.js");

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log("Bundling Mermaid v11 into single-file CommonJS module...");
const startTime = Date.now();

await esbuild.build({
  stdin: {
    contents: `
import mermaid from "mermaid";
module.exports = mermaid.default || mermaid;
`,
    resolveDir: process.cwd(),
    sourcefile: "mermaid-entry.js",
  },
  bundle: true,
  minify: true,
  format: "cjs",
  platform: "browser",
  splitting: false,
  define: {
    global: "globalThis",
  },
  outfile: OUT_FILE,
});

const stats = fs.statSync(OUT_FILE);
const mb = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`✅ Bundled Mermaid successfully to ${OUT_FILE} (${mb} MB in ${Date.now() - startTime}ms)`);
