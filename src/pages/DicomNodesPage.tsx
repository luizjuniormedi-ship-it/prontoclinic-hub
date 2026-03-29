import { useEffect, useState } from "react";
import { Server, Plus, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { dicomNodesService } from "@/services/dicomService";
import type { DicomNode, DicomNodeType } from "@/types/dicom";
import { toast } from "@/hooks/use-toast";

const nodeTypeLabels: Record<DicomNodeType, string> = {
  pacs: 'PACS Server', modality: 'Modalidade', ris: 'RIS', worklist: 'Worklist SCP', viewer: 'Viewer',
};

export default function DicomNodesPage() {
  const [nodes, setNodes] = useState<DicomNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DicomNode | null>(null);
  const [form, setForm] = useState({ name: '', node_type: 'pacs' as DicomNodeType, aetitle: '', ip_address: '', port: '', description: '', active: true });

  const load = () => {
    setLoading(true);
    dicomNodesService.list().then(setNodes).catch(() => toast({ title: "Erro ao carregar nós DICOM", variant: "destructive" })).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openNew = () => { setEditing(null); setForm({ name: '', node_type: 'pacs', aetitle: '', ip_address: '', port: '', description: '', active: true }); setDialogOpen(true); };
  const openEdit = (n: DicomNode) => { setEditing(n); setForm({ name: n.name, node_type: n.node_type, aetitle: n.aetitle, ip_address: n.ip_address || '', port: n.port?.toString() || '', description: n.description || '', active: n.active }); setDialogOpen(true); };

  const save = async () => {
    if (!form.name || !form.aetitle) { toast({ title: "Nome e AE Title são obrigatórios", variant: "destructive" }); return; }
    try {
      const payload = { ...form, port: form.port ? parseInt(form.port) : null };
      if (editing) await dicomNodesService.update(editing.id, payload);
      else await dicomNodesService.create(payload);
      toast({ title: editing ? "Nó atualizado" : "Nó criado" });
      setDialogOpen(false);
      load();
    } catch { toast({ title: "Erro ao salvar", variant: "destructive" }); }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Nós DICOM / PACS" description="Servidores PACS, Worklist SCP e viewers configurados">
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Novo Nó</Button>
      </PageHeader>

      {nodes.length === 0 ? <EmptyState icon={Server} title="Nenhum nó DICOM configurado" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>AE Title</TableHead>
              <TableHead>IP</TableHead><TableHead>Porta</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {nodes.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">{n.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{nodeTypeLabels[n.node_type]}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{n.aetitle}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{n.ip_address || '—'}</TableCell>
                  <TableCell className="text-xs">{n.port || '—'}</TableCell>
                  <TableCell>{n.active ? <Wifi className="h-4 w-4 text-success" /> : <WifiOff className="h-4 w-4 text-muted-foreground" />}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => openEdit(n)}>Editar</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Editar Nó DICOM' : 'Novo Nó DICOM'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Tipo</Label>
              <Select value={form.node_type} onValueChange={(v) => setForm({ ...form, node_type: v as DicomNodeType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(nodeTypeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>AE Title *</Label><Input value={form.aetitle} onChange={(e) => setForm({ ...form, aetitle: e.target.value.toUpperCase() })} className="font-mono" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>IP</Label><Input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.100" /></div>
              <div><Label>Porta</Label><Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="4242" /></div>
            </div>
            <div><Label>Descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /><Label>Ativo</Label></div>
          </div>
          <DialogFooter><Button onClick={save}>{editing ? 'Salvar' : 'Criar'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
