import { type Browser, chromium } from "playwright";

import { config } from "./config.js";

/**
 * Pool single-browser warm. On garde 1 instance Chromium en mémoire et on
 * crée un context isolé par requête (cookies/cache séparés). Évite le
 * cold start ~1s de chaque rendu.
 *
 * Browser recycling : on relance Chromium toutes les N requêtes (1000)
 * pour limiter les memory leaks Playwright sur process long-running.
 */
let browser: Browser | null = null;
let requestsServed = 0;
const BROWSER_RECYCLE_THRESHOLD = 1000;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected() && requestsServed < BROWSER_RECYCLE_THRESHOLD) {
    return browser;
  }
  if (browser) {
    console.log("[render] recycling browser après", requestsServed, "requêtes");
    await browser.close().catch(() => undefined);
    requestsServed = 0;
  }
  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
    ],
  });
  return browser;
}

export type RenderOptions = {
  format?: "A4" | "A3" | "Letter";
  landscape?: boolean;
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  printBackground?: boolean;
  /** CSS selector à attendre avant de capturer (ex: `[data-pdf-ready]`).
   *  Fallback : on attend `networkidle`. */
  waitFor?: string;
  /** Délai max avant capture (default 30s, capé par RENDER_TIMEOUT_MS). */
  timeoutMs?: number;
};

export async function renderPdf(url: string, opts: RenderOptions = {}): Promise<Buffer> {
  const b = await getBrowser();
  const ctx = await b.newContext({
    viewport: { width: 1200, height: 1600 },
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    // User-agent dédié, permet de tracker côté storefront que c'est le
    // bot PDF qui hit (skip GTM, etc.).
    userAgent: "elude-pdf-render/0.1.0 (Playwright/Chromium)",
  });
  const page = await ctx.newPage();

  try {
    const navTimeout = Math.min(opts.timeoutMs ?? 30000, config.RENDER_TIMEOUT_MS);
    await page.goto(url, { waitUntil: "networkidle", timeout: navTimeout });

    if (opts.waitFor) {
      await page.waitForSelector(opts.waitFor, { timeout: 10000 });
    }

    // Force le media type print pour activer les `@media print` CSS du
    // storefront (cacher header/footer/CTAs, optimiser pour A4).
    await page.emulateMedia({ media: "print" });

    const pdf = await page.pdf({
      format: opts.format ?? "A4",
      landscape: opts.landscape ?? false,
      printBackground: opts.printBackground ?? true,
      margin: {
        top: opts.margin?.top ?? "0mm",
        right: opts.margin?.right ?? "0mm",
        bottom: opts.margin?.bottom ?? "0mm",
        left: opts.margin?.left ?? "0mm",
      },
    });

    requestsServed += 1;
    return pdf;
  } finally {
    await page.close().catch(() => undefined);
    await ctx.close().catch(() => undefined);
  }
}

/** Hard kill du browser au shutdown SIGTERM (Coolify deploy / restart). */
export async function shutdown(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => undefined);
    browser = null;
  }
}
