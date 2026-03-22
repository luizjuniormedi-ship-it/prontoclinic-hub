import { useEffect, useState } from "react";
import { Database, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { api } from "@/services/api";
import { ConsultationType, ExamType, ProcedureType, TherapyService, HealthInsurancePlan, Room, Specialty } from "@/types";
import { formatCurrency } from "@/utils/formatters";
import { useToast } from "@/hooks/use-toast";

export default function MasterDataPage() {
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [consultations, setConsultations] = useState<ConsultationType[]>([]);
  const [exams, setExams] = useState<ExamType[]>([]);
  const [procedures, setProcedures] = useState<ProcedureType[]>([]);
  const [therapies, setTherapies] = useState<TherapyService[]>([]);
  const [insurances, setInsurances] = useState<HealthInsurancePlan[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([
      api.getSpecialties(), api.getConsultationTypes(), api.getExamTypes(),
      api.getProcedureTypes(), api.getTherapyServices(), api.getInsurancePlans(), api.getRooms(),
    ]).then(([sp, ct, ex, pr, th, ins, rm]) => {
      setSpecialties(sp); setConsultations(ct); setExams(ex);
      setProcedures(pr); setTherapies(th); setInsurances(ins); setRooms(rm);
      setLoading(false);
    });
  }, []);

  if (loading) return <LoadingState />;

  const q = search.toLowerCase();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Cadastros Mestres" description="Especialidades, consultas, exames, procedimentos, terapias, convênios e salas" />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Tabs defaultValue="specialties">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="specialties">Especialidades ({specialties.length})</TabsTrigger>
          <TabsTrigger value="consultations">Consultas ({consultations.length})</TabsTrigger>
          <TabsTrigger value="exams">Exames ({exams.length})</TabsTrigger>
          <TabsTrigger value="procedures">Procedimentos ({procedures.length})</TabsTrigger>
          <TabsTrigger value="therapies">Terapias ({therapies.length})</TabsTrigger>
          <TabsTrigger value="insurances">Convênios ({insurances.length})</TabsTrigger>
          <TabsTrigger value="rooms">Salas ({rooms.length})</TabsTrigger>
        </TabsList>

        {/* Specialties */}
        <TabsContent value="specialties">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Código</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {specialties.filter((s) => !search || s.name.toLowerCase().includes(q)).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-xs font-mono">{s.code || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${s.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{s.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="sm" className="h-7 text-xs">Editar</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Consultations */}
        <TabsContent value="consultations">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Especialidade</TableHead><TableHead>Duração</TableHead><TableHead>Valor Part.</TableHead><TableHead>Convênios</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {consultations.filter((c) => !search || c.name.toLowerCase().includes(q)).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-sm">{c.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.specialtyName}</TableCell>
                    <TableCell className="text-xs">{c.defaultDuration}min</TableCell>
                    <TableCell className="text-xs">{formatCurrency(c.particularPrice)}</TableCell>
                    <TableCell><div className="flex gap-1 flex-wrap">{c.acceptedInsurances.map((i) => <Badge key={i} variant="outline" className="border-0 bg-primary/10 text-primary text-[9px]">{i}</Badge>)}</div></TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${c.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{c.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Exams */}
        <TabsContent value="exams">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Categoria</TableHead><TableHead>Duração</TableHead><TableHead>Valor Part.</TableHead><TableHead>Preparo</TableHead><TableHead>Prioridade</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {exams.filter((e) => !search || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium text-sm">{e.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.category}</TableCell>
                    <TableCell className="text-xs">{e.defaultDuration}min</TableCell>
                    <TableCell className="text-xs">{formatCurrency(e.particularPrice)}</TableCell>
                    <TableCell>{e.requiresPrep ? <Badge variant="outline" className="border-0 bg-warning/10 text-warning text-[10px]">Sim</Badge> : <span className="text-xs text-muted-foreground">Não</span>}</TableCell>
                    <TableCell className="text-xs">{e.defaultPriority === "urgent" ? <Badge variant="outline" className="border-0 bg-warning/10 text-warning text-[10px]">Urgente</Badge> : "Normal"}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${e.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{e.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Procedures */}
        <TabsContent value="procedures">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Especialidade</TableHead><TableHead>Duração</TableHead><TableHead>Valor Part.</TableHead><TableHead>Autorização</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {procedures.filter((p) => !search || p.name.toLowerCase().includes(q)).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-sm">{p.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.specialtyName}</TableCell>
                    <TableCell className="text-xs">{p.defaultDuration}min</TableCell>
                    <TableCell className="text-xs">{formatCurrency(p.particularPrice)}</TableCell>
                    <TableCell>{p.requiresAuthorization ? <Badge variant="outline" className="border-0 bg-warning/10 text-warning text-[10px]">Sim</Badge> : <span className="text-xs text-muted-foreground">Não</span>}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${p.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{p.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Therapies */}
        <TabsContent value="therapies">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Duração</TableHead><TableHead>Valor Part.</TableHead><TableHead>Pacote</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {therapies.filter((t) => !search || t.name.toLowerCase().includes(q)).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium text-sm">{t.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.type}</TableCell>
                    <TableCell className="text-xs">{t.defaultDuration}min</TableCell>
                    <TableCell className="text-xs">{formatCurrency(t.particularPrice)}</TableCell>
                    <TableCell>{t.allowsPackage ? <Badge variant="outline" className="border-0 bg-success/10 text-success text-[10px]">Sim</Badge> : <span className="text-xs text-muted-foreground">Não</span>}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${t.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{t.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Insurances */}
        <TabsContent value="insurances">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Código</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {insurances.filter((i) => !search || i.name.toLowerCase().includes(q)).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell className="text-xs font-mono">{i.code}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{i.type}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${i.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{i.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Rooms */}
        <TabsContent value="rooms">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Unidade</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {rooms.filter((r) => !search || r.name.toLowerCase().includes(q)).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-xs">{r.type.replace("_", " ")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.unitName}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${r.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{r.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
