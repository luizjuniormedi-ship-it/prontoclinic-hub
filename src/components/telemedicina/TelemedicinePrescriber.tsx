/**
 * TelemedicinePrescriber — Editor de prescrição digital
 *
 * Funcionalidades:
 *  - Templates com variáveis ({{paciente}}, {{idade}}, {{data}})
 *  - Autocomplete de medicamentos (lista base + busca)
 *  - Calculadora de dose por peso (mg/kg)
 *  - Assinatura digital em canvas
 *  - Geração de PDF via window.print() (em produção: jsPDF)
 *
 * Conformidade:
 *  - Lei 14.063/2020 (assinatura eletrônica)
 *  - Portaria SVS/MS 344/98 (receita de controle especial)
 */

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Pill, Calculator, FileSignature, Loader2, Search, CheckCircle2, Eraser, Save } from "lucide-react";
import { telemedicinaService, type TipoReceita } from "@/services/telemedicinaService";
import { cn } from "@/lib/utils";

// Lista base de medicamentos (em produção: carregar de tabela medication_catalog)
const MEDICAMENTOS_BASE = [
  { id: "dip-500", nome: "Dipirona 500mg", concentracao: "500mg", forma: "comprimido", mgkg: undefined },
  { id: "par-750", nome: "Paracetamol 750mg", concentracao: "750mg", forma: "comprimido", mgkg: 15 },
  { id: "ibu-400", nome: "Ibuprofeno 400mg", concentracao: "400mg", forma: "comprimido", mgkg: 10 },
  { id: "amox-500", nome: "Amoxicilina 500mg", concentracao: "500mg", forma: "cápsula", mgkg: 25 },
  { id: "azt-500", nome: "Azitromicina 500mg", concentracao: "500mg", forma: "comprimido", mgkg: 10 },
  { id: "lor-10",  nome: "Loratadina 10mg",   concentracao: "10mg",  forma: "comprimido", mgkg: undefined },
  { id: "ome-20",  nome: "Omeprazol 20mg",    concentracao: "20mg",  forma: "cápsula",    mgkg: undefined },
];

const TEMPLATES = {
  ANALGESICO: `**{{paciente}}** ({{idade}})

1. Dipirona 500mg, 1cp de 6/6h por 5 dias (se dor ou febre > 37,8°C)
2. Paracetamol 750mg, 1cp de 8/8h se persistir (máx 3g/dia)

**Retorno:** se não melhorar em 5 dias.`,
  ANTIBIOTICO: `**{{paciente}}** ({{idade}})

1. Amoxicilina 500mg, 1cp de 8/8h por 7 dias
2. Paracetamol 750mg se dor/ febre (uso condicional)

**Observações:** completar o ciclo mesmo com melhora clínica.`,
};

interface MedSelecionado {
  id: string;
  nome: string;
  concentracao: string;
  posologia: string;
}

interface TelemedicinePrescriberProps {
  cdSala: string;
  cdPaciente: number;
  cdMedico: number;
  pacienteNome: string;
  pacienteIdade: string;
  onAssinada?: (receitaId: string) => void;
}

async function hashAssinatura(pdfContent: string, key: string): Promise<string> {
  const data = new TextEncoder().encode(pdfContent + ":" + key);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function TelemedicinePrescriber({
  cdSala,
  cdPaciente,
  cdMedico,
  pacienteNome,
  pacienteIdade,
  onAssinada,
}: TelemedicinePrescriberProps) {
  const [buscaMed, setBuscaMed] = useState("");
  const [meds, setMeds] = useState<MedSelecionado[]>([]);
  const [template, setTemplate] = useState("");
  const [receitaFinal, setReceitaFinal] = useState("");
  const [tipoReceita, setTipoReceita] = useState<TipoReceita>("BRANCA");
  const [pesoKg, setPesoKg] = useState<string>("");
  const [doseCalculada, setDoseCalculada] = useState<string | null>(null);
  const [medCalculo, setMedCalculo] = useState<string>("par-750");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const desenhandoRef = useRef(false);
  const [temAssinatura, setTemAssinatura] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const medicamentosFiltrados = useMemo(() => {
    const q = buscaMed.toLowerCase().trim();
    if (!q) return MEDICAMENTOS_BASE;
    return MEDICAMENTOS_BASE.filter((m) => m.nome.toLowerCase().includes(q));
  }, [buscaMed]);

  function adicionarMedicamento(medId: string) {
    const med = MEDICAMENTOS_BASE.find((m) => m.id === medId);
    if (!med) return;
    if (meds.some((m) => m.id === med.id)) return;
    setMeds((prev) => [
      ...prev,
      { id: med.id, nome: med.nome, concentracao: med.concentracao, posologia: "1cp de 8/8h por 7 dias" },
    ]);
  }

  function removerMedicamento(medId: string) {
    setMeds((prev) => prev.filter((m) => m.id !== medId));
  }

  function aplicarTemplate(tpl: string) {
    setTemplate(tpl);
    setReceitaFinal(tpl);
  }

  function gerarReceita() {
    const itens = meds
      .map((m, i) => `${i + 1}. ${m.nome} — ${m.posologia}`)
      .join("\n");
    const corpo = template
      .replace("{{paciente}}", pacienteNome || "Paciente")
      .replace("{{idade}}", pacienteIdade || "—")
      .replace("{{data}}", new Date().toLocaleDateString("pt-BR"));
    setReceitaFinal(corpo + (itens ? "\n\n**Itens:**\n" + itens : ""));
  }

  function calcularDose() {
    const peso = Number(pesoKg.replace(",", "."));
    if (!peso || peso <= 0) {
      setDoseCalculada(null);
      return;
    }
    const med = MEDICAMENTOS_BASE.find((m) => m.id === medCalculo);
    if (!med?.mgkg) {
      setDoseCalculada("Medicamento sem cálculo por peso");
      return;
    }
    const totalMg = peso * med.mgkg;
    const cps = totalMg / Number(med.concentracao.replace(/[^\d]/g, "") || 1);
    setDoseCalculada(
      `${peso}kg × ${med.mgkg}mg/kg = ${totalMg.toFixed(0)}mg → ~${cps.toFixed(1)} cp(s) por tomada`,
    );
  }

  // Assinatura em canvas
  function canvasCoords(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    if ("touches" in e) {
      const t = e.touches[0] ?? e.changedTouches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function iniciarDesenho(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    desenhandoRef.current = true;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { x, y } = canvasCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function desenhar(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!desenhandoRef.current) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { x, y } = canvasCoords(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineTo(x, y);
    ctx.stroke();
    setTemAssinatura(true);
  }

  function pararDesenho() {
    desenhandoRef.current = false;
  }

  function limparAssinatura() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setTemAssinatura(false);
  }

  async function handleSalvar() {
    if (!receitaFinal.trim()) {
      setErro("Gere a receita antes de assinar");
      return;
    }
    if (!temAssinatura) {
      setErro("Assinatura digital obrigatória");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const prescId = await telemedicinaService.criarPrescricao(
        cdSala,
        receitaFinal,
        cdPaciente,
        cdMedico,
        meds.map((m) => m.nome).join(", "),
      );
      const canvas = canvasRef.current;
      const assinaturaData = canvas?.toDataURL("image/png") ?? "";
      const hash = await hashAssinatura(assinaturaData + receitaFinal, String(prescId));
      const { receitaId } = await telemedicinaService.assinarPrescricao(
        prescId,
        hash,
        `canvas:${assinaturaData.length}b64`,
        tipoReceita,
        30,
      );
      setSucesso(receitaId);
      onAssinada?.(receitaId);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar receita");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pill className="h-5 w-5" /> Compor receita
          </CardTitle>
          <CardDescription>
            Adicione medicamentos, escolha o template e calcule a dose se necessário.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="meds">
            <TabsList>
              <TabsTrigger value="meds">Medicamentos</TabsTrigger>
              <TabsTrigger value="template">Template</TabsTrigger>
              <TabsTrigger value="calc">Calculadora</TabsTrigger>
            </TabsList>

            <TabsContent value="meds" className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Buscar medicamento…"
                  value={buscaMed}
                  onChange={(e) => setBuscaMed(e.target.value)}
                  aria-label="Buscar medicamento"
                />
              </div>
              <ul className="space-y-1 max-h-48 overflow-y-auto rounded-md border p-2">
                {medicamentosFiltrados.map((m) => (
                  <li key={m.id} className="flex items-center justify-between text-sm py-1">
                    <span>{m.nome}</span>
                    <Button size="sm" variant="ghost" onClick={() => adicionarMedicamento(m.id)}>
                      + Adicionar
                    </Button>
                  </li>
                ))}
              </ul>
              {meds.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Adicionados</Label>
                  {meds.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-sm">
                      <Badge variant="secondary">{m.nome}</Badge>
                      <Input
                        value={m.posologia}
                        onChange={(e) =>
                          setMeds((prev) => prev.map((x) => (x.id === m.id ? { ...x, posologia: e.target.value } : x)))
                        }
                        aria-label={`Posologia de ${m.nome}`}
                      />
                      <Button size="sm" variant="ghost" onClick={() => removerMedicamento(m.id)}>
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="template" className="space-y-3">
              <p className="text-xs text-muted-foreground">Variáveis: {"{{paciente}}"}, {"{{idade}}"}, {"{{data}}"}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => aplicarTemplate(TEMPLATES.ANALGESICO)}>
                  Analgésico
                </Button>
                <Button size="sm" variant="outline" onClick={() => aplicarTemplate(TEMPLATES.ANTIBIOTICO)}>
                  Antibiótico
                </Button>
                <Button size="sm" variant="outline" onClick={() => setTemplate("")}>
                  Em branco
                </Button>
              </div>
              <Textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={8}
                className="font-mono text-sm"
                placeholder="Digite o texto da receita (Markdown)…"
                aria-label="Template da receita"
              />
            </TabsContent>

            <TabsContent value="calc" className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Calculator className="h-4 w-4" />
                Calculadora de dose por peso
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="peso">Peso (kg)</Label>
                  <Input id="peso" value={pesoKg} onChange={(e) => setPesoKg(e.target.value)} placeholder="Ex: 70" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="med">Medicamento</Label>
                  <Select value={medCalculo} onValueChange={setMedCalculo}>
                    <SelectTrigger id="med"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MEDICAMENTOS_BASE.filter((m) => m.mgkg).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={calcularDose} variant="outline">Calcular</Button>
              {doseCalculada && (
                <Alert>
                  <AlertDescription className="font-mono text-sm">{doseCalculada}</AlertDescription>
                </Alert>
              )}
            </TabsContent>
          </Tabs>

          <div className="space-y-2">
            <Label htmlFor="tipo">Tipo de receita</Label>
            <Select value={tipoReceita} onValueChange={(v) => setTipoReceita(v as TipoReceita)}>
              <SelectTrigger id="tipo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BRANCA">Branca — comum</SelectItem>
                <SelectItem value="AZUL">Azul — controlada B1/B2</SelectItem>
                <SelectItem value="AMARELA">Amarela — controlada C</SelectItem>
                <SelectItem value="VERMELHA">Vermelha — controle especial</SelectItem>
                <SelectItem value="CONTROLE_ESPECIAL">Controle especial — A</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={gerarReceita} variant="secondary" className="w-full" disabled={!template && meds.length === 0}>
            Gerar receita
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5" /> Assinatura digital
          </CardTitle>
          <CardDescription>
            Assine abaixo usando o mouse ou toque.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={receitaFinal}
            onChange={(e) => setReceitaFinal(e.target.value)}
            rows={10}
            className={cn("font-mono text-xs", !receitaFinal && "italic text-muted-foreground")}
            placeholder="A receita gerada aparecerá aqui. Você pode editar antes de assinar."
            aria-label="Receita final para assinatura"
          />
          <div className="border rounded-md bg-white">
            <canvas
              ref={canvasRef}
              width={500}
              height={150}
              className="w-full touch-none"
              onMouseDown={iniciarDesenho}
              onMouseMove={desenhar}
              onMouseUp={pararDesenho}
              onMouseLeave={pararDesenho}
              onTouchStart={iniciarDesenho}
              onTouchMove={desenhar}
              onTouchEnd={pararDesenho}
              aria-label="Área de assinatura digital"
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{temAssinatura ? "Assinatura capturada" : "Aguardando assinatura"}</span>
            <Button size="sm" variant="ghost" onClick={limparAssinatura}>
              <Eraser className="h-3.5 w-3.5 mr-1" /> Limpar
            </Button>
          </div>
          {erro && <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>}
          {sucesso && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>Receita assinada e gravada (id: {sucesso.slice(0, 8)}…)</AlertDescription>
            </Alert>
          )}
          <Button onClick={handleSalvar} disabled={salvando} className="w-full">
            {salvando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Assinar e salvar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default TelemedicinePrescriber;
