// Finds a playwright-core and a Chromium without making this app depend on them.
// Override either with PLAYWRIGHT_CORE / PLAYWRIGHT_CHROME.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const first = (paths) => paths.find((p) => p && existsSync(p));

const coreDir = first([
  process.env.PLAYWRIGHT_CORE,
  join(process.cwd(), "node_modules/playwright-core"),
  "/private/tmp/jbm-local-center/node_modules/playwright-core",
  ...(() => { const d = join(homedir(), ".npm/_npx"); try { return readdirSync(d).map((k) => join(d, k, "node_modules/playwright-core")); } catch { return []; } })(),
]);
if (!coreDir) throw new Error("no playwright-core — set PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core");
const mod = await import(join(coreDir, "index.js"));
export const chromium = (mod.chromium ?? mod.default?.chromium);

const cacheDir = join(homedir(), "Library/Caches/ms-playwright");
export const executablePath = first([
  process.env.PLAYWRIGHT_CHROME,
  ...(() => { try { return readdirSync(cacheDir).filter((k) => k.startsWith("chromium-")).sort().reverse()
    .map((k) => join(cacheDir, k, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")); } catch { return []; } })(),
]);
if (!executablePath) throw new Error("no Chromium — set PLAYWRIGHT_CHROME=/path/to/chrome");
