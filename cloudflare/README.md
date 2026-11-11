# Cloudflare — Ienvia staging edge

This directory contains the initial Cloudflare Workers edge gateway for the Ienvia migration.

## Current scope

- Cloudflare Worker receives staging traffic.
- Requests are forwarded to the existing Vercel origin.
- Responses are explicitly marked with `x-ienvia-edge: cloudflare-staging`.
- Dynamic responses are not cached.
- `/__edge/health` checks the Worker itself without depending on the origin.
- The Worker does not receive or store application secrets.

## Important limitation

This is an edge staging gateway, **not a completed migration of the Express application**. The current backend uses Node filesystem persistence, local uploads, WebSockets, Baileys/WhatsApp runtime and other Node-specific integrations. Those responsibilities need separate migration work before Vercel can be retired.

The current Vercel origin may also enforce Deployment Protection/SSO. If so, configure a supported origin-access mechanism before expecting proxied application routes to work. Do not disable protection globally as a workaround.

## Deploy

```bash
npx wrangler deploy --config wrangler.jsonc
```

Do not add production secrets to `vars`. Use Wrangler secrets or Cloudflare secret bindings for sensitive values once the application runtime is ready.

## Node container prototype

An isolated, separate deployment configuration is also included:

- `wrangler.container.jsonc`
- `cloudflare/container-worker.js`
- `cloudflare/container-server.js`
- `cloudflare/Dockerfile`

This prototype runs the existing Express application in a Node 24 Linux container behind a Durable Object, with outbound internet access for Supabase, Evolution and AI providers. It sets `VERCEL=1` so the application uses its cloud-mode behavior and does not start a local Baileys motor inside the container.

It is intentionally separate from the already deployed edge gateway. It has **not** been built or deployed: Cloudflare's documented deployment flow builds the image with Docker, and Containers are billed under the Workers Paid plan plus metered resource usage. The app's scheduled campaign processing and ephemeral local state also need dedicated validation/migration before production use.
