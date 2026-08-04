import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Building2, MapPin, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, LoadingState } from "@/components/StateViews";
import { useToast } from "@/hooks/use-toast";
import { catalogService } from "@/services/catalogService";
import type { Company, Unit, UnitStatus, UnitType } from "@/types";

const unitTypeLabels: Record<UnitType, string> = {
  matriz: "Matriz",
  filial: "Filial",
  ambulatorio: "Ambulatório",
  laboratorio: "Laboratório",
  hospital: "Hospital",
  upa: "UPA",
  ubs: "UBS",
  consultorio: "Consultório",
};

type CompanyForm = Pick<Company, "legalName" | "cnpj" | "phone" | "email">;
type UnitForm = Pick<Unit, "name" | "code" | "cnpj" | "type" | "status"> & { id?: string };

const emptyCompany: CompanyForm = { legalName: "", cnpj: "", phone: "", email: "" };
const emptyUnit: UnitForm = { name: "", code: "", cnpj: "", type: "filial", status: "active" };

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"companies" | "units">("companies");
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [unitDialogOpen, setUnitDialogOpen] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [companyForm, setCompanyForm] = useState<CompanyForm>(emptyCompany);
  const [unitForm, setUnitForm] = useState<UnitForm>(emptyUnit);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextCompanies, nextUnits] = await Promise.all([
        catalogService.companies.getAll(),
        catalogService.units.getAll(false),
      ]);
      const nextCanManage = nextCompanies[0]
        ? await catalogService.companies.canManage(nextCompanies[0].id)
        : false;
      setCompanies(nextCompanies);
      setUnits(nextUnits);
      setCanManage(nextCanManage);
    } catch (error) {
      toast({ title: "Erro ao carregar empresas e unidades", description: toMessage(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredCompanies = useMemo(() => companies.filter((company) => !normalizedSearch
    || company.tradeName.toLowerCase().includes(normalizedSearch)
    || company.legalName.toLowerCase().includes(normalizedSearch)
    || company.cnpj.includes(normalizedSearch)), [companies, normalizedSearch]);
  const filteredUnits = useMemo(() => units.filter((unit) => !normalizedSearch
    || unit.name.toLowerCase().includes(normalizedSearch)
    || unit.code.toLowerCase().includes(normalizedSearch)
    || unit.companyName.toLowerCase().includes(normalizedSearch)), [units, normalizedSearch]);

  function openCompany(company: Company) {
    setCompanyForm({ legalName: company.legalName, cnpj: company.cnpj, phone: company.phone, email: company.email });
    setCompanyDialogOpen(true);
  }

  function openUnit(unit?: Unit) {
    setUnitForm(unit ? { id: unit.id, name: unit.name, code: unit.code, cnpj: unit.cnpj ?? "", type: unit.type, status: unit.status } : emptyUnit);
    setUnitDialogOpen(true);
  }

  async function saveCompany() {
    if (!companyForm.legalName.trim() || digits(companyForm.cnpj).length !== 14) {
      toast({ title: "Dados inválidos", description: "Informe a razão social e um CNPJ com 14 dígitos.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await catalogService.companies.updateActive({
        name: companyForm.legalName,
        cnpj: companyForm.cnpj,
        phone: companyForm.phone,
        email: companyForm.email,
      });
      setCompanyDialogOpen(false);
      await load();
      toast({ title: "Empresa atualizada" });
    } catch (error) {
      toast({ title: "Não foi possível salvar a empresa", description: toMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function saveUnit() {
    if (!unitForm.name.trim() || !unitForm.code.trim() || (unitForm.cnpj && digits(unitForm.cnpj).length !== 14)) {
      toast({ title: "Dados inválidos", description: "Informe nome, código e, quando preenchido, um CNPJ com 14 dígitos.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await catalogService.units.save({
        id: unitForm.id ? Number(unitForm.id) : undefined,
        name: unitForm.name,
        code: unitForm.code,
        cnpj: unitForm.cnpj,
        type: unitForm.type,
        active: unitForm.status === "active",
      });
      setUnitDialogOpen(false);
      await load();
      toast({ title: unitForm.id ? "Unidade atualizada" : "Unidade cadastrada" });
    } catch (error) {
      toast({ title: "Não foi possível salvar a unidade", description: toMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Empresas & Unidades" description="Gestão da empresa ativa e suas unidades" actions={
        canManage ? <Button onClick={() => openUnit()} disabled={companies.length === 0}><Plus className="mr-2 h-4 w-4" />Nova Unidade</Button> : undefined
      } />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Buscar empresas e unidades" placeholder="Buscar empresa, unidade ou CNPJ" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "companies" | "units")}
      >
        <TabsList><TabsTrigger value="companies">Empresas ({companies.length})</TabsTrigger><TabsTrigger value="units">Unidades ({units.length})</TabsTrigger></TabsList>
        <TabsContent value="companies">
          {filteredCompanies.length === 0 ? <EmptyState icon={Building2} title="Nenhuma empresa no contexto ativo" /> : (
            <div className="overflow-auto rounded-lg border bg-card"><Table>
              <TableHeader><TableRow><TableHead>Empresa</TableHead><TableHead>CNPJ</TableHead><TableHead>Telefone</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{filteredCompanies.map((company) => <TableRow key={company.id}>
                <TableCell className="font-medium">{company.legalName}</TableCell><TableCell>{company.cnpj || "—"}</TableCell><TableCell>{company.phone || "—"}</TableCell>
                <TableCell><StatusBadge status={company.status} /></TableCell><TableCell>{canManage ? <Button variant="ghost" size="sm" onClick={() => openCompany(company)}>Editar</Button> : null}</TableCell>
              </TableRow>)}</TableBody>
            </Table></div>
          )}
        </TabsContent>
        <TabsContent value="units">
          {filteredUnits.length === 0 ? <EmptyState icon={MapPin} title="Nenhuma unidade" /> : (
            <div className="overflow-auto rounded-lg border bg-card"><Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Código</TableHead><TableHead>Empresa</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{filteredUnits.map((unit) => <TableRow key={unit.id}>
                <TableCell className="font-medium">{unit.name}</TableCell><TableCell className="font-mono text-xs">{unit.code}</TableCell><TableCell>{unit.companyName}</TableCell>
                <TableCell><Badge variant="outline">{unitTypeLabels[unit.type]}</Badge></TableCell><TableCell><StatusBadge status={unit.status} /></TableCell>
                <TableCell>{canManage ? <Button variant="ghost" size="sm" onClick={() => openUnit(unit)}>Editar</Button> : null}</TableCell>
              </TableRow>)}</TableBody>
            </Table></div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={companyDialogOpen} onOpenChange={setCompanyDialogOpen}><DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Editar empresa ativa</DialogTitle><DialogDescription>A alteração exige contexto administrativo com MFA.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Razão social" value={companyForm.legalName} onChange={(legalName) => setCompanyForm((form) => ({ ...form, legalName }))} />
          <Field label="CNPJ" value={companyForm.cnpj} onChange={(cnpj) => setCompanyForm((form) => ({ ...form, cnpj }))} />
          <Field label="Telefone" value={companyForm.phone} onChange={(phone) => setCompanyForm((form) => ({ ...form, phone }))} />
          <Field label="E-mail" type="email" value={companyForm.email} onChange={(email) => setCompanyForm((form) => ({ ...form, email }))} />
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setCompanyDialogOpen(false)} disabled={saving}>Cancelar</Button><Button onClick={() => void saveCompany()} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button></DialogFooter>
      </DialogContent></Dialog>

      <Dialog open={unitDialogOpen} onOpenChange={setUnitDialogOpen}><DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{unitForm.id ? "Editar unidade" : "Nova unidade"}</DialogTitle><DialogDescription>A unidade será vinculada à empresa ativa.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Nome" value={unitForm.name} onChange={(name) => setUnitForm((form) => ({ ...form, name }))} />
          <Field label="Código" value={unitForm.code} onChange={(code) => setUnitForm((form) => ({ ...form, code }))} />
          <Field label="CNPJ" value={unitForm.cnpj ?? ""} onChange={(cnpj) => setUnitForm((form) => ({ ...form, cnpj }))} />
          <UnitTypeSelect value={unitForm.type} onChange={(type) => setUnitForm((form) => ({ ...form, type }))} />
          <StatusSelect value={unitForm.status} onChange={(status) => setUnitForm((form) => ({ ...form, status }))} />
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setUnitDialogOpen(false)} disabled={saving}>Cancelar</Button><Button onClick={() => void saveUnit()} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  const id = useId();
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function UnitTypeSelect({ value, onChange }: { value: UnitType; onChange: (value: UnitType) => void }) {
  const id = useId();
  return <div className="space-y-2"><Label htmlFor={id}>Tipo</Label><Select value={value} onValueChange={(type: UnitType) => onChange(type)}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(unitTypeLabels).map(([option, label]) => <SelectItem key={option} value={option}>{label}</SelectItem>)}</SelectContent></Select></div>;
}

function StatusSelect({ value, onChange }: { value: UnitStatus; onChange: (value: UnitStatus) => void }) {
  const id = useId();
  return <div className="space-y-2"><Label htmlFor={id}>Status</Label><Select value={value} onValueChange={(status: UnitStatus) => onChange(status)}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Ativo</SelectItem><SelectItem value="inactive">Inativo</SelectItem></SelectContent></Select></div>;
}

function StatusBadge({ status }: { status: UnitStatus }) {
  return <Badge variant="outline" className={status === "active" ? "border-0 bg-success/10 text-success" : "border-0 bg-muted text-muted-foreground"}>{status === "active" ? "Ativo" : "Inativo"}</Badge>;
}

function digits(value: string) { return value.replace(/\D/g, ""); }
function toMessage(error: unknown) { return error instanceof Error ? error.message : "Erro inesperado"; }
