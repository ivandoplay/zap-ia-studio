const ORIGIN = "https://zap-ia-studio.vercel.app";
const EDGE_HEADER = "x-ienvia-edge";

function responseJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
  });
}

export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);

    if (incoming.pathname === "/__edge/health") {
      return responseJson({
        ok: true,
        service: "ienvia-cloudflare-edge",
        mode: "staging-proxy",
        origin: new URL(ORIGIN).host,
        timestamp: new Date().toISOString()
      }, 200, { [EDGE_HEADER]: "cloudflare-staging" });
    }

    if (request.method === "TRACE" || request.method === "CONNECT") {
      return responseJson({ ok: false, error: "method_not_allowed" }, 405);
    }

    const target = new URL(incoming.pathname + incoming.search, ORIGIN);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set(EDGE_HEADER, "cloudflare-staging");
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", "https");

    try {
      const upstream = await fetch(new Request(target, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual"
      }));

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set(EDGE_HEADER, "cloudflare-staging");
      responseHeaders.set("cache-control", "no-store");

      const location = responseHeaders.get("location") || "";
      if (upstream.status >= 300 && upstream.status < 400 && /vercel\.com|vercel\.app/i.test(location)) {
        return responseJson({
          ok: false,
          error: "origin_access_restricted",
          message: "A origem Vercel exige uma autorização que ainda não foi configurada para este ambiente de homologação."
        }, 503, { [EDGE_HEADER]: "cloudflare-staging" });
      }

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
      });
    } catch {
      return responseJson({
        ok: false,
        error: "origin_unavailable",
        message: "Não foi possível alcançar a origem configurada."
      }, 502, { [EDGE_HEADER]: "cloudflare-staging" });
    }
  }
};