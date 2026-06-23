/**
 * TriageForm — Formulário completo de triagem de enfermagem
 *
 * Sub-componente de TriagePanel. Renderiza:
 * - Queixa principal + HDA
 * - Sinais vitais (PA, FC, FR, SpO2, T, glicemia, dor)
 * - Antropometria (peso, altura)
 * - Glasgow (3 inputs)
 * - Alergias, medicações, observações
 * - Botão "Classificar Manchester" (preview)
 * - Botão "Salvar Triagem"
 */

import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Activity, Brain, Heart, Ruler, Thermometer, Droplet, Wind, Save, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { friendlyError } from "@/utils/friendlyError";
import {
  classificarManchester,
  calcularNEWS2,
  type SinaisVitais,
  type GlasgowScore,
  type TriagemCreate,
  type ClassificacaoCor,
  type ClassificacaoRisco,
} from "@/services/nursingService";

interface TriageFormProps {
  cdPaciente: number;
  companyId: string;
  classificacoes: ClassificacaoRisco[];
  cdAppointment?: number;
  cdUsuarioEnfermeiro?: string;
  onSubmit: (data: TriagemCreate, corSugerida: ClassificacaoCor) => Promise<void>;
  onCancel: () => void;
}

const initialSinais: SinaisVitais = {
  pressaoSistolica: null,
  pressaoDiastolica: null,
  frequenciaCardiaca: null,
  frequenciaRespiratoria: null,
  temperatura: null,
  saturacaoO2: null,
  glicemia: null,
  escalaDor: 0,
};

export function TriageForm(props: TriageFormProps): JSX.Element {
  const { toast } = useToast();
  const [sinais, setSinais] = useState<SinaisVitais>(initialSinais);
  const [queixa, setQueixa] = useState<string>("");
  const [hda, setHda] = useState<string>("");
  const [medicacoes, setMedicacoes] = useState<string>("");
  const [alergias, setAlergias] = useState<string>("");
  const [observacoes, setObservacoes] = useState<string>("");
  const [peso, setPeso] = useState<string>("");
  const [altura, setAltura] = useState<string>("");
  const [glasgowOcular, setGlasgowOcular] = useState<number>(4);
  const [glasgowVerbal, setGlasgowVerbal] = useState<number>(5);
  const [glasgowMotor, setGlasgowMotor] = useState<number>(6);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [corSugerida, setCorSugerida] = useState<ClassificacaoCor | null>(null);

  const glasgow: GlasgowScore = useMemo(
    () => ({ ocular: glasgowOcular, verbal: glasgowVerbal, motor: glasgowMotor }),
    [glasgowOcular, glasgowVerbal, glasgowMotor],
  );
  const glasgowTotal = glasgowOcular + glasgowVerbal + glasgowMotor;

  // Cálculo em tempo real da sugestão de classificação Manchester
  const handlePreviewClassificacao = useCallback((): void => {
    const cor = classificarManchester(sinais, queixa);
    setCorSugerida(cor);
  }, [sinais, queixa]);

  // Cálculo em tempo real do NEWS2
  const news2 = useMemo(
    () =>
      calcularNEWS2({
        frequenciaRespiratoria: sinais.frequenciaRespiratoria,
        saturacaoO2: sinais.saturacaoO2,
        temperatura: sinais.temperatura,
        pressaoSistolica: sinais.pressaoSistolica,
        frequenciaCardiaca: sinais.frequenciaCardiaca,
        nivelConsciencia: glasgowTotal < 15 ? 1 : 0,
      }),
    [sinais, glasgowTotal],
  );

  const handleSinaisChange = useCallback(
    (field: keyof SinaisVitais, value: string): void => {
      if (value === "") {
        setSinais((prev) => ({ ...prev, [field]: null }));
        return;
      }
      const num = Number(value);
      if (Number.isNaN(num)) return;
      setSinais((prev) => ({ ...prev, [field]: num }));
    },
    [],
  );

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!queixa.trim()) {
      toast({ title: "Queixa principal obrigatória", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Se ainda não tem cor sugerida, calcular agora
      const cor = corSugerida ?? classificarManchester(sinais, queixa);
      const cdClassificacao =
        props.classificacoes.find((c) => c.ds_classificacao === cor)?.id ?? null;
      const triagem: TriagemCreate = {
        company_id: props.companyId,
        cd_paciente: props.cdPaciente,
        cd_appointment: props.cdAppointment,
        cd_classificacao_id: cdClassificacao,
        cd_usuario_enfermeiro: props.cdUsuarioEnfermeiro,
        queixa_principal: queixa,
        historia_doenca_atual: hda,
        medicamentos_uso: medicacoes,
        alergias,
        observacoes_enfermagem: observacoes,
        sinaisVitais: sinais,
        antropometria: {
          pesoKg: peso ? Number(peso) : null,
          alturaCm: altura ? Number(altura) : null,
        },
        glasgow,
        tp_status: "TRIADO",
      };
      await props.onSubmit(triagem, cor);
      toast({ title: "Triagem salva com sucesso", description: `Classificação: ${cor}` });
    } catch (err: unknown) {
      toast({ title: "Erro ao salvar triagem", description: friendlyError(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [corSugerida, sinais, queixa, hda, medicacoes, alergias, observacoes, peso, altura, glasgow, props, toast]);

  const classBadge = (label: string, hex: string, ativo: boolean): JSX.Element => (
    <button
      type="button"
      key={label}
      onClick={() => setCorSugerida(label as ClassificacaoCor)}
      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all border-2 ${
        ativo ? "ring-2 ring-offset-2 ring-foreground scale-105" : "opacity-70 hover:opacity-100"
      }`}
      style={{
        background: hex,
        color: "white",
        borderColor: ativo ? "white" : "transparent",
      }}
      aria-pressed={ativo}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Classificação visual */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Classificação de Risco
              </CardTitle>
              <CardDescription>Manchester — clique para definir manualmente</CardDescription>
            </div>
            {corSugerida && (
              <Badge
                style={{
                  background: props.classificacoes.find((c) => c.ds_classificacao === corSugerida)?.cd_cor_hex,
                  color: "white",
                }}
              >
                {corSugerida}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(["VERMELHO", "LARANJA", "AMARELO", "VERDE", "AZUL"] as ClassificacaoCor[]).map((cor) => {
            const meta = props.classificacoes.find((c) => c.ds_classificacao === cor);
            return classBadge(cor, meta?.cd_cor_hex ?? "#888", corSugerida === cor);
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handlePreviewClassificacao}
            className="ml-auto"
          >
            Sugerir (algoritmo)
          </Button>
        </CardContent>
      </Card>

      {/* Queixa + HDA */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Anamnese</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="queixa">Queixa principal *</Label>
            <Textarea
              id="queixa"
              value={queixa}
              onChange={(e) => setQueixa(e.target.value)}
              placeholder="Ex.: 'Dor torácica há 2h irradiando para braço esquerdo'"
              rows={2}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hda">História da doença atual</Label>
            <Textarea
              id="hda"
              value={hda}
              onChange={(e) => setHda(e.target.value)}
              rows={3}
              placeholder="Início, duração, características, fatores de piora/melhora..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Sinais vitais */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Sinais Vitais
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <VitalInput
            id="pas"
            label="P. Sistólica"
            unit="mmHg"
            icon={<Heart className="h-3 w-3" />}
            value={sinais.pressaoSistolica}
            onChange={(v) => handleSinaisChange("pressaoSistolica", v)}
          />
          <VitalInput
            id="pad"
            label="P. Diastólica"
            unit="mmHg"
            icon={<Heart className="h-3 w-3" />}
            value={sinais.pressaoDiastolica}
            onChange={(v) => handleSinaisChange("pressaoDiastolica", v)}
          />
          <VitalInput
            id="fc"
            label="FC"
            unit="bpm"
            icon={<Heart className="h-3 w-3" />}
            value={sinais.frequenciaCardiaca}
            onChange={(v) => handleSinaisChange("frequenciaCardiaca", v)}
          />
          <VitalInput
            id="fr"
            label="FR"
            unit="irpm"
            icon={<Wind className="h-3 w-3" />}
            value={sinais.frequenciaRespiratoria}
            onChange={(v) => handleSinaisChange("frequenciaRespiratoria", v)}
          />
          <VitalInput
            id="temp"
            label="Temperatura"
            unit="°C"
            icon={<Thermometer className="h-3 w-3" />}
            value={sinais.temperatura}
            onChange={(v) => handleSinaisChange("temperatura", v)}
            step="0.1"
          />
          <VitalInput
            id="spo2"
            label="SpO2"
            unit="%"
            icon={<Droplet className="h-3 w-3" />}
            value={sinais.saturacaoO2}
            onChange={(v) => handleSinaisChange("saturacaoO2", v)}
          />
          <VitalInput
            id="gli"
            label="Glicemia"
            unit="mg/dL"
            value={sinais.glicemia}
            onChange={(v) => handleSinaisChange("glicemia", v)}
          />
          <div className="space-y-1.5 col-span-2 md:col-span-1">
            <Label htmlFor="dor" className="text-xs flex items-center justify-between">
              <span>Dor (EVA)</span>
              <span className="font-bold text-primary">{sinais.escalaDor ?? 0}/10</span>
            </Label>
            <Slider
              id="dor"
              min={0}
              max={10}
              step={1}
              value={[sinais.escalaDor ?? 0]}
              onValueChange={(v) => setSinais((p) => ({ ...p, escalaDor: v[0] }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Antropometria + Glasgow */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Ruler className="h-4 w-4 text-primary" /> Antropometria e Glasgow
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="peso">Peso (kg)</Label>
              <Input
                id="peso"
                type="number"
                step="0.1"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                placeholder="70.5"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="altura">Altura (cm)</Label>
              <Input
                id="altura"
                type="number"
                step="0.1"
                value={altura}
                onChange={(e) => setAltura(e.target.value)}
                placeholder="170"
              />
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm">
              <Brain className="h-3.5 w-3.5" /> Escala de Glasgow
              <Badge variant={glasgowTotal < 13 ? "destructive" : "secondary"} className="ml-2">
                Total: {glasgowTotal}/15
              </Badge>
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <GlasgowField
                label="Ocular"
                value={glasgowOcular}
                onChange={setGlasgowOcular}
                min={1}
                max={4}
              />
              <GlasgowField
                label="Verbal"
                value={glasgowVerbal}
                onChange={setGlasgowVerbal}
                min={1}
                max={5}
              />
              <GlasgowField
                label="Motor"
                value={glasgowMotor}
                onChange={setGlasgowMotor}
                min={1}
                max={6}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alergias + medicações + observações */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Histórico e Observações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="alergias">Alergias</Label>
            <Input
              id="alergias"
              value={alergias}
              onChange={(e) => setAlergias(e.target.value)}
              placeholder="Ex.: AAS, dipirona, frutos do mar"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="med">Medicações em uso</Label>
            <Textarea
              id="med"
              value={medicacoes}
              onChange={(e) => setMedicacoes(e.target.value)}
              rows={2}
              placeholder="Ex.: Losartana 50mg 12/12h, Metformina 850mg 8/8h"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="obs">Observações de enfermagem</Label>
            <Textarea
              id="obs"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
              placeholder="Estado geral, pupilas, coloração, locomoção..."
            />
          </div>
        </CardContent>
      </Card>

      {/* NEWS2 score em tempo real */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">NEWS2 Score</CardTitle>
            <Badge
              variant={
                news2.classificacao === "ALTO" ? "destructive" : news2.classificacao === "MEDIO" ? "default" : "secondary"
              }
            >
              {news2.score} pts — {news2.classificacao}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center text-xs">
            <News2Cell label="FR" value={news2.detalhes.fr} />
            <News2Cell label="SpO2" value={news2.detalhes.spo2} />
            <News2Cell label="Temp" value={news2.detalhes.temp} />
            <News2Cell label="PAS" value={news2.detalhes.pas} />
            <News2Cell label="FC" value={news2.detalhes.fc} />
            <News2Cell label="Consc." value={news2.detalhes.consciencia} />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit} disabled={submitting} className="flex-1">
          <Save className="h-4 w-4 mr-2" />
          {submitting ? "Salvando..." : "Salvar Triagem"}
        </Button>
        <Button onClick={props.onCancel} variant="outline" disabled={submitting}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

interface VitalInputProps {
  id: string;
  label: string;
  unit: string;
  icon?: React.ReactNode;
  value: number | null;
  onChange: (v: string) => void;
  step?: string;
}

function VitalInput({ id, label, unit, icon, value, onChange, step }: VitalInputProps): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs flex items-center gap-1">
        {icon}
        {label} <span className="text-muted-foreground">({unit})</span>
      </Label>
      <Input
        id={id}
        type="number"
        step={step ?? "1"}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-9"
      />
    </div>
  );
}

interface GlasgowFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}

function GlasgowField({ label, value, onChange, min, max }: GlasgowFieldProps): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v) && v >= min && v <= max) onChange(v);
        }}
        className="h-9 text-center font-semibold"
      />
    </div>
  );
}

function News2Cell({ label, value }: { label: string; value: number }): JSX.Element {
  const bg = value === 0 ? "bg-green-100 text-green-900" : value === 1 ? "bg-yellow-100 text-yellow-900" : value === 2 ? "bg-orange-100 text-orange-900" : "bg-red-100 text-red-900";
  return (
    <div className={`p-2 rounded ${bg}`}>
      <div className="font-bold text-base">{value}</div>
      <div className="text-[10px] uppercase">{label}</div>
    </div>
  );
}

export default TriageForm;
