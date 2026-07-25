/**
 * ReportTemplateEditor — Editor de templates de laudo
 *
 * Espelha SIGH.laudospadroes (139 templates no SIGH atual)
 * - Editor com preview lado a lado
 * - Variáveis dinâmicas: {{nome}}, {{data}}, {{exame}}, {{idade}}, {{sexo}}, {{medico}}
 * - Tags de formatação: [NEGRITO], [ITALICO], [IMAGEM]
 * - Categorização por especialidade (RADIOLOGIA, CARDIOLOGIA, OFTALMOLOGIA, etc)
 * - Associação a serviço (services_catalog)
 *
 * Migration: 20260101000009_dicom.sql
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Eye, Edit2, Save, FileText, Bold, Italic, Image as ImageIcon } from "lucide-react";
import {
  templateService,
  type ReportTemplate,
  type ReportTemplateType,
} from "@/services/dicomService";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

const TEMPLATE_TYPES: { value: ReportTemplateType; label: string }[] = [
  { value: "RADIOLOGIA", label: "Radiologia" },
  { value: "CARDIOLOGIA", label: "Cardiologia" },
  { value: "OFTALMOLOGIA", label: "Oftalmologia" },
  { value: "GASTRO", label: "Gastroenterologia" },
  { value: "UROLOGIA", label: "Urologia" },
  { value: "GINECOLOGIA", label: "Ginecologia" },
  { value: "ORTOPEDIA", label: "Ortopedia" },
  { value: "NEUROLOGIA", label: "Neurologia" },
  { value: "PATOLOGIA", label: "Patologia" },
  { value: "GENERICO", label: "Genérico" },
];

const VARIABLES = [
  { key: "nome", label: "Nome do Paciente" },
  { key: "idade", label: "Idade" },
  { key: "sexo", label: "Sexo" },
  { key: "data", label: "Data do Exame" },
  { key: "exame", label: "Tipo de Exame" },
  { key: "medico", label: "Médico Solicitante" },
  { key: "laudador", label: "Médico Laudador" },
  { key: "clinica", label: "Nome da Clínica" },
  { key: "convenio", label: "Convênio" },
  { key: "prontuario", label: "Nº Prontuário" },
  { key: "cid", label: "CID-10" },
  { key: "queixa", label: "Queixa Principal" },
  { key: "historia", label: "História Clínica" },
];

const SAMPLE = {
  nome: "João da Silva",
  idade: "47 anos",
  sexo: "Masculino",
  data: new Date().toLocaleDateString("pt-BR"),
  exame: "Tomografia Computadorizada de Tórax",
  medico: "Dra. Maria Souza (CRM 12345)",
  laudador: "Dr. Carlos Mendes (CRM 67890)",
  clinica: "ProntoClinic Hub",
  convenio: "AMIL",
  prontuario: "PT-2026-00001",
  cid: "R91.8",
  queixa: "Dor torácica há 3 semanas",
  historia: "Paciente tabagista (30 anos-maço)",
};

function renderPreview(text: string): string {
  if (!text) return "";
  let out = text;
  // Tags customizadas → HTML
  out = out.replace(/\[NEGRITO\]([\s\S]*?)\[\/NEGRITO\]/g, "<b>$1</b>");
  out = out.replace(/\[ITALICO\]([\s\S]*?)\[\/ITALICO\]/g, "<i>$1</i>");
  out = out.replace(/\[IMAGEM\]/g, '<span class="inline-block px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">[Imagem]</span>');
  // Variáveis
  out = out.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE[k as keyof typeof SAMPLE] || `[${k}]`);
  // Quebras de linha
  out = out.replace(/\n/g, "<br/>");
  return out;
}

export function ReportTemplateEditor() {
  const { companyId } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ReportTemplate | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [draftName, setDraftName] = useState("");
  const [filterType, setFilterType] = useState<ReportTemplateType | "ALL">("ALL");
  const [showPreview, setShowPreview] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["report-templates", companyId, filterType],
    queryFn: () => templateService.listTemplates(companyId!, { type: filterType === "ALL" ? undefined : filterType }),
    enabled: !!companyId,
  });

  const { data: services } = useQuery({
    queryKey: ["services-catalog"],
    queryFn: async () => {
      const { data } = await supabase
        .from("services_catalog")
        .select("id, name, code")
        .order("name")
        .limit(200);
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: Partial<ReportTemplate>) => templateService.saveTemplate(companyId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-templates"] });
      setIsCreateOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Partial<ReportTemplate> }) =>
      templateService.updateTemplate(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-templates"] });
      setEditing(null);
    },
  });

  useEffect(() => {
    if (editing) {
      setDraftContent(editing.bl_template_web || "");
      setDraftName(editing.ds_name);
    }
  }, [editing]);

  const previewHtml = useMemo(() => renderPreview(draftContent), [draftContent]);

  function insertTag(tag: string) {
    if (tag === "BOLD") {
      setDraftContent((c) => c + "\n[NEGRITO]texto em negrito[/NEGRITO]\n");
    } else if (tag === "ITALIC") {
      setDraftContent((c) => c + "\n[ITALICO]texto em itálico[/ITALICO]\n");
    } else if (tag === "IMAGE") {
      setDraftContent((c) => c + "\n[IMAGEM]\n");
    }
  }

  function insertVariable(key: string) {
    setDraftContent((c) => c + `{{${key}}}`);
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Templates de Laudo</h1>
          <p className="text-muted-foreground">
            Modelos de laudo por especialidade (espelha SIGH.laudospadroes)
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Novo Template
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Template de Laudo</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                createMutation.mutate({
                  ds_name: fd.get("ds_name") as string,
                  ds_title: (fd.get("ds_title") as string) || undefined,
                  ds_type: (fd.get("ds_type") as ReportTemplateType) || "RADIOLOGIA",
                  cd_service: Number(fd.get("cd_service")) || undefined,
                  ds_template_short: (fd.get("ds_template_short") as string) || undefined,
                  bl_template_web: (fd.get("bl_template_web") as string) || undefined,
                  lg_active: true,
                  nm_sequence: 1,
                });
              }}
            >
              <div className="space-y-3">
                <div>
                  <Label>Nome *</Label>
                  <Input name="ds_name" required maxLength={100}
                    placeholder="Ex: TC Torax Padrao" />
                </div>
                <div>
                  <Label>Título</Label>
                  <Input name="ds_title" maxLength={150}
                    placeholder="Tomografia Computadorizada de Tórax" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Especialidade</Label>
                    <Select name="ds_type" defaultValue="RADIOLOGIA">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TEMPLATE_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Serviço</Label>
                    <Select name="cd_service">
                      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        {(services || []).map((s: { id: string | number; code?: string; name: string }) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.code} - {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Descrição curta</Label>
                  <Input name="ds_template_short" maxLength={50}
                    placeholder="Resumo em uma linha para UI" />
                </div>
                <div>
                  <Label>Conteúdo (variáveis: {`{{nome}}`}, tags: [NEGRITO]…[/NEGRITO])</Label>
                  <Textarea name="bl_template_web" rows={6}
                    placeholder="TEXTO: TC de tórax sem contraste.&#10;&#10;CONCLUSÃO: ..." />
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

      <Tabs defaultValue="list" className="w-full">
        <TabsList>
          <TabsTrigger value="list">
            <FileText className="mr-2 h-4 w-4" />
            Lista ({templates?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="editor" disabled={!editing}>
            <Edit2 className="mr-2 h-4 w-4" />
            Editor
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3">
          <div className="flex gap-2 items-center">
            <Label>Filtrar:</Label>
            <Select value={filterType} onValueChange={(v) => setFilterType(v as ReportTemplateType | "ALL")}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                {TEMPLATE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Resumo</TableHead>
                    <TableHead>Sequência</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">Carregando...</TableCell>
                    </TableRow>
                  ) : (templates || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Nenhum template encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (templates || []).map((t) => {
                      const tt = TEMPLATE_TYPES.find((x) => x.value === t.ds_type);
                      return (
                        <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setEditing(t)}>
                          <TableCell className="font-medium">{t.ds_name}</TableCell>
                          <TableCell><Badge variant="outline">{tt?.label || t.ds_type}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {t.ds_template_short || "—"}
                          </TableCell>
                          <TableCell>{t.nm_sequence}</TableCell>
                          <TableCell>
                            {t.lg_active ? (
                              <Badge variant="default">Ativo</Badge>
                            ) : (
                              <Badge variant="secondary">Inativo</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditing(t); }}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="editor">
          {editing && (
            <div className="grid grid-cols-12 gap-4">
              <Card className="col-span-7">
                <CardHeader>
                  <CardTitle>Editor: {editing.ds_name}</CardTitle>
                  <CardDescription>Tags: [NEGRITO], [ITALICO], [IMAGEM] — Variáveis: {`{{nome}}`}, {`{{data}}`}…</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 mb-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => insertTag("BOLD")}>
                      <Bold className="h-3 w-3 mr-1" />Negrito
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => insertTag("ITALIC")}>
                      <Italic className="h-3 w-3 mr-1" />Itálico
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => insertTag("IMAGE")}>
                      <ImageIcon className="h-3 w-3 mr-1" />Imagem
                    </Button>
                  </div>
                  <div className="mb-2">
                    <Label className="text-xs">Inserir variável:</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {VARIABLES.map((v) => (
                        <Button
                          key={v.key}
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => insertVariable(v.key)}
                          title={v.label}
                        >
                          {`{{${v.key}}}`}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Label>Nome do template</Label>
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="mb-2"
                  />
                  <Textarea
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    rows={20}
                    className="font-mono text-sm"
                  />
                  <div className="flex gap-2 mt-3">
                    <Button onClick={() => setShowPreview((s) => !s)} variant="outline" size="sm">
                      <Eye className="h-4 w-4 mr-1" />
                      {showPreview ? "Ocultar" : "Mostrar"} preview
                    </Button>
                    <Button
                      onClick={() => updateMutation.mutate({
                        id: editing.id,
                        updates: {
                          bl_template_web: draftContent,
                          ds_name: draftName,
                        },
                      })}
                      disabled={updateMutation.isPending}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      {updateMutation.isPending ? "Salvando..." : "Salvar"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {showPreview && (
                <Card className="col-span-5">
                  <CardHeader>
                    <CardTitle>Preview</CardTitle>
                    <CardDescription>
                      Renderização com dados de exemplo: {SAMPLE.nome}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div
                      className="prose prose-sm max-w-none p-4 border rounded bg-white"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(previewHtml || "<em>— vazio —</em>", {
                          ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'p', 'br', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
                          ALLOWED_ATTR: ['class', 'style'],
                          ALLOW_DATA_ATTR: false,
                        })
                      }}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ReportTemplateEditor;
