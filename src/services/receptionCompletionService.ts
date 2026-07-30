import { supabase } from "@/lib/supabase";

export interface ReceptionTermCatalogItem {
  id: string;
  code: string;
  version: string;
  title: string;
  content: string;
  contentHash: string;
  purpose: string;
  publishedAt: string | null;
}

interface ReceptionTermCatalogRow {
  id: string;
  codigo: string;
  versao: string;
  titulo: string;
  texto: string;
  texto_hash: string;
  finalidade: string;
  publicado_em: string | null;
}

async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  message: string,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${message}: ${error.message}`);
  return data as T;
}

export async function sha256CanonicalContent(content: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 não está disponível neste navegador");
  }

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const receptionCompletionService = {
  async listActiveTerms(): Promise<ReceptionTermCatalogItem[]> {
    const { data, error } = await supabase
      .from("lgpd_termos")
      .select(
        "id,codigo,versao,titulo,texto,texto_hash,finalidade,publicado_em",
      )
      .eq("lg_ativo", true)
      .order("titulo", { ascending: true })
      .order("versao", { ascending: false });

    if (error) {
      throw new Error(`Erro ao carregar catálogo de termos: ${error.message}`);
    }

    return ((data || []) as ReceptionTermCatalogRow[]).map((term) => ({
      id: term.id,
      code: term.codigo,
      version: term.versao,
      title: term.titulo,
      content: term.texto,
      contentHash: term.texto_hash.trim().toLowerCase(),
      purpose: term.finalidade,
      publishedAt: term.publicado_em,
    }));
  },
  async acceptTerm(
    patientId: string,
    term: ReceptionTermCatalogItem,
    appointmentId?: string,
    signatureReference?: string,
  ) {
    const contentHash = await sha256CanonicalContent(term.content);
    if (contentHash !== term.contentHash) {
      throw new Error(
        "Conteúdo do termo não corresponde ao hash publicado no catálogo",
      );
    }

    return rpc<string>(
      "record_reception_term_acceptance_secure",
      {
        p_patient_id: Number(patientId),
        p_term_code: term.code,
        p_term_version: term.version,
        p_content_hash: contentHash,
        p_appointment_id: appointmentId ? Number(appointmentId) : null,
        p_signature_reference: signatureReference || null,
      },
      "Erro ao registrar aceite do termo",
    );
  },
  requestDocumentPickup(
    patientId: string,
    documentType: string,
    appointmentId?: string,
    notes?: string,
  ) {
    return rpc<string>(
      "create_reception_document_pickup_secure",
      {
        p_patient_id: Number(patientId),
        p_document_type: documentType,
        p_appointment_id: appointmentId ? Number(appointmentId) : null,
        p_notes: notes || null,
      },
      "Erro ao solicitar retirada de documento",
    );
  },
  releaseDocumentPickup(
    pickupId: string,
    recipientName: string,
    recipientCpf: string,
  ) {
    return rpc<null>(
      "release_reception_document_pickup_secure",
      {
        p_pickup_id: pickupId,
        p_recipient_name: recipientName,
        p_recipient_cpf: recipientCpf,
      },
      "Erro ao registrar entrega de documento",
    );
  },
  createWalkin(
    patientId: string,
    unitId: number,
    appointmentTypeId: number,
    professionalId: number,
    serviceId: number,
    notes?: string,
  ) {
    return rpc<number>(
      "create_reception_walkin_secure",
      {
        p_patient_id: Number(patientId),
        p_unit_id: unitId,
        p_appointment_type_id: appointmentTypeId,
        p_professional_id: professionalId,
        p_service_id: serviceId,
        p_notes: notes || null,
      },
      "Erro ao registrar atendimento espontaneo",
    );
  },
  resolveDocumentIssue(
    appointmentId: string,
    documentId: string,
    documentNumber: string,
    expiresAt?: string,
  ) {
    return rpc<null>(
      "resolve_reception_document_issue_secure",
      {
        p_appointment_id: Number(appointmentId),
        p_document_id: documentId,
        p_document_number: documentNumber.trim(),
        p_expires_at: expiresAt || null,
      },
      "Erro ao regularizar documento",
    );
  },
};
