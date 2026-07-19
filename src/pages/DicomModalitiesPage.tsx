import { useEffect, useState } from "react";
import { Monitor, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { dicomModalitiesService, dicomNodesService } from "@/services/dicomService";
import { listDicomUnits } from "@/services/dicomNodeRoutingService";
import type { DicomModality, DicomNode } from "@/types/dicom";
import { toast } from "@/hooks/use-toast";

const MODALITY_TYPES = ['CR','CT','MR','US','DX','XA','MG','PT','NM','RF','OT'];

export default function DicomModalitiesPage() {
  const [modalities, setModalities] = useState<DicomModality[]>([]);
  const [nodes, setNodes] = useState<DicomNode[]>([]);
  const [units, setUnits] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DicomModality | null>(null);
  const [form, setForm] = useState({ name: '', unit_id: '', modality_type: 'CR', aetitle: '', manufacturer: '', model: '', ip_address: '', port: '', worklist_enabled: false, pacs_node_id: '', worklist_node_id: '', room_name: '', active: true });

  const load = () => {
    setLoading(true);
    Promise.all([dicomModalitiesService.list(), dicomNodesService.list(), listDicomUnits()])
      .then(([m, n, unitOptions]) => { setModalities(m as unknown as DicomModality[]); setNodes((n.filter(x => x.node_type === 'pacs' || x.node_kind === 'pacs' || x.node_type === 'worklist')) as unknown as DicomNode[]); setUnits(unitOptions); })
      .catch(() => toast({ title: "Erro ao carregar", variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = modalities.filter(m => !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.aetitle.toLowerCase().includes(search.toLowerCase()));

  const openNew = () => { setEditing(null); setForm({ name: '', unit_id: '', modality_type: 'CR', aetitle: '', manufacturer: '', model: '', ip_address: '', port: '', worklist_enabled: false, pacs_node_id: '', worklist_node_id: '', room_name: '', active: true }); setDialogOpen(true); };
  const openEdit = (m: DicomModality) => { setEditing(m); setForm({ name: m.name, unit_id: m.unit_id == null ? '' : String(m.unit_id), modality_type: m.modality_type, aetitle: m.aetitle, manufacturer: m.manufacturer || '', model: m.model || '', ip_address: m.ip_address || '', port: m.port?.toString() || '', worklist_enabled: m.worklist_enabled, pacs_node_id: m.pacs_node_id || '', worklist_node_id: m.worklist_node_id || '', room_name: m.room_name || '', active: m.active }); setDialogOpen(true); };

  const save = async () => {
    if (!form.name || !form.aetitle) { toast({ title: "Nome e AE Title obrigatórios", variant: "destructive" }); return; }
    try {
      const payload = { ...form, unit_id: form.unit_id ? Number(form.unit_id) : null, port: form.port ? parseInt(form.port, 10) : null, pacs_node_id: form.pacs_node_id || null, worklist_node_id: form.worklist_node_id || null };
      if (editing) await dicomModalitiesService.update(editing.id, payload);
      else await dicomModalitiesService.create(payload);
      toast({ title: editing ? "Equipamento atualizado" : "Equipamento criado" });
      setDialogOpen(false);
      load();
    } catch { toast({ title: "Erro ao salvar", variant: "destructive" }); }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Equipamentos DICOM" description="Modalidades de imagem configuradas na rede" actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Novo Equipamento</Button>} />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar equipamento..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? <EmptyState icon={Monitor} title="Nenhum equipamento DICOM" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Nome</TableHead><TableHead>Unidade</TableHead><TableHead>Tipo</TableHead><TableHead>AE Title</TableHead>
              <TableHead>Fabricante</TableHead><TableHead>IP</TableHead><TableHead>Worklist</TableHead>
              <TableHead>PACS / Worklist</TableHead><TableHead>Sala</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium text-sm">{m.name}</TableCell>
                  <TableCell className="text-xs">{units.find((u) => u.id === m.unit_id)?.name || 'Padrão da empresa'}</TableCell>
                  <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{m.modality_type}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{m.aetitle}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.manufacturer || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.ip_address || '—'}</TableCell>
                  <TableCell>{m.worklist_enabled ? <Badge className="bg-success/10 text-success border-0 text-[10px]">Sim</Badge> : <span className="text-xs text-muted-foreground">Não</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{[m.pacs_node_name, m.worklist_node_name].filter(Boolean).join(' / ') || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.room_name || '—'}</TableCell>
                  <TableCell>{m.active ? <Badge className="bg-success/10 text-success border-0 text-[10px]">Ativo</Badge> : <Badge className="bg-muted text-muted-foreground border-0 text-[10px]">Inativo</Badge>}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => openEdit(m)}>Editar</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Editar Equipamento' : 'Novo Equipamento'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Modalidade</Label>
                <Select value={form.modality_type} onValueChange={(v) => setForm({ ...form, modality_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MODALITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Unidade</Label>
              <Select value={form.unit_id || "company-default"} onValueChange={(v) => setForm({ ...form, unit_id: v === "company-default" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Padrão da empresa" /></SelectTrigger>
                <SelectContent><SelectItem value="company-default">Padrão da empresa</SelectItem>{units.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>AE Title *</Label><Input value={form.aetitle} onChange={(e) => setForm({ ...form, aetitle: e.target.value.toUpperCase() })} className="font-mono" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Fabricante</Label><Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></div>
              <div><Label>Modelo</Label><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>IP</Label><Input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.50" /></div>
              <div><Label>Porta</Label><Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} /></div>
            </div>
            <div><Label>Sala</Label><Input value={form.room_name} onChange={(e) => setForm({ ...form, room_name: e.target.value })} /></div>
            <div><Label>Servidor PACS</Label>
              <Select value={form.pacs_node_id || "none"} onValueChange={(v) => setForm({ ...form, pacs_node_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {nodes.filter((n) => !form.unit_id || n.unit_id == null || n.unit_id === Number(form.unit_id)).filter((n) => n.node_kind === 'pacs' || n.node_type === 'pacs').map(n => <SelectItem key={n.id} value={n.id}>{n.name} ({n.aetitle})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Servidor Worklist</Label>
              <Select value={form.worklist_node_id || "none"} onValueChange={(v) => setForm({ ...form, worklist_node_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent><SelectItem value="none">Nenhum</SelectItem>{nodes.filter((n) => !form.unit_id || n.unit_id == null || n.unit_id === Number(form.unit_id)).filter((n) => n.node_kind === 'worklist' || n.node_type === 'worklist').map((n) => <SelectItem key={n.id} value={n.id}>{n.name} ({n.aetitle})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2"><Switch checked={form.worklist_enabled} onCheckedChange={(v) => setForm({ ...form, worklist_enabled: v })} /><Label>Worklist habilitada</Label></div>
            <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /><Label>Ativo</Label></div>
          </div>
          <DialogFooter><Button onClick={save}>{editing ? 'Salvar' : 'Criar'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
