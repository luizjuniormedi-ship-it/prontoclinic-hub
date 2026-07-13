/**
 * nursingService — Módulo de Enfermagem e Triagem
 *
 * Funcionalidades:
 * - Classificação de risco Manchester (5 cores)
 * - NEWS2 (National Early Warning Score 2)
 * - Fila de triagem com senhas sequenciais
 * - Sinais vitais, antropometria, escala de dor, Glasgow
 *
 * Migration relacionada: 20260101000016_enfermagem.sql
 * Seed: supabase/seed_nursing.sql
 */

import { supabase } from "@/lib/supabase";

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export type ClassificacaoCor = "VERMELHO" | "LARANJA" | "AMARELO" | "VERDE" | "AZUL";
export type News2Classificacao = "BAIXO" | "MEDIO" | "ALTO";
export type TriagemStatus = "AGUARDANDO" | "EM_TRIAGEM" | "TRIADO" | "ENCAMINHADO" | "FINALIZADO";
export type FilaStatus = "AGUARDANDO" | "CHAMADO" | "EM_TRIAGEM" | "TRIADO" | "DESISTIU";

export interface ClassificacaoRisco {
  id: number;
  company_id?: string | null;
  ds_classificacao: ClassificacaoCor;
  cd_cor_hex: string;
  nr_tempo_max_atendimento_min: number;
  ds_descricao?: string | null;
  lg_ativo: boolean;
  cd_origem_sigh?: number | null;
  created_at: string;
}

export interface FluxogramaPergunta {
  id: number;
  company_id?: string | null;
  ds_discriminador: string;
  ds_pergunta: string;
  cd_classificacao_se_sim: string;
  cd_ordem: number;
  ds_categoria?: string | null;
  lg_ativo: boolean;
  created_at: string;
}

export interface SinaisVitais {
  pressaoSistolica?: number | null;
  pressaoDiastolica?: number | null;
  frequenciaCardiaca?: number | null;
  frequenciaRespiratoria?: number | null;
  temperatura?: number | null;
  saturacaoO2?: number | null;
  glicemia?: number | null;
  escalaDor?: number | null;
}

export interface DadosAntropometricos {
  pesoKg?: number | null;
  alturaCm?: number | null;
}

export interface GlasgowScore {
  ocular: number;   // 1-4
  verbal: number;   // 1-5
  motor: number;    // 1-6
}

export interface TriagemCreate {
  company_id: string;
  cd_paciente: number;
  cd_appointment?: number | null;
  cd_classificacao_id?: number | null;
  cd_usuario_enfermeiro?: string | null;
  queixa_principal?: string;
  historia_doenca_atual?: string;
  medicamentos_uso?: string;
  alergias?: string;
  observacoes_enfermagem?: string;
  sinaisVitais: SinaisVitais;
  antropometria?: DadosAntropometricos;
  glasgow?: GlasgowScore | null;
  tp_status?: TriagemStatus;
}

export interface Triagem extends TriagemCreate {
  id: number;
  dt_triagem: string;
  dt_encaminhamento?: string | null;
  cd_destino?: string | null;
  cd_origem_sigh?: number | null;
  created_at: string;
  // Campos derivados
  vl_pressao_sistolica?: number | null;
  vl_pressao_diastolica?: number | null;
  vl_frequencia_cardiaca?: number | null;
  vl_frequencia_respiratoria?: number | null;
  vl_temperatura?: number | null;
  vl_saturacao_o2?: number | null;
  vl_glicemia?: number | null;
  vl_escala_dor?: number | null;
  vl_peso_kg?: number | null;
  vl_altura_cm?: number | null;
  vl_glasgow_ocular?: number | null;
  vl_glasgow_verbal?: number | null;
  vl_glasgow_motor?: number | null;
  vl_glasgow_total?: number | null;
}

export interface FilaItem {
  id: number;
  company_id: string;
  cd_paciente: number;
  dt_chegada: string;
  dt_chamada?: string | null;
  cd_senha: string;
  cd_classificacao_id?: number | null;
  tp_status: FilaStatus;
  ds_queixa_inicial?: string | null;
  cd_cor_hex?: string | null;
  created_at: string;
}

export interface FluxogramaResposta {
  id: number;
  cd_triagem: number;
  cd_fluxograma: number;
  lg_sim: boolean;
  dt_resposta: string;
}

export interface News2Avaliacao {
  id: number;
  company_id: string;
  cd_triagem: number;
  nr_frequencia_respiratoria: number | null;
  nr_saturacao_o2: number | null;
  nr_temperatura: number | null;
  nr_pressao_sistolica: number | null;
  nr_frequencia_cardiaca: number | null;
  nr_nivel_consciencia: number | null;
  nr_score_total: number | null;
  cd_classificacao_risco: News2Classificacao | null;
  dt_avaliacao: string;
}

// ─── Helpers internos ───────────────────────────────────────────────────────

interface TriagemRow {
  id: number;
  company_id: string;
  cd_paciente: number;
  cd_appointment: number | null;
  dt_triagem: string;
  cd_classificacao_id: number | null;
  cd_usuario_enfermeiro: string | null;
  vl_pressao_sistolica: number | null;
  vl_pressao_diastolica: number | null;
  vl_frequencia_cardiaca: number | null;
  vl_frequencia_respiratoria: number | null;
  vl_temperatura: number | null;
  vl_saturacao_o2: number | null;
  vl_glicemia: number | null;
  vl_escala_dor: number | null;
  vl_peso_kg: number | null;
  vl_altura_cm: number | null;
  vl_glasgow_ocular: number | null;
  vl_glasgow_verbal: number | null;
  vl_glasgow_motor: number | null;
  vl_glasgow_total: number | null;
  ds_queixa_principal: string | null;
  ds_historia_doenca_atual: string | null;
  ds_medicamentos_uso: string | null;
  ds_alergias: string | null;
  ds_observacoes_enfermagem: string | null;
  tp_status: TriagemStatus;
  dt_encaminhamento: string | null;
  cd_destino: string | null;
  cd_origem_sigh: number | null;
  created_at: string;
}

function mapRowToTriagem(row: TriagemRow): Triagem {
  return {
    id: row.id,
    company_id: row.company_id,
    cd_paciente: row.cd_paciente,
    cd_appointment: row.cd_appointment,
    dt_triagem: row.dt_triagem,
    cd_classificacao_id: row.cd_classificacao_id,
    cd_usuario_enfermeiro: row.cd_usuario_enfermeiro,
    vl_pressao_sistolica: row.vl_pressao_sistolica,
    vl_pressao_diastolica: row.vl_pressao_diastolica,
    vl_frequencia_cardiaca: row.vl_frequencia_cardiaca,
    vl_frequencia_respiratoria: row.vl_frequencia_respiratoria,
    vl_temperatura: row.vl_temperatura ? Number(row.vl_temperatura) : null,
    vl_saturacao_o2: row.vl_saturacao_o2,
    vl_glicemia: row.vl_glicemia,
    vl_escala_dor: row.vl_escala_dor,
    vl_peso_kg: row.vl_peso_kg ? Number(row.vl_peso_kg) : null,
    vl_altura_cm: row.vl_altura_cm ? Number(row.vl_altura_cm) : null,
    vl_glasgow_ocular: row.vl_glasgow_ocular,
    vl_glasgow_verbal: row.vl_glasgow_verbal,
    vl_glasgow_motor: row.vl_glasgow_motor,
    vl_glasgow_total: row.vl_glasgow_total,
    queixa_principal: row.ds_queixa_principal ?? undefined,
    historia_doenca_atual: row.ds_historia_doenca_atual ?? undefined,
    medicamentos_uso: row.ds_medicamentos_uso ?? undefined,
    alergias: row.ds_alergias ?? undefined,
    observacoes_enfermagem: row.ds_observacoes_enfermagem ?? undefined,
    sinaisVitais: {
      pressaoSistolica: row.vl_pressao_sistolica,
      pressaoDiastolica: row.vl_pressao_diastolica,
      frequenciaCardiaca: row.vl_frequencia_cardiaca,
      frequenciaRespiratoria: row.vl_frequencia_respiratoria,
      temperatura: row.vl_temperatura ? Number(row.vl_temperatura) : null,
      saturacaoO2: row.vl_saturacao_o2,
      glicemia: row.vl_glicemia,
      escalaDor: row.vl_escala_dor,
    },
    antropometria: {
      pesoKg: row.vl_peso_kg ? Number(row.vl_peso_kg) : null,
      alturaCm: row.vl_altura_cm ? Number(row.vl_altura_cm) : null,
    },
    glasgow:
      row.vl_glasgow_ocular && row.vl_glasgow_verbal && row.vl_glasgow_motor
        ? {
            ocular: row.vl_glasgow_ocular,
            verbal: row.vl_glasgow_verbal,
            motor: row.vl_glasgow_motor,
          }
        : null,
    tp_status: row.tp_status,
    dt_encaminhamento: row.dt_encaminhamento,
    cd_destino: row.cd_destino,
    cd_origem_sigh: row.cd_origem_sigh,
    created_at: row.created_at,
  };
}

function requireIdempotencyKey(value: string): string {
  const key = value?.trim();
  if (!key) throw new Error("Chave de idempotência é obrigatória.");
  return key;
}

function createIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

const pendingEnqueueKeys = new Map<string, string>();
const pendingCallKeys = new Map<number, string>();

function requireRecord(value: unknown, operation: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${operation}: resposta inválida do servidor.`);
  }
  return value as Record<string, unknown>;
}

function unwrapRecord(value: unknown, operation: string, keys: string[]): Record<string, unknown> {
  const response = requireRecord(value, operation);
  for (const key of keys) {
    if (key in response) return requireRecord(response[key], operation);
  }
  return response;
}

function requireFilaItem(value: unknown, operation: string): FilaItem {
  const row = unwrapRecord(value, operation, ["queue_item", "fila", "item"]);
  if (
    typeof row.id !== "number"
    || typeof row.cd_paciente !== "number"
    || typeof row.cd_senha !== "string"
    || typeof row.tp_status !== "string"
  ) {
    throw new Error(`${operation}: item de fila inválido na resposta.`);
  }
  return row as unknown as FilaItem;
}

function requireTriagem(value: unknown, operation: string): Triagem {
  const row = unwrapRecord(value, operation, ["triage", "triagem"]);
  if (typeof row.id !== "number" || typeof row.cd_paciente !== "number" || typeof row.tp_status !== "string") {
    throw new Error(`${operation}: triagem inválida na resposta.`);
  }
  return mapRowToTriagem(row as unknown as TriagemRow);
}

function requireCompletedTriagem(value: unknown, operation: string): Triagem {
  const response = requireRecord(value, operation);
  const triagem = requireTriagem(response.triage, operation);
  requireFilaItem(response.queue_item, operation);
  const news2 = requireRecord(response.news2, operation);
  if (typeof news2.nr_score_total !== "number" || typeof news2.cd_classificacao_risco !== "string") {
    throw new Error(`${operation}: avaliação NEWS2 inválida na resposta.`);
  }
  return triagem;
}

// ─── NEWS2 — algoritmo clínico ──────────────────────────────────────────────

/**
 * Pontua um único parâmetro do NEWS2 conforme a tabela NHS.
 * Retorna 0-3 conforme gravidade do desvio da normalidade.
 */
export function calcularPontuacaoNews2(
  tipo: "FR" | "SPO2" | "TEMP" | "PAS" | "FC" | "CONSCIENCIA",
  valor: number | null | undefined,
): number {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return 0;

  switch (tipo) {
    case "FR": {
      if (valor <= 8) return 3;
      if (valor <= 11) return 1;
      if (valor <= 20) return 0;
      if (valor <= 24) return 2;
      return 3;
    }
    case "SPO2": {
      if (valor <= 91) return 3;
      if (valor <= 93) return 2;
      if (valor <= 95) return 1;
      return 0;
    }
    case "TEMP": {
      if (valor <= 35.0) return 3;
      if (valor <= 36.0) return 1;
      if (valor <= 38.0) return 0;
      if (valor <= 39.0) return 1;
      return 2;
    }
    case "PAS": {
      if (valor <= 90) return 3;
      if (valor <= 100) return 2;
      if (valor <= 110) return 1;
      if (valor <= 219) return 0;
      return 3;
    }
    case "FC": {
      if (valor <= 40) return 3;
      if (valor <= 50) return 1;
      if (valor <= 90) return 0;
      if (valor <= 110) return 1;
      if (valor <= 130) return 2;
      return 3;
    }
    case "CONSCIENCIA": {
      // V (Voice), P (Pain), U (Unresponsive) = 3 pontos
      // valor 0 = alerta (AVPU "Alert") = 0 pts
      // valor 1 = novo distúrbio (V/P/U) = 3 pts
      return valor === 0 ? 0 : 3;
    }
  }
}

export interface News2Input {
  frequenciaRespiratoria?: number | null;
  saturacaoO2?: number | null;
  temperatura?: number | null;
  pressaoSistolica?: number | null;
  frequenciaCardiaca?: number | null;
  nivelConsciencia?: number | null; // 0=alerta, 1=V/P/U (alterado)
}

export interface News2Result {
  score: number;
  classificacao: News2Classificacao;
  detalhes: {
    fr: number;
    spo2: number;
    temp: number;
    pas: number;
    fc: number;
    consciencia: number;
  };
}

export interface CompleteTriagemOptions {
  filaId: number;
  news2?: News2Result;
  idempotencyKey: string;
}

/**
 * Calcula o NEWS2 score total e a classificação de risco.
 * - BAIXO  (0-4): monitorização de rotina
 * - MEDIO  (5-6) ou score 3 em qualquer parâmetro: resposta única
 * - ALTO   (≥ 7): resposta emergente (equipe completa)
 */
export function calcularNEWS2(input: News2Input): News2Result {
  const detalhes = {
    fr: calcularPontuacaoNews2("FR", input.frequenciaRespiratoria),
    spo2: calcularPontuacaoNews2("SPO2", input.saturacaoO2),
    temp: calcularPontuacaoNews2("TEMP", input.temperatura),
    pas: calcularPontuacaoNews2("PAS", input.pressaoSistolica),
    fc: calcularPontuacaoNews2("FC", input.frequenciaCardiaca),
    consciencia: calcularPontuacaoNews2("CONSCIENCIA", input.nivelConsciencia),
  };
  const score = detalhes.fr + detalhes.spo2 + detalhes.temp + detalhes.pas + detalhes.fc + detalhes.consciencia;
  const algumaPontuacaoAlta = Object.values(detalhes).some((v) => v === 3);
  let classificacao: News2Classificacao;
  if (score >= 7) classificacao = "ALTO";
  else if (score >= 5 || algumaPontuacaoAlta) classificacao = "MEDIO";
  else classificacao = "BAIXO";
  return { score, classificacao, detalhes };
}

// ─── Classificação Manchester — algoritmo cliente ──────────────────────────

/**
 * Aplica algoritmo simplificado de Manchester no cliente (mesmo da função
 * SQL classificar_manchester). Usado para preview antes de salvar.
 */
export function classificarManchester(
  sinaisVitais: SinaisVitais,
  queixaPrincipal?: string,
): ClassificacaoCor {
  const q = (queixaPrincipal ?? "").toLowerCase();

  // VERMELHO — emergência
  if ((sinaisVitais.saturacaoO2 ?? 100) < 85) return "VERMELHO";
  if (q.includes("dispneia") || q.includes("não respira") || q.includes("inconsciente") || q.includes("choque")) {
    return "VERMELHO";
  }
  if ((sinaisVitais.temperatura ?? 36) >= 40) return "VERMELHO";
  if ((sinaisVitais.pressaoSistolica ?? 120) < 80) return "VERMELHO";

  // LARANJA — muito urgente
  if ((sinaisVitais.escalaDor ?? 0) >= 7) return "LARANJA";
  if (
    q.includes("dor torácica") ||
    q.includes("dor no peito") ||
    q.includes("hemorragia") ||
    q.includes("sangramento ativo") ||
    q.includes("convuls")
  ) {
    return "LARANJA";
  }
  if ((sinaisVitais.pressaoSistolica ?? 120) < 90 || (sinaisVitais.pressaoSistolica ?? 120) > 200) {
    return "LARANJA";
  }
  if ((sinaisVitais.saturacaoO2 ?? 100) < 90) return "LARANJA";

  // AMARELO — urgente
  if ((sinaisVitais.temperatura ?? 36) >= 39) return "AMARELO";
  if ((sinaisVitais.escalaDor ?? 0) >= 4) return "AMARELO";
  if (
    (sinaisVitais.frequenciaCardiaca ?? 80) < 50 ||
    (sinaisVitais.frequenciaCardiaca ?? 80) > 120
  ) {
    return "AMARELO";
  }
  if (q.includes("febre") || q.includes("vômito") || q.includes("vomito")) return "AMARELO";

  // VERDE — pouco urgente
  if ((sinaisVitais.escalaDor ?? 0) >= 1) return "VERDE";

  // AZUL — não urgente
  return "AZUL";
}

// ─── Validação ──────────────────────────────────────────────────────────────

export function validateTriagem(data: TriagemCreate): string | null {
  if (!data.company_id) return "company_id é obrigatório.";
  if (!data.cd_paciente) return "Paciente é obrigatório.";
  if (!data.cd_classificacao_id) return "Classificação de risco é obrigatória.";
  const sv = data.sinaisVitais;
  if (sv.pressaoSistolica === undefined || sv.pressaoSistolica === null) {
    return "Pressão sistólica (PAS) é obrigatória para calcular o NEWS2.";
  }
  if (sv.pressaoDiastolica === undefined || sv.pressaoDiastolica === null) {
    return "Pressão diastólica (PAD) é obrigatória para calcular o NEWS2.";
  }
  if (sv.frequenciaCardiaca === undefined || sv.frequenciaCardiaca === null) {
    return "Frequência cardíaca (FC) é obrigatória para calcular o NEWS2.";
  }
  if (sv.frequenciaRespiratoria === undefined || sv.frequenciaRespiratoria === null) {
    return "Frequência respiratória (FR) é obrigatória para calcular o NEWS2.";
  }
  if (sv.temperatura === undefined || sv.temperatura === null) {
    return "Temperatura é obrigatória para calcular o NEWS2.";
  }
  if (sv.saturacaoO2 === undefined || sv.saturacaoO2 === null) {
    return "Saturação de oxigênio (SpO2) é obrigatória para calcular o NEWS2.";
  }
  if (sv.pressaoSistolica < 1 || sv.pressaoSistolica > 300) {
    return "Pressão sistólica (PAS) fora da faixa permitida (1-300 mmHg).";
  }
  if (sv.pressaoDiastolica < 1 || sv.pressaoDiastolica > 200) {
    return "Pressão diastólica (PAD) fora da faixa permitida (1-200 mmHg).";
  }
  if (sv.pressaoDiastolica >= sv.pressaoSistolica) {
    return "Pressão diastólica (PAD) deve ser menor que a pressão sistólica (PAS).";
  }
  if (sv.frequenciaCardiaca < 1 || sv.frequenciaCardiaca > 250) {
    return "Frequência cardíaca (FC) fora da faixa permitida (1-250 bpm).";
  }
  if (sv.frequenciaRespiratoria < 1 || sv.frequenciaRespiratoria > 80) {
    return "Frequência respiratória (FR) fora da faixa permitida (1-80 irpm).";
  }
  if (sv.temperatura < 20 || sv.temperatura > 45) {
    return "Temperatura fora da faixa permitida (20-45°C).";
  }
  if (sv.saturacaoO2 < 1 || sv.saturacaoO2 > 100) {
    return "Saturação de oxigênio (SpO2) fora da faixa permitida (1-100%).";
  }
  if (sv.escalaDor !== undefined && sv.escalaDor !== null) {
    if (sv.escalaDor < 0 || sv.escalaDor > 10) {
      return "Escala de dor deve estar entre 0 e 10.";
    }
  }
  if (data.glasgow) {
    const g = data.glasgow;
    if (g.ocular < 1 || g.ocular > 4) return "Glasgow ocular inválido (1-4).";
    if (g.verbal < 1 || g.verbal > 5) return "Glasgow verbal inválido (1-5).";
    if (g.motor < 1 || g.motor > 6) return "Glasgow motor inválido (1-6).";
  }
  return null;
}

// ─── Service público ───────────────────────────────────────────────────────

export const nursingService = {
  classificacao: {
    async getAll(): Promise<ClassificacaoRisco[]> {
      const { data, error } = await supabase
        .from("mnct_classificacao_risco")
        .select("*")
        .eq("lg_ativo", true)
        .order("nr_tempo_max_atendimento_min");
      if (error) throw new Error(`Erro ao buscar classificações: ${error.message}`);
      return (data ?? []) as ClassificacaoRisco[];
    },
  },

  fluxograma: {
    async getAll(): Promise<FluxogramaPergunta[]> {
      const { data, error } = await supabase
        .from("mnct_fluxograma")
        .select("*")
        .eq("lg_ativo", true)
        .order("cd_ordem");
      if (error) throw new Error(`Erro ao buscar fluxograma: ${error.message}`);
      return (data ?? []) as FluxogramaPergunta[];
    },
  },

  triagem: {
    async create(data: TriagemCreate, options?: CompleteTriagemOptions): Promise<Triagem> {
      const err = validateTriagem(data);
      if (err) throw new Error(err);
      if (!options || !Number.isInteger(options.filaId) || options.filaId <= 0) {
        throw new Error("Conclusão segura exige um item válido da fila.");
      }
      const glasgowTotal = data.glasgow
        ? data.glasgow.ocular + data.glasgow.verbal + data.glasgow.motor
        : 15;
      const { data: completed, error } = await supabase.rpc("complete_nursing_triage_secure", {
        p_queue_id: options.filaId,
        p_appointment_id: data.cd_appointment ?? null,
        p_classification_id: data.cd_classificacao_id,
        p_triage: {
          queixa_principal: data.queixa_principal ?? null,
          historia_doenca_atual: data.historia_doenca_atual ?? null,
          medicamentos_uso: data.medicamentos_uso ?? null,
          alergias: data.alergias ?? null,
          observacoes_enfermagem: data.observacoes_enfermagem ?? null,
          sinais_vitais: data.sinaisVitais,
          antropometria: data.antropometria ?? null,
          glasgow: data.glasgow ?? null,
          nivel_consciencia: glasgowTotal === 15 ? "A" : "C",
          status: data.tp_status ?? "TRIADO",
        },
        p_idempotency_key: requireIdempotencyKey(options.idempotencyKey),
      });
      if (error) throw new Error(`Erro ao concluir triagem: ${error.message}`);
      return requireCompletedTriagem(completed, "Erro ao concluir triagem");
    },

    async getById(id: number): Promise<Triagem | null> {
      const { data, error } = await supabase
        .from("triagens")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`Erro ao buscar triagem: ${error.message}`);
      return data ? mapRowToTriagem(data as TriagemRow) : null;
    },

    async getAguardando(_companyId: string): Promise<Triagem[]> {
      const { data, error } = await supabase
        .from("triagens")
        .select("*")
        .eq("tp_status", "AGUARDANDO")
        .order("dt_triagem", { ascending: true });
      if (error) throw new Error(`Erro ao listar triagens aguardando: ${error.message}`);
      return (data ?? []).map((r) => mapRowToTriagem(r as TriagemRow));
    },

    async getNews2ByTriagem(triagemId: number): Promise<News2Avaliacao | null> {
      const { data, error } = await supabase
        .from("news2_avaliacoes")
        .select("*")
        .eq("cd_triagem", triagemId)
        .order("dt_avaliacao", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Erro ao buscar NEWS2: ${error.message}`);
      return (data as News2Avaliacao) ?? null;
    },
  },

  fila: {
    /**
     * Adiciona paciente à fila de triagem.
     */
    async adicionar(
      companyId: string,
      cdPaciente: number,
      queixaInicial: string,
      cdClassificacaoId?: number | null,
      idempotencyKey?: string,
    ): Promise<FilaItem> {
      const fingerprint = JSON.stringify([companyId, cdPaciente, queixaInicial, cdClassificacaoId ?? null]);
      const operationKey = idempotencyKey
        ? requireIdempotencyKey(idempotencyKey)
        : (pendingEnqueueKeys.get(fingerprint) ?? createIdempotencyKey());
      if (!idempotencyKey) pendingEnqueueKeys.set(fingerprint, operationKey);
      const { data, error } = await supabase.rpc("enqueue_nursing_triage_secure", {
        p_patient_id: cdPaciente,
        p_initial_complaint: queixaInicial,
        p_classification_id: cdClassificacaoId ?? null,
        p_idempotency_key: operationKey,
      });
      if (error) throw new Error(`Erro ao adicionar à fila: ${error.message}`);
      const item = requireFilaItem(data, "Erro ao adicionar à fila");
      pendingEnqueueKeys.delete(fingerprint);
      return item;
    },

    /**
     * Retorna itens em AGUARDANDO/CHAMADO, ordenados por gravidade e chegada.
     */
    async getFilaAtiva(_companyId: string): Promise<FilaItem[]> {
      const { data, error } = await supabase
        .from("triagem_fila")
        .select("*")
        .in("tp_status", ["AGUARDANDO", "CHAMADO", "EM_TRIAGEM"])
        .order("dt_chegada", { ascending: true });
      if (error) throw new Error(`Erro ao listar fila: ${error.message}`);
      return (data ?? []) as FilaItem[];
    },

    /**
     * Chama o próximo da fila (altera status para CHAMADO e seta dt_chamada).
     */
    async chamar(senhaId: number, idempotencyKey?: string): Promise<FilaItem> {
      const operationKey = idempotencyKey
        ? requireIdempotencyKey(idempotencyKey)
        : (pendingCallKeys.get(senhaId) ?? createIdempotencyKey());
      if (!idempotencyKey) pendingCallKeys.set(senhaId, operationKey);
      const { data, error } = await supabase.rpc("call_nursing_triage_secure", {
        p_queue_id: senhaId,
        p_idempotency_key: operationKey,
      });
      if (error) throw new Error(`Erro ao chamar senha: ${error.message}`);
      const item = requireFilaItem(data, "Erro ao chamar senha");
      pendingCallKeys.delete(senhaId);
      return item;
    },
  },
};

export default nursingService;

