/**
 * auditService.ts
 *
 * Substitui o mock getAuditLogs() da api.ts (linha 83).
 *
 * Backed pela tabela `public.audit_logs` (migration 20260101000007_audit_logs.sql)
 * com partições anuais, triggers genéricos em todas as tabelas sensíveis,
 * RLS restritiva (somente admin/DPO leem; ninguém altera/apaga), e função
 * RPC `log_data_access(tabela, registro_id, acao, contexto)` que o frontend
 * chama para registrar acessos sensíveis (prontuário, paciente, etc).
 *
 * LGPD: Art. 37 (registro de operações), Art. 16 (eliminação após tratamento),
 *       Art. 46 (medidas de segurança), Art. 50 (boas práticas).
 */

import { supabase } from '@/lib/supabase';
import { AuditLog, AuditFilters, AuditStats } from '@/types';

// ── DB row type (espelha a migration) ──
export interface DbAuditLog {
  id: number | string;
  company_id: string | null;
  dt_evento: string;
  cd_usuario: string | null;
  cd_usuario_nome: string | null;
  role_name: string | null;
  acao: string;
  tabela: string;
  registro_id: string | null;
  operacao: string | null;
  dados_anteriores: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
  ip_origem: string | null;
  user_agent: string | null;
  request_id: string | null;
  dt_retencao: string;
}

// ── Mapper DB → DTO usado pelo frontend (compat com AuditLog existente) ──
function mapRowToAuditLog(row: DbAuditLog): AuditLog {
  return {
    id: String(row.id),
    userId: row.cd_usuario ?? '',
    userName: row.cd_usuario_nome ?? '(sistema)',
    action: row.acao,
    entity: row.tabela,
    entityId: row.registro_id ?? '',
    details: {
      operacao: row.operacao,
      role_name: row.role_name,
      dados_anteriores: row.dados_anteriores,
      dados_novos: row.dados_novos,
      ip_origem: row.ip_origem,
      user_agent: row.user_agent,
      request_id: row.request_id,
      dt_retencao: row.dt_retencao,
    },
    createdAt: row.dt_evento,
  };
}

// ── Formato de exportação (DPO/Compliance) ──
export interface AuditExport {
  geradoEm: string;
  filtros: AuditFilters;
  total: number;
  eventos: DbAuditLog[];
}

export const auditService = {
  /**
   * Lista logs com filtros e paginação.
   * RLS já filtra por empresa + role admin/dpo automaticamente.
   */
  async getAll(filters: AuditFilters = {}): Promise<AuditLog[]> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('dt_evento', { ascending: false })
      .range(from, to);

    if (filters.tabela) query = query.eq('tabela', filters.tabela);
    if (filters.acao) query = query.eq('acao', filters.acao);
    if (filters.cd_usuario) query = query.eq('cd_usuario', filters.cd_usuario);
    if (filters.data_inicio) query = query.gte('dt_evento', filters.data_inicio);
    if (filters.data_fim) query = query.lte('dt_evento', filters.data_fim);

    const { data, error } = await query;
    if (error) {
      throw new Error(`Erro ao buscar logs de auditoria: ${error.message}`);
    }
    return (data || []).map(mapRowToAuditLog);
  },

  /**
   * Histórico completo de um registro específico (ex: paciente X).
   * Ordenado do mais recente para o mais antigo.
   */
  async getByRecord(tabela: string, registroId: string, limit = 100): Promise<AuditLog[]> {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('tabela', tabela)
      .eq('registro_id', registroId)
      .order('dt_evento', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Erro ao buscar histórico: ${error.message}`);
    }
    return (data || []).map(mapRowToAuditLog);
  },

  /**
   * Ações de um usuário nos últimos N dias (default 30).
   * Útil para revisão de privilégios e detecção de anomalias.
   */
  async getByUser(userId: string, days = 30): Promise<AuditLog[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('cd_usuario', userId)
      .gte('dt_evento', since.toISOString())
      .order('dt_evento', { ascending: false });

    if (error) {
      throw new Error(`Erro ao buscar ações do usuário: ${error.message}`);
    }
    return (data || []).map(mapRowToAuditLog);
  },

  /**
   * Registra acesso de leitura a dados sensíveis (prontuário, paciente etc).
   *
   * NÃO BLOQUEANTE: falhas são logadas no console mas não interrompem a UX.
   * Use o hook `useAuditLog` para invocar de componentes React.
   *
   * A função RPC `log_data_access` no banco:
   *  - exige auth.uid()
   *  - captura company_id e role_name do user_profile
   *  - registra evento com ação customizada (ex: 'VIEW_RECORD')
   */
  async logApiAccess(
    tabela: string,
    registroId: string,
    acao: string,
    contexto: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const { error } = await supabase.rpc('log_data_access', {
        p_tabela: tabela,
        p_registro_id: registroId,
        p_acao: acao,
        p_contexto: contexto,
      });
      if (error) {
        console.warn('[auditService] Falha ao registrar acesso:', error.message);
      }
    } catch (e) {
      console.warn('[auditService] Exceção ao registrar acesso:', e);
    }
  },

  /**
   * Estatísticas agregadas para dashboard de auditoria.
   *
   * Usa a view `audit_logs_stats` (criada na migration). Retorna top N
   * ações, usuários e tabelas no período.
   */
  async getEstatisticas(days = 30): Promise<AuditStats> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const nowIso = new Date().toISOString();

    // 1) Total de eventos no período
    const { count: total, error: totalErr } = await supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .gte('dt_evento', since.toISOString());

    if (totalErr) {
      throw new Error(`Erro ao contar eventos: ${totalErr.message}`);
    }

    // 2) Top ações
    const { data: acoes, error: acoesErr } = await supabase
      .from('audit_logs')
      .select('acao')
      .gte('dt_evento', since.toISOString());

    if (acoesErr) {
      throw new Error(`Erro ao agregar ações: ${acoesErr.message}`);
    }
    const porAcaoMap = new Map<string, number>();
    (acoes || []).forEach((r) => {
      porAcaoMap.set(r.acao, (porAcaoMap.get(r.acao) ?? 0) + 1);
    });
    const porAcao = Array.from(porAcaoMap.entries())
      .map(([acao, t]) => ({ acao, total: t }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // 3) Top tabelas
    const porTabelaMap = new Map<string, number>();
    (acoes || []).forEach((r: any) => {
      const tab = r.tabela;
      if (tab) porTabelaMap.set(tab, (porTabelaMap.get(tab) ?? 0) + 1);
    });
    const porTabela = Array.from(porTabelaMap.entries())
      .map(([tabela, t]) => ({ tabela, total: t }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // 4) Top usuários (pega campos extras só pra esse passo)
    const { data: usuarios, error: usrErr } = await supabase
      .from('audit_logs')
      .select('cd_usuario, cd_usuario_nome')
      .gte('dt_evento', since.toISOString())
      .not('cd_usuario', 'is', null);

    if (usrErr) {
      throw new Error(`Erro ao agregar usuários: ${usrErr.message}`);
    }
    const porUsuarioMap = new Map<string, { userName: string; total: number }>();
    (usuarios || []).forEach((r: any) => {
      const id = r.cd_usuario as string;
      const cur = porUsuarioMap.get(id);
      if (cur) cur.total += 1;
      else porUsuarioMap.set(id, { userName: r.cd_usuario_nome ?? '(sem nome)', total: 1 });
    });
    const porUsuario = Array.from(porUsuarioMap.entries())
      .map(([userId, v]) => ({ userId, userName: v.userName, total: v.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    return {
      totalEventos: total ?? 0,
      porAcao,
      porTabela,
      porUsuario,
      periodo: { inicio: since.toISOString(), fim: nowIso },
    };
  },

  /**
   * Exporta eventos para análise do DPO / compliance.
   *
   * Limite de segurança: 5.000 registros por export (mais que isso
   * deve ser quebrado em janelas para não estourar memória do browser).
   *
   * Formato: JSON pronto para download.
   */
  async exportar(filters: AuditFilters = {}): Promise<AuditExport> {
    const EXPORT_LIMIT = 5000;
    const safeFilters = { ...filters, pageSize: EXPORT_LIMIT };

    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('dt_evento', { ascending: false })
      .limit(safeFilters.pageSize);

    if (error) {
      throw new Error(`Erro ao exportar auditoria: ${error.message}`);
    }

    // Aplica filtros em memória se necessário (client-side filter)
    let eventos: DbAuditLog[] = (data || []) as DbAuditLog[];
    if (filters.tabela) eventos = eventos.filter((e) => e.tabela === filters.tabela);
    if (filters.acao) eventos = eventos.filter((e) => e.acao === filters.acao);
    if (filters.cd_usuario) eventos = eventos.filter((e) => e.cd_usuario === filters.cd_usuario);
    if (filters.data_inicio) eventos = eventos.filter((e) => e.dt_evento >= filters.data_inicio!);
    if (filters.data_fim) eventos = eventos.filter((e) => e.dt_evento <= filters.data_fim!);

    return {
      geradoEm: new Date().toISOString(),
      filtros: safeFilters,
      total: eventos.length,
      eventos,
    };
  },

  /**
   * Dispara download de arquivo JSON no browser.
   * Helper para uso no componente AuditLogViewer.
   */
  async exportarEbaixar(filters: AuditFilters = {}, filename?: string): Promise<void> {
    const exp = await this.exportar(filters);
    const blob = new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      filename ??
      `audit_logs_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Lista tabelas auditáveis (para popular dropdown de filtros).
   */
  async getTabelasAuditaveis(): Promise<string[]> {
    // Conjunto canônico. Caso queira puxar dinamicamente:
    // SELECT DISTINCT tabela FROM audit_logs
    return [
      'patients',
      'appointments',
      'medical_records',
      'billings',
      'billing_productions',
      'professional_payments',
      'call_center_records',
      'worklist_items',
      'pacs_studies',
    ];
  },

  /**
   * Lista ações canônicas.
   */
  getAcoesAuditaveis(): string[] {
    return [
      'INSERT',
      'UPDATE',
      'DELETE',
      'LOGIN',
      'LOGOUT',
      'EXPORT',
      'ANONYMIZE',
      'VIEW_RECORD',
      'PRINT',
    ];
  },
};
