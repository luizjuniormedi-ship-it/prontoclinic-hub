import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { tissGuideService, type TissGuide } from "@/services/tissGuideService";

const statusLabel: Record<TissGuide["status"], string> = {
  DRAFT: "Rascunho",
  VALIDATED: "Validada",
  SIGNED: "Assinada",
  CANCELLED: "Cancelada",
  SUBSTITUTED: "Substituida",
};

export function TissGuideManager({
  companyId,
  billingAccountId,
}: {
  companyId: string;
  billingAccountId?: string;
}) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data: guides = [], isLoading, isError } = useQuery({
    queryKey: ["tiss-guides", companyId],
    queryFn: () => tissGuideService.list(companyId),
    enabled: Boolean(companyId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tiss-guides", companyId] });
  const run = async (id: string, action: () => Promise<unknown>, success: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(success);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-4 space-y-4" aria-labelledby="tiss-guide-manager-title">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 id="tiss-guide-manager-title" className="font-semibold">Guias TISS</h2>
          <p className="text-xs text-muted-foreground">
            Cadastro e validação. O aceite do paciente e o fechamento são feitos na conta vinculada.
          </p>
        </div>
        {billingAccountId && <Badge variant="secondary">Conta vinculada</Badge>}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando guias...</p>}
      {isError && <p className="text-sm text-destructive">Não foi possível carregar as guias TISS.</p>}
      {!isLoading && !isError && guides.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma guia no tenant atual.</p>
      )}
      {!isLoading && !isError && guides.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left">
              <th className="p-2">Número</th><th className="p-2">Tipo</th><th className="p-2">Status</th><th className="p-2">Ambiente</th><th className="p-2">Ações</th>
            </tr></thead>
            <tbody>
              {guides.map((guide) => (
                <tr key={guide.id} className="border-b last:border-0">
                  <td className="p-2 font-mono">{guide.guide_number}</td>
                  <td className="p-2">{guide.guide_type}</td>
                  <td className="p-2"><Badge variant="outline">{statusLabel[guide.status]}</Badge></td>
                  <td className="p-2 text-xs">{guide.environment}</td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      {guide.status === "DRAFT" && (
                        <Button size="sm" variant="ghost" title="Validar guia" disabled={busyId === guide.id} onClick={() => void run(guide.id, () => tissGuideService.validate(guide.id), "Guia validada")}>
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                      {["DRAFT", "VALIDATED", "SIGNED"].includes(guide.status) && (
                        <Button size="sm" variant="ghost" title="Cancelar guia" disabled={busyId === guide.id} onClick={() => void run(guide.id, () => tissGuideService.cancel(guide.id, "Cancelamento solicitado pelo operador"), "Guia cancelada")}>
                          <XCircle className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
