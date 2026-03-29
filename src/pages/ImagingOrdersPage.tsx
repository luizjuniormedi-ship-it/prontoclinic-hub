import { useEffect, useState } from "react";
import { FileImage, Plus, Search, Send, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { imagingOrdersService, imagingOrderItemsService, worklistQueueService } from "@/services/dicomService";
import { supabase } from "@/lib/supabase";
import type { ImagingOrder, ImagingOrderItem, ImagingOrderStatus } from "@/types/dicom";
import { imagingStatusLabels, imagingStatusColors, priorityLabels, priorityColors } from "@/types/dicom";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const MODALITY_TYPES = ['CR','CT','MR','US','DX','XA','MG','PT','NM','RF'];

export default function ImagingOrdersPage() {
  const [orders, setOrders] = useState<ImagingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<ImagingOrder | null>(null);
  const [detailItems, setDetailItems] = useState<ImagingOrderItem[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);

  // New order form
  const [patients, setPatients] = useState<any[]>([]);
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [form, setForm] = useState({ patient_id: '', requesting_physician_id: '', clinical_indication: '', priority: 'normal', notes: '' });
  const [itemForm, setItemForm] = useState({ exam_name: '', modality_type: 'CR', body_part: '', contrast_required: false, scheduled_date: '', scheduled_time: '' });

  const load = () => {
    setLoading(true);
    imagingOrdersService.list({ status: statusFilter !== 'all' ? statusFilter : undefined })
      .then(setOrders)
      .catch(() => toast({ title: "Erro ao carregar pedidos", variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter]);

  const loadLookups = async () => {
    const [p, pr] = await Promise.all([
      supabase.from('patients').select('id, full_name').order('full_name').limit(200),
      supabase.from('professionals').select('id, full_name').order('full_name').limit(100),
    ]);
    setPatients(p.data || []);
    setProfessionals(pr.data || []);
  };

  const openNew = () => {
    setForm({ patient_id: '', requesting_physician_id: '', clinical_indication: '', priority: 'normal', notes: '' });
    setItemForm({ exam_name: '', modality_type: 'CR', body_part: '', contrast_required: false, scheduled_date: '', scheduled_time: '' });
    loadLookups();
    setDialogOpen(true);
  };

  const createOrder = async () => {
    if (!form.patient_id || !itemForm.exam_name) {
      toast({ title: "Paciente e exame são obrigatórios", variant: "destructive" });
      return;
    }
    try {
      const order = await imagingOrdersService.create({
        patient_id: form.patient_id,
        requesting_physician_id: form.requesting_physician_id || undefined,
        clinical_indication: form.clinical_indication,
        priority: form.priority as any,
        notes: form.notes,
      });

      const scheduledDatetime = itemForm.scheduled_date && itemForm.scheduled_time
        ? `${itemForm.scheduled_date}T${itemForm.scheduled_time}:00`
        : undefined;

      await imagingOrderItemsService.create({
        imaging_order_id: order.id,
        exam_name: itemForm.exam_name,
        modality_type: itemForm.modality_type,
        body_part: itemForm.body_part || undefined,
        contrast_required: itemForm.contrast_required,
        scheduled_date: itemForm.scheduled_date || undefined,
        scheduled_time: itemForm.scheduled_time || undefined,
        scheduled_datetime: scheduledDatetime,
      });

      toast({ title: "Pedido de exame criado com sucesso" });
      setDialogOpen(false);
      load();
    } catch {
      toast({ title: "Erro ao criar pedido", variant: "destructive" });
    }
  };

  const openDetail = async (order: ImagingOrder) => {
    setDetailOrder(order);
    const items = await imagingOrderItemsService.listByOrder(order.id);
    setDetailItems(items);
    setDetailOpen(true);
  };

  const releaseToWorklist = async (item: ImagingOrderItem, order: ImagingOrder) => {
    try {
      const { data: patient } = await supabase.from('patients').select('id, full_name, birth_date, sex, cpf').eq('id', order.patient_id).single();
      if (!patient) throw new Error("Patient not found");

      await worklistQueueService.createFromOrderItem(item, order, patient);
      toast({ title: "Item liberado para worklist" });
      // Refresh
      const items = await imagingOrderItemsService.listByOrder(order.id);
      setDetailItems(items);
      load();
    } catch {
      toast({ title: "Erro ao liberar para worklist", variant: "destructive" });
    }
  };

  const filtered = orders.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return o.patient_name?.toLowerCase().includes(q) || o.accession_number.toLowerCase().includes(q);
  });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Pedidos de Exame de Imagem" description="Requisições de exames vinculadas a pacientes e agendamentos" actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Novo Pedido</Button>} />

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente ou accession..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(imagingStatusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? <EmptyState icon={FileImage} title="Nenhum pedido de exame" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Accession</TableHead><TableHead>Paciente</TableHead><TableHead>Solicitante</TableHead>
              <TableHead>Prioridade</TableHead><TableHead>Status</TableHead><TableHead>Data</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.accession_number}</TableCell>
                  <TableCell className="font-medium text-sm">{o.patient_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.physician_name || o.referring_physician_name || '—'}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${priorityColors[o.priority]}`}>{priorityLabels[o.priority]}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${imagingStatusColors[o.status]}`}>{imagingStatusLabels[o.status]}</Badge></TableCell>
                  <TableCell className="text-xs">{formatDate(o.created_at)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => openDetail(o)}><Eye className="h-3 w-3 mr-1" />Detalhes</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* New Order Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Novo Pedido de Exame de Imagem</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2 max-h-[60vh] overflow-y-auto">
            <div><Label>Paciente *</Label>
              <Select value={form.patient_id} onValueChange={(v) => setForm({ ...form, patient_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{patients.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Médico Solicitante</Label>
              <Select value={form.requesting_physician_id} onValueChange={(v) => setForm({ ...form, requesting_physician_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{professionals.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Indicação Clínica</Label><Textarea value={form.clinical_indication} onChange={(e) => setForm({ ...form, clinical_indication: e.target.value })} /></div>
            <div><Label>Prioridade</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(priorityLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <hr />
            <p className="text-sm font-semibold">Exame</p>
            <div><Label>Nome do Exame *</Label><Input value={itemForm.exam_name} onChange={(e) => setItemForm({ ...itemForm, exam_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Modalidade</Label>
                <Select value={itemForm.modality_type} onValueChange={(v) => setItemForm({ ...itemForm, modality_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MODALITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Região</Label><Input value={itemForm.body_part} onChange={(e) => setItemForm({ ...itemForm, body_part: e.target.value })} placeholder="Tórax, Crânio..." /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Data</Label><Input type="date" value={itemForm.scheduled_date} onChange={(e) => setItemForm({ ...itemForm, scheduled_date: e.target.value })} /></div>
              <div><Label>Hora</Label><Input type="time" value={itemForm.scheduled_time} onChange={(e) => setItemForm({ ...itemForm, scheduled_time: e.target.value })} /></div>
            </div>
            <div><Label>Notas</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={createOrder}>Criar Pedido</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Pedido {detailOrder?.accession_number}</DialogTitle></DialogHeader>
          {detailOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Paciente:</span> <strong>{detailOrder.patient_name}</strong></div>
                <div><span className="text-muted-foreground">Solicitante:</span> {detailOrder.physician_name || '—'}</div>
                <div><span className="text-muted-foreground">Indicação:</span> {detailOrder.clinical_indication || '—'}</div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className={`border-0 text-[10px] ${imagingStatusColors[detailOrder.status]}`}>{imagingStatusLabels[detailOrder.status]}</Badge></div>
              </div>

              <div className="rounded-lg border overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Exame</TableHead><TableHead>Modalidade</TableHead><TableHead>Região</TableHead>
                    <TableHead>Data/Hora</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {detailItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium text-sm">{item.exam_name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{item.modality_type}</Badge></TableCell>
                        <TableCell className="text-xs">{item.body_part || '—'}</TableCell>
                        <TableCell className="text-xs">{item.scheduled_date ? `${item.scheduled_date} ${item.scheduled_time || ''}` : '—'}</TableCell>
                        <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${imagingStatusColors[item.status]}`}>{imagingStatusLabels[item.status]}</Badge></TableCell>
                        <TableCell>
                          {item.status === 'agendado' && (
                            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => releaseToWorklist(item, detailOrder)}>
                              <Send className="h-3 w-3 mr-1" />Liberar WL
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
