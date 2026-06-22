/**
 * DicomEquipmentManager — UI para gestão de equipamentos DICOM
 *
 * Espelha SIGH.dicom_equipamentos (5 registros no SIGH atual)
 * - Lista: nome, AE Title, tipo (US/CT/MR/CR/XA/PT/NM/MG), IP, worklist
 * - CRUD com formulário
 * - Status online/offline (botão "Testar conexão" via Orthanc REST)
 * - Logs de envio/recebimento (worklist tags)
 *
 * Migration: 20260101000009_dicom.sql
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Wifi, WifiOff, Pencil, Trash2, Activity, Server, ListTree } from "lucide-react";
import {
  equipmentService,
  worklistService,
  type DicomEquipment,
  type DicomModality,
} from "@/services/dicomService";
import { useAuth } from "@/hooks/useAuth";

const MODALITIES: DicomModality[] = ["US", "CT", "MR", "CR", "XA", "PT", "NM", "MG", "DX", "ECG"];

function modalityBadge(mod: DicomModality): { label: string; cls: string } {
  const map: Record<DicomModality, { label: string; cls: string }> = {
    US: { label: "Ultrassom", cls: "bg-cyan-100 text-cyan-800" },
    CT: { label: "Tomografia", cls: "bg-blue-100 text-blue-800" },
    MR: { label: "Ressonância", cls: "bg-indigo-100 text-indigo-800" },
    CR: { label: "Raio-X", cls: "bg-gray-100 text-gray-800" },
    XA: { label: "Hemodinâmica", cls: "bg-red-100 text-red-800" },
    PT: { label: "PET-CT", cls: "bg-purple-100 text-purple-800" },
    NM: { label: "Medicina Nuclear", cls: "bg-amber-100 text-amber-800" },
    MG: { label: "Mamografia", cls: "bg-pink-100 text-pink-800" },
    DX: { label: "DR", cls: "bg-slate-100 text-slate-800" },
    ECG: { label: "ECG", cls: "bg-green-100 text-green-800" },
  };
  return map[mod] || { label: mod, cls: "bg-gray-100 text-gray-800" };
}

export function DicomEquipmentManager() {
  const { companyId } = useAuth();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DicomEquipment | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<DicomEquipment | null>(null);
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; message: string; latencyMs: number; at: string }>>({});

  const { data: equipment, isLoading } = useQuery({
    queryKey: ["dicom-equipment", companyId],
    queryFn: () => equipmentService.getEquipment(companyId!),
    enabled: !!companyId,
  });

  const { data: worklist } = useQuery({
    queryKey: ["dicom-worklist", selectedEquipment?.id],
    queryFn: () => worklistService.getWorklist(selectedEquipment!.id),
    enabled: !!selectedEquipment,
  });

  const createMutation = useMutation({
    mutationFn: (payload: Partial<DicomEquipment>) =>
      equipmentService.createEquipment(companyId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dicom-equipment"] });
      setIsCreateOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Partial<DicomEquipment> }) =>
      equipmentService.updateEquipment(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dicom-equipment"] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => equipmentService.deleteEquipment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dicom-equipment"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => equipmentService.testConnection(id),
    onSuccess: (r, id) => {
      setTestResults((prev) => ({ ...prev, [id]: { ...r, at: new Date().toLocaleTimeString() } }));
    },
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Equipamentos DICOM</h1>
          <p className="text-muted-foreground">
            Cadastro de modalities (CT, MR, US, CR...) — espelha SIGH.dicom_equipamentos
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Novo Equipamento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Cadastrar Equipamento DICOM</DialogTitle>
              <DialogDescription>
                AE Title (Application Entity) deve ser único por empresa. Use até 16 caracteres (DICOM standard).
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                createMutation.mutate({
                  ds_equipment: fd.get("ds_equipment") as string,
                  ds_aetitle: (fd.get("ds_aetitle") as string).toUpperCase(),
                  ds_type: (fd.get("ds_type") as DicomModality) || "US",
                  ds_ip: (fd.get("ds_ip") as string) || undefined,
                  ds_port: Number(fd.get("ds_port")) || 104,
                  ds_location: (fd.get("ds_location") as string) || undefined,
                  ds_manufacturer: (fd.get("ds_manufacturer") as string) || undefined,
                  ds_model: (fd.get("ds_model") as string) || undefined,
                  ds_software_version: (fd.get("ds_software_version") as string) || undefined,
                  lg_worklist: fd.get("lg_worklist") === "on",
                  lg_verify_photo: fd.get("lg_verify_photo") === "on",
                  ds_observacao: (fd.get("ds_observacao") as string) || undefined,
                });
              }}
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label htmlFor="ds_equipment">Nome do Equipamento *</Label>
                  <Input id="ds_equipment" name="ds_equipment" required maxLength={100}
                    placeholder="Ex: Philips Brilliance 64" />
                </div>
                <div>
                  <Label htmlFor="ds_aetitle">AE Title *</Label>
                  <Input id="ds_aetitle" name="ds_aetitle" required maxLength={16} pattern="[A-Z0-9_]+"
                    placeholder="CT_HOSP" style={{ textTransform: "uppercase" }} />
                  <p className="text-xs text-muted-foreground mt-1">1-16 chars: A-Z, 0-9, _</p>
                </div>
                <div>
                  <Label htmlFor="ds_type">Modalidade *</Label>
                  <Select name="ds_type" defaultValue="US">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODALITIES.map((m) => (
                        <SelectItem key={m} value={m}>{modalityBadge(m).label} ({m})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ds_ip">IP</Label>
                  <Input id="ds_ip" name="ds_ip" maxLength={45} placeholder="192.168.0.10" />
                </div>
                <div>
                  <Label htmlFor="ds_port">Porta</Label>
                  <Input id="ds_port" name="ds_port" type="number" defaultValue={104} />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="ds_location">Localização</Label>
                  <Input id="ds_location" name="ds_location" maxLength={100}
                    placeholder="Sala de Tomografia - 1º andar" />
                </div>
                <div>
                  <Label htmlFor="ds_manufacturer">Fabricante</Label>
                  <Input id="ds_manufacturer" name="ds_manufacturer" maxLength={100}
                    placeholder="Philips, GE, Siemens..." />
                </div>
                <div>
                  <Label htmlFor="ds_model">Modelo</Label>
                  <Input id="ds_model" name="ds_model" maxLength={100} />
                </div>
                <div>
                  <Label htmlFor="ds_software_version">Versão Software</Label>
                  <Input id="ds_software_version" name="ds_software_version" maxLength={50} />
                </div>
                <div className="flex items-center gap-6 pt-2">
                  <div className="flex items-center gap-2">
                    <Switch id="lg_worklist" name="lg_worklist" />
                    <Label htmlFor="lg_worklist">Worklist</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="lg_verify_photo" name="lg_verify_photo" />
                    <Label htmlFor="lg_verify_photo">Verificar Foto</Label>
                  </div>
                </div>
                <div className="col-span-2">
                  <Label htmlFor="ds_observacao">Observação</Label>
                  <Textarea id="ds_observacao" name="ds_observacao" rows={2} />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="equipment" className="w-full">
        <TabsList>
          <TabsTrigger value="equipment">
            <Server className="mr-2 h-4 w-4" />
            Equipamentos ({equipment?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="worklist" disabled={!selectedEquipment}>
            <ListTree className="mr-2 h-4 w-4" />
            Worklist ({worklist?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="equipment" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>AE Title</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>IP:Porta</TableHead>
                    <TableHead>Worklist</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[220px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">Carregando...</TableCell>
                    </TableRow>
                  ) : (equipment || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Nenhum equipamento cadastrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (equipment || []).map((eq) => {
                      const mod = modalityBadge(eq.ds_type);
                      const tr = testResults[eq.id];
                      return (
                        <TableRow
                          key={eq.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedEquipment(eq)}
                        >
                          <TableCell className="font-medium">{eq.ds_equipment}</TableCell>
                          <TableCell><code className="text-xs">{eq.ds_aetitle}</code></TableCell>
                          <TableCell>
                            <Badge className={mod.cls}>{mod.label}</Badge>
                          </TableCell>
                          <TableCell>
                            {eq.ds_ip ? `${eq.ds_ip}:${eq.ds_port}` : "—"}
                          </TableCell>
                          <TableCell>
                            {eq.lg_worklist ? (
                              <Badge variant="default">Sim</Badge>
                            ) : (
                              <Badge variant="secondary">Não</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {eq.lg_active ? (
                              <Badge variant="default">Ativo</Badge>
                            ) : (
                              <Badge variant="secondary">Inativo</Badge>
                            )}
                            {tr && (
                              <div className="text-xs mt-1">
                                {tr.ok ? (
                                  <span className="text-green-600 flex items-center gap-1">
                                    <Wifi className="h-3 w-3" /> {tr.latencyMs}ms
                                  </span>
                                ) : (
                                  <span className="text-red-600 flex items-center gap-1">
                                    <WifiOff className="h-3 w-3" /> offline
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost" size="sm"
                                onClick={(e) => { e.stopPropagation(); testMutation.mutate(eq.id); }}
                                disabled={testMutation.isPending}
                                title="Testar conexão (DICOM Echo)"
                              >
                                <Activity className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost" size="sm"
                                onClick={(e) => { e.stopPropagation(); setEditing(eq); }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost" size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm(`Remover equipamento ${eq.ds_equipment}?`)) {
                                    deleteMutation.mutate(eq.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {testResults && Object.keys(testResults).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Log de Testes de Conexão</CardTitle>
                <CardDescription>DICOM Echo (C-ECHO) via Orthanc REST API</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1">
                  {Object.entries(testResults).map(([id, r]) => (
                    <li key={id}>
                      <code className="text-xs">equip-{id}</code> às <b>{r.at}</b>: {r.message}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="worklist">
          {selectedEquipment && (
            <Card>
              <CardHeader>
                <CardTitle>Worklist: {selectedEquipment.ds_equipment}</CardTitle>
                <CardDescription>
                  Tags DICOM Modality Worklist (MWL) — {worklist?.length || 0} configuradas
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tag DICOM</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>ID Equipamento</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Descrição</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(worklist || []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          Nenhuma tag MWL configurada.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (worklist || []).map((w) => (
                        <TableRow key={w.id}>
                          <TableCell><code className="text-xs">{w.ds_tag || "—"}</code></TableCell>
                          <TableCell>{w.ds_type || "—"}</TableCell>
                          <TableCell>{w.ds_id_equipment || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{w.ds_value || "—"}</TableCell>
                          <TableCell>{w.ds_description || "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog de Edição */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>Editar Equipamento</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  updateMutation.mutate({
                    id: editing.id,
                    updates: {
                      ds_equipment: fd.get("ds_equipment") as string,
                      ds_ip: (fd.get("ds_ip") as string) || undefined,
                      ds_port: Number(fd.get("ds_port")) || 104,
                      ds_location: (fd.get("ds_location") as string) || undefined,
                      lg_worklist: fd.get("lg_worklist") === "on",
                      lg_active: fd.get("lg_active") === "on",
                    },
                  });
                }}
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>Nome</Label>
                    <Input name="ds_equipment" defaultValue={editing.ds_equipment} required />
                  </div>
                  <div>
                    <Label>IP</Label>
                    <Input name="ds_ip" defaultValue={editing.ds_ip || ""} />
                  </div>
                  <div>
                    <Label>Porta</Label>
                    <Input name="ds_port" type="number" defaultValue={editing.ds_port} />
                  </div>
                  <div className="col-span-2">
                    <Label>Localização</Label>
                    <Input name="ds_location" defaultValue={editing.ds_location || ""} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="lg_worklist_edit" name="lg_worklist" defaultChecked={editing.lg_worklist} />
                    <Label htmlFor="lg_worklist_edit">Worklist</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="lg_active_edit" name="lg_active" defaultChecked={editing.lg_active} />
                    <Label htmlFor="lg_active_edit">Ativo</Label>
                  </div>
                </div>
                <DialogFooter className="mt-4">
                  <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? "Salvando..." : "Atualizar"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DicomEquipmentManager;
