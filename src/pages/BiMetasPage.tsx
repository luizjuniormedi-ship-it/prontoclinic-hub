/**
 * BiMetasPage.tsx
 *
 * Página dedicada ao CRUD de metas (BI).
 */

import { useCallback, useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { MetasManager } from "@/components/bi/MetasManager";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { friendlyError } from "@/utils/friendlyError";
import { biService, type Meta } from "@/services/biService";

export default function BiMetasPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.company_id ?? "";
  const [metas, setMetas] = useState<Meta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!companyId) {
      setError("Usuário sem empresa associada.");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await biService.getMetas(companyId);
      setMetas(data);
    } catch (err) {
      setError(friendlyError(err, "Carregar metas"));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const handleSalvar = async (meta: Partial<Meta>) => {
    if (meta.id) {
      await biService.updateMeta(meta.id, meta);
    } else {
      await biService.createMeta(companyId, { ...meta, cd_usuario_criou: user?.id ?? null });
    }
    await carregar();
    toast({ title: "Meta salva." });
  };

  const handleExcluir = async (id: number) => {
    await biService.deleteMeta(id);
    await carregar();
    toast({ title: "Meta excluída." });
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Metas de Performance"
          description="Defina objetivos por KPI, período e tipo de comparação."
        />
        {loading ? (
          <LoadingState message="Carregando metas..." />
        ) : error ? (
          <ErrorState message={error} onRetry={carregar} />
        ) : (
          <MetasManager
            companyId={companyId}
            metas={metas}
            onSalvar={handleSalvar}
            onExcluir={handleExcluir}
          />
        )}
      </div>
    </AppLayout>
  );
}
