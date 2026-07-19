/**
 * InternacaoManager — Mapa de leitos, internações, prescrições e evoluções.
 *
 * Componente principal do módulo de internação.
 * Mostra:
 *   - Mapa visual de leitos (LIVRE/OCUPADO) por tipo (UTI, enfermaria, etc.)
 *   - Lista de internações ativas
 *   - Form de prescrição (apenas médicos)
 *   - Form de evolução SOAP (médicos + enfermeiros)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BedDouble, UserPlus, FileText, Activity, ChevronRight, Save, X, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { useToast } from "@/hooks/use-toast";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import {
  internacaoService,
  type LeitoOcupacao,
  type Internacao,
  type Prescricao,
  type Evolucao,
} from "@/services/internacaoService";
import { useConfirm } from "@/hooks/useConfirm";

const COR_LEITO: Record<LeitoOcupacao["tp_leito"], string> = {
  ENFERMARIA: "bg-blue-100 border-blue-300 text-blue-900",
  APARTAMENTO: "bg-indigo-100 border-indigo-300 text-indigo-900",
  UTI_ADULTO: "bg-red-100 border-red-300 text-red-900",
  UTI_PEDIATRICA: "bg-pink-100 border-pink-300 text-pink-900",
  UTI_NEONATAL: "bg-yellow-100 border-yellow-300 text-yellow-900",
  ISOLAMENTO: "bg-purple-100 border-purple-300 text-purple-900",
  OBSERVACAO: "bg-orange-100 border-orange-300 text-orange-900",
};

interface PrescricaoFormState {
  ds_prescricao: string;
  tp_dieta: string;
  ds_cuidados: string;
  ds_observacoes: string;
}

interface EvolucaoFormState {
  ds_subjetivo: string;
  ds_objetivo: string;
  ds_avaliacao: string;
  ds_plano: string;
  pa: string;
  fc: string;
  fr: string;
  t: string;
  spo2: string;
}

const PRESCRICAO_INICIAL: PrescricaoFormState = {
  ds_prescricao: "",
  tp_dieta: "",
  ds_cuidados: "",
  ds_observacoes: "",
};

const EVOLUCAO_INICIAL: EvolucaoFormState = {
  ds_subjetivo: "",
  ds_objetivo: "",
  ds_avaliacao: "",
  ds_plano: "",
  pa: "",
  fc: "",
  fr: "",
  t: "",
  spo2: "",
};

export function InternacaoManager() {
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const { professionalId, isLoading: loadingProfessional, error: professionalError } = useCurrentProfessional();
  const [mapa, setMapa] = useState<LeitoOcupacao[]>([]);
  const [internacoes, setInternacoes] = useState<Internacao[]>([]);
  const [selectedLeito, setSelectedLeito] = useState<LeitoOcupacao | null>(null);
  const [selectedInternacao, setSelectedInternacao] = useState<Internacao | null>(null);
  const [prescricoes, setPrescricoes] = useState<Prescricao[]>([]);
  const [evolucoes, setEvolucoes] = useState<Evolucao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [prescricaoForm, setPrescricaoForm] = useState<PrescricaoFormState>(PRESCRICAO_INICIAL);
  const [evolucaoForm, setEvolucaoForm] = useState<EvolucaoFormState>(EVOLUCAO_INICIAL);

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mapaData, internacoesData] = await Promise.all([
        internacaoService.leitos.getMapaOcupacao(),
        internacaoService.internacoes.getAll({ emAberto: true }),
      ]);
      setMapa(mapaData);
      setInternacoes(internacoesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrirInternacao = useCallback(async (leito: LeitoOcupacao) => {
    setSelectedLeito(leito);
    if (leito.cd_pacixleit) {
      const internacao = await internacaoService.internacoes.getById(leito.cd_pacixleit);
      setSelectedInternacao(internacao);
      if (internacao) {
        const [p, e] = await Promise.all([
          internacaoService.prescricoes.getByInternacao(internacao.id),
          internacaoService.evolucoes.getByInternacao(internacao.id),
        ]);
        setPrescricoes(p);
        setEvolucoes(e);
      }
    } else {
      setSelectedInternacao(null);
      setPrescricoes([]);
      setEvolucoes([]);
    }
  }, []);

  const handleDarAlta = useCallback(async () => {
    if (!selectedInternacao) return;
    if (!await confirm({ title: "Confirmar alta deste paciente?", confirmText: "Dar alta" })) return;
    try {
      await internacaoService.internacoes.darAlta(selectedInternacao.id, {
        tp_alta: "MELHORADO",
        ds_motivo_alta: "Alta médica",
      });
      toast({ title: "Alta registrada com sucesso" });
      setSelectedLeito(null);
      setSelectedInternacao(null);
      void carregar();
    } catch (err) {
      toast({
        title: "Erro ao dar alta",
        description: err instanceof Error ? err.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  }, [selectedInternacao, toast, carregar]);

  const handleCriarPrescricao = useCallback(async () => {
    if (!selectedInternacao) return;
    if (!prescricaoForm.ds_prescricao.trim()) {
      toast({ title: "Prescrição vazia", variant: "destructive" });
      return;
    }
    if (!professionalId) {
      toast({
        title: "Profissional não identificado",
        description: professionalError?.message ?? "Sua conta não está vinculada a um profissional. Contate o administrador.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await internacaoService.prescricoes.create({
        cd_internacao: selectedInternacao.id,
        cd_medico: professionalId,
        ds_prescricao: prescricaoForm.ds_prescricao,
        tp_dieta: prescricaoForm.tp_dieta || null,
        ds_cuidados: prescricaoForm.ds_cuidados || null,
        ds_observacoes: prescricaoForm.ds_observacoes || null,
        lg_ativa: true,
      });
      toast({ title: "Prescrição criada" });
      setPrescricaoForm(PRESCRICAO_INICIAL);
      const p = await internacaoService.prescricoes.getByInternacao(selectedInternacao.id);
      setPrescricoes(p);
    } catch (err) {
      toast({
        title: "Erro ao criar prescrição",
        description: err instanceof Error ? err.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [selectedInternacao, prescricaoForm, toast, professionalId, professionalError]);

  const handleCriarEvolucao = useCallback(async () => {
    if (!selectedInternacao) return;
    if (!professionalId) {
      toast({
        title: "Profissional não identificado",
        description: professionalError?.message ?? "Sua conta não está vinculada a um profissional. Contate o administrador.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const sinasVitais: Record<string, number | string> = {};
      if (evolucaoForm.pa) sinasVitais.pa = evolucaoForm.pa;
      if (evolucaoForm.fc) sinasVitais.fc = Number(evolucaoForm.fc);
      if (evolucaoForm.fr) sinasVitais.fr = Number(evolucaoForm.fr);
      if (evolucaoForm.t) sinasVitais.t = Number(evolucaoForm.t);
      if (evolucaoForm.spo2) sinasVitais.spo2 = Number(evolucaoForm.spo2);

      await internacaoService.evolucoes.create({
        cd_internacao: selectedInternacao.id,
        cd_medico: professionalId,
        ds_subjetivo: evolucaoForm.ds_subjetivo || null,
        ds_objetivo: evolucaoForm.ds_objetivo || null,
        ds_avaliacao: evolucaoForm.ds_avaliacao || null,
        ds_plano: evolucaoForm.ds_plano || null,
        sinas_vitais: Object.keys(sinasVitais).length > 0 ? sinasVitais : null,
      });
      toast({ title: "Evolução registrada" });
      setEvolucaoForm(EVOLUCAO_INICIAL);
      const e = await internacaoService.evolucoes.getByInternacao(selectedInternacao.id);
      setEvolucoes(e);
    } catch (err) {
      toast({
        title: "Erro ao criar evolução",
        description: err instanceof Error ? err.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [selectedInternacao, evolucaoForm, toast, professionalId, professionalError]);

  const stats = useMemo(() => {
    const total = mapa.length;
    const ocupados = mapa.filter((l) => l.tp_status === "OCUPADO").length;
    const livres = total - ocupados;
    const utiOcupados = mapa.filter(
      (l) => l.tp_status === "OCUPADO" && l.tp_leito.startsWith("UTI_"),
    ).length;
    return { total, ocupados, livres, utiOcupados };
  }, [mapa]);

  if (loading) return <LoadingState message="Carregando mapa de leitos..." />;
  if (error) return <ErrorState message={error} onRetry={carregar} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Internação Hospitalar"
        description="Mapa de leitos, prescrições e evoluções SOAP"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total de leitos</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Ocupados</p>
            <p className="text-2xl font-bold text-red-600">{stats.ocupados}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Livres</p>
            <p className="text-2xl font-bold text-green-600">{stats.livres}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">UTI ocupados</p>
            <p className="text-2xl font-bold text-orange-600">{stats.utiOcupados}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="mapa">
        <TabsList>
          <TabsTrigger value="mapa">
            <BedDouble className="h-4 w-4 mr-1" /> Mapa de Leitos
          </TabsTrigger>
          <TabsTrigger value="internacoes">
            <UserPlus className="h-4 w-4 mr-1" /> Internações ativas
            <Badge variant="secondary" className="ml-2">{internacoes.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mapa" className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
            {mapa.map((leito) => (
              <button
                key={leito.id}
                onClick={() => void abrirInternacao(leito)}
                aria-label={`Leito ${leito.nr_leito} ${leito.tp_status}`}
                className={`rounded-md border-2 p-3 text-left transition-all hover:scale-105 ${COR_LEITO[leito.tp_leito]} ${
                  leito.tp_status === "OCUPADO" ? "opacity-90" : ""
                }`}
              >
                <div className="text-xs font-medium uppercase">{leito.tp_leito.replace(/_/g, " ")}</div>
                <div className="text-lg font-bold">{leito.nr_leito}</div>
                <div className="text-[10px] mt-1 flex items-center gap-1">
                  {leito.tp_status === "OCUPADO" ? (
                    <>
                      <AlertCircle className="h-3 w-3" />
                      <span>Ocupado</span>
                    </>
                  ) : (
                    <span className="text-green-700">Livre</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {mapa.length === 0 && (
            <EmptyState
              icon={BedDouble}
              title="Nenhum leito cadastrado"
              description="Cadastre leitos na tela de Cadastros para visualizar o mapa."
            />
          )}
        </TabsContent>

        <TabsContent value="internacoes" className="space-y-2">
          {internacoes.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="Nenhuma internação ativa"
              description="Use a aba 'Mapa de Leitos' e clique em um leito livre para iniciar uma internação."
            />
          ) : (
            internacoes.map((i) => (
              <Card
                key={i.id}
                onClick={() => {
                  const leito = mapa.find((l) => l.id === i.cd_leito);
                  if (leito) void abrirInternacao(leito);
                }}
                className="cursor-pointer hover:shadow-md transition-shadow"
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">Paciente #{i.cd_paciente}</p>
                    <p className="text-xs text-muted-foreground">
                      Internado em {new Date(i.dt_internacao).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {selectedLeito && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>
              Leito {selectedLeito.nr_leito} — {selectedLeito.tp_status}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedLeito(null);
                setSelectedInternacao(null);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {selectedInternacao ? (
              <Tabs defaultValue="evolucao">
                <TabsList>
                  <TabsTrigger value="evolucao">Evolução</TabsTrigger>
                  <TabsTrigger value="prescricao">Prescrição</TabsTrigger>
                  <TabsTrigger value="historico">Histórico</TabsTrigger>
                </TabsList>

                <TabsContent value="evolucao" className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div>
                      <Label htmlFor="pa">PA (mmHg)</Label>
                      <Input
                        id="pa"
                        placeholder="120/80"
                        value={evolucaoForm.pa}
                        onChange={(e) => setEvolucaoForm((s) => ({ ...s, pa: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="fc">FC (bpm)</Label>
                      <Input
                        id="fc"
                        type="number"
                        value={evolucaoForm.fc}
                        onChange={(e) => setEvolucaoForm((s) => ({ ...s, fc: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="fr">FR (irpm)</Label>
                      <Input
                        id="fr"
                        type="number"
                        value={evolucaoForm.fr}
                        onChange={(e) => setEvolucaoForm((s) => ({ ...s, fr: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="t">T (°C)</Label>
                      <Input
                        id="t"
                        type="number"
                        step="0.1"
                        value={evolucaoForm.t}
                        onChange={(e) => setEvolucaoForm((s) => ({ ...s, t: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="spo2">SpO2 (%)</Label>
                      <Input
                        id="spo2"
                        type="number"
                        value={evolucaoForm.spo2}
                        onChange={(e) => setEvolucaoForm((s) => ({ ...s, spo2: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="subj">S — Subjetivo</Label>
                    <Textarea
                      id="subj"
                      rows={2}
                      value={evolucaoForm.ds_subjetivo}
                      onChange={(e) => setEvolucaoForm((s) => ({ ...s, ds_subjetivo: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="obj">O — Objetivo</Label>
                    <Textarea
                      id="obj"
                      rows={2}
                      value={evolucaoForm.ds_objetivo}
                      onChange={(e) => setEvolucaoForm((s) => ({ ...s, ds_objetivo: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="aval">A — Avaliação</Label>
                    <Textarea
                      id="aval"
                      rows={2}
                      value={evolucaoForm.ds_avaliacao}
                      onChange={(e) => setEvolucaoForm((s) => ({ ...s, ds_avaliacao: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="plano">P — Plano</Label>
                    <Textarea
                      id="plano"
                      rows={2}
                      value={evolucaoForm.ds_plano}
                      onChange={(e) => setEvolucaoForm((s) => ({ ...s, ds_plano: e.target.value }))}
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => void handleCriarEvolucao()}
                      disabled={saving || loadingProfessional || !professionalId}
                      title={!professionalId ? "Aguardando identificação do profissional..." : undefined}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      {loadingProfessional ? "Carregando..." : "Registrar Evolução"}
                    </Button>
                    <Button variant="outline" onClick={() => void handleDarAlta()}>
                      Dar Alta
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="prescricao" className="space-y-3">
                  <div>
                    <Label htmlFor="presc">Texto da prescrição</Label>
                    <Textarea
                      id="presc"
                      rows={6}
                      placeholder="1. Dipirona 1g IV 6/6h se dor ou T>38°C&#10;2. Soro fisiológico 1000ml EV 12/12h&#10;3. ..."
                      value={prescricaoForm.ds_prescricao}
                      onChange={(e) =>
                        setPrescricaoForm((s) => ({ ...s, ds_prescricao: e.target.value }))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="dieta">Dieta</Label>
                      <Input
                        id="dieta"
                        placeholder="Ex: Jejum, Geral, Pastosa..."
                        value={prescricaoForm.tp_dieta}
                        onChange={(e) => setPrescricaoForm((s) => ({ ...s, tp_dieta: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="cuidados">Cuidados</Label>
                      <Input
                        id="cuidados"
                        value={prescricaoForm.ds_cuidados}
                        onChange={(e) => setPrescricaoForm((s) => ({ ...s, ds_cuidados: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="obs">Observações</Label>
                    <Textarea
                      id="obs"
                      rows={2}
                      value={prescricaoForm.ds_observacoes}
                      onChange={(e) => setPrescricaoForm((s) => ({ ...s, ds_observacoes: e.target.value }))}
                    />
                  </div>
                  <Button
                    onClick={() => void handleCriarPrescricao()}
                    disabled={saving || loadingProfessional || !professionalId}
                    title={!professionalId ? "Aguardando identificação do profissional..." : undefined}
                  >
                    <Save className="h-4 w-4 mr-1" />
                    {loadingProfessional ? "Carregando..." : "Salvar Prescrição"}
                  </Button>
                </TabsContent>

                <TabsContent value="historico" className="space-y-3">
                  <div>
                    <h4 className="font-semibold mb-2">Prescrições anteriores</h4>
                    {prescricoes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma.</p>
                    ) : (
                      prescricoes.map((p) => (
                        <div key={p.id} className="text-sm border-l-2 pl-2 mb-2">
                          <p className="font-medium">
                            {new Date(p.dt_prescricao).toLocaleString("pt-BR")}
                          </p>
                          <pre className="whitespace-pre-wrap text-xs">{p.ds_prescricao}</pre>
                        </div>
                      ))
                    )}
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">Evoluções anteriores</h4>
                    {evolucoes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma.</p>
                    ) : (
                      evolucoes.map((e) => (
                        <div key={e.id} className="text-sm border-l-2 pl-2 mb-2">
                          <p className="font-medium">
                            {new Date(e.dt_evolucao).toLocaleString("pt-BR")}
                          </p>
                          {e.ds_subjetivo && <p><strong>S:</strong> {e.ds_subjetivo}</p>}
                          {e.ds_objetivo && <p><strong>O:</strong> {e.ds_objetivo}</p>}
                          {e.ds_avaliacao && <p><strong>A:</strong> {e.ds_avaliacao}</p>}
                          {e.ds_plano && <p><strong>P:</strong> {e.ds_plano}</p>}
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <p className="text-sm text-muted-foreground">
                Leito livre. Use a tela de Recepção/PA para internar um paciente.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
