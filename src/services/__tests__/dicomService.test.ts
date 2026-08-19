import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { rpc, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from,
  },
}));

import { modalitiesService, nodesService, reportService, worklistQueueService } from "@/services/dicomService";

function createInsertQuery(result: unknown) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  return { insert, select, single };
}

describe("worklistQueueService.releaseAppointment", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it("usa somente a RPC transacional e preserva a chave de idempotência", async () => {
    rpc.mockResolvedValue({
      data: [{ id: "queue-1", appointment_id: 42 }],
      error: null,
    });

    await expect(
      worklistQueueService.releaseAppointment(42, "reception:42:attempt-1"),
    ).resolves.toHaveLength(1);

    expect(rpc).toHaveBeenCalledWith(
      "release_appointment_to_worklist_secure",
      {
        p_appointment_id: 42,
        p_idempotency_key: "reception:42:attempt-1",
      },
    );
  });

  it("falha fechado para agendamento ou chave inválidos", async () => {
    await expect(
      worklistQueueService.releaseAppointment(0, "reception:42:attempt-1"),
    ).rejects.toThrow("Agendamento inválido");
    await expect(
      worklistQueueService.releaseAppointment(42, "curta"),
    ).rejects.toThrow("Chave de idempotência inválida");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não considera resposta vazia como liberação concluída", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(
      worklistQueueService.releaseAppointment(42, "reception:42:attempt-1"),
    ).rejects.toThrow("não retornou itens");
  });
});

describe("worklistQueueService.cancel", () => {
  beforeEach(() => from.mockReset());

  function createCancelQuery(result: unknown) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn();
    eq.mockReturnValue({ eq, select });
    const update = vi.fn().mockReturnValue({ eq });
    return { update, eq, select, maybeSingle };
  }

  it("confirma a linha cancelada antes de concluir", async () => {
    const query = createCancelQuery({ data: { id: "queue-1" }, error: null });
    from.mockReturnValue(query);

    await expect(worklistQueueService.cancel("queue-1")).resolves.toBeUndefined();
    expect(query.eq).toHaveBeenNthCalledWith(1, "id", "queue-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "status", "pending");
    expect(query.select).toHaveBeenCalledWith("id");
  });

  it("falha fechado quando RLS ou o identificador impedem a atualização", async () => {
    const query = createCancelQuery({ data: null, error: null });
    from.mockReturnValue(query);

    await expect(worklistQueueService.cancel("queue-denied")).rejects.toThrow(
      "não encontrado, sem permissão ou já processado",
    );
  });

  it("propaga o erro retornado pelo banco", async () => {
    const databaseError = new Error("database unavailable");
    const query = createCancelQuery({ data: null, error: databaseError });
    from.mockReturnValue(query);

    await expect(worklistQueueService.cancel("queue-1")).rejects.toBe(databaseError);
  });
});

describe("DICOM node and modality persistence contracts", () => {
  beforeEach(() => from.mockReset());

  it("persiste nós na tabela canônica com escopo multiempresa", async () => {
    const query = createInsertQuery({ data: { id: "node-uuid" }, error: null });
    from.mockReturnValue(query);

    await expect(nodesService.create({
      company_id: "company-1",
      unit_id: 7,
      name: "PACS principal",
      node_type: "pacs",
      aetitle: "PRONTOPACS",
      ip_address: "10.0.0.8",
      port: 4242,
    })).resolves.toEqual({ id: "node-uuid" });

    expect(from).toHaveBeenCalledWith("dicom_nodes");
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      company_id: "company-1",
      unit_id: 7,
      node_kind: "pacs",
      dicom_host: "10.0.0.8",
      dicom_port: 4242,
    }));
  });

  it("preserva o UUID do PACS e o escopo ao criar modalidade", async () => {
    const query = createInsertQuery({ data: { id: 31 }, error: null });
    from.mockReturnValue(query);

    await modalitiesService.create({
      company_id: "company-1",
      unit_id: 7,
      name: "Tomógrafo",
      modality_type: "CT",
      aetitle: "CT01",
      pacs_node_id: "853ef08b-873a-43c6-a501-7c4fb42f6fd0",
    });

    expect(from).toHaveBeenCalledWith("dicom_equipment");
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      company_id: "company-1",
      unit_id: 7,
      pacs_node_id: "853ef08b-873a-43c6-a501-7c4fb42f6fd0",
    }));
    expect(query.insert).not.toHaveBeenCalledWith(expect.objectContaining({
      cd_pacs_node: expect.anything(),
    }));
  });

  it("falha fechado sem empresa antes de consultar", async () => {
    await expect(nodesService.list(" ")).rejects.toThrow("Empresa inválida");
    await expect(modalitiesService.list("")).rejects.toThrow("Empresa inválida");
    expect(from).not.toHaveBeenCalled();
  });
});

describe("reportService canonical reports contract", () => {
  beforeEach(() => from.mockReset());

  it("não referencia a tabela legada de laudos em nenhum serviço M24", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/services/dicomService.ts"),
      "utf8",
    );
    expect(source).not.toContain("radiology_reports");
    expect(source.match(/\.from\("reports"\)/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("atualiza somente public.reports com os campos canônicos", async () => {
    const existingQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "report-1" },
        error: null,
      }),
    };
    const updated = {
      id: "report-1",
      imaging_order_item_id: 42,
      patient_id: 7,
      findings: "Sem alterações agudas",
      executor_name: "Dra. Radiologista",
      status: "em_revisao",
      created_at: "2026-08-16T10:00:00Z",
      updated_at: "2026-08-16T10:05:00Z",
    };
    const updateQuery = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updated, error: null }),
    };
    from.mockReturnValueOnce(existingQuery).mockReturnValueOnce(updateQuery);

    await expect(
      reportService.saveReport("00000000-0000-4000-8000-000000000042", "Sem alterações agudas", "Dra. Radiologista"),
    ).resolves.toMatchObject({
      ds_content: "Sem alterações agudas",
      ds_status: "PRELIMINARY",
      ds_signed_by: "Dra. Radiologista",
    });

    expect(from).toHaveBeenNthCalledWith(1, "reports");
    expect(from).toHaveBeenNthCalledWith(2, "reports");
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      findings: "Sem alterações agudas",
      executor_name: "Dra. Radiologista",
    }));
  });

  it("falha fechado quando o relatório canônico ainda não existe", async () => {
    const existingQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    from.mockReturnValue(existingQuery);

    await expect(reportService.saveReport("00000000-0000-4000-8000-000000000042", "Conteúdo")).rejects.toThrow(
      "Laudo canônico não encontrado para o item de imagem",
    );
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("propaga erro ao consultar public.reports", async () => {
    const databaseError = new Error("reports unavailable");
    const existingQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: databaseError }),
    };
    from.mockReturnValue(existingQuery);

    await expect(reportService.saveReport("00000000-0000-4000-8000-000000000042", "Conteúdo")).rejects.toBe(databaseError);
  });

  it("correlaciona o laudo canônico diretamente pelo StudyInstanceUID", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "report-24",
          study_instance_uid: "1.2.826.0.1.3680043.10.24",
          findings: "Sem alterações agudas",
          status: "liberado",
          created_at: "2026-08-16T10:00:00Z",
          updated_at: "2026-08-16T10:05:00Z",
        },
        error: null,
      }),
    };
    from.mockReturnValue(query);

    await expect(
      reportService.getByStudyInstanceUid(" 1.2.826.0.1.3680043.10.24 "),
    ).resolves.toMatchObject({
      study_instance_uid: "1.2.826.0.1.3680043.10.24",
      ds_content: "Sem alterações agudas",
      ds_status: "FINAL",
    });

    expect(from).toHaveBeenCalledWith("reports");
    expect(query.eq).toHaveBeenCalledWith("study_instance_uid", "1.2.826.0.1.3680043.10.24");
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("publica somente pelo ID canônico do exame, sem fallback legado", async () => {
    rpc.mockResolvedValue({
      data: {
        exam_id: 24001,
        status: "LAUDADO",
        published: true,
        published_at: "2026-08-16T10:10:00Z",
      },
      error: null,
    });

    await expect(reportService.publishReport(24001, true)).resolves.toEqual({
      examId: 24001,
      status: "LAUDADO",
      publishedToApp: true,
      publishedAt: "2026-08-16T10:10:00Z",
    });
    expect(rpc).toHaveBeenCalledWith("publish_dicom_report", {
      p_exam_id: 24001,
      p_publish_to_app: true,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejeita ID de exame ambíguo antes da RPC", async () => {
    await expect(reportService.publishReport(0, true)).rejects.toThrow(
      "ID canônico do exame DICOM inválido",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("module 10 worklist migration", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728010000_module10_worklist_contract.sql",
    ),
    "utf8",
  );

  it("mantém a fila sob FORCE RLS e owner sem bypass", () => {
    expect(migration).toContain(
      "ALTER TABLE public.dicom_worklist_queue FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain("NOBYPASSRLS");
    expect(migration).toContain("NOSUPERUSER");
    expect(migration).toContain(
      "OWNER TO prontomedic_worklist_rpc_owner",
    );
    expect(migration).toContain(
      "m10_worklist_queue_rpc_access",
    );
  });

  it("preserva unicidade, escopo e idempotência na liberação", () => {
    expect(migration).toContain(
      "UNIQUE (company_id, imaging_order_item_id)",
    );
    expect(migration).toContain(
      "public.org_can_access_unit(company_id, unit_id)",
    );
    expect(migration).toContain(
      "WHERE public.dicom_worklist_queue.idempotency_key = EXCLUDED.idempotency_key",
    );
  });

  it("não permite DML direto do cliente autenticado na fila", () => {
    expect(migration).toMatch(
      /REVOKE INSERT, DELETE, TRUNCATE ON public\.dicom_worklist_queue[\s\S]*FROM authenticated;/,
    );
    expect(migration).not.toMatch(
      /GRANT INSERT[^;]*public\.dicom_worklist_queue[^;]*TO authenticated/i,
    );
  });
});
