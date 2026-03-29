import { useEffect, useState } from "react";
import { FileImage, Plus, Search, Send, Eye, X, ListPlus, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { imagingOrdersService, imagingOrderItemsService, worklistQueueService } from "@/services/dicomService";
import { dicomIntegrationService } from "@/services/dicomIntegrationService";
import { supabase } from "@/lib/supabase";
import type { ImagingOrder, ImagingOrderItem } from "@/types/dicom";
import { imagingStatusLabels, imagingStatusColors, priorityLabels, priorityColors } from "@/types/dicom";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const MODALITY_TYPES = ['CR','CT','MR','US','DX','XA','MG','PT','NM','RF','OT'];

interface NewItemForm {
  exam_name: string;
  modality_type: string;
  body_part: string;
  laterality: string;
  contrast_required: boolean;
  station_aetitle: string;
  scheduled_date: string;
  scheduled_time: string;
}

const emptyItemForm = (): NewItemForm => ({
  exam_name: '', modality_type: 'CR', body_part: '', laterality: '',
  contrast_required: false, station_aetitle: '', scheduled_date: '', scheduled_time: '',
});

export default function ImagingOrdersPage() {
  const [orders, setOrders] = useState<ImagingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<ImagingOrder | null>(null);
  const [detailItems, setDetailItems] = useState<ImagingOrderItem[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Lookups
  const [patients, setPatients] = useState<any[]>([]);
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);

  // New order form
  const [form, setForm] = useState({
    patient_id: '', requesting_physician_id: '', clinical_indication: '',
    priority: 'normal', notes: '', scheduling_id: '',
  });
  const [itemForms, setItemForms] = useState<NewItemForm[]>([emptyItemForm()]);
  const [newItemForm, setNewItemForm] = useState<NewItemForm>(emptyItemForm());

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

  // Load appointments when patient changes
  const loadAppointments = async (patientId: string) => {
    if (!patientId) { setAppointments([]); return; }
    const { data } = await supabase
      .from('appointments')
      .select('id, appointment_date, start_time, status, professionals(full_name)')
      .eq('patient_id', patientId)
      .in('status', ['scheduled', 'confirmed', 'in_progress'])
      .order('appointment_date', { ascending: false })
      .limit(20);
    setAppointments(data || []);
  };

  const openNew = () => {
    setForm({ patient_id: '', requesting_physician_id: '', clinical_indication: '', priority: 'normal', notes: '', scheduling_id: '' });
    setItemForms([emptyItemForm()]);
    setAppointments([]);
    loadLookups();
    setDialogOpen(true);
  };

  const addItemRow = () => setItemForms([...itemForms, emptyItemForm()]);
  const removeItemRow = (idx: number) => {
    if (itemForms.length <= 1) return;
    setItemForms(itemForms.filter((_, i) => i !== idx));
  };
  const updateItemRow = (idx: number, field: string, value: any) => {
    setItemForms(itemForms.map((f, i) => i === idx ? { ...f, [field]: value } : f));
  };

  const createOrder = async () => {
    if (!form.patient_id) { toast({ title: "Selecione um paciente", variant: "destructive" }); return; }
    const validItems = itemForms.filter(f => f.exam_name.trim());
    if (validItems.length === 0) { toast({ title: "Adicione pelo menos um exame", variant: "destructive" }); return; }

    setSaving(true);
    try {
      // Find physician name for referring field
      const physician = professionals.find(p => p.id === form.requesting_physician_id);

      const order = await imagingOrdersService.create({
        patient_id: form.patient_id,
        requesting_physician_id: form.requesting_physician_id || undefined,
        referring_physician_name: physician?.full_name,
        clinical_indication: form.clinical_indication,
        priority: form.priority as any,
        notes: form.notes,
        scheduling_id: form.scheduling_id || undefined,
      });

      // Create all items
      for (const itemForm of validItems) {
        const scheduledDatetime = itemForm.scheduled_date && itemForm.scheduled_time
          ? `${itemForm.scheduled_date}T${itemForm.scheduled_time}:00`
          : undefined;

        await imagingOrderItemsService.create({
          imaging_order_id: order.id,
          exam_name: itemForm.exam_name,
          modality_type: itemForm.modality_type,
          body_part: itemForm.body_part || undefined,
          laterality: itemForm.laterality as any || undefined,
          contrast_required: itemForm.contrast_required,
          station_aetitle: itemForm.station_aetitle || undefined,
          scheduled_date: itemForm.scheduled_date || undefined,
          scheduled_time: itemForm.scheduled_time || undefined,
          scheduled_datetime: scheduledDatetime,
        });
      }

      toast({ title: `Pedido criado com ${validItems.length} exame(s)` });
      setDialogOpen(false);
      load();
    } catch {
      toast({ title: "Erro ao criar pedido", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (order: ImagingOrder) => {
    setDetailOrder(order);
    try {
      const items = await imagingOrderItemsService.listByOrder(order.id);
      setDetailItems(items);
    } catch {
      setDetailItems([]);
    }
    setDetailOpen(true);
  };

  const releaseToWorklist = async (item: ImagingOrderItem, order: ImagingOrder) => {
    try {
      const { data: patient } = await supabase
        .from('patients').select('id, full_name, birth_date, sex, cpf')
        .eq('id', order.patient_id).single();
      if (!patient) throw new Error("Paciente não encontrado");

      await worklistQueueService.createFromOrderItem(item, order, patient);
      await dicomIntegrationService.syncOrderStatus(order.id);
      toast({ title: "Item liberado para worklist" });

      const items = await imagingOrderItemsService.listByOrder(order.id);
      setDetailItems(items);
      load();
    } catch {
      toast({ title: "Erro ao liberar para worklist", variant: "destructive" });
    }
  };

  const releaseAllToWorklist = async (order: ImagingOrder) => {
    const eligible = detailItems.filter(i => i.status === 'agendado');
    if (eligible.length === 0) { toast({ title: "Nenhum item elegível para liberação" }); return; }

    try {
      const { data: patient } = await supabase
        .from('patients').select('id, full_name, birth_date, sex, cpf')
        .eq('id', order.patient_id).single();
      if (!patient) throw new Error("Paciente não encontrado");

      for (const item of eligible) {
        await worklistQueueService.createFromOrderItem(item, order, patient);
      }
      await dicomIntegrationService.syncOrderStatus(order.id);
      toast({ title: `${eligible.length} item(ns) liberado(s) para worklist` });

      const items = await imagingOrderItemsService.listByOrder(order.id);
      setDetailItems(items);
      load();
    } catch {
      toast({ title: "Erro ao liberar itens", variant: "destructive" });
    }
  };

  const cancelOrder = async (order: ImagingOrder) => {
    if (!confirm("Cancelar este pedido e todos os seus itens? Esta ação removerá itens da worklist.")) return;
    try {
      await dicomIntegrationService.cancelOrder(order.id);
      toast({ title: "Pedido cancelado" });
      setDetailOpen(false);
      load();
    } catch {
      toast({ title: "Erro ao cancelar pedido", variant: "destructive" });
    }
  };

  const addItemToOrder = async () => {
    if (!detailOrder || !newItemForm.exam_name.trim()) {
      toast({ title: "Nome do exame obrigatório", variant: "destructive" });
      return;
    }
    try {
      const scheduledDatetime = newItemForm.scheduled_date && newItemForm.scheduled_time
        ? `${newItemForm.scheduled_date}T${newItemForm.scheduled_time}:00` : undefined;

      await imagingOrderItemsService.create({
        imaging_order_id: detailOrder.id,
        exam_name: newItemForm.exam_name,
        modality_type: newItemForm.modality_type,
        body_part: newItemForm.body_part || undefined,
        laterality: newItemForm.laterality as any || undefined,
        contrast_required: newItemForm.contrast_required,
        station_aetitle: newItemForm.station_aetitle || undefined,
        scheduled_date: newItemForm.scheduled_date || undefined,
        scheduled_time: newItemForm.scheduled_time || undefined,
        scheduled_datetime: scheduledDatetime,
      });

      toast({ title: "Exame adicionado ao pedido" });
      setAddItemOpen(false);
      setNewItemForm(emptyItemForm());
      const items = await imagingOrderItemsService.listByOrder(detailOrder.id);
      setDetailItems(items);
    } catch {
      toast({ title: "Erro ao adicionar exame", variant: "destructive" });
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
      <PageHeader title="Pedidos de Exame de Imagem" description="Requisições vinculadas a pacientes, agendamentos e worklist DICOM" actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Novo Pedido</Button>} />

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

      {filtered.length === 0 ? <EmptyState icon={FileImage} title="Nenhum pedido de exame" description="Crie um pedido de exame de imagem para iniciar o fluxo de worklist e PACS." /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Accession</TableHead><TableHead>Paciente</TableHead><TableHead>Solicitante</TableHead>
              <TableHead>Prioridade</TableHead><TableHead>Status</TableHead><TableHead>Data</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.id} className={o.status === 'cancelado' ? 'opacity-50' : ''}>
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

      {/* ── New Order Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Pedido de Exame de Imagem</DialogTitle>
            <DialogDescription>Crie um pedido com um ou mais exames. Cada exame será um item individual na worklist.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {/* Patient */}
            <div><Label>Paciente *</Label>
              <Select value={form.patient_id} onValueChange={(v) => { setForm({ ...form, patient_id: v, scheduling_id: '' }); loadAppointments(v); }}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{patients.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Link to appointment */}
            {appointments.length > 0 && (
              <div><Label className="flex items-center gap-1"><Link className="h-3 w-3" />Vincular a Agendamento</Label>
                <Select value={form.scheduling_id} onValueChange={(v) => setForm({ ...form, scheduling_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Opcional..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Nenhum</SelectItem>
                    {appointments.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.appointment_date} {a.start_time} — {a.professionals?.full_name || 'Prof.'} ({a.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Médico Solicitante</Label>
                <Select value={form.requesting_physician_id} onValueChange={(v) => setForm({ ...form, requesting_physician_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>{professionals.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Prioridade</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(priorityLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Indicação Clínica</Label><Textarea value={form.clinical_indication} onChange={(e) => setForm({ ...form, clinical_indication: e.target.value })} /></div>

            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Exames ({itemForms.length})</p>
              <Button type="button" size="sm" variant="outline" onClick={addItemRow}><Plus className="h-3 w-3 mr-1" />Adicionar Exame</Button>
            </div>

            {itemForms.map((item, idx) => (
              <div key={idx} className="rounded-lg border p-3 space-y-3 relative">
                {itemForms.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" className="absolute top-1 right-1 h-6 w-6 p-0" onClick={() => removeItemRow(idx)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
                <p className="text-xs font-medium text-muted-foreground">Exame {idx + 1}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Nome do Exame *</Label><Input value={item.exam_name} onChange={(e) => updateItemRow(idx, 'exam_name', e.target.value)} placeholder="Raio-X Tórax PA/Perfil" /></div>
                  <div><Label className="text-xs">Modalidade</Label>
                    <Select value={item.modality_type} onValueChange={(v) => updateItemRow(idx, 'modality_type', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{MODALITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label className="text-xs">Região</Label><Input value={item.body_part} onChange={(e) => updateItemRow(idx, 'body_part', e.target.value)} placeholder="Tórax" /></div>
                  <div><Label className="text-xs">Lateralidade</Label>
                    <Select value={item.laterality} onValueChange={(v) => updateItemRow(idx, 'laterality', v)}>
                      <SelectTrigger><SelectValue placeholder="N/A" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="na">N/A</SelectItem>
                        <SelectItem value="left">Esquerdo</SelectItem>
                        <SelectItem value="right">Direito</SelectItem>
                        <SelectItem value="bilateral">Bilateral</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">AE Title Estação</Label><Input value={item.station_aetitle} onChange={(e) => updateItemRow(idx, 'station_aetitle', e.target.value.toUpperCase())} className="font-mono" placeholder="CR_SALA1" /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label className="text-xs">Data</Label><Input type="date" value={item.scheduled_date} onChange={(e) => updateItemRow(idx, 'scheduled_date', e.target.value)} /></div>
                  <div><Label className="text-xs">Hora</Label><Input type="time" value={item.scheduled_time} onChange={(e) => updateItemRow(idx, 'scheduled_time', e.target.value)} /></div>
                  <div className="flex items-end pb-1">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={item.contrast_required} onCheckedChange={(v) => updateItemRow(idx, 'contrast_required', v)} />
                      <Label className="text-xs">Contraste</Label>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <div><Label>Notas</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={createOrder} disabled={saving}>{saving ? 'Criando...' : 'Criar Pedido'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail Dialog ── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Pedido {detailOrder?.accession_number}</DialogTitle></DialogHeader>
          {detailOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                <div><span className="text-muted-foreground">Paciente:</span> <strong>{detailOrder.patient_name}</strong></div>
                <div><span className="text-muted-foreground">Solicitante:</span> {detailOrder.physician_name || detailOrder.referring_physician_name || '—'}</div>
                <div><span className="text-muted-foreground">Prioridade:</span> <Badge variant="outline" className={`border-0 text-[10px] ${priorityColors[detailOrder.priority]}`}>{priorityLabels[detailOrder.priority]}</Badge></div>
                <div><span className="text-muted-foreground">Indicação:</span> {detailOrder.clinical_indication || '—'}</div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className={`border-0 text-[10px] ${imagingStatusColors[detailOrder.status]}`}>{imagingStatusLabels[detailOrder.status]}</Badge></div>
                {detailOrder.scheduling_id && <div><span className="text-muted-foreground">Agendamento:</span> <span className="font-mono text-xs">{detailOrder.scheduling_id.substring(0, 8)}...</span></div>}
              </div>

              {/* Actions bar */}
              <div className="flex gap-2 flex-wrap">
                {detailOrder.status !== 'cancelado' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setNewItemForm(emptyItemForm()); setAddItemOpen(true); }}>
                      <ListPlus className="h-3 w-3 mr-1" />Adicionar Exame
                    </Button>
                    {detailItems.some(i => i.status === 'agendado') && (
                      <Button size="sm" onClick={() => releaseAllToWorklist(detailOrder)}>
                        <Send className="h-3 w-3 mr-1" />Liberar Todos p/ Worklist
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => cancelOrder(detailOrder)}>
                      <X className="h-3 w-3 mr-1" />Cancelar Pedido
                    </Button>
                  </>
                )}
              </div>

              {/* Items table */}
              <div className="rounded-lg border overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Exame</TableHead><TableHead>Modalidade</TableHead><TableHead>Região</TableHead>
                    <TableHead>Lateralidade</TableHead><TableHead>Contraste</TableHead><TableHead>AE Title</TableHead>
                    <TableHead>Data/Hora</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {detailItems.map((item) => (
                      <TableRow key={item.id} className={item.status === 'cancelado' ? 'opacity-50' : ''}>
                        <TableCell className="font-medium text-sm">{item.exam_name}</TableCell>
                        <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{item.modality_type}</Badge></TableCell>
                        <TableCell className="text-xs">{item.body_part || '—'}</TableCell>
                        <TableCell className="text-xs">{item.laterality || '—'}</TableCell>
                        <TableCell className="text-xs">{item.contrast_required ? 'Sim' : 'Não'}</TableCell>
                        <TableCell className="font-mono text-xs">{item.station_aetitle || '—'}</TableCell>
                        <TableCell className="text-xs">{item.scheduled_date ? `${item.scheduled_date} ${item.scheduled_time || ''}` : '—'}</TableCell>
                        <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${imagingStatusColors[item.status]}`}>{imagingStatusLabels[item.status]}</Badge></TableCell>
                        <TableCell>
                          {item.status === 'agendado' && (
                            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => releaseToWorklist(item, detailOrder)}>
                              <Send className="h-3 w-3 mr-1" />WL
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {detailItems.length === 0 && (
                      <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">Nenhum exame neste pedido</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Technical info */}
              <div className="rounded-lg border p-3 space-y-1 text-xs text-muted-foreground">
                <p><strong>Procedure IDs gerados:</strong></p>
                {detailItems.map(item => (
                  <p key={item.id} className="font-mono">
                    {item.exam_name}: RPD={item.requested_procedure_id?.substring(0, 30)}... SPS={item.scheduled_procedure_step_id?.substring(0, 30)}...
                  </p>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add Item to Existing Order Dialog ── */}
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adicionar Exame ao Pedido</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div><Label>Nome do Exame *</Label><Input value={newItemForm.exam_name} onChange={(e) => setNewItemForm({ ...newItemForm, exam_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Modalidade</Label>
                <Select value={newItemForm.modality_type} onValueChange={(v) => setNewItemForm({ ...newItemForm, modality_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MODALITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Região</Label><Input value={newItemForm.body_part} onChange={(e) => setNewItemForm({ ...newItemForm, body_part: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Data</Label><Input type="date" value={newItemForm.scheduled_date} onChange={(e) => setNewItemForm({ ...newItemForm, scheduled_date: e.target.value })} /></div>
              <div><Label>Hora</Label><Input type="time" value={newItemForm.scheduled_time} onChange={(e) => setNewItemForm({ ...newItemForm, scheduled_time: e.target.value })} /></div>
            </div>
            <div><Label>AE Title Estação</Label><Input value={newItemForm.station_aetitle} onChange={(e) => setNewItemForm({ ...newItemForm, station_aetitle: e.target.value.toUpperCase() })} className="font-mono" /></div>
            <div className="flex items-center gap-2"><Checkbox checked={newItemForm.contrast_required} onCheckedChange={(v) => setNewItemForm({ ...newItemForm, contrast_required: !!v })} /><Label>Requer Contraste</Label></div>
          </div>
          <DialogFooter><Button onClick={addItemToOrder}>Adicionar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
