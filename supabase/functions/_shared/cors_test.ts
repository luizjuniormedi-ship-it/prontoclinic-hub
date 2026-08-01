import { assertEquals } from "jsr:@std/assert@1";
import { allowedRedirectUrl, corsHeaders } from "./cors.ts";

Deno.test("CORS autoriza somente origem presente na allowlist", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://prontomedic.example");
  const allowed = corsHeaders(new Request("https://edge.local", {
    headers: { Origin: "https://prontomedic.example" },
  }));
  assertEquals(new Headers(allowed ?? {}).get("Access-Control-Allow-Origin"), "https://prontomedic.example");
});

Deno.test("CORS rejeita origem não cadastrada", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://prontomedic.example");
  const denied = corsHeaders(new Request("https://edge.local", {
    headers: { Origin: "https://attacker.example" },
  }));
  assertEquals(denied, null);
});

Deno.test("CORS permite chamada servidor a servidor sem Origin", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://prontomedic.example");
  const serverCall = corsHeaders(new Request("https://edge.local"));
  assertEquals(new Headers(serverCall ?? {}).get("Vary"), "Origin");
});

Deno.test("CORS permite os cabeçalhos reais do cliente Supabase", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://prontomedic.example");
  const headers = new Headers(corsHeaders(new Request("https://edge.local", {
    headers: { Origin: "https://prontomedic.example" },
  })) ?? {});
  const allowedHeaders = headers.get("Access-Control-Allow-Headers") ?? "";
  assertEquals(allowedHeaders.includes("x-application-name"), true);
  assertEquals(allowedHeaders.includes("x-supabase-api-version"), true);
});

Deno.test("redirect administrativo aceita somente origem e caminho autorizados", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://prontomedic.example");
  const paths = new Set(["/reset-password"]);
  assertEquals(
    allowedRedirectUrl("https://prontomedic.example/reset-password?token=vazamento#fragmento", paths),
    "https://prontomedic.example/reset-password",
  );
  assertEquals(allowedRedirectUrl("https://attacker.example/reset-password", paths), null);
  assertEquals(allowedRedirectUrl("https://prontomedic.example/admin/users", paths), null);
});
