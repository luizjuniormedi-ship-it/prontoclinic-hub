/**
 * BiAlertasPage.tsx
 *
 * Página dedicada à gestão de alertas de BI.
 */

import { useCallback, useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { AlertasPanel } from "@/components/bi/AlertasPanel";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { friendlyError } from "@/utils/friendlyError";
import { biService, type Alerta } from "@/services/biService";

export default function BiAlertasPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.company_id ?? "";
  const [alertas, setAlertas] = useState<Alerta[]>([]);
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
      const data = await biService.getAlertasHistorico(companyId, 200);
      setAlertas(data);
    } catch (err) {
      setError(friendlyError(err, "Carregar alertas"));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const handleResolver = async (id: number) => {
    if (!user?.id) return;
    try {
      await biService.resolverAlerta(id, user.id);
      toast({ title: "Alerta resolvido." });
      await carregar();
    } catch (err) {
      toast({ variant: "destructive", title: friendlyError(err, "Resolver") });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Alertas de Performance"
          description="Histórico completo de notificações de violação de metas."
        />
        {loading ? (
          <LoadingState message="Carregando alertas..." />
        ) : error ? (
          <ErrorState message={error} onRetry={carregar} />
        ) : (
          <AlertasPanel
            alertas={alertas}
            onResolver={handleResolver}
            onRecarregar={carregar}
          />
        )}
      </div>
    </AppLayout>
  );
}
