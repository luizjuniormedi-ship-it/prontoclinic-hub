/**
 * useAuditLog.ts
 *
 * Hook React para registrar acessos do usuário a dados sensíveis.
 * Usado em componentes que exibem prontuários, dados de pacientes,
 * faturamento etc — em conformidade com LGPD Art. 37.
 *
 * Falhas de auditoria NUNCA bloqueiam a UX (console.warn apenas).
 *
 * Exemplo:
 *   const { log } = useAuditLog();
 *   useEffect(() => { log('medical_records', recordId, 'VIEW_RECORD'); }, [recordId]);
 */

import { useCallback } from 'react';
import { auditService } from '@/services/auditService';

export interface UseAuditLog {
  /**
   * Registra um acesso. Não bloqueante.
   * @param tabela   nome da tabela (ex: 'medical_records', 'patients')
   * @param registroId id do registro acessado
   * @param acao     ação realizada (ex: 'VIEW_RECORD', 'PRINT', 'EXPORT')
   * @param contexto payload extra opcional (filtros aplicados, página, etc)
   */
  log: (
    tabela: string,
    registroId: string,
    acao: string,
    contexto?: Record<string, unknown>,
  ) => Promise<void>;
}

export function useAuditLog(): UseAuditLog {
  const log = useCallback(
    async (
      tabela: string,
      registroId: string,
      acao: string,
      contexto: Record<string, unknown> = {},
    ) => {
      try {
        await auditService.logApiAccess(tabela, registroId, acao, contexto);
      } catch (e) {
        // Nunca bloquear a UX por falha de auditoria.
        // A trigger do banco captura INSERT/UPDATE/DELETE automaticamente;
        // este hook é para acessos de leitura que não disparam trigger.
        console.warn('[useAuditLog] Falha ao logar auditoria (não bloqueante):', e);
      }
    },
    [],
  );

  return { log };
}
