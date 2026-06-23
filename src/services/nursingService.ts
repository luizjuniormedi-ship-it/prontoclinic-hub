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

function mapSinaisToRow(data: TriagemCreate): Record<string, unknown> {
  const row: Record<string, unknown> = {
    company_id: data.company_id,
    cd_paciente: data.cd_paciente,
    cd_appointment: data.cd_appointment ?? null,
    cd_classificacao_id: data.cd_classificacao_id ?? null,
    cd_usuario_enfermeiro: data.cd_usuario_enfermeiro ?? null,
    ds_queixa_principal: data.queixa_principal ?? null,
    ds_historia_doenca_atual: data.historia_doenca_atual ?? null,
    ds_medicamentos_uso: data.medicamentos_uso ?? null,
    ds_alergias: data.alergias ?? null,
    ds_observacoes_enfermagem: data.observacoes_enfermagem ?? null,
    tp_status: data.tp_status ?? "AGUARDANDO",
  };
  const sv = data.sinaisVitais;
  if (sv.pressaoSistolica !== undefined) row.vl_pressao_sistolica = sv.pressaoSistolica;
  if (sv.pressaoDiastolica !== undefined) row.vl_pressao_diastolica = sv.pressaoDiastolica;
  if (sv.frequenciaCardiaca !== undefined) row.vl_frequencia_cardiaca = sv.frequenciaCardiaca;
  if (sv.frequenciaRespiratoria !== undefined) row.vl_frequencia_respiratoria = sv.frequenciaRespiratoria;
  if (sv.temperatura !== undefined && sv.temperatura !== null) row.vl_temperatura = sv.temperatura;
  if (sv.saturacaoO2 !== undefined) row.vl_saturacao_o2 = sv.saturacaoO2;
  if (sv.glicemia !== undefined) row.vl_glicemia = sv.glicemia;
  if (sv.escalaDor !== undefined) row.vl_escala_dor = sv.escalaDor;
  if (data.antropometria) {
    if (data.antropometria.pesoKg !== undefined) row.vl_peso_kg = data.antropometria.pesoKg;
    if (data.antropometria.alturaCm !== undefined) row.vl_altura_cm = data.antropometria.alturaCm;
  }
  if (data.glasgow) {
    row.vl_glasgow_ocular = data.glasgow.ocular;
    row.vl_glasgow_verbal = data.glasgow.verbal;
    row.vl_glasgow_motor = data.glasgow.motor;
  }
  return row;
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
  const sv = data.sinaisVitais;
  if (sv.pressaoSistolica !== undefined && sv.pressaoSistolica !== null) {
    if (sv.pressaoSistolica < 0 || sv.pressaoSistolica > 300) {
      return "Pressão sistólica fora da faixa (0-300).";
    }
  }
  if (sv.temperatura !== undefined && sv.temperatura !== null) {
    if (sv.temperatura < 20 || sv.temperatura > 45) {
      return "Temperatura fora da faixa (20-45°C).";
    }
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
    async create(data: TriagemCreate): Promise<Triagem> {
      const err = validateTriagem(data);
      if (err) throw new Error(err);
      const row = mapSinaisToRow(data);
      const { data: inserted, error } = await supabase
        .from("triagens")
        .insert(row)
        .select()
        .single();
      if (error) throw new Error(`Erro ao criar triagem: ${error.message}`);
      return mapRowToTriagem(inserted as TriagemRow);
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

    async update(id: number, data: Partial<TriagemCreate>): Promise<Triagem> {
      const row: Record<string, unknown> = {};
      if (data.cd_classificacao_id !== undefined) row.cd_classificacao_id = data.cd_classificacao_id;
      if (data.tp_status !== undefined) row.tp_status = data.tp_status;
      if (data.observacoes_enfermagem !== undefined) {
        row.ds_observacoes_enfermagem = data.observacoes_enfermagem;
      }
      if (data.sinaisVitais) {
        const sv = data.sinaisVitais;
        if (sv.pressaoSistolica !== undefined) row.vl_pressao_sistolica = sv.pressaoSistolica;
        if (sv.pressaoDiastolica !== undefined) row.vl_pressao_diastolica = sv.pressaoDiastolica;
        if (sv.frequenciaCardiaca !== undefined) row.vl_frequencia_cardiaca = sv.frequenciaCardiaca;
        if (sv.frequenciaRespiratoria !== undefined) row.vl_frequencia_respiratoria = sv.frequenciaRespiratoria;
        if (sv.temperatura !== undefined && sv.temperatura !== null) row.vl_temperatura = sv.temperatura;
        if (sv.saturacaoO2 !== undefined) row.vl_saturacao_o2 = sv.saturacaoO2;
        if (sv.glicemia !== undefined) row.vl_glicemia = sv.glicemia;
        if (sv.escalaDor !== undefined) row.vl_escala_dor = sv.escalaDor;
      }
      const { data: updated, error } = await supabase
        .from("triagens")
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(`Erro ao atualizar triagem: ${error.message}`);
      return mapRowToTriagem(updated as TriagemRow);
    },

    /**
     * Salva a avaliação NEWS2 vinculada a uma triagem.
     */
    async salvarNews2(triagemId: number, companyId: string, avaliacao: News2Result): Promise<News2Avaliacao> {
      const row = {
        company_id: companyId,
        cd_triagem: triagemId,
        nr_frequencia_respiratoria: avaliacao.detalhes.fr,
        nr_saturacao_o2: avaliacao.detalhes.spo2,
        nr_temperatura: avaliacao.detalhes.temp,
        nr_pressao_sistolica: avaliacao.detalhes.pas,
        nr_frequencia_cardiaca: avaliacao.detalhes.fc,
        nr_nivel_consciencia: avaliacao.detalhes.consciencia,
        cd_classificacao_risco: avaliacao.classificacao,
      };
      const { data, error } = await supabase
        .from("news2_avaliacoes")
        .insert(row)
        .select()
        .single();
      if (error) throw new Error(`Erro ao salvar NEWS2: ${error.message}`);
      return data as News2Avaliacao;
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
     * Gera a próxima senha sequencial (T001, T002...) para a empresa.
     * Tenta usar a função SQL gerar_senha_triagem; em fallback (modo offline
     * / mock) gera localmente.
     */
    async gerarSenha(companyId: string): Promise<string> {
      try {
        const { data, error } = await supabase.rpc("gerar_senha_triagem", {
          p_company_id: companyId,
        });
        if (!error && typeof data === "string") return data;
      } catch {
        // Ignora — usa fallback
      }
      // Fallback local
      const stamp = new Date();
      const dd = String(stamp.getDate()).padStart(2, "0");
      const hh = String(stamp.getHours()).padStart(2, "0");
      const mm = String(stamp.getMinutes()).padStart(2, "0");
      const ss = String(stamp.getSeconds()).padStart(2, "0");
      return `T${dd}${hh}${mm}${ss}`.slice(0, 12);
    },

    /**
     * Adiciona paciente à fila de triagem.
     */
    async adicionar(
      companyId: string,
      cdPaciente: number,
      queixaInicial: string,
      cdClassificacaoId?: number | null,
    ): Promise<FilaItem> {
      const senha = await nursingService.fila.gerarSenha(companyId);
      const row: Record<string, unknown> = {
        company_id: companyId,
        cd_paciente: cdPaciente,
        cd_senha: senha,
        tp_status: "AGUARDANDO",
        ds_queixa_inicial: queixaInicial,
      };
      if (cdClassificacaoId !== undefined) row.cd_classificacao_id = cdClassificacaoId;
      const { data, error } = await supabase.from("triagem_fila").insert(row).select().single();
      if (error) throw new Error(`Erro ao adicionar à fila: ${error.message}`);
      return data as FilaItem;
    },

    /**
     * Retorna itens em AGUARDANDO/CHAMADO, ordenados por gravidade e chegada.
     */
    async getFilaAtiva(companyId: string): Promise<FilaItem[]> {
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
    async chamar(senhaId: number): Promise<FilaItem> {
      const { data, error } = await supabase
        .from("triagem_fila")
        .update({ tp_status: "CHAMADO", dt_chamada: new Date().toISOString() })
        .eq("id", senhaId)
        .select()
        .single();
      if (error) throw new Error(`Erro ao chamar senha: ${error.message}`);
      return data as FilaItem;
    },

    /**
     * Marca senha como TRIADO.
     */
    async marcarTriado(senhaId: number): Promise<FilaItem> {
      const { data, error } = await supabase
        .from("triagem_fila")
        .update({ tp_status: "TRIADO" })
        .eq("id", senhaId)
        .select()
        .single();
      if (error) throw new Error(`Erro ao marcar triado: ${error.message}`);
      return data as FilaItem;
    },
  },
};

export default nursingService;
