import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";

import { config, isUrlAllowed } from "./config.js";
import { renderPdf, shutdown } from "./render.js";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    service: "elude-pdf-render",
    version: "0.1.0",
    docs: "POST /render { url, options?, filename? } avec X-PDF-Secret",
  }),
);

app.get("/health", (c) =>
  c.json({ ok: true, ts: new Date().toISOString() }),
);

const RenderBody = z.object({
  url: z.string().min(1),
  filename: z.string().optional(),
  options: z
    .object({
      format: z.enum(["A4", "A3", "Letter"]).optional(),
      landscape: z.boolean().optional(),
      printBackground: z.boolean().optional(),
      margin: z
        .object({
          top: z.string().optional(),
          right: z.string().optional(),
          bottom: z.string().optional(),
          left: z.string().optional(),
        })
        .optional(),
      waitFor: z.string().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .optional(),
});

app.post("/render", async (c) => {
  // Auth shared secret
  const secret = c.req.header("x-pdf-secret");
  if (secret !== config.PDF_SECRET) {
    return c.json({ error: "unauthorized" }, 401);
  }

  // Body validation
  const raw = await c.req.json().catch(() => null);
  const parsed = RenderBody.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_body", issues: parsed.error.issues },
      400,
    );
  }
  const { url, options, filename } = parsed.data;

  // URL whitelist (SSRF protection)
  const check = isUrlAllowed(url);
  if (!check.ok) {
    return c.json({ error: "url_not_allowed", reason: check.reason }, 400);
  }

  const startedAt = Date.now();
  let buffer: Buffer;
  try {
    buffer = await renderPdf(url, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[render] failed:", message);
    return c.json({ error: "render_failed", message }, 502);
  }

  const elapsed = Date.now() - startedAt;
  console.log(`[render] ${url} → ${buffer.length} bytes in ${elapsed}ms`);

  const disposition = filename
    ? `attachment; filename="${filename}"`
    : "inline";

  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Content-Length": String(buffer.length),
      "X-Render-Time-Ms": String(elapsed),
    },
  });
});

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`[elude-pdf-render] listening on :${info.port}`);
});

// Graceful shutdown : Coolify envoie SIGTERM 30s avant kill au redeploy.
// On ferme proprement le browser pour libérer la mémoire avant exit.
const onShutdown = async () => {
  console.log("[elude-pdf-render] shutting down…");
  await shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", onShutdown);
process.on("SIGINT", onShutdown);
