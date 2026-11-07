#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("demo", "tiddlers");
if (fs.existsSync(dir)) {
  for (const file of fs.readdirSync(dir)) {
    if (
      file.startsWith("$__UpgradeLibrary") ||
      file.startsWith("$__info_browser_window") ||
      file.startsWith("$__temp_") ||
      file.startsWith("$__state_") ||
      file.startsWith("$__StoryList") ||
      file.startsWith("$__HistoryList") ||
      file.startsWith("$__Palette") ||
      file.startsWith("$__palettes_") ||
      file.startsWith("Test")
    ) {
      try {
        fs.unlinkSync(path.join(dir, file));
      } catch (e) {
        // ignore
      }
    }
  }
}
