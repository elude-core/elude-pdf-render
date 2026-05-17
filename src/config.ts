import { z } from "zod";

/**
 * Env config validée au boot. Si manquant → process.exit(1) avec message
 * clair plutôt que crash silencieux à la 1ère requête.
 */
const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PDF_SECRET: z
    .string()
    .min(32, "PDF_SECRET doit faire au moins 32 caractères"),
  /** Domaines autorisés pour le rendering (séparés par virgule). Évite SSRF :
   * un attaquant ne peut pas demander de rendre n'importe quelle URL. */
  ALLOWED_URL_HOSTS: z
    .string()
    .default(
      "dev.pro-cisailles.com,pro-storefront.vercel.app,cisailles.stackindepend.fr,massicots.stackindepend.fr,rogneuses.stackindepend.fr,agrafeuses.stackindepend.fr,destructeurs.stackindepend.fr,plastifieuses.stackindepend.fr,machines-a-relier.stackindepend.fr,localhost:3000",
    ),
  /** Timeout max de la navigation Playwright. */
  RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  NODE_ENV: z.string().default("production"),
});

function parseEnv() {
  const result = Env.safeParse(process.env);
  if (!result.success) {
    console.error("[config] Env invalide :");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = parseEnv();

export const allowedHosts = new Set(
  config.ALLOWED_URL_HOSTS.split(",").map((s) => s.trim()).filter(Boolean),
);

/**
 * Valide qu'une URL est :
 *   - bien formée
 *   - HTTPS (sauf localhost en dev)
 *   - sur un host whitelisté
 *
 * Bloque les SSRF basiques (file://, http://internal-host, etc.).
 */
export function isUrlAllowed(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL invalide" };
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    return { ok: false, reason: `Protocole non supporté: ${url.protocol}` };
  }

  // Match exact ou avec port pour localhost
  const hostMatch = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  if (!allowedHosts.has(hostMatch) && !allowedHosts.has(url.hostname)) {
    return { ok: false, reason: `Host non whitelisté: ${hostMatch}` };
  }

  return { ok: true, url };
}
