import { useEffect, useState } from "react";
import { Activity, Monitor, Server, ClipboardList, FileText, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/StateViews";
import { StatsCard } from "@/components/StatsCard";
import { dicomDashboardService, dicomModalitiesService, dicomNodesService } from "@/services/dicomService";
import type { DicomModality, DicomNode } from "@/types/dicom";
import { toast } from "@/hooks/use-toast";

export default function DicomDashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [modalities, setModalities] = useState<DicomModality[]>([]);
  const [nodes, setNodes] = useState<DicomNode[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      dicomDashboardService.getStats(),
      dicomModalitiesService.list(),
      dicomNodesService.list(),
    ]).then(([s, m, n]) => { setStats(s); setModalities(m); setNodes(n); })
      .catch(() => toast({ title: "Erro ao carregar dashboard", variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading || !stats) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Integração DICOM / PACS" description="Painel de monitoramento da integração com equipamentos de imagem">
        <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-2" />Atualizar</Button>
      </PageHeader>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard title="Equipamentos Ativos" value={stats.activeModalities} icon={Monitor} />
        <StatsCard title="Worklist Habilitada" value={stats.worklistEnabled} icon={ClipboardList} />
        <StatsCard title="WL Pendentes" value={stats.worklistPending} icon={Activity} />
        <StatsCard title="Laudos Pendentes" value={stats.pendingReports} icon={FileText} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard title="Em Aquisição" value={stats.ordersInAcquisition} icon={Monitor} />
        <StatsCard title="Enviados PACS" value={stats.ordersSentPacs} icon={Server} />
        <StatsCard title="WL Exportados" value={stats.worklistExported} icon={ClipboardList} />
        <StatsCard title="Laudos Finais" value={stats.completedReports} icon={FileText} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Modalities */}
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Monitor className="h-4 w-4" />Equipamentos</CardTitle></CardHeader>
          <CardContent>
            {modalities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum equipamento configurado</p>
            ) : (
              <div className="space-y-2">
                {modalities.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-2 rounded-md border text-sm">
                    <div>
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">({m.modality_type})</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{m.aetitle}</span>
                    </div>
                    <div className="flex gap-1">
                      {m.worklist_enabled && <Badge className="bg-primary/10 text-primary border-0 text-[10px]">WL</Badge>}
                      {m.active
                        ? <Badge className="bg-success/10 text-success border-0 text-[10px]">Online</Badge>
                        : <Badge className="bg-muted text-muted-foreground border-0 text-[10px]">Offline</Badge>
                      }
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* PACS/DICOM Nodes */}
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4" />Nós DICOM</CardTitle></CardHeader>
          <CardContent>
            {nodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum nó configurado</p>
            ) : (
              <div className="space-y-2">
                {nodes.map((n) => (
                  <div key={n.id} className="flex items-center justify-between p-2 rounded-md border text-sm">
                    <div>
                      <span className="font-medium">{n.name}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{n.aetitle}</span>
                      {n.ip_address && <span className="ml-2 text-xs text-muted-foreground">{n.ip_address}:{n.port}</span>}
                    </div>
                    <div className="flex gap-1">
                      <Badge variant="outline" className="text-[10px]">{n.node_type.toUpperCase()}</Badge>
                      {n.active
                        ? <Badge className="bg-success/10 text-success border-0 text-[10px]">Ativo</Badge>
                        : <Badge className="bg-muted text-muted-foreground border-0 text-[10px]">Inativo</Badge>
                      }
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Integration Info */}
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4" />Informações de Integração</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Este painel monitora o estado da integração DICOM/PACS. Para comunicação real com equipamentos, é necessário um serviço intermediário (ex: Orthanc) rodando na rede local da clínica.</p>
          <p><strong>Fluxo:</strong> Pedido → Worklist Queue → MWL SCP (Orthanc) → Modalidade adquire → Envia ao PACS → Laudo</p>
          <p><strong>Protocolo:</strong> DICOM C-FIND (Worklist), C-STORE (imagens), C-MOVE (distribuição)</p>
        </CardContent>
      </Card>
    </div>
  );
}
