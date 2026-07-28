import { supabase } from "@/lib/supabase";

export type SectorType = "administrative" | "clinical" | "diagnostic" | "operational" | "support";
export type ResourceType = "room" | "office" | "bed" | "equipment" | "inventory_location" | "cost_center";
export type ResourceStatus = "active" | "inactive" | "maintenance";

export interface OrganizationSector {
  id: number;
  company_id: string;
  unit_id: number;
  code: string;
  name: string;
  sector_type: SectorType;
  lg_ativo: boolean;
}

export interface OrganizationalResource {
  id: number;
  company_id: string;
  unit_id: number;
  sector_id: number | null;
  code: string;
  name: string;
  resource_type: ResourceType;
  status: ResourceStatus;
}

export interface UnitService {
  id: number;
  unit_id: number;
  service_id: number;
  duration_minutes: number;
  lg_ativo: boolean;
}

export interface UnitSchedule {
  id: number;
  unit_id: number;
  sector_id: number | null;
  resource_id: number | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
  lg_ativo: boolean;
}

export interface CatalogServiceOption {
  id: number;
  name: string;
  code: string | null;
}

const sectorColumns = "id, company_id, unit_id, code, name, sector_type, lg_ativo";
const resourceColumns = "id, company_id, unit_id, sector_id, code, name, resource_type, status";

async function read<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export const organizationalStructureService = {
  listSectors(unitId: number) {
    return read<OrganizationSector>(
      supabase.from("sectors").select(sectorColumns).eq("unit_id", unitId).eq("lg_ativo", true).order("name"),
    );
  },

  createSector(input: { company_id: string; unit_id: number; code: string; name: string; sector_type: SectorType }) {
    return supabase.from("sectors").insert({ ...input, code: input.code.trim().toUpperCase(), name: input.name.trim() }).select(sectorColumns).single().then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data as OrganizationSector;
    });
  },

  updateSector(id: number, input: Partial<Pick<OrganizationSector, "code" | "name" | "sector_type" | "lg_ativo">>) {
    const payload = { ...input, ...(input.code ? { code: input.code.trim().toUpperCase() } : {}), ...(input.name ? { name: input.name.trim() } : {}) };
    return supabase.from("sectors").update(payload).eq("id", id).select(sectorColumns).single().then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data as OrganizationSector;
    });
  },

  listResources(unitId: number) {
    return read<OrganizationalResource>(
      supabase.from("organizational_resources").select(resourceColumns).eq("unit_id", unitId).neq("status", "inactive").order("name"),
    );
  },

  createResource(input: { company_id: string; unit_id: number; sector_id: number | null; code: string; name: string; resource_type: ResourceType }) {
    return supabase.from("organizational_resources").insert({ ...input, code: input.code.trim().toUpperCase(), name: input.name.trim(), status: "active" }).select(resourceColumns).single().then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data as OrganizationalResource;
    });
  },

  updateResource(id: number, input: Partial<Pick<OrganizationalResource, "sector_id" | "code" | "name" | "resource_type" | "status">>) {
    const payload = { ...input, ...(input.code ? { code: input.code.trim().toUpperCase() } : {}), ...(input.name ? { name: input.name.trim() } : {}) };
    return supabase.from("organizational_resources").update(payload).eq("id", id).select(resourceColumns).single().then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data as OrganizationalResource;
    });
  },

  listUnitServices(unitId: number) {
    return read<UnitService>(
      supabase.from("unit_services").select("id, unit_id, service_id, duration_minutes, lg_ativo").eq("unit_id", unitId).eq("lg_ativo", true).order("service_id"),
    );
  },

  listCatalogServices() {
    return read<CatalogServiceOption>(
      supabase.from("services_catalog").select("id, name, code").eq("lg_ativo", true).order("name"),
    );
  },

  assignService(input: { company_id: string; unit_id: number; service_id: number; duration_minutes: number }) {
    return supabase.from("unit_services").upsert({ ...input, lg_ativo: true }, { onConflict: "company_id,unit_id,service_id" }).select("id, unit_id, service_id, duration_minutes, lg_ativo").single().then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data as UnitService;
    });
  },

  updateUnitService(id: number, input: Partial<Pick<UnitService, "duration_minutes" | "lg_ativo">>) {
    return supabase.from("unit_services").update(input).eq("id", id).select("id, unit_id, service_id, duration_minutes, lg_ativo").single().then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data as UnitService;
    });
  },

  listSchedules(unitId: number) {
    return read<UnitSchedule>(
      supabase.from("unit_schedules").select("id, unit_id, sector_id, resource_id, day_of_week, start_time, end_time, timezone, lg_ativo").eq("unit_id", unitId).eq("lg_ativo", true).order("day_of_week").order("start_time"),
    );
  },

  createSchedule(input: { company_id: string; unit_id: number; sector_id: number | null; resource_id: number | null; day_of_week: number; start_time: string; end_time: string; timezone: string }) {
    return supabase.from("unit_schedules").insert({ ...input, lg_ativo: true }).select("id, unit_id, sector_id, resource_id, day_of_week, start_time, end_time, timezone, lg_ativo").single().then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data as UnitSchedule;
    });
  },

  updateSchedule(id: number, input: Partial<Pick<UnitSchedule, "day_of_week" | "start_time" | "end_time" | "timezone" | "lg_ativo">>) {
    return supabase.from("unit_schedules").update(input).eq("id", id).select("id, unit_id, sector_id, resource_id, day_of_week, start_time, end_time, timezone, lg_ativo").single().then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data as UnitSchedule;
    });
  },
};
