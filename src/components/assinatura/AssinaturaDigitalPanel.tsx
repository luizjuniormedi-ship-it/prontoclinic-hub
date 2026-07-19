/**
 * AssinaturaDigitalPanel — Upload de certificado + listagem de documentos assinados.
 *
 * Importante: a chave privada NUNCA é armazenada. O componente apenas
 * gerencia metadados; a assinatura real é feita client-side via Web Crypto API.
 */

import { useCallback, useEffect, useState } from "react";
import { Shield, Upload, FileCheck, AlertTriangle, Calendar, X, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { useToast } from "@/hooks/use-toast";
import {
  assinaturaDigitalService,
  certificadoValido,
  sha256,
  type Certificado,
  type AssinaturaAuditoria,
} from "@/services/assinaturaDigitalService";
import { useConfirm } from "@/hooks/useConfirm";

export function AssinaturaDigitalPanel() {
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [certificados, setCertificados] = useState<Certificado[]>([]);
  const [auditoria, setAuditoria] = useState<AssinaturaAuditoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // form
  const [cdProfissional, setCdProfissional] = useState("");
  const [tpCertificado, setTpCertificado] = useState<"A1" | "A3" | "ICP_BRASIL">("A1");
  const [nrSerie, setNrSerie] = useState("");
  const [cdEmissor, setCdEmissor] = useState("");
  const [dtInicio, setDtInicio] = useState("");
  const [dtFim, setDtFim] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [certs, audit] = await Promise.all([
        assinaturaDigitalService.certificados.getAll(false),
        assinaturaDigitalService.documentos.getAuditoria(),
      ]);
      setCertificados(certs);
      setAuditoria(audit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const handleCadastrar = useCallback(async () => {
    if (!cdProfissional || !nrSerie || !dtInicio || !dtFim) {
      toast({ title: "Preencha todos os campos", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await assinaturaDigitalService.certificados.create({
        cd_profissional: Number(cdProfissional),
        tp_certificado: tpCertificado,
        nr_serie: nrSerie,
        cd_emissor: cdEmissor || null,
        dt_validade_inicio: dtInicio,
        dt_validade_fim: dtFim,
        lg_ativo: true,
      });
      toast({ title: "Certificado cadastrado" });
      setCdProfissional("");
      setNrSerie("");
      setCdEmissor("");
      setDtInicio("");
      setDtFim("");
      void carregar();
    } catch (err) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [cdProfissional, tpCertificado, nrSerie, cdEmissor, dtInicio, dtFim, toast, carregar]);

  const handleRevogar = useCallback(async (id: number) => {
    if (!await confirm({ title: "Revogar certificado?", description: "Esta ação não pode ser desfeita.", destructive: true, confirmText: "Revogar" })) return;
    try {
      await assinaturaDigitalService.certificados.revogar(id, {
        ds_motivo_revogacao: "Revogação manual via painel",
      });
      toast({ title: "Certificado revogado" });
      void carregar();
    } catch (err) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    }
  }, [toast, carregar]);

  if (loading) return <LoadingState message="Carregando certificados..." />;
  if (error) return <ErrorState message={error} onRetry={carregar} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assinatura Digital ICP-Brasil"
        description="Certificados A1/A3 e auditoria de documentos assinados"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Certificados ativos</p>
            <p className="text-2xl font-bold text-green-600">
              {certificados.filter((c) => c.lg_ativo && !c.lg_revogado).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Documentos assinados</p>
            <p className="text-2xl font-bold">{auditoria.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Inválidos</p>
            <p className="text-2xl font-bold text-red-600">
              {auditoria.filter((a) => !a.lg_valido).length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" /> Cadastrar novo certificado
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800 flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>
              <strong>LGPD + Segurança:</strong> A chave privada do certificado A1 (.pfx) é
              usada LOCALMENTE no seu navegador para assinar. Ela NUNCA é enviada ao servidor.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cd_prof">ID do Profissional</Label>
              <Input
                id="cd_prof"
                type="number"
                value={cdProfissional}
                onChange={(e) => setCdProfissional(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="tp_cert">Tipo</Label>
              <select
                id="tp_cert"
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={tpCertificado}
                onChange={(e) => setTpCertificado(e.target.value as "A1" | "A3" | "ICP_BRASIL")}
              >
                <option value="A1">A1 (arquivo .pfx)</option>
                <option value="A3">A3 (token/cartão)</option>
                <option value="ICP_BRASIL">ICP-Brasil (outros)</option>
              </select>
            </div>
            <div>
              <Label htmlFor="nr_serie">Número de série</Label>
              <Input
                id="nr_serie"
                value={nrSerie}
                onChange={(e) => setNrSerie(e.target.value)}
                placeholder="Ex: 1234567890abcdef"
              />
            </div>
            <div>
              <Label htmlFor="emissor">Emissor (AC)</Label>
              <Input
                id="emissor"
                value={cdEmissor}
                onChange={(e) => setCdEmissor(e.target.value)}
                placeholder="Ex: AC Raiz, Certisign..."
              />
            </div>
            <div>
              <Label htmlFor="dt_inicio">Validade — início</Label>
              <Input
                id="dt_inicio"
                type="date"
                value={dtInicio}
                onChange={(e) => setDtInicio(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="dt_fim">Validade — fim</Label>
              <Input
                id="dt_fim"
                type="date"
                value={dtFim}
                onChange={(e) => setDtFim(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={() => void handleCadastrar()} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> Cadastrar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" /> Certificados cadastrados
            <Badge variant="secondary">{certificados.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {certificados.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="Nenhum certificado cadastrado"
              description="Cadastre seu certificado ICP-Brasil para começar a assinar documentos digitalmente."
            />
          ) : (
            certificados.map((c) => {
              const valido = certificadoValido(c);
              return (
                <div
                  key={c.id}
                  className={`p-3 rounded-md border flex items-center justify-between ${
                    c.lg_revogado
                      ? "border-red-300 bg-red-50"
                      : valido
                        ? "border-green-300 bg-green-50"
                        : "border-yellow-300 bg-yellow-50"
                  }`}
                >
                  <div>
                    <p className="font-medium text-sm">
                      {c.tp_certificado} · Série {c.nr_serie}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {c.cd_emissor ?? "—"} · {c.dt_validade_inicio} → {c.dt_validade_fim}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.lg_revogado ? (
                      <Badge variant="destructive">Revogado</Badge>
                    ) : valido ? (
                      <Badge className="bg-green-600">Válido</Badge>
                    ) : (
                      <Badge variant="outline">Vencido</Badge>
                    )}
                    {!c.lg_revogado && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRevogar(c.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-4 w-4" /> Auditoria de documentos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {auditoria.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento assinado registrado.</p>
          ) : (
            auditoria.slice(0, 20).map((a) => (
              <div
                key={a.id}
                className="p-2 text-sm border-l-2 border-blue-400 pl-2 hover:bg-accent"
              >
                <div className="flex items-center justify-between">
                  <span>
                    <span className="font-medium">{a.tp_documento}</span> · {a.ds_profissional}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.dt_assinatura).toLocaleString("pt-BR")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  {a.ds_hash_documento.slice(0, 16)}…
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
