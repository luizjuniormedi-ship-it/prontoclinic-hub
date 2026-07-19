import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { selectDicomNode, type DicomNodeRoute } from "@/services/dicomNodeRoutingService";

const nodes: DicomNodeRoute[] = [
  {
    id: "company-pacs", company_id: "c1", unit_id: null, name: "PACS padrao", node_kind: "pacs",
    aetitle: "PACS", dicom_host: "pacs.company", dicom_port: 4242, priority: 50,
    is_default: true, is_active: true, health_status: "healthy",
  },
  {
    id: "unit-1-pacs", company_id: "c1", unit_id: 1, name: "PACS unidade 1", node_kind: "pacs",
    aetitle: "PACS1", dicom_host: "pacs.unit1", dicom_port: 4242, priority: 100,
    is_default: false, is_active: true, health_status: "healthy",
  },
  {
    id: "unit-1-wl", company_id: "c1", unit_id: 1, name: "MWL unidade 1", node_kind: "worklist",
    aetitle: "MWL1", dicom_host: "mwl.unit1", dicom_port: 4242, priority: 10,
    is_default: true, is_active: true, health_status: "healthy",
  },
];

describe("selectDicomNode", () => {
  it("seleciona o PACS da unidade sem misturar com Worklist", () => {
    const route = selectDicomNode(nodes, { unitId: 1, kind: "pacs" });
    expect(route.node?.id).toBe("unit-1-pacs");
    expect(route.node?.node_kind).toBe("pacs");
    expect(route.source).toBe("unit");
  });

  it("seleciona o Worklist correto para a unidade", () => {
    const route = selectDicomNode(nodes, { unitId: 1, kind: "worklist" });
    expect(route.node?.id).toBe("unit-1-wl");
    expect(route.node?.node_kind).toBe("worklist");
  });

  it("usa o no padrao da empresa quando a unidade nao possui o tipo", () => {
    const route = selectDicomNode(nodes, { unitId: 2, kind: "pacs" });
    expect(route.node?.id).toBe("company-pacs");
    expect(route.source).toBe("company-default");
  });

  it("mantem fallback legado quando nao ha nos modernos", () => {
    const route = selectDicomNode([], { unitId: 2, kind: "pacs" });
    expect(route.node).toBeNull();
    expect(route.source).toBe("legacy-fallback");
    expect(route.restEndpoint).toMatch(/^https?:\/\//);
  });
});
