import { beforeEach, describe, expect, it, vi } from "vitest";
import { encountersService } from "@/services/encountersService";
import { medicalAttendanceService } from "@/services/medicalAttendanceService";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/services/medicalAttendanceService", () => ({
  medicalAttendanceService: {
    open: vi.fn(),
    save: vi.fn(),
    finalize: vi.fn(),
  },
}));

describe("encountersService - contrato clínico canônico", () => {
  beforeEach(() => vi.clearAllMocks());

  it("abre atendimento pelo RPC M18 e exige appointment_id", async () => {
    vi.mocked(medicalAttendanceService.open).mockResolvedValue({ id: "enc-1" } as never);

    await expect(encountersService.create({ professional_id: 7 })).rejects.toThrow(/Agendamento obrigatório/);
    await encountersService.create({ appointment_id: 42, professional_id: 7 });

    expect(medicalAttendanceService.open).toHaveBeenCalledWith(42, undefined, 7);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("salva conteúdo pelo RPC M18 e normaliza summary como conduta", async () => {
    await encountersService.update("enc-1", {
      chief_complaint: "Dor abdominal",
      summary: "Orientações e retorno",
      status: "aguardando_assinatura",
    });

    expect(medicalAttendanceService.save).toHaveBeenCalledWith("enc-1", {
      chief_complaint: "Dor abdominal",
      conduct: "Orientações e retorno",
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("assina com identidade derivada no servidor", async () => {
    await encountersService.sign("enc-1", "Nome informado pela tela");

    expect(medicalAttendanceService.finalize).toHaveBeenCalledWith("enc-1");
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
