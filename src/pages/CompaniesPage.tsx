import { useEffect, useState } from "react";
import { Plus, Search, Building2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { api } from "@/services/api";
import { Company, Unit, UnitType } from "@/types";
import { useToast } from "@/hooks/use-toast";

const unitTypeLabels: Record<UnitType, string> = { matriz: "Matriz", filial: "Filial", ambulatorio: "Ambulatório", laboratorio: "Laboratório" };

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [unitDialogOpen, setUnitDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([api.getCompanies(), api.getUnits()]).then(([c, u]) => {
      setCompanies(c); setUnits(u); setLoading(false);
    });
  }, []);

  if (loading) return <LoadingState />;

  const filteredCompanies = companies.filter((c) => {
    const q = search.toLowerCase();
    return !search || c.tradeName.toLowerCase().includes(q) || c.legalName.toLowerCase().includes(q) || c.cnpj.includes(q);
  });

  const filteredUnits = units.filter((u) => {
    const q = search.toLowerCase();
    return !search || u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q) || u.city.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Empresas & Unidades" description="Gestão multiempresa e multiunidade" actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setUnitDialogOpen(true)}><MapPin className="mr-2 h-4 w-4" />Nova Unidade</Button>
          <Button onClick={() => setCompanyDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Nova Empresa</Button>
        </div>
      } />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar empresa, unidade, CNPJ..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Tabs defaultValue="companies">
        <TabsList>
          <TabsTrigger value="companies">Empresas ({companies.length})</TabsTrigger>
          <TabsTrigger value="units">Unidades ({units.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="companies">
          {filteredCompanies.length === 0 ? <EmptyState icon={Building2} title="Nenhuma empresa" /> : (
            <div className="rounded-lg border bg-card overflow-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Nome Fantasia</TableHead><TableHead>Razão Social</TableHead><TableHead>CNPJ</TableHead><TableHead>Telefone</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredCompanies.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.tradeName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.legalName}</TableCell>
                      <TableCell className="text-xs">{c.cnpj}</TableCell>
                      <TableCell className="text-xs">{c.phone}</TableCell>
                      <TableCell><Badge variant="outline" className={`border-0 ${c.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{c.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                      <TableCell><Button variant="ghost" size="sm" className="h-7 text-xs">Editar</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="units">
          {filteredUnits.length === 0 ? <EmptyState icon={MapPin} title="Nenhuma unidade" /> : (
            <div className="rounded-lg border bg-card overflow-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Nome</TableHead><TableHead>Código</TableHead><TableHead>Empresa</TableHead><TableHead>Cidade/UF</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredUnits.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-xs font-mono">{u.code}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{u.companyName}</TableCell>
                      <TableCell className="text-xs">{u.city}/{u.state}</TableCell>
                      <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{unitTypeLabels[u.type]}</Badge></TableCell>
                      <TableCell><Badge variant="outline" className={`border-0 ${u.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{u.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                      <TableCell><Button variant="ghost" size="sm" className="h-7 text-xs">Editar</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Company dialog */}
      <Dialog open={companyDialogOpen} onOpenChange={setCompanyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Empresa</DialogTitle><DialogDescription>Cadastre uma empresa do grupo.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Razão Social *</Label><Input placeholder="Razão social" /></div>
            <div className="space-y-2"><Label>Nome Fantasia *</Label><Input placeholder="Nome fantasia" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>CNPJ *</Label><Input placeholder="00.000.000/0000-00" /></div>
              <div className="space-y-2"><Label>Telefone</Label><Input placeholder="(00) 0000-0000" /></div>
            </div>
            <div className="space-y-2"><Label>E-mail</Label><Input placeholder="email@empresa.com" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompanyDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => { toast({ title: "Empresa cadastrada!" }); setCompanyDialogOpen(false); }}>Cadastrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unit dialog */}
      <Dialog open={unitDialogOpen} onOpenChange={setUnitDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Unidade</DialogTitle><DialogDescription>Cadastre uma filial ou unidade.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Empresa *</Label>
              <Select><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.tradeName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Nome da Unidade *</Label><Input placeholder="Ex: Unidade Centro" /></div>
              <div className="space-y-2"><Label>Código *</Label><Input placeholder="UC01" /></div>
            </div>
            <div className="space-y-2"><Label>Tipo *</Label>
              <Select><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="matriz">Matriz</SelectItem>
                  <SelectItem value="filial">Filial</SelectItem>
                  <SelectItem value="ambulatorio">Ambulatório</SelectItem>
                  <SelectItem value="laboratorio">Laboratório</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Endereço</Label><Input placeholder="Endereço completo" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Cidade</Label><Input placeholder="Cidade" /></div>
              <div className="space-y-2"><Label>Estado</Label><Input placeholder="UF" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Telefone</Label><Input placeholder="(00) 0000-0000" /></div>
              <div className="space-y-2"><Label>E-mail</Label><Input placeholder="email@unidade.com" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => { toast({ title: "Unidade cadastrada!" }); setUnitDialogOpen(false); }}>Cadastrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
