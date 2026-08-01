export function corsHeaders(request: Request): HeadersInit | null {
  const allowedOrigins = new Set(
    (Deno.env.get("ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  const origin = request.headers.get("Origin");
  if (!origin) {
    return { Vary: "Origin" };
  }
  if (!allowedOrigins.has(origin)) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-application-name, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function allowedRedirectUrl(value: unknown, allowedPaths: ReadonlySet<string>): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const allowedOrigins = new Set(
      (Deno.env.get("ALLOWED_ORIGINS") ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
    if (!allowedOrigins.has(url.origin) || !allowedPaths.has(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function corsDenied(): Response {
  return new Response(JSON.stringify({ error: "Origem não autorizada" }), {
    status: 403,
    headers: { "Content-Type": "application/json", Vary: "Origin" },
  });
}
