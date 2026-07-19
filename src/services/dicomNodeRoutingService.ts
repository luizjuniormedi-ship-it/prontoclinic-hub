import { supabase } from "@/lib/supabase";

export type DicomNodeKind = "pacs" | "worklist";
export type DicomNodeHealth = "unknown" | "healthy" | "degraded" | "offline";

export interface DicomNodeRoute {
  id: string;
  company_id: string;
  unit_id: number | null;
  name: string;
  node_kind: DicomNodeKind;
  aetitle: string;
  dicom_host?: string | null;
  dicom_port: number;
  rest_endpoint_ref?: string | null;
  priority: number;
  is_default: boolean;
  is_active: boolean;
  health_status: DicomNodeHealth;
}

export interface DicomNodeSelection {
  unitId?: number | null;
  kind: DicomNodeKind;
}

export interface ResolvedDicomRoute {
  node: DicomNodeRoute | null;
  source: "unit" | "company-default" | "legacy-fallback" | "unresolved";
  restEndpoint?: string;
}

export interface DicomUnitOption {
  id: number;
  name: string;
}

const LEGACY_ORTHANC_URL = ((import.meta.env.VITE_ORTHANC_URL as string | undefined) || "http://localhost:8042").replace(/\/$/, "");

function rankNode(node: DicomNodeRoute): [number, number, number] {
  return [node.is_default ? 0 : 1, node.priority, node.unit_id == null ? 1 : 0];
}

function compareNodes(a: DicomNodeRoute, b: DicomNodeRoute): number {
  const ar = rankNode(a);
  const br = rankNode(b);
  return ar[0] - br[0] || ar[1] - br[1] || ar[2] - br[2] || a.name.localeCompare(b.name);
}

/** Pure deterministic resolver, kept free of Supabase for unit testing. */
export function selectDicomNode(nodes: DicomNodeRoute[], selection: DicomNodeSelection): ResolvedDicomRoute {
  const active = nodes.filter((node) => node.is_active && node.node_kind === selection.kind);
  const unitMatches = selection.unitId == null ? [] : active.filter((node) => node.unit_id === selection.unitId);
  const companyDefaults = active.filter((node) => node.unit_id == null);
  const node = [...unitMatches].sort(compareNodes)[0] || [...companyDefaults].sort(compareNodes)[0] || null;
  if (!node) return { node: null, source: LEGACY_ORTHANC_URL ? "legacy-fallback" : "unresolved", restEndpoint: LEGACY_ORTHANC_URL };
  return {
    node,
    source: node.unit_id === selection.unitId ? "unit" : "company-default",
    // This URL is only a compatibility fallback. A gateway should resolve
    // rest_endpoint_ref server-side and never return Orthanc credentials.
    restEndpoint: node.rest_endpoint_ref ? undefined : LEGACY_ORTHANC_URL,
  };
}

export async function listDicomNodeRoutes(companyId: string, unitId?: number | null): Promise<DicomNodeRoute[]> {
  let query = supabase
    .from("dicom_nodes")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("priority", { ascending: true });
  if (unitId != null) query = query.or(`unit_id.eq.${unitId},unit_id.is.null`);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as DicomNodeRoute[];
}

export async function resolveDicomNodeRoute(companyId: string, selection: DicomNodeSelection): Promise<ResolvedDicomRoute> {
  const nodes = await listDicomNodeRoutes(companyId, selection.unitId);
  return selectDicomNode(nodes, selection);
}

export async function listDicomUnits(): Promise<DicomUnitOption[]> {
  const { data, error } = await supabase.from("units").select("id, ds_nome").order("ds_nome");
  if (error) throw error;
  return (data || []).map((row: { id: number; ds_nome: string }) => ({ id: row.id, name: row.ds_nome }));
}

export function getLegacyOrthancUrl(): string {
  return LEGACY_ORTHANC_URL;
}
