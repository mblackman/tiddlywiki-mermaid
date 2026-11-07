#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT_DIR = process.cwd();
const PKG_PATH = path.join(ROOT_DIR, "package.json");
const PLUGIN_INFO_PATH = path.join(ROOT_DIR, "plugins", "mblackman", "mermaid", "plugin.info");

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
const pluginInfo = JSON.parse(fs.readFileSync(PLUGIN_INFO_PATH, "utf8"));

// 1. Fetch latest version of mermaid from npm registry
const latestMermaid = execSync("npm view mermaid version", { encoding: "utf8" }).trim();

// 2. Parse current mermaid version from devDependencies
const rawDeclared = pkg.devDependencies?.mermaid || "";
const currentMermaid = rawDeclared.replace(/^[^0-9]*/, "");

console.log(`Current declared Mermaid: ${currentMermaid || "none"} (${rawDeclared})`);
console.log(`Latest available Mermaid on npm: ${latestMermaid}`);

const hasUpdate = latestMermaid !== currentMermaid;

// Calculate next patch version for plugin
const [major, minor, patch] = (pkg.version || "0.0.0").split(".").map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `has_update=${hasUpdate}\nlatest_mermaid=${latestMermaid}\ncurrent_mermaid=${currentMermaid}\nnew_version=${newVersion}\n`
  );
}

const isCheckOnly = process.argv.includes("--check");
const isApply = process.argv.includes("--apply");

if (isCheckOnly) {
  if (hasUpdate) {
    console.log(`🚀 Update available: ${currentMermaid} -> ${latestMermaid}. Target plugin version: ${newVersion}`);
  } else {
    console.log(`✅ Mermaid is already up to date (${latestMermaid}).`);
  }
  process.exit(0);
}

if (isApply) {
  const force = process.argv.includes("--force");
  if (!hasUpdate && !force) {
    console.log("No update needed. Use --force to apply anyway.");
    process.exit(0);
  }

  console.log(`Upgrading mermaid to ${latestMermaid} and bumping plugin version to ${newVersion}...`);

  // Update package.json
  pkg.version = newVersion;
  pkg.devDependencies.mermaid = `^${latestMermaid}`;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf8");

  // Update plugin.info
  pluginInfo.version = newVersion;
  fs.writeFileSync(PLUGIN_INFO_PATH, JSON.stringify(pluginInfo, null, 2) + "\n", "utf8");

  // Install new mermaid version and update package-lock.json
  console.log(`Running npm install --save-dev mermaid@${latestMermaid}...`);
  execSync(`npm install --save-dev mermaid@${latestMermaid}`, { stdio: "inherit", cwd: ROOT_DIR });

  console.log(`✅ Successfully updated files to plugin version ${newVersion} with Mermaid ${latestMermaid}.`);
}
