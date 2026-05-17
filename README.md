# elude-pdf-render

Microservice de génération PDF via Playwright (Chromium headless).

Reçoit une URL, retourne le PDF buffer. Utilisé par le storefront
elude-core-storefront pour les fiches techniques produit.

## Endpoints

### `GET /health`

Liveness check pour Coolify / Uptime Kuma.

### `POST /render`

Auth : header `X-PDF-Secret: <PDF_SECRET>`

```json
{
  "url": "https://dev.pro-cisailles.com/p/<handle>/pdf-view",
  "filename": "BAH-P104-G-22-fiche.pdf",
  "options": {
    "format": "A4",
    "landscape": false,
    "printBackground": true,
    "margin": { "top": "0mm", "right": "0mm", "bottom": "0mm", "left": "0mm" },
    "waitFor": "[data-pdf-ready]",
    "timeoutMs": 30000
  }
}
```

Response : `Content-Type: application/pdf` binary buffer.

## Env vars

| Var | Default | Description |
|-----|---------|-------------|
| `PORT` | `3000` | Port HTTP |
| `PDF_SECRET` | — | **Required.** Shared secret pour auth, ≥32 chars |
| `ALLOWED_URL_HOSTS` | preset | CSV des hosts whitelisted (SSRF protection) |
| `RENDER_TIMEOUT_MS` | `30000` | Timeout max nav Playwright |
| `NODE_ENV` | `production` | — |

## Pourquoi ce microservice

- @react-pdf/renderer côté storefront Vercel : limites visuelles (pas de shadows,
  pas de webfonts custom faciles, pas de gradients) + cold start ~2-3s.
- Playwright permet de rendre n'importe quelle page HTML/CSS moderne en PDF —
  ce qui veut dire qu'on peut utiliser la **PDP elle-même** (page `/p/<handle>/pdf-view`
  côté storefront) comme template. WYSIWYG + 0 design à maintenir en double.

Pattern microservice cohérent avec `elude-sync`, `elude-core-payload`,
`pim.elude.fr` — déployé sur Coolify (`pdf.elude.fr`).

## Dev local

```bash
npm install
npx playwright install chromium
PDF_SECRET=<32-chars-min> npm run dev
```

## Deploy

Coolify → Application → Public Repository → Dockerfile build.
Shared vars du project `elude-core` (PDF_SECRET).
Domain `https://pdf.elude.fr`.
