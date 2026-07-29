import { assertEquals } from "jsr:@std/assert@1";
import { corsHeaders } from "./cors.ts";

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
