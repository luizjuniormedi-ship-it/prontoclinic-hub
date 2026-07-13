/**
 * LabResultForm — Formulário de inserção de resultados
 *
 * - Header com dados do paciente e do exame
 * - Grid de parâmetros com valor de referência
 * - Input numérico com validação em tempo real
 * - Badge colorido (verde/amarelo/vermelho) com classificação
 * - Botão "Salvar e liberar" ou "Salvar (ainda não liberar)"
 *
 * Requisitos: WCAG AA (labels, aria-describedby, foco visível)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Save, Send, AlertTriangle, FlaskConical } from "lucide-react";
import {
  resultado,
  valorReferencia,
  classificar,
  type LabResultSecurePayload,
  type LabResultadoTipo,
  type ResultadoLab,
  type ValorReferencia,
} from "@/services/lisService";
import { useToast } from "@/components/ui/use-toast";

interface ParametrosState {
  ds_parametro: string;
  vl_resultado: string;
  ds_unidade: string;
  vl_minimo_referencia: string;
  vl_maximo_referencia: string;
  ds_observacao: string;
}

function createIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `lab-result-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resultadoBadge(tp: LabResultadoTipo | null): { label: string; cls: string } {
  switch (tp) {
    case "NORMAL": return { label: "Normal", cls: "bg-green-100 text-green-800 border-green-300" };
    case "BAIXO": return { label: "Baixo", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" };
    case "ALTO": return { label: "Alto", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" };
    case "CRITICO_BAIXO": return { label: "CRÍTICO BAIXO", cls: "bg-red-100 text-red-900 border-red-500 font-bold" };
    case "CRITICO_ALTO": return { label: "CRÍTICO ALTO", cls: "bg-red-100 text-red-900 border-red-500 font-bold" };
    case "INCONCLUSIVO": return { label: "Inconclusivo", cls: "bg-gray-100 text-gray-800 border-gray-300" };
    default: return { label: "—", cls: "bg-gray-50 text-gray-500 border-gray-200" };
  }
}

export interface LabResultFormProps {
  cdItemPedido: number;
  cdExame: number;
  userId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function LabResultForm({
  cdItemPedido,
  cdExame,
  onSaved,
  onCancel,
}: LabResultFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [parametros, setParametros] = useState<ParametrosState[]>([]);
  const [equipamento, setEquipamento] = useState("");
  const [loteReagente, setLoteReagente] = useState("");
  const [hl7Raw, setHl7Raw] = useState("");
  const pendingOperation = useRef<{
    fingerprint: string;
    idempotencyKey: string;
    expectedStatus: LabPedidoStatus;
  } | null>(null);

  // Carregar valores de referência do exame
  const { data: referencias } = useQuery({
    queryKey: ["lab-valor-referencia", cdExame],
    queryFn: () => valorReferencia.getByExame(cdExame),
    enabled: !!cdExame,
  });

  // Carregar resultados já existentes
  const { data: resultadosExistentes } = useQuery({
    queryKey: ["lab-resultado-item", cdItemPedido],
    queryFn: () => resultado.listarPorItem(cdItemPedido),
    enabled: !!cdItemPedido,
  });

  const {
    data: itemStatus,
    error: itemStatusError,
    isPending: isItemStatusPending,
    refetch: refetchItemStatus,
  } = useQuery({
    queryKey: ["lab-item-status", cdItemPedido],
    queryFn: () => resultado.obterStatusItem(cdItemPedido),
    enabled: !!cdItemPedido,
  });

  // Inicializar parâmetros a partir de referencias
  useEffect(() => {
    if (!referencias) return;
    if (parametros.length > 0) return; // já inicializado
    const inicial: ParametrosState[] = referencias.map((r: ValorReferencia) => ({
      ds_parametro: r.ds_parametro,
      vl_resultado: "",
      ds_unidade: r.ds_unidade ?? "",
      vl_minimo_referencia: r.vl_minimo?.toString() ?? "",
      vl_maximo_referencia: r.vl_maximo?.toString() ?? "",
      ds_observacao: "",
    }));
    setParametros(inicial.length > 0 ? inicial : [{
      ds_parametro: "Resultado",
      vl_resultado: "",
      ds_unidade: "",
      vl_minimo_referencia: "",
      vl_maximo_referencia: "",
      ds_observacao: "",
    }]);
  }, [referencias, parametros.length]);

  // Pré-popular com resultados existentes (modo edição)
  useEffect(() => {
    if (!resultadosExistentes || resultadosExistentes.length === 0) return;
    if (parametros.length === 0) return;
    setParametros((prev) =>
      prev.map((p) => {
        const existente = resultadosExistentes.find(
          (r: ResultadoLab) => r.ds_parametro === p.ds_parametro,
        );
        if (!existente) return p;
        return {
          ...p,
          vl_resultado: existente.vl_resultado?.toString() ?? existente.vl_resultado_texto ?? "",
          ds_unidade: existente.ds_unidade ?? p.ds_unidade,
          ds_observacao: existente.ds_observacao ?? "",
        };
      }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultadosExistentes]);

  // Calcular classificação em tempo real
  const classificacoes = useMemo<Array<{ idx: number; tipo: LabResultadoTipo | null }>>(() => {
    return parametros.map((p, idx) => {
      const v = p.vl_resultado === "" ? null : Number(p.vl_resultado);
      const min = p.vl_minimo_referencia === "" ? null : Number(p.vl_minimo_referencia);
      const max = p.vl_maximo_referencia === "" ? null : Number(p.vl_maximo_referencia);
      if (v === null || Number.isNaN(v)) return { idx, tipo: null };
      return { idx, tipo: classificar(v, min, max) };
    });
  }, [parametros]);

  const temCritico = classificacoes.some((c) =>
    c.tipo === "CRITICO_BAIXO" || c.tipo === "CRITICO_ALTO",
  );

  // Importar HL7
  const handleImportarHL7 = () => {
    if (!hl7Raw) return;
    // Importação dinâmica para evitar circular dep
    import("@/services/lisService").then(({ parseHL7 }) => {
      const parsed = parseHL7(hl7Raw);
      setParametros((prev) =>
        prev.map((p) => {
          const obx = parsed.obx_list.find(
            (o) => o.description === p.ds_parametro || o.code === p.ds_parametro,
          );
          if (!obx) return p;
          return {
            ...p,
            vl_resultado: obx.value,
            ds_unidade: obx.units || p.ds_unidade,
            vl_minimo_referencia: obx.reference_range.split("-")[0] || p.vl_minimo_referencia,
            vl_maximo_referencia: obx.reference_range.split("-")[1] || p.vl_maximo_referencia,
          };
        }),
      );
      toast({ title: `Importados ${parsed.obx_list.length} parâmetros HL7` });
    });
  };

  const salvar = useMutation({
    mutationFn: async (liberar: boolean) => {
      if (!itemStatus) throw new Error("Não foi possível confirmar o status atual do item");

      const rows: LabResultSecurePayload[] = parametros
        .filter((p) => p.ds_parametro && p.vl_resultado !== "")
        .map((p) => {
          const v = p.vl_resultado === "" ? null : Number(p.vl_resultado);
          const min = p.vl_minimo_referencia === "" ? null : Number(p.vl_minimo_referencia);
          const max = p.vl_maximo_referencia === "" ? null : Number(p.vl_maximo_referencia);
          return {
            ds_parametro: p.ds_parametro,
            vl_resultado: v,
            vl_resultado_texto: p.vl_resultado && Number.isNaN(Number(p.vl_resultado)) ? p.vl_resultado : null,
            ds_unidade: p.ds_unidade || null,
            vl_minimo_referencia: min,
            vl_maximo_referencia: max,
            tp_resultado: classificar(v, min, max),
            cd_equipamento: equipamento || null,
            cd_lote_reagente: loteReagente || null,
            ds_observacao: p.ds_observacao || null,
            ds_hl7_message: hl7Raw || null,
          };
        });
      if (rows.length === 0) throw new Error("Preencha ao menos um parâmetro");

      const requestFingerprint = JSON.stringify({ liberar, rows });
      let operation = pendingOperation.current;
      if (!operation || operation.fingerprint !== requestFingerprint) {
        operation = {
          fingerprint: requestFingerprint,
          idempotencyKey: createIdempotencyKey(),
          expectedStatus: itemStatus,
        };
        pendingOperation.current = operation;
      }

      return resultado.salvarSeguro({
        itemId: cdItemPedido,
        results: rows,
        release: liberar,
        expectedStatus: operation.expectedStatus,
        idempotencyKey: operation.idempotencyKey,
      });
    },
    onSuccess: (_, liberar) => {
      pendingOperation.current = null;
      queryClient.invalidateQueries({ queryKey: ["lab-resultado-item", cdItemPedido] });
      queryClient.invalidateQueries({ queryKey: ["lab-alertas-pendentes"] });
      queryClient.invalidateQueries({ queryKey: ["lab-pedidos"] });
      toast({
        title: liberar ? "Resultado salvo e liberado" : "Resultado salvo",
        description: temCritico
          ? "Valores críticos detectados. Alerta gerado automaticamente."
          : undefined,
      });
      onSaved();
    },
    onError: (e: Error) => {
      void refetchItemStatus();
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    },
  });

  const podeSalvar = itemStatus === "COLETADO" || itemStatus === "EM_ANALISE";
  const podeLiberar = itemStatus === "EM_ANALISE";

  return (
    <div className="space-y-4">
      {itemStatusError && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Erro ao carregar status do exame</AlertTitle>
          <AlertDescription>{(itemStatusError as Error).message}</AlertDescription>
        </Alert>
      )}
      {itemStatus && !podeSalvar && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Resultado não pode ser salvo</AlertTitle>
          <AlertDescription>O item está com status {itemStatus}.</AlertDescription>
        </Alert>
      )}
      {temCritico && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Valores críticos detectados</AlertTitle>
          <AlertDescription>
            Um alerta será gerado automaticamente para o médico responsável ao salvar.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            Equipamento / Reagente
          </CardTitle>
          <CardDescription>Metadados da análise</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="equipamento">Equipamento (ID)</Label>
              <Input
                id="equipamento"
                value={equipamento}
                onChange={(e) => setEquipamento(e.target.value)}
                placeholder="Ex: COBAS-6000"
              />
            </div>
            <div>
              <Label htmlFor="lote">Lote do reagente</Label>
              <Input
                id="lote"
                value={loteReagente}
                onChange={(e) => setLoteReagente(e.target.value)}
                placeholder="Lote"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parâmetros</CardTitle>
          <CardDescription>
            Classificação calculada em tempo real (NORMAL/BAIXO/ALTO/CRÍTICO)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {parametros.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Carregando parâmetros...
            </p>
          ) : (
            <div className="space-y-3">
              {parametros.map((p, idx) => {
                const c = classificacoes[idx];
                const b = resultadoBadge(c.tipo);
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-end border-b pb-3"
                  >
                    <div className="col-span-3">
                      <Label htmlFor={`param-${idx}`}>Parâmetro</Label>
                      <Input
                        id={`param-${idx}`}
                        value={p.ds_parametro}
                        onChange={(e) =>
                          setParametros((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, ds_parametro: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-2">
                      <Label htmlFor={`vl-${idx}`}>Valor</Label>
                      <Input
                        id={`vl-${idx}`}
                        type="number"
                        step="0.001"
                        value={p.vl_resultado}
                        onChange={(e) =>
                          setParametros((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, vl_resultado: e.target.value } : x,
                            ),
                          )
                        }
                        aria-describedby={`ref-${idx}`}
                      />
                    </div>
                    <div className="col-span-1">
                      <Label htmlFor={`un-${idx}`}>Un.</Label>
                      <Input
                        id={`un-${idx}`}
                        value={p.ds_unidade}
                        onChange={(e) =>
                          setParametros((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, ds_unidade: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-2">
                      <Label htmlFor={`min-${idx}`}>Mín.</Label>
                      <Input
                        id={`min-${idx}`}
                        type="number"
                        step="0.001"
                        value={p.vl_minimo_referencia}
                        onChange={(e) =>
                          setParametros((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? { ...x, vl_minimo_referencia: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-2">
                      <Label htmlFor={`max-${idx}`}>Máx.</Label>
                      <Input
                        id={`max-${idx}`}
                        type="number"
                        step="0.001"
                        value={p.vl_maximo_referencia}
                        onChange={(e) =>
                          setParametros((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? { ...x, vl_maximo_referencia: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-2 flex items-end">
                      <Badge className={b.cls} id={`ref-${idx}`}>
                        {b.label}
                      </Badge>
                    </div>
                    <div className="col-span-12">
                      <Label htmlFor={`obs-${idx}`}>Observação</Label>
                      <Input
                        id={`obs-${idx}`}
                        value={p.ds_observacao}
                        onChange={(e) =>
                          setParametros((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, ds_observacao: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar HL7 v2.5 (opcional)</CardTitle>
          <CardDescription>
            Cole uma mensagem ORU^R01 para preencher automaticamente
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={hl7Raw}
            onChange={(e) => setHl7Raw(e.target.value)}
            rows={4}
            placeholder="MSH|^~\\&|LAB|HOSP|...&#10;OBX|1|NM|GLICOSE^Glicose^L|||90|mg/dL|70-99|N|||F"
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleImportarHL7}
            className="mt-2"
            disabled={!hl7Raw}
          >
            Importar parâmetros
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          variant="outline"
          onClick={() => salvar.mutate(false)}
          disabled={salvar.isPending || isItemStatusPending || !podeSalvar}
        >
          <Save className="h-4 w-4 mr-2" />
          Salvar (não liberar)
        </Button>
        <Button
          onClick={() => salvar.mutate(true)}
          disabled={salvar.isPending || isItemStatusPending || !podeLiberar}
        >
          <Send className="h-4 w-4 mr-2" />
          Salvar e liberar
        </Button>
      </div>
    </div>
  );
}

