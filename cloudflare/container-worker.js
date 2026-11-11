import { DurableObject } from "cloudflare:workers";

const PORT = 3000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const STARTUP_ATTEMPTS = 60;
const STARTUP_DELAY_MS = 1000;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export class IenviaApiContainer extends DurableObject {
  async fetch(request) {
    const container = this.ctx.container;
    if (!container) return json({ ok: false, error: "container_binding_missing" }, 503);

    if (!container.running) {
      container.start({
        enableInternet: true,
        env: this.runtimeEnvironment()
      });
    }

    await container.setInactivityTimeout(IDLE_TIMEOUT_MS);
    const port = container.getTcpPort(PORT);
    let ready = false;

    for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt++) {
      try {
        const health = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1500)
        });
        await health.body?.cancel();
        if (health.ok) {
          ready = true;
          break;
        }
      } catch {
        // The container may still be booting. Retry only the readiness probe.
      }
      await scheduler.wait(STARTUP_DELAY_MS);
    }

    if (!ready) return json({ ok: false, error: "container_startup_timeout" }, 503);

    const target = new URL(request.url);
    target.protocol = "http:";
    target.hostname = "container";
    target.port = "";
    const forwarded = new Request(target, request);
    forwarded.headers.delete("host");
    forwarded.headers.set("x-ienvia-runtime", "cloudflare-container");
    return port.fetch(forwarded);
  }

  runtimeEnvironment() {
    const names = [
      "SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "EVOLUTION_API_URL",
      "EVOLUTION_API_KEY",
      "EVOLUTION_WEBHOOK_SECRET",
      "EVOLUTION_WEBHOOK_BASE_URL",
      "EVOLUTION_DEFAULT_USER_ID",
      "OPENROUTER_API_KEY",
      "GEMINI_API_KEY",
      "GEMINI_API_KEYS",
      "IENVIA_CAMPANHAS_EXPERIMENTAL"
    ];
    const values = {
      NODE_ENV: "production",
      VERCEL: "1",
      PORT: String(PORT)
    };
    for (const name of names) {
      const value = this.env[name];
      if (typeof value === "string" && value.length) values[name] = value;
    }
    return values;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__edge/health") {
      return json({
        ok: true,
        service: "ienvia-cloudflare-container-gateway",
        mode: "container-staging",
        origin: "cloudflare-container"
      });
    }
    return env.IENVIA_API.getByName("ienvia-api").fetch(request);
  }
};
