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
import { catalogService } from "@/services/catalogService";
import { Company, Unit, UnitType } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

const unitTypeLabels: Record<UnitType, string> = { matriz: "Matriz", filial: "Filial", ambulatorio: "Ambulatório", laboratorio: "Laboratório" };

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [unitDialogOpen, setUnitDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [companyForm, setCompanyForm] = useState({ legalName: "", tradeName: "", cnpj: "", phone: "", email: "" });
  const [unitForm, setUnitForm] = useState({ companyId: "", name: "", code: "", type: "filial" as UnitType, address: "", city: "", state: "", phone: "", email: "" });
  const { toast } = useToast();
  const { companyId } = useAuth();

  const reload = async () => {
    const [nextCompanies, nextUnits] = await Promise.all([catalogService.companies.getAll(), catalogService.units.getAll()]);
    setCompanies(nextCompanies);
    const companyNames = new Map(nextCompanies.map((company) => [company.id, company.tradeName]));
    setUnits(nextUnits.map((unit) => ({ ...unit, companyName: companyNames.get(unit.companyId) ?? "—" })));
  };

  const handleCreateCompany = async () => {
    if (!companyForm.legalName.trim() || !companyForm.tradeName.trim() || !companyForm.cnpj.trim()) {
      toast({ title: "Preencha razão social, nome fantasia e CNPJ", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editingCompany) {
        await catalogService.companies.update(editingCompany.id, companyForm);
        toast({ title: "Empresa atualizada" });
      } else {
        await catalogService.companies.create(companyForm);
        toast({ title: "Empresa cadastrada" });
      }
      setCompanyDialogOpen(false);
      setEditingCompany(null);
      setCompanyForm({ legalName: "", tradeName: "", cnpj: "", phone: "", email: "" });
      await reload();
    } catch (err) {
      toast({ title: "Erro ao cadastrar empresa", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateUnit = async () => {
    const selectedCompanyId = unitForm.companyId || companyId || companies[0]?.id;
    if (!selectedCompanyId || !unitForm.name.trim() || !unitForm.code.trim()) {
      toast({ title: "Preencha empresa, nome e código da unidade", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const input = { ...unitForm, companyId: selectedCompanyId };
      if (editingUnit) {
        await catalogService.units.update(editingUnit.id, input);
        toast({ title: "Unidade atualizada" });
      } else {
        await catalogService.units.create(input);
        toast({ title: "Unidade cadastrada" });
      }
      setUnitDialogOpen(false);
      setEditingUnit(null);
      setUnitForm({ companyId: selectedCompanyId, name: "", code: "", type: "filial", address: "", city: "", state: "", phone: "", email: "" });
      await reload();
    } catch (err) {
      toast({ title: "Erro ao cadastrar unidade", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    Promise.all([catalogService.companies.getAll(), catalogService.units.getAll()])
      .then(([c, u]) => {
        const companyNames = new Map(c.map((company) => [company.id, company.tradeName]));
        setCompanies(c); setUnits(u.map((unit) => ({ ...unit, companyName: companyNames.get(unit.companyId) ?? "—" }))); setLoading(false);
      })
      .catch((err) => {
        console.error("Erro ao carregar empresas/unidades:", err);
        toast({ title: "Erro ao carregar dados", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
        setLoading(false);
      });
  }, [toast]);

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
          <Button variant="outline" onClick={() => { setUnitForm((form) => ({ ...form, companyId: companyId || companies[0]?.id || "" })); setUnitDialogOpen(true); }}><MapPin className="mr-2 h-4 w-4" />Nova Unidade</Button>
          <Button onClick={() => { setEditingCompany(null); setCompanyForm({ legalName: "", tradeName: "", cnpj: "", phone: "", email: "" }); setCompanyDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />Nova Empresa</Button>
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
                      <TableCell><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditingCompany(c); setCompanyForm({ legalName: c.legalName, tradeName: c.tradeName, cnpj: c.cnpj, phone: c.phone, email: c.email }); setCompanyDialogOpen(true); }}>Editar</Button></TableCell>
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
                      <TableCell><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditingUnit(u); setUnitForm({ companyId: u.companyId, name: u.name, code: u.code, type: u.type, address: u.address, city: u.city, state: u.state, phone: u.phone, email: u.email }); setUnitDialogOpen(true); }}>Editar</Button></TableCell>
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
          <DialogHeader><DialogTitle>{editingCompany ? "Editar Empresa" : "Nova Empresa"}</DialogTitle><DialogDescription>Cadastre uma empresa do grupo.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Razão Social *</Label><Input value={companyForm.legalName} onChange={(e) => setCompanyForm((form) => ({ ...form, legalName: e.target.value }))} placeholder="Razão social" /></div>
            <div className="space-y-2"><Label>Nome Fantasia *</Label><Input value={companyForm.tradeName} onChange={(e) => setCompanyForm((form) => ({ ...form, tradeName: e.target.value }))} placeholder="Nome fantasia" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>CNPJ *</Label><Input value={companyForm.cnpj} onChange={(e) => setCompanyForm((form) => ({ ...form, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" /></div>
              <div className="space-y-2"><Label>Telefone</Label><Input value={companyForm.phone} onChange={(e) => setCompanyForm((form) => ({ ...form, phone: e.target.value }))} placeholder="(00) 0000-0000" /></div>
            </div>
            <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={companyForm.email} onChange={(e) => setCompanyForm((form) => ({ ...form, email: e.target.value }))} placeholder="email@empresa.com" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompanyDialogOpen(false)}>Cancelar</Button>
            <Button disabled={saving} onClick={handleCreateCompany}>{saving ? "Salvando..." : editingCompany ? "Atualizar" : "Cadastrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unit dialog */}
      <Dialog open={unitDialogOpen} onOpenChange={setUnitDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingUnit ? "Editar Unidade" : "Nova Unidade"}</DialogTitle><DialogDescription>Cadastre uma filial ou unidade.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Empresa *</Label>
              <Select value={unitForm.companyId} onValueChange={(value) => setUnitForm((form) => ({ ...form, companyId: value }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.tradeName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Nome da Unidade *</Label><Input value={unitForm.name} onChange={(e) => setUnitForm((form) => ({ ...form, name: e.target.value }))} placeholder="Ex: Unidade Centro" /></div>
              <div className="space-y-2"><Label>Código *</Label><Input value={unitForm.code} onChange={(e) => setUnitForm((form) => ({ ...form, code: e.target.value }))} placeholder="UC01" /></div>
            </div>
            <div className="space-y-2"><Label>Tipo *</Label>
              <Select value={unitForm.type} onValueChange={(value) => setUnitForm((form) => ({ ...form, type: value as UnitType }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="matriz">Matriz</SelectItem>
                  <SelectItem value="filial">Filial</SelectItem>
                  <SelectItem value="ambulatorio">Ambulatório</SelectItem>
                  <SelectItem value="laboratorio">Laboratório</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Endereço</Label><Input value={unitForm.address} onChange={(e) => setUnitForm((form) => ({ ...form, address: e.target.value }))} placeholder="Endereço completo" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Cidade</Label><Input value={unitForm.city} onChange={(e) => setUnitForm((form) => ({ ...form, city: e.target.value }))} placeholder="Cidade" /></div>
              <div className="space-y-2"><Label>Estado</Label><Input value={unitForm.state} onChange={(e) => setUnitForm((form) => ({ ...form, state: e.target.value }))} placeholder="UF" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Telefone</Label><Input value={unitForm.phone} onChange={(e) => setUnitForm((form) => ({ ...form, phone: e.target.value }))} placeholder="(00) 0000-0000" /></div>
              <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={unitForm.email} onChange={(e) => setUnitForm((form) => ({ ...form, email: e.target.value }))} placeholder="email@unidade.com" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitDialogOpen(false)}>Cancelar</Button>
            <Button disabled={saving} onClick={handleCreateUnit}>{saving ? "Salvando..." : editingUnit ? "Atualizar" : "Cadastrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
