import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260716212629_canonical_imaging_reporting_journey.sql"), "utf8");
const multiunitSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260716160000_dicom_multiunit_nodes.sql"), "utf8");

describe("canonical imaging migration security", () => {
  it("não cria função SECURITY DEFINER nem policy aberta", () => {
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).not.toMatch(/(?:USING|WITH CHECK)\s*\(\s*true\s*\)/i);
  });

  it("inclui app_prontomedic com grants mínimos e sem DELETE", () => {
    expect(sql).toContain("TO app_prontomedic");
    expect(sql).toMatch(/REVOKE UPDATE, DELETE ON TABLE public\.report_signatures/i);
    expect(sql).toMatch(/REVOKE DELETE ON TABLE public\.reports/i);
    expect(sql).not.toMatch(/GRANT\s+ALL[\s\S]*app_prontomedic/i);
  });

  it("protege assinatura, entrega e retificação com marcadores transacionais", () => {
    expect(sql).toContain("app.report_signing_rpc");
    expect(sql).toContain("app.report_delivery_rpc");
    expect(sql).toContain("app.report_rectify_rpc");
    expect(sql).toContain("OLD.status IN ('assinado','liberado','entregue','retificado')");
    expect(sql).toContain("NOT v_content_changed");
  });
});

describe("DICOM multiunit migration compatibility", () => {
  it("normaliza o contrato legado antes de criar os índices novos", () => {
    const alterPosition = multiunitSql.indexOf("ALTER TABLE public.dicom_nodes");
    const indexPosition = multiunitSql.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS dicom_nodes_one_default_per_scope");

    expect(alterPosition).toBeGreaterThan(-1);
    expect(indexPosition).toBeGreaterThan(alterPosition);
    expect(multiunitSql).toContain("ADD COLUMN IF NOT EXISTS is_default BOOLEAN");
    expect(multiunitSql).toContain("ADD COLUMN IF NOT EXISTS node_kind VARCHAR(20)");
    expect(multiunitSql).toContain("CREATE ROLE authenticated NOLOGIN");
    expect(multiunitSql).toContain("CREATE ROLE anon NOLOGIN");
  });

  it("sincroniza colunas legadas e novas sem elevar privilégios", () => {
    expect(multiunitSql).toContain("sync_dicom_node_contracts");
    expect(multiunitSql).toContain("NEW.node_type := COALESCE(NEW.node_type, NEW.node_kind)");
    expect(multiunitSql).not.toContain("public.get_my_company_id()");
    expect(multiunitSql).toContain("request.jwt.claim.company_id");
    expect(multiunitSql).not.toMatch(/SECURITY\s+DEFINER/i);
  });
});
