import { describe, expect, it } from "vitest";
import { normalizeCallCenterText } from "@/pages/CallCenterPage";

describe("CallCenterPage — mensagens operacionais", () => {
  it("corrige o mojibake legado antes de exibir o erro ao usuário", () => {
    expect(normalizeCallCenterText("role 'recepcao' sem acesso ao mÃ³dulo 'call_center'"))
      .toBe("role 'recepcao' sem acesso ao módulo 'call_center'");
  });
});
