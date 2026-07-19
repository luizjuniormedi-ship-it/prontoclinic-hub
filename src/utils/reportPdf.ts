/**
 * reportPdf — geração de laudo imprimível (PDF via window.print()).
 *
 * Padrão do projeto: monta HTML A4 e abre janela de impressão (o usuário
 * salva como PDF pelo próprio browser). Sem dependência externa pesada.
 * QR Code é renderizado via api.qrserver.com apontando para a página
 * pública de validação (/validar-laudo/:codigo).
 */
import type { Report } from "@/services/reportsService";

const CLINICA = {
  nome: "POLICLINICA MEDILIFE DIAGNOSTICOS LTDA",
  cnpj: "42.533.813/0001-97",
  endereco: "São Gonçalo / RJ",
};

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export function printReport(report: Report): void {
  const validationUrl = `${window.location.origin}/validar-laudo/${report.validation_code || ""}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(validationUrl)}`;
  const assinado = ["assinado", "liberado", "entregue"].includes(report.status);

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Laudo ${escapeHtml(report.validation_code)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 12px; line-height: 1.5; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #2563eb; padding-bottom: 10px; margin-bottom: 14px; }
  .header h1 { font-size: 15px; margin: 0; color: #2563eb; }
  .header .sub { font-size: 10px; color: #666; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin-bottom: 14px; font-size: 11px; }
  .meta b { color: #444; }
  .titulo-exame { text-align: center; font-size: 14px; font-weight: bold; text-transform: uppercase; margin: 12px 0; padding: 6px; background: #f1f5f9; }
  .secao { margin-bottom: 12px; }
  .secao h3 { font-size: 12px; text-transform: uppercase; color: #2563eb; border-bottom: 1px solid #ddd; padding-bottom: 2px; margin-bottom: 4px; }
  .secao p { white-space: pre-wrap; margin: 0; text-align: justify; }
  .conclusao { background: #f8fafc; padding: 8px; border-left: 3px solid #2563eb; }
  .critico { background: #fef2f2; border-left-color: #dc2626; color: #991b1b; font-weight: bold; }
  .assinatura { margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-end; }
  .assinatura .linha { border-top: 1px solid #333; width: 260px; text-align: center; padding-top: 4px; font-size: 11px; }
  .qr { text-align: center; font-size: 9px; color: #666; }
  .footer { margin-top: 24px; border-top: 1px solid #ddd; padding-top: 6px; font-size: 9px; color: #888; text-align: center; }
  .rascunho { position: fixed; top: 40%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 90px; color: rgba(200,0,0,0.08); font-weight: bold; }
</style></head><body>
  ${!assinado ? '<div class="rascunho">RASCUNHO</div>' : ''}
  <div class="header">
    <div><h1>${CLINICA.nome}</h1><div class="sub">CNPJ ${CLINICA.cnpj} · ${CLINICA.endereco}</div></div>
    <div class="sub" style="text-align:right">Laudo Nº ${escapeHtml(report.validation_code)}<br>${assinado ? "DOCUMENTO ASSINADO" : "PRÉ-VISUALIZAÇÃO"}</div>
  </div>
  <div class="meta">
    <div><b>Paciente:</b> ${escapeHtml(report.patient_name) || "—"}</div>
    <div><b>Tipo:</b> ${escapeHtml(report.type_name) || "—"}</div>
    <div><b>Data de realização:</b> ${fmtDate(report.created_at)}</div>
    <div><b>Data de liberação:</b> ${fmtDate(report.released_at)}</div>
    ${report.cid_principal ? `<div><b>CID:</b> ${escapeHtml(report.cid_principal)}</div>` : ""}
    ${report.requester_name ? `<div><b>Médico solicitante:</b> ${escapeHtml(report.requester_name)}</div>` : ""}
    ${report.executor_name ? `<div><b>Médico executor:</b> ${escapeHtml(report.executor_name)}${report.executor_crm ? ` (${escapeHtml(report.executor_crm)})` : ""}</div>` : ""}
    ${report.is_rectified ? `<div><b>Versão:</b> ${report.version} (RETIFICADO)</div>` : ""}
  </div>
  <div class="titulo-exame">${escapeHtml(report.title) || escapeHtml(report.type_name) || "LAUDO"}</div>
  ${report.clinical_indication ? `<div class="secao"><h3>Indicação Clínica</h3><p>${escapeHtml(report.clinical_indication)}</p></div>` : ""}
  ${report.technique ? `<div class="secao"><h3>Técnica</h3><p>${escapeHtml(report.technique)}</p></div>` : ""}
  <div class="secao"><h3>Achados</h3><p>${escapeHtml(report.findings) || "—"}</p></div>
  ${report.conclusion ? `<div class="secao"><h3>Conclusão / Impressão</h3><p class="conclusao ${report.has_critical_finding ? "critico" : ""}">${escapeHtml(report.conclusion)}</p></div>` : ""}
  ${report.recommendation ? `<div class="secao"><h3>Recomendação</h3><p>${escapeHtml(report.recommendation)}</p></div>` : ""}
  <div class="assinatura">
    <div class="linha">${assinado ? escapeHtml(report.signed_by_name || report.executor_name) : "________________________"}<br><span class="sub">${assinado ? (escapeHtml(report.signed_by_crm || report.executor_crm) || "Médico laudador") : "Médico laudador"}</span></div>
    <div class="qr"><img src="${qrSrc}" width="90" height="90" alt="QR validação"><br>Validar autenticidade<br><b>${escapeHtml(report.validation_code)}</b></div>
  </div>
  <div class="footer">Documento gerado pelo PRONTOMEDIC · Valide a autenticidade em ${escapeHtml(validationUrl)}</div>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    alert("Permita pop-ups para gerar o laudo em PDF.");
    return;
  }
  w.document.write(html);
  w.document.close();
  // aguarda o QR carregar antes de imprimir
  setTimeout(() => { w.focus(); w.print(); }, 600);
}
