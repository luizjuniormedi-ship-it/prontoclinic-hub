import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, Check, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { userProfilesService, type UserProfileWithEmail } from "@/services/userProfilesService";
import { accessControlService, type AccessExpiration, type Delegation, type UnitAccess, type UserPermissionOverride } from "@/services/accessControlService";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface Unit { id: number; ds_nome: string; cd_codigo: string; }

export default function AdminAccessPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserProfileWithEmail[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [unitAccess, setUnitAccess] = useState<UnitAccess[]>([]);
  const [overrides, setOverrides] = useState<UserPermissionOverride[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [expirations, setExpirations] = useState<AccessExpiration[]>([]);
  const [unitId, setUnitId] = useState("");
  const [module, setModule] = useState("patients");
  const [action, setAction] = useState("view");
  const [effect, setEffect] = useState<"grant" | "deny">("grant");
  const [reason, setReason] = useState("");
  const [delegationAction, setDelegationAction] = useState("view");
  const [delegationEndsAt, setDelegationEndsAt] = useState("");
  const [expirationAt, setExpirationAt] = useState("");
  const [expirationReason, setExpirationReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [{ data: unitRows, error: unitError }, userRows] = await Promise.all([
        supabase.from("units").select("id, ds_nome, cd_codigo").eq("lg_ativo", true).order("ds_nome"),
        userProfilesService.getAll(),
      ]);
      if (unitError) throw new Error(unitError.message);
      setUnits((unitRows ?? []) as Unit[]);
      setUsers(userRows);
      setSelectedUserId((current) => current || userRows[0]?.id || "");
    } catch (err) {
      toast({ title: "Erro ao carregar acessos", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setLoading(false); }
  }, [toast]);

  const loadSelected = useCallback(async () => {
    if (!selectedUserId) return;
    try {
      const [unitRows, overrideRows, delegationRows, expirationRows] = await Promise.all([
        accessControlService.listUnitAccess(selectedUserId),
        accessControlService.listOverrides(selectedUserId),
        accessControlService.listDelegations(selectedUserId),
        accessControlService.listExpirations(selectedUserId),
      ]);
      setUnitAccess(unitRows);
      setOverrides(overrideRows);
      setDelegations(delegationRows);
      setExpirations(expirationRows);
    } catch (err) {
      toast({ title: "Erro ao carregar escopo do usuário", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }, [selectedUserId, toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSelected(); }, [loadSelected]);

  const selectedUser = users.find((candidate) => candidate.id === selectedUserId);

  const saveUnit = async () => {
    if (!selectedUser || !unitId || !user?.company_id) return;
    try {
      setSaving(true);
      await accessControlService.grantUnitAccess({ user_id: selectedUser.id, company_id: user.company_id, unit_id: Number(unitId) });
      toast({ title: "Acesso de unidade concedido" });
      setUnitId("");
      await loadSelected();
    } catch (err) {
      toast({ title: "Erro ao conceder acesso", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const removeUnit = async (id: number) => {
    try {
      await accessControlService.revokeUnitAccess(id);
      toast({ title: "Acesso revogado" });
      await loadSelected();
    } catch (err) {
      toast({ title: "Erro ao revogar acesso", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const saveOverride = async () => {
    if (!selectedUser || !user?.company_id || !reason.trim()) {
      toast({ title: "Informe o motivo da exceção", variant: "destructive" });
      return;
    }
    const permission = await supabase.from("permissions").select("id").eq("module", module).eq("action", action).maybeSingle();
    if (permission.error || !permission.data) {
      toast({ title: "Permissão não encontrada", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      await accessControlService.saveOverride({
        user_id: selectedUser.id,
        company_id: user.company_id,
        permission_id: permission.data.id,
        effect,
        unit_id: null,
        sector_code: null,
        valid_from: new Date().toISOString(),
        valid_until: null,
        reason,
      });
      toast({ title: "Exceção de permissão salva" });
      setReason("");
      await loadSelected();
    } catch (err) {
      toast({ title: "Erro ao salvar exceção", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveDelegation = async () => {
    if (!selectedUser || !user?.id || !user.company_id || !delegationEndsAt || !reason.trim() || selectedUser.id === user.id) {
      toast({ title: "Informe um delegado diferente, validade e motivo", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      await accessControlService.createDelegation({
        company_id: user.company_id,
        delegator_user_id: user.id,
        delegate_user_id: selectedUser.id,
        module,
        actions: [delegationAction],
        unit_id: unitId ? Number(unitId) : null,
        starts_at: new Date().toISOString(),
        ends_at: new Date(delegationEndsAt).toISOString(),
        approval_status: "pending",
        reason,
      });
      toast({ title: "Delegação criada para aprovação" });
      setReason("");
      setDelegationEndsAt("");
      await loadSelected();
    } catch (err) {
      toast({ title: "Erro ao criar delegação", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveExpiration = async () => {
    if (!selectedUser || !user?.company_id || !expirationAt || !expirationReason.trim()) {
      toast({ title: "Informe a data e o motivo da expiração", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      await accessControlService.createExpiration({
        user_id: selectedUser.id,
        company_id: user.company_id,
        expires_at: new Date(expirationAt).toISOString(),
        reason: expirationReason,
      });
      toast({ title: "Expiração de acesso registrada" });
      setExpirationAt("");
      setExpirationReason("");
      await loadSelected();
    } catch (err) {
      toast({ title: "Erro ao registrar expiração", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const approveDelegation = async (id: number) => {
    if (!user?.id) return;
    try {
      await accessControlService.updateDelegationStatus(id, "approved", user.id);
      toast({ title: "Delegação aprovada" });
      await loadSelected();
    } catch (err) {
      toast({ title: "Erro ao aprovar delegação", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground">Carregando acessos...</div>;

  return <div className="space-y-6">
    <PageHeader title="Acessos por unidade e exceções" description="Controle escopo, permissões temporárias e delegações com RLS." />
    <Card>
      <CardHeader><CardTitle className="text-base">Usuário</CardTitle></CardHeader>
      <CardContent>
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger className="max-w-md"><SelectValue placeholder="Selecione um usuário" /></SelectTrigger>
          <SelectContent>{users.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.full_name} · {candidate.role_name || "sem perfil"}</SelectItem>)}</SelectContent>
        </Select>
      </CardContent>
    </Card>
    {selectedUser && <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Unidades autorizadas</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Adicionar unidade" /></SelectTrigger>
              <SelectContent>{units.filter((unit) => !unitAccess.some((access) => access.unit_id === unit.id)).map((unit) => <SelectItem key={unit.id} value={String(unit.id)}>{unit.ds_nome} · {unit.cd_codigo}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={() => void saveUnit()} disabled={saving || !unitId} title="Conceder acesso"><Plus className="h-4 w-4" /></Button>
          </div>
          {unitAccess.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum acesso adicional. O vínculo principal permanece no perfil.</p> : unitAccess.map((access) => <div key={access.id} className="flex items-center justify-between border rounded-md p-2 text-sm"><span>{units.find((unit) => unit.id === access.unit_id)?.ds_nome || "Unidade #" + access.unit_id}</span><Button variant="ghost" size="icon" onClick={() => void removeUnit(access.id)} title="Revogar"><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Exceção individual</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label>Módulo</Label><Input value={module} onChange={(event) => setModule(event.target.value)} /></div><div className="space-y-1"><Label>Ação</Label><Input value={action} onChange={(event) => setAction(event.target.value)} /></div></div>
          <div className="space-y-1"><Label>Efeito</Label><Select value={effect} onValueChange={(value) => setEffect(value as "grant" | "deny")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="grant">Conceder</SelectItem><SelectItem value="deny">Negar</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label>Motivo *</Label><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: cobertura de férias" /></div>
          <Button onClick={() => void saveOverride()} disabled={saving}><ShieldCheck className="mr-2 h-4 w-4" />Salvar exceção</Button>
          {overrides.map((override) => <div key={override.id} className="border rounded-md p-2 text-xs flex justify-between"><span>{override.effect === "grant" ? "Concede" : "Nega"} permissão #{override.permission_id}<br /><span className="text-muted-foreground">{override.reason}</span></span><Badge variant="outline">{override.valid_until ? "Temporária" : "Ativa"}</Badge></div>)}
        </CardContent>
      </Card>
    </div>}
    {selectedUser && <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Delegações e substituições</CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label>Ação delegada</Label><Input value={delegationAction} onChange={(event) => setDelegationAction(event.target.value)} /></div><div className="space-y-1"><Label>Fim da validade</Label><Input type="datetime-local" value={delegationEndsAt} onChange={(event) => setDelegationEndsAt(event.target.value)} /></div></div>
        <Button onClick={() => void saveDelegation()} disabled={saving || selectedUser.id === user?.id}><CalendarClock className="mr-2 h-4 w-4" />Criar delegação pendente</Button>
        {delegations.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma delegação encontrada para este usuário.</p> : <div className="space-y-2">{delegations.map((delegation) => <div key={delegation.id} className="border rounded-md p-2 text-sm flex items-center justify-between"><span>{delegation.module} · {delegation.actions.join(", ")}<br /><span className="text-xs text-muted-foreground">{delegation.reason}</span></span><span className="flex items-center gap-2"><Badge variant="outline">{delegation.approval_status}</Badge>{delegation.approval_status === "pending" && <Button variant="ghost" size="icon" onClick={() => void approveDelegation(delegation.id)} title="Aprovar"><Check className="h-4 w-4 text-emerald-600" /></Button>}{delegation.approval_status === "approved" && <Button variant="ghost" size="icon" onClick={() => void accessControlService.updateDelegationStatus(delegation.id, "revoked").then(loadSelected)} title="Revogar"><X className="h-4 w-4 text-destructive" /></Button>}</span></div>)}</div>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Validade do acesso</CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label>Expira em</Label><Input type="datetime-local" value={expirationAt} onChange={(event) => setExpirationAt(event.target.value)} /></div><div className="space-y-1"><Label>Motivo</Label><Input value={expirationReason} onChange={(event) => setExpirationReason(event.target.value)} placeholder="Ex.: contrato temporário" /></div></div>
        <Button onClick={() => void saveExpiration()} disabled={saving}><CalendarClock className="mr-2 h-4 w-4" />Registrar expiração</Button>
        {expirations.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma expiração registrada.</p> : <div className="space-y-2">{expirations.map((expiration) => <div key={expiration.id} className="border rounded-md p-2 text-sm flex items-center justify-between"><span>{new Date(expiration.expires_at).toLocaleString()}<br /><span className="text-xs text-muted-foreground">{expiration.reason}</span></span>{expiration.revoked_at ? <Badge variant="outline">Revogado</Badge> : <Button variant="ghost" size="icon" onClick={() => void accessControlService.revokeExpiration(expiration.id).then(loadSelected)} title="Revogar"><Trash2 className="h-4 w-4 text-destructive" /></Button>}</div>)}</div>}
      </CardContent></Card>
    </div>}
  </div>;
}
