/**
 * DispenseWizard — Wizard de 3 passos para dispensar uma receita
 *
 * Passo 1: Buscar paciente (CPF ou nome)
 * Passo 2: Selecionar medicamentos (autocomplete) — usa FEFO
 * Passo 3: Confirmar e gerar recibo (texto simples)
 *
 * Performance: TanStack Query para buscar pacientes e medicamentos.
 * Acessibilidade: aria-live para anunciar passo, aria-labels em inputs.
 */

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Search, User, Pill, CheckCircle2, ChevronLeft, ChevronRight,
  Plus, Trash2, FileDown, Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { pharmacyService, type EstoqueAtual, type Medicamento, type DispensacaoItem } from "@/services/pharmacyService";

type Patient = { id: number; full_name: string; cpf: string | null; birth_date?: string | null };

type ItemSelecionado = DispensacaoItem & {
  ds_produto: string;
  ds_lote: string;
  dt_validade: string;
};

export function DispenseWizard() {
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [paciente, setPaciente] = useState<Patient | null>(null);
  const [itens, setItens] = useState<ItemSelecionado[]>([]);
  const [observacao, setObservacao] = useState("");
  const [searchPaciente, setSearchPaciente] = useState("");
  const [searchMedicamento, setSearchMedicamento] = useState("");
  const [medicamentoSelecionado, setMedicamentoSelecionado] = useState<Medicamento | null>(null);
  const [qtSolicitada, setQtSolicitada] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [sucessoMsg, setSucessoMsg] = useState<string | null>(null);
  const stepAnnounceRef = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();

  // Busca pacientes
  const { data: pacientes, isLoading: loadingPacientes } = useQuery({
    queryKey: ["search-pacientes", searchPaciente],
    queryFn: async () => {
      if (!searchPaciente || searchPaciente.length < 2) return [];
      const term = `%${searchPaciente}%`;
      const { data, error } = await supabase
        .from("patients")
        .select("id, full_name, cpf, birth_date")
        .or(`full_name.ilike.${term},cpf.ilike.${term}`)
        .limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as Patient[];
    },
    enabled: searchPaciente.length >= 2,
  });

  // Busca medicamentos
  const { data: medicamentos } = useQuery({
    queryKey: ["search-medicamentos", searchMedicamento],
    queryFn: () => pharmacyService.medicamentos.getAll({ search: searchMedicamento, ativo: true }),
    enabled: searchMedicamento.length >= 2,
  });

  // Busca lotes válidos (FEFO) do medicamento selecionado
  const { data: lotes, isLoading: loadingLotes } = useQuery({
    queryKey: ["lotes-validos", medicamentoSelecionado?.id],
    queryFn: () =>
      medicamentoSelecionado
        ? pharmacyService.lotes.getValidos(medicamentoSelecionado.id, "MEDICAMENTO")
        : Promise.resolve([] as EstoqueAtual[]),
    enabled: !!medicamentoSelecionado,
  });

  const criarDispensacao = useMutation({
    mutationFn: () => {
      if (!paciente) throw new Error("Paciente não selecionado");
      return pharmacyService.dispensacoes.create({
        cd_paciente: paciente.id,
        ds_observacao: observacao || null,
        itens: itens.map((i) => ({
          cd_lote: i.cd_lote,
          qt_dispensada: i.qt_dispensada,
          vl_unitario: i.vl_unitario ?? null,
        })),
      });
    },
    onSuccess: (d) => {
      setSucessoMsg(`Dispensação #${d.id} criada com sucesso!`);
      queryClient.invalidateQueries({ queryKey: ["dispensacoes"] });
      queryClient.invalidateQueries({ queryKey: ["estoque-atual"] });
      queryClient.invalidateQueries({ queryKey: ["movimentacoes"] });
      // Reset
      setPasso(1);
      setPaciente(null);
      setItens([]);
      setObservacao("");
      setSearchPaciente("");
      setMedicamentoSelecionado(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  // Anuncia mudança de passo (a11y)
  useEffect(() => {
    if (stepAnnounceRef.current) {
      const labels: Record<number, string> = {
        1: "Passo 1 de 3: buscar paciente",
        2: "Passo 2 de 3: selecionar medicamentos",
        3: "Passo 3 de 3: confirmar dispensação",
      };
      stepAnnounceRef.current.textContent = labels[passo] ?? "";
    }
  }, [passo]);

  function adicionarItem() {
    setError(null);
    if (!medicamentoSelecionado) {
      setError("Selecione um medicamento");
      return;
    }
    if (qtSolicitada <= 0) {
      setError("Quantidade deve ser maior que zero");
      return;
    }
    if (lotes && lotes.length > 0) {
      // FEFO: pega o primeiro lote com quantidade suficiente
      const lote = lotes.find((l) => l.qt_atual >= qtSolicitada);
      if (!lote) {
        setError(
          `Nenhum lote com quantidade suficiente. Disponível: ${lotes.map((l) => l.qt_atual).join(", ")}`,
        );
        return;
      }
      setItens((prev) => [
        ...prev,
        {
          cd_lote: lote.cd_lote,
          qt_dispensada: qtSolicitada,
          vl_unitario: lote.vl_custo_unitario ?? null,
          ds_produto: `${medicamentoSelecionado.cd_principio_ativo} ${medicamentoSelecionado.ds_concentracao ?? ""}`.trim(),
          ds_lote: String(lote.cd_lote),
          dt_validade: lote.dt_validade,
        },
      ]);
      setMedicamentoSelecionado(null);
      setSearchMedicamento("");
      setQtSolicitada(1);
    }
  }

  function removerItem(idx: number) {
    setItens((prev) => prev.filter((_, i) => i !== idx));
  }

  function gerarRecibo() {
    if (!paciente) return "";
    const data = new Date().toLocaleString("pt-BR");
    let recibo = `=== RECIBO DE DISPENSACAO ===\n`;
    recibo += `Data: ${data}\n`;
    recibo += `Paciente: ${paciente.full_name}\n`;
    if (paciente.cpf) recibo += `CPF: ${paciente.cpf}\n`;
    recibo += `\nItens dispensados:\n`;
    itens.forEach((it, i) => {
      recibo += `${i + 1}. ${it.ds_produto} — lote ${it.ds_lote} (val. ${new Date(it.dt_validade).toLocaleDateString("pt-BR")}) — ${it.qt_dispensada} un.\n`;
    });
    if (observacao) recibo += `\nObservacao: ${observacao}\n`;
    recibo += `\nAssinatura do paciente: ____________________\n`;
    recibo += `Assinatura do farmaceutico: ____________________\n`;
    return recibo;
  }

  function downloadRecibo() {
    const texto = gerarRecibo();
    const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dispensacao-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4" aria-live="polite">
      {/* Indicador de passos */}
      <div
        ref={stepAnnounceRef}
        className="sr-only"
        role="status"
        aria-live="polite"
      />
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                passo === n
                  ? "bg-primary text-primary-foreground"
                  : passo > n
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-200 text-gray-600"
              }`}
              aria-current={passo === n ? "step" : undefined}
            >
              {passo > n ? <CheckCircle2 className="h-4 w-4" /> : n}
            </div>
            <span className="text-sm font-medium">
              {n === 1 ? "Paciente" : n === 2 ? "Medicamentos" : "Confirmar"}
            </span>
            {n < 3 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {sucessoMsg && (
        <div role="status" className="rounded-md bg-green-100 p-3 text-sm text-green-800">
          {sucessoMsg}
        </div>
      )}

      {passo === 1 && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div>
              <Label htmlFor="search-paciente">Buscar paciente</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search-paciente"
                  placeholder="Digite nome ou CPF..."
                  value={searchPaciente}
                  onChange={(e) => setSearchPaciente(e.target.value)}
                  className="pl-8"
                  aria-label="Buscar paciente"
                />
              </div>
            </div>
            {loadingPacientes && (
              <p className="text-sm text-muted-foreground">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Buscando...
              </p>
            )}
            {pacientes && pacientes.length > 0 && (
              <ul className="divide-y rounded border">
                {pacientes.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPaciente(p)}
                      className={`flex w-full items-center gap-3 p-2 text-left hover:bg-accent ${
                        paciente?.id === p.id ? "bg-accent" : ""
                      }`}
                    >
                      <User className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="font-medium">{p.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          CPF: {p.cpf ?? "—"}
                          {p.birth_date && ` • Nasc.: ${new Date(p.birth_date).toLocaleDateString("pt-BR")}`}
                        </div>
                      </div>
                      {paciente?.id === p.id && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {paciente && (
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-sm">
                  <strong>Selecionado:</strong> {paciente.full_name}
                </p>
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setPasso(2)} disabled={!paciente}>
                Próximo <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {passo === 2 && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div>
              <Label htmlFor="search-medicamento">Adicionar medicamento</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search-medicamento"
                  placeholder="Buscar medicamento..."
                  value={searchMedicamento}
                  onChange={(e) => setSearchMedicamento(e.target.value)}
                  className="pl-8"
                  aria-label="Buscar medicamento"
                />
              </div>
            </div>
            {medicamentos && medicamentos.length > 0 && (
              <ul className="max-h-48 divide-y overflow-y-auto rounded border">
                {medicamentos.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setMedicamentoSelecionado(m)}
                      className={`flex w-full items-center gap-2 p-2 text-left text-sm hover:bg-accent ${
                        medicamentoSelecionado?.id === m.id ? "bg-accent" : ""
                      }`}
                    >
                      <Pill className="h-3.5 w-3.5" />
                      <div className="flex-1">
                        <div className="font-medium">{m.cd_principio_ativo} {m.ds_concentracao}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.cd_nome_comercial ?? "—"} • {m.ds_forma_farmaceutica}
                        </div>
                      </div>
                      {m.lg_controlado && <Badge variant="destructive">Controlado</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {medicamentoSelecionado && (
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-sm font-medium">
                  {medicamentoSelecionado.cd_principio_ativo} {medicamentoSelecionado.ds_concentracao}
                </p>
                {loadingLotes ? (
                  <p className="text-xs text-muted-foreground">Carregando lotes...</p>
                ) : lotes && lotes.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium">Lotes disponíveis (FEFO):</p>
                    {lotes.map((l) => (
                      <div
                        key={l.cd_lote}
                        className="flex items-center justify-between text-xs"
                      >
                        <span>
                          Lote {l.cd_lote} • Val. {new Date(l.dt_validade).toLocaleDateString("pt-BR")}
                        </span>
                        <Badge variant="outline">{l.qt_atual} disp.</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">Sem estoque disponível.</p>
                )}
                <div className="mt-2 flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor="qt">Quantidade</Label>
                    <Input
                      id="qt"
                      type="number"
                      min={1}
                      value={qtSolicitada}
                      onChange={(e) => setQtSolicitada(Number(e.target.value))}
                    />
                  </div>
                  <Button onClick={adicionarItem}>
                    <Plus className="mr-1 h-4 w-4" />Adicionar
                  </Button>
                </div>
              </div>
            )}

            {itens.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Itens da dispensação</h3>
                <ul className="space-y-1">
                  {itens.map((it, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between rounded border p-2 text-sm"
                    >
                      <div>
                        <div className="font-medium">{it.ds_produto}</div>
                        <div className="text-xs text-muted-foreground">
                          Lote {it.ds_lote} • Val. {new Date(it.dt_validade).toLocaleDateString("pt-BR")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>{it.qt_dispensada} un.</Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removerItem(idx)}
                          aria-label={`Remover ${it.ds_produto}`}
                          title="Remover item"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <Label htmlFor="observacao">Observação (opcional)</Label>
              <Textarea
                id="observacao"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setPasso(1)}>
                <ChevronLeft className="mr-1 h-4 w-4" />Voltar
              </Button>
              <Button onClick={() => setPasso(3)} disabled={itens.length === 0}>
                Revisar <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {passo === 3 && paciente && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="rounded-md bg-muted/40 p-3">
              <h3 className="font-semibold">Resumo da Dispensação</h3>
              <p className="text-sm"><strong>Paciente:</strong> {paciente.full_name}</p>
              <p className="text-sm"><strong>CPF:</strong> {paciente.cpf ?? "—"}</p>
              <p className="text-sm"><strong>Itens:</strong> {itens.length}</p>
              {observacao && <p className="text-sm"><strong>Observação:</strong> {observacao}</p>}
            </div>

            <ul className="space-y-1 text-sm">
              {itens.map((it, idx) => (
                <li key={idx} className="flex justify-between border-b py-1">
                  <span>{it.ds_produto} (lote {it.ds_lote})</span>
                  <span className="font-semibold">{it.qt_dispensada} un.</span>
                </li>
              ))}
            </ul>

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setPasso(2)}>
                <ChevronLeft className="mr-1 h-4 w-4" />Voltar
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={downloadRecibo}>
                  <FileDown className="mr-1 h-4 w-4" />Baixar Recibo
                </Button>
                <Button
                  onClick={() => criarDispensacao.mutate()}
                  disabled={criarDispensacao.isPending}
                >
                  {criarDispensacao.isPending ? (
                    <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Processando...</>
                  ) : (
                    <><CheckCircle2 className="mr-1 h-4 w-4" />Confirmar Dispensação</>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
