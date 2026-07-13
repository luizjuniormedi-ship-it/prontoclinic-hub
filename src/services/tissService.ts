import { supabase } from "@/lib/supabase";
import { z } from "zod";

export type TissTipoGuia =
  | "CONSULTA"
  | "SP/SADT"
  | "INTERNACAO"
  | "HONORARIO"
  | "ODONTOLOGIA"
  | "AUXILIAR";

export type TissAmbiente = "HOMOLOGACAO" | "PRODUCAO";
export type GlosaStatus = "PENDENTE" | "ENVIADO" | "DEFERIDO" | "INDEFERIDO" | "PARCIAL";

export interface TissReadModel {
  tiss_xml_id: number;
  billing_id: number | null;
  appointment_id: number | null;
  patient_id: number | null;
  insurance_plan_id: number | null;
  insurance_company_id: number | null;
  insurance_company_name: string | null;
  insurance_plan_name: string | null;
  billing_amount: number | null;
  tiss_created_at: string;
}

export interface TissGlosaReadModel {
  id: number;
  tiss_xml_id: number;
  billing_id: number | null;
  denial_code: string | null;
  denial_reason: string | null;
  denial_amount: number;
  denial_date: string;
  appeal_sent: boolean;
  appeal_date: string | null;
  appeal_protocol: string | null;
  appeal_status: GlosaStatus;
  procedure_code: string | null;
  executor_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface TissProtocolReadModel {
  id: number;
  insurance_company_id: number;
  insurance_company_name: string;
  tiss_version: string;
  environment: TissAmbiente;
  active: boolean;
  last_test_at: string | null;
  last_test_status: string | null;
  created_at: string;
  updated_at: string;
}

const positiveIdSchema = z.number().int().positive();
const nullableIdSchema = positiveIdSchema.nullable();
const nonNegativeValueSchema = z.union([
  z.number(),
  z.string().trim().regex(/^\d+(?:\.\d+)?$/).transform(Number),
]).pipe(z.number().finite().nonnegative());
const timestampSchema = z.string().datetime({ offset: true });
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
});

const tissReadModelSchema = z.object({
  tiss_xml_id: positiveIdSchema,
  billing_id: nullableIdSchema,
  appointment_id: nullableIdSchema,
  patient_id: nullableIdSchema,
  insurance_plan_id: nullableIdSchema,
  insurance_company_id: nullableIdSchema,
  insurance_company_name: z.string().nullable(),
  insurance_plan_name: z.string().nullable(),
  billing_amount: nonNegativeValueSchema.nullable(),
  tiss_created_at: timestampSchema,
});

const tissGlosaReadModelSchema = z.object({
  id: positiveIdSchema,
  tiss_xml_id: positiveIdSchema,
  billing_id: nullableIdSchema,
  denial_code: z.string().nullable(),
  denial_reason: z.string().nullable(),
  denial_amount: nonNegativeValueSchema,
  denial_date: dateSchema,
  appeal_sent: z.boolean(),
  appeal_date: dateSchema.nullable(),
  appeal_protocol: z.string().nullable(),
  appeal_status: z.enum(["PENDENTE", "ENVIADO", "DEFERIDO", "INDEFERIDO", "PARCIAL"]),
  procedure_code: z.string().nullable(),
  executor_code: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

const tissProtocolReadModelSchema = z.object({
  id: positiveIdSchema,
  insurance_company_id: positiveIdSchema,
  insurance_company_name: z.string().trim().min(1),
  tiss_version: z.string().trim().min(1),
  environment: z.enum(["HOMOLOGACAO", "PRODUCAO"]),
  active: z.boolean(),
  last_test_at: timestampSchema.nullable(),
  last_test_status: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

function parseRows<T>(schema: z.ZodTypeAny, data: unknown, resource: string): T[] {
  const result = z.array(schema).safeParse(data ?? []);
  if (!result.success) {
    throw new Error(`Resposta TISS invalida para ${resource}.`);
  }
  return result.data as T[];
}

function blocked(message: string): never {
  throw new Error(message);
}

export const tissService = {
  async listFaturas(filters?: {
    mes?: number;
    ano?: number;
    insurance_company_id?: number;
  }): Promise<TissReadModel[]> {
    const { data, error } = await supabase.rpc("list_tiss_read_model_secure", {
      p_year: filters?.ano ?? null,
      p_month: filters?.mes ?? null,
      p_insurance_company_id: filters?.insurance_company_id ?? null,
    });
    if (error) throw error;
    return parseRows<TissReadModel>(tissReadModelSchema, data, "guias");
  },

  async listGlosas(tissXmlId?: number): Promise<TissGlosaReadModel[]> {
    const { data, error } = await supabase.rpc("list_tiss_glosas_read_secure", {
      p_tiss_xml_id: tissXmlId ?? null,
    });
    if (error) throw error;
    return parseRows<TissGlosaReadModel>(tissGlosaReadModelSchema, data, "glosas");
  },

  async listProtocols(): Promise<TissProtocolReadModel[]> {
    const { data, error } = await supabase.rpc("list_tiss_protocols_read_secure");
    if (error) throw error;
    return parseRows<TissProtocolReadModel>(tissProtocolReadModelSchema, data, "protocolos");
  },

  async generateXML(
    appointmentId: number,
    codes: {
      tipoGuia: TissTipoGuia;
      cd_convenio: number;
      cd_paciente: number;
      cd_profissional: number;
      nr_carteira: string;
      cd_atendimento?: string;
      vl_total?: number;
      procedimentos: Array<{
        cd_tuss: string;
        ds_procedimento: string;
        qt: number;
        vl_unitario: number;
      }>;
    },
  ): Promise<{ xml: string; id: number; hash: string }> {
    void appointmentId;
    void codes;
    return blocked("Geracao XML TISS bloqueada no navegador: operacao exige backend seguro e auditoria");
  },

  async sendToOperadora(
    tissXmlId: number,
  ): Promise<{ sent: boolean; protocolo?: string; response?: unknown }> {
    void tissXmlId;
    return blocked("Transmissao TISS bloqueada: exige backend seguro com certificado A1, idempotencia e auditoria");
  },

  async processReturn(tissXmlId: number, returnXML: string): Promise<never> {
    void tissXmlId;
    void returnXML;
    return blocked("Processamento de retorno TISS bloqueado no navegador: operacao exige backend seguro e auditoria");
  },

  async registrarGlosa(tissXmlId: number, motivo: string, valor: number, codigo?: string): Promise<never> {
    void tissXmlId;
    void motivo;
    void valor;
    void codigo;
    return blocked("Registro de glosa TISS bloqueado no navegador: operacao exige backend seguro e auditoria");
  },

  async enviarRecurso(glosaId: number, recursoXML: string): Promise<never> {
    void glosaId;
    void recursoXML;
    return blocked("Envio de recurso TISS bloqueado no navegador: operacao exige backend seguro e auditoria");
  },

  async gerarXMLRecurso(glosaId: number): Promise<never> {
    void glosaId;
    return blocked("Geracao de recurso TISS bloqueada no navegador: operacao exige backend seguro e auditoria");
  },

  async gerarFaturaMensal(mes: number, ano: number, companyId: string): Promise<never> {
    void mes;
    void ano;
    void companyId;
    return blocked("Geracao mensal TISS bloqueada: o fluxo legado nao possui contrato transacional seguro");
  },

  async saveProtocol(companyId: string, data: { cd_convenio: number; ds_endpoint: string }): Promise<never> {
    void companyId;
    void data;
    return blocked("Configuracao de protocolo TISS bloqueada no navegador: operacao exige backend seguro e auditoria");
  },
};

export default tissService;
