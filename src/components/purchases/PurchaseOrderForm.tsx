/**
 * PurchaseOrderForm — Formulário de criação de Ordem de Compra.
 *
 * Permite selecionar fornecedor, adicionar múltiplos itens com
 * quantidade e valor unitário, e calcular total automaticamente.
 *
 * Decisões:
 *   - Lista de itens controlada por estado local (adicção/remoção dinâmica).
 *   - Cálculo de total feito no cliente para feedback em tempo real,
 *     mas o valor final é enviado ao backend e validado pelo schema Zod.
 *   - Usa Sheet (drawer lateral) para minimizar mudança de contexto.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Trash2, Plus } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { fornecedoresService, ordensCompraService, type Fornecedor, tpProdutoEnum } from "@/services/purchasesService";

type ItemForm = {
  ds_produto: string;
  qt_solicitada: number;
  vl_unitario: number;
  cd_produto_tipo: z.infer<typeof tpProdutoEnum>;
};

interface Props {
  onClose: () => void;
  onCreated?: () => void;
}

export function PurchaseOrderForm({ onClose, onCreated }: Props) {
  const [nrOrdem, setNrOrdem] = useState<string>(`OC-${Date.now()}`);
  const [fornecedorId, setFornecedorId] = useState<string>("");
  const [previsaoEntrega, setPrevisaoEntrega] = useState<string>("");
  const [pagamento, setPagamento] = useState<string>("BOLETO");
  const [condicaoPagto, setCondicaoPagto] = useState<string>("");
  const [observacoes, setObservacoes] = useState<string>("");
  const [itens, setItens] = useState<ItemForm[]>([{ ds_produto: "", qt_solicitada: 1, vl_unitario: 0, cd_produto_tipo: "MATERIAL" }]);
  const { toast } = useToast();

  const { data: fornecedores } = useQuery({
    queryKey: ["fornecedores-ativos"],
    queryFn: () => fornecedoresService.getAll({ ativo: true }),
  });

  const totalGeral = useMemo(
    () => itens.reduce((acc, it) => acc + it.qt_solicitada * it.vl_unitario, 0),
    [itens],
  );

  const criarMut = useMutation({
    mutationFn: ordensCompraService.create,
    onSuccess: () => {
      toast({ title: "Ordem de compra criada" });
      onCreated?.();
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao criar OC", description: err.message, variant: "destructive" });
    },
  });

  const adicionarItem = () =>
    setItens([...itens, { ds_produto: "", qt_solicitada: 1, vl_unitario: 0, cd_produto_tipo: "MATERIAL" }]);

  const removerItem = (idx: number) =>
    setItens(itens.filter((_, i) => i !== idx));

  const atualizarItem = (idx: number, campo: keyof ItemForm, valor: string | number) =>
    setItens(itens.map((it, i) => (i === idx ? { ...it, [campo]: valor } : it)));

  const handleSubmit = () => {
    if (!fornecedorId) {
      toast({ title: "Selecione um fornecedor", variant: "destructive" });
      return;
    }
    if (itens.length === 0 || itens.some((i) => !i.ds_produto || i.qt_solicitada <= 0)) {
      toast({ title: "Preencha todos os itens", variant: "destructive" });
      return;
    }
    criarMut.mutate({
      nr_ordem: nrOrdem,
      cd_fornecedor: Number(fornecedorId),
      dt_previsao_entrega: previsaoEntrega || null,
      vl_total: totalGeral,
      tp_pagamento: pagamento as "BOLETO" | "PIX" | "CARTAO" | "TRANSFERENCIA" | "DINHEIRO",
      cd_condicao_pagto: condicaoPagto || null,
      ds_observacoes: observacoes || null,
      tp_status: "PENDENTE",
      itens: itens.map((it) => ({
        ds_produto: it.ds_produto,
        qt_solicitada: it.qt_solicitada,
        qt_recebida: 0,
        vl_unitario: it.vl_unitario,
        vl_total: it.qt_solicitada * it.vl_unitario,
        cd_produto_tipo: it.cd_produto_tipo,
      })),
    });
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Nova Ordem de Compra</SheetTitle>
          <SheetDescription>Preencha os dados da OC e adicione os itens.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Número da OC</Label>
              <Input value={nrOrdem} onChange={(e) => setNrOrdem(e.target.value)} />
            </div>
            <div>
              <Label>Fornecedor *</Label>
              <Select value={fornecedorId} onValueChange={setFornecedorId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(fornecedores ?? []).map((f: Fornecedor) => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.nm_razao_social}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Previsão de Entrega</Label>
              <Input type="date" value={previsaoEntrega} onChange={(e) => setPrevisaoEntrega(e.target.value)} />
            </div>
            <div>
              <Label>Forma de Pagamento</Label>
              <Select value={pagamento} onValueChange={setPagamento}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BOLETO">Boleto</SelectItem>
                  <SelectItem value="PIX">PIX</SelectItem>
                  <SelectItem value="CARTAO">Cartão</SelectItem>
                  <SelectItem value="TRANSFERENCIA">Transferência</SelectItem>
                  <SelectItem value="DINHEIRO">Dinheiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Condição de Pagamento</Label>
            <Input value={condicaoPagto} onChange={(e) => setCondicaoPagto(e.target.value)} placeholder="Ex: 30/60/90 dias" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Itens</Label>
              <Button size="sm" variant="outline" onClick={adicionarItem}>
                <Plus className="h-3 w-3 mr-1" />Item
              </Button>
            </div>
            <div className="space-y-2">
              {itens.map((it, idx) => (
                <div key={idx} className="flex gap-2 items-end p-2 border rounded">
                  <div className="flex-1">
                    <Input
                      placeholder="Descrição do produto"
                      value={it.ds_produto}
                      onChange={(e) => atualizarItem(idx, "ds_produto", e.target.value)}
                    />
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      min={1}
                      placeholder="Qt"
                      value={it.qt_solicitada}
                      onChange={(e) => atualizarItem(idx, "qt_solicitada", Number(e.target.value))}
                    />
                  </div>
                  <div className="w-28">
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      placeholder="Vl Unit"
                      value={it.vl_unitario}
                      onChange={(e) => atualizarItem(idx, "vl_unitario", Number(e.target.value))}
                    />
                  </div>
                  <div className="w-32 text-right font-mono text-sm">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(it.qt_solicitada * it.vl_unitario)}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removerItem(idx)} disabled={itens.length === 1}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>Observações</Label>
            <Input value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </div>

          <div className="flex justify-between items-center p-3 bg-muted rounded">
            <span className="font-medium">Total Geral</span>
            <span className="text-xl font-bold font-mono">
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalGeral)}
            </span>
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={criarMut.isPending}>
            {criarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Criar OC
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}