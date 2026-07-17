import { supabase } from "@/lib/supabase";

export interface AccessContextOption {
  membershipId: string;
  companyId: string;
  companyName: string;
  roleId: number;
  roleName: string;
  unitId: number | null;
  unitName: string;
}

type AccessContextRow = {
  membership_id: string;
  company_id: string;
  company_name: string;
  role_id: number;
  role_name: string;
  unit_id: number | null;
  unit_name: string;
};

export const accessContextService = {
  async listAuthorized(): Promise<AccessContextOption[]> {
    const { data, error } = await supabase.rpc("list_authorized_access_contexts");
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as AccessContextRow[]).map((row) => ({
      membershipId: row.membership_id,
      companyId: row.company_id,
      companyName: row.company_name,
      roleId: row.role_id,
      roleName: row.role_name,
      unitId: row.unit_id,
      unitName: row.unit_name,
    }));
  },

  async select(membershipId: string, roleId: number, unitId: number | null): Promise<void> {
    const { error } = await supabase.rpc("set_access_context", {
      p_membership_id: membershipId,
      p_role_id: roleId,
      p_unit_id: unitId,
    });
    if (error) throw new Error(error.message);
  },
};
