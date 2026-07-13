/**
 * TissGuiaForm — formularios relacionados a TISS:
 *   - Dialog para registro manual de glosa
 *   - Dialog para configuracao de protocolos por operadora
 *
 * Sub-componente extraido de TissManager.tsx
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  tissService,
  TISS_GLOSA_CODES,
  type TissXml,
} from "@/services/tissService";
import { insuranceCompanyService } from "@/services/insuranceService";

export interface TissGuiaFormProps {
  // Glosa form
  glosaDialogOpen: boolean;
  setGlosaDialogOpen: (open: boolean) => void;
  selectedXml: TissXml | null;
  // Protocol form
  protocolDialogOpen: boolean;
  setProtocolDialogOpen: (open: boolean) => void;
  companyId: string;
}

export function TissGuiaForm({
  glosaDialogOpen,
  setGlosaDialogOpen,
  selectedXml,
  protocolDialogOpen,
  setProtocolDialogOpen,
  companyId,
}: TissGuiaFormProps) {
  const queryClient = useQueryClient();

  // ── Glosa manual (form) ─────────────────────────────────────
  const handleGlosaSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedXml) return;
    const fd = new FormData(e.currentTarget);
    try {
      await tissService.registrarGlosa(
        selectedXml.id,
        fd.get("motivo") as string,
        Number(fd.get("valor")),
        (fd.get("codigo") as string) || undefined,
      );
      toast.success("Glosa registrada");
      setGlosaDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["tiss-xml"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
    }
  };

  // ── Protocol form ───────────────────────────────────────────
  const { data: protocols } = useQuery({
    queryKey: ["tiss-protocols", companyId],
    queryFn: () => tissService.listProtocols(companyId),
    enabled: !!companyId && protocolDialogOpen,
  });

  const { data: convenios } = useQuery({
    queryKey: ["insurance-companies"],
    queryFn: () => insuranceCompanyService.getAll(),
  });

  const saveProtocolMutation = useMutation({
    mutationFn: (payload: {
      cd_convenio: number;
      ds_endpoint: string;
      tp_ambiente: "HOMOLOGACAO" | "PRODUCAO";
      ds_versao_tiss: string;
      cd_certificado_a1_path?: string;
      ds_certificado_senha?: string;
    }) => tissService.saveProtocol(companyId, payload),
    onSuccess: () => {
      toast.success("Protocolo salvo");
      queryClient.invalidateQueries({ queryKey: ["tiss-protocols"] });
    },
  });

  const handleProtocolSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    saveProtocolMutation.mutate({
      cd_convenio: Number(fd.get("cd_convenio")),
      ds_endpoint: fd.get("ds_endpoint") as string,
      tp_ambiente: ((fd.get("tp_ambiente") as string) || "HOMOLOGACAO") as "HOMOLOGACAO" | "PRODUCAO",
      ds_versao_tiss: (fd.get("ds_versao_tiss") as string) || "3.05.00",
      cd_certificado_a1_path: (fd.get("cd_certificado_a1_path") as string) || undefined,
      ds_certificado_senha: (fd.get("ds_certificado_senha") as string) || undefined,
    });
  };

  return (
    <>
      {/* Dialog de Glosa manual */}
      <Dialog open={glosaDialogOpen} onOpenChange={setGlosaDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Glosa</DialogTitle>
            <DialogDescription>Adicione uma glosa manual para esta fatura</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGlosaSubmit}>
            <div className="space-y-3">
              <div>
                <Label>Codigo TISS</Label>
                <Select name="codigo">
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {TISS_GLOSA_CODES.map((c) => (
                      <SelectItem key={c.codigo} value={c.codigo}>
                        {c.codigo} - {c.descricao}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Motivo</Label>
                <Textarea name="motivo" required rows={3} />
              </div>
              <div>
                <Label>Valor (R$)</Label>
                <Input name="valor" type="number" step="0.01" min="0.01" required />
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setGlosaDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled
                title="Registro de glosa indisponivel ate existir backend TISS seguro"
              >
                Registrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog de Protocolos */}
      <Dialog open={protocolDialogOpen} onOpenChange={setProtocolDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Protocolos TISS (endpoints por operadora)</DialogTitle>
            <DialogDescription>Configure o endpoint SOAP/REST de cada convenio.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleProtocolSubmit}>
            <div className="space-y-3">
              <div>
                <Label>Convenio *</Label>
                <Select name="cd_convenio" required>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {(convenios || []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Endpoint (URL do webservice) *</Label>
                <Input name="ds_endpoint" required placeholder="https://webservice.operadora.com.br/tiss" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Ambiente</Label>
                  <Select name="tp_ambiente" defaultValue="HOMOLOGACAO">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HOMOLOGACAO">Homologacao</SelectItem>
                      <SelectItem value="PRODUCAO">Producao</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Versao TISS</Label>
                  <Input name="ds_versao_tiss" defaultValue="3.05.00" maxLength={10} />
                </div>
              </div>
              <div>
                <Label>Caminho do Certificado A1 (.pfx) - VITE_TISS_CERT_PATH</Label>
                <Input name="cd_certificado_a1_path" placeholder="/etc/pc_hub/cert_a1.pfx" />
              </div>
              <div>
                <Label>Senha do Certificado</Label>
                <Input name="ds_certificado_senha" type="password" />
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setProtocolDialogOpen(false)}>
                Fechar
              </Button>
              <Button
                type="submit"
                disabled
                title="Protocolo TISS indisponivel ate existir backend seguro"
              >
                Salvar
              </Button>
            </DialogFooter>
          </form>

          <div className="mt-4">
            <Label className="text-xs">Protocolos cadastrados</Label>
            <ul className="text-sm space-y-1 mt-2 max-h-40 overflow-y-auto">
              {(protocols || []).map((p) => (
                <li key={p.id} className="p-2 border rounded">
                  <b>{p.tp_ambiente}</b> — {p.ds_endpoint}
                  {p.dt_ultimo_teste && <span className="text-xs ml-2 text-muted-foreground">ultimo teste: {new Date(p.dt_ultimo_teste).toLocaleString()}</span>}
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default TissGuiaForm;
