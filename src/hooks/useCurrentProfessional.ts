/**
 * useCurrentProfessional — Hook que resolve o profissional logado a partir
 * do user_profiles.id do Supabase Auth.
 *
 * Por que existe: várias partes do código precisam gravar `cd_medico` (FK
 * para professionals.id), mas o contexto de auth expõe apenas o `user.id`
 * (UUID do Supabase Auth). Esse hook faz o JOIN user_profiles → professionals
 * via user_id = auth.uid().
 *
 * Retorna:
 *   - professionalId: BIGINT FK para professionals.id (number) — usar em cd_medico
 *   - isLoading: boolean
 *   - error: Error | null
 *
 * IMPORTANTE: retorna `null` para `professionalId` enquanto carrega ou se
 * o usuário logado não tiver um professional vinculado (ex.: admin puro).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export interface CurrentProfessional {
  professionalId: number | null;
  isLoading: boolean;
  error: Error | null;
}

export function useCurrentProfessional(): CurrentProfessional {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["current-professional", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data, error } = await supabase
        .from("professionals")
        .select("id")
        .eq("user_id", user.id)
        .eq("lg_ativo", true)
        .maybeSingle();

      if (error) {
        // PGRST116 = no rows found (não é erro de verdade)
        if (error.code === "PGRST116") return null;
        throw new Error(`Erro ao buscar profissional: ${error.message}`);
      }

      return data?.id ?? null;
    },
    enabled: !!user?.id,
    // Cache por mais tempo — perfil do usuário não muda a cada minuto
    staleTime: 5 * 60_000,
  });

  return {
    professionalId: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}