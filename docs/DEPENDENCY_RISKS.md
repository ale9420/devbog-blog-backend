# Dependency risks

Dependabot alerts that stay open because the fix needs a major version that a parent package pins. Each entry says why the risk is accepted and what would close it. Review this list on every Strapi upgrade. Patches within the same major go in through `overrides` in `package.json` instead (see `SECURITY.md`).

Last reviewed: 2026-10-02, Strapi 5.56.0.

## Fixed through overrides

The parent pins an older patch of the same major, so `overrides` lifts it:

| Package               | Pinned by                                        | Override  | Alerts closed      |
| --------------------- | ------------------------------------------------ | --------- | ------------------ |
| `nodemailer`          | `@strapi/provider-email-nodemailer` (9.0.1)      | `^9.1.1`  | 4 of 7 (see below) |
| `postcss`             | `styled-components` (8.4.31, 8.4.49)             | `^8.5.28` | 4                  |
| `markdown-it`         | `@strapi/content-manager` (14.3.0)               | `^14.3.2` | 1                  |
| `dompurify`           | `@strapi/content-manager` (3.4.13)               | `^3.4.16` | 1                  |
| `@opentelemetry/core` | `@opentelemetry/sdk-metrics` (2.7.1, via Fedify) | `^2.8.0`  | 1                  |
| `axios`               | `@strapi/*` (1.19.0)                             | `^1.20.0` | npm audit          |

Drop an override once the parent ships the patched version, so it doesn't hold back later updates.

`nodemailer` 9.1.1 is a net gain, not a clean fix: it closes 4 of the 7 advisories on 9.0.1, but 2 newer ones only affect `>=9.1.0` (GHSA-g57g-f23g-4646, GHSA-prgh-xp8r-p3m5). That leaves 5 advisories instead of 7, with 2 high in both versions.

## Accepted

| Package                  | Installed  | Fix                     | Pinned by                                            | Why it's accepted                                                                                                                                                                                                                                                                                                |
| ------------------------ | ---------- | ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodemailer` (5 alerts)  | 9.1.1      | 10.0.9 (major)          | `@strapi/provider-email-nodemailer`                  | Address parser DoS, malformed envelopes from crafted addresses, and a DNS cache issue across transports. The only addresses we send to are account emails, which users-permissions validates as emails before sending. There is also a single SMTP host. Closes when Strapi moves the provider to nodemailer 10. |
| `vite`                   | 5.4.21     | 6.4.3 (major)           | `@strapi/strapi`                                     | Dev server issues (`server.fs.deny` bypass on Windows, path traversal in optimized deps, `launch-editor`). Vite only runs in `strapi develop` and at image build time. Production serves the prebuilt admin.                                                                                                     |
| `webpack-dev-middleware` | 6.1.3      | 7.4.6 (major)           | `@strapi/strapi`                                     | Path traversal in the dev middleware, only used by `strapi develop` with the webpack bundler, which this project doesn't use.                                                                                                                                                                                    |
| `esbuild`                | 0.20, 0.21 | 0.25 (breaking pre-1.0) | `@strapi/pack-up`, `vite` 5                          | Affects only `esbuild --serve`, which is never used. Our own build runs esbuild 0.28.                                                                                                                                                                                                                            |
| `react-router`           | 6.30.6     | 7.18.0 (major)          | `react-router-dom` 6, required by the Strapi 5 admin | Open redirect via `\` in `<Link>`/`useNavigate`, and `deserializeErrors` in data-router SSR hydration. Only the authenticated admin panel uses it, client-side, with its own routes. The Strapi 5 admin doesn't support React Router 7.                                                                          |
| `stream-json`            | 1.9.1      | 3.5.0 (major)           | `@strapi/data-transfer`                              | DoS on deeply nested JSON in `strapi import`/`transfer`, which only runs from the CLI on files we produce.                                                                                                                                                                                                       |
| `braces`                 | 3.0.3      | none                    | `chokidar`, `micromatch` (Strapi dev tooling)        | Stack exhaustion with crafted brace patterns. The patterns are file globs in our own config, never user input.                                                                                                                                                                                                   |
| `showdown` (3 alerts)    | 2.1.0      | none (unmaintained)     | `@notum-cz/strapi-plugin-seo`                        | XSS and ReDoS. The SEO plugin converts markdown to HTML only to count words for keyword density; the HTML is never rendered, so the XSS can't run. The ReDoS needs an editor's own content and freezes only their browser tab. Closes if the plugin drops showdown or we replace the plugin.                     |

To dismiss these alerts on GitHub, use the reason `tolerable_risk` for `nodemailer`, `react-router` and `stream-json`, and `vulnerable_code_not_actually_used` for the rest.
