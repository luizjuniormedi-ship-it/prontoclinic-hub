/**
 * prescriptionPdf — receita digital imprimível (PDF via window.print()) com QR Code.
 * Segue o mesmo padrão de reportPdf.ts. QR aponta para validação pública.
 */

const CLINICA = {
  nome: "POLICLINICA MEDILIFE DIAGNOSTICOS LTDA",
  cnpj: "42.533.813/0001-97",
  endereco: "São Gonçalo / RJ",
};

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return new Date().toLocaleDateString("pt-BR");
  try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return iso; }
}

export interface PrescriptionData {
  patient_name: string;
  medications: string;      // texto da prescrição (uma ou várias linhas)
  physician_name: string;
  physician_crm?: string;
  date?: string;
  validation_code: string;
  tipo?: "simples" | "controle_especial" | "antimicrobiano";
}

export function printPrescription(rx: PrescriptionData): void {
  const validationUrl = `${window.location.origin}/validar-laudo/${rx.validation_code}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(validationUrl)}`;
  const tipoLabel = rx.tipo === "controle_especial" ? "RECEITUÁRIO DE CONTROLE ESPECIAL"
    : rx.tipo === "antimicrobiano" ? "RECEITA DE ANTIMICROBIANO" : "RECEITA MÉDICA";

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Receita ${esc(rx.validation_code)}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  body { font-family: Arial, sans-serif; color:#1a1a1a; font-size:13px; }
  .header { text-align:center; border-bottom:2px solid #2563eb; padding-bottom:10px; margin-bottom:16px; }
  .header h1 { font-size:16px; margin:0; color:#2563eb; }
  .header .sub { font-size:10px; color:#666; }
  .tipo { text-align:center; font-weight:bold; text-transform:uppercase; margin:12px 0; font-size:13px; letter-spacing:1px; }
  .paciente { margin-bottom:16px; font-size:12px; }
  .rx { min-height:280px; white-space:pre-wrap; line-height:2; padding:10px 0; border-bottom:1px dashed #ccc; }
  .assinatura { margin-top:50px; text-align:center; }
  .assinatura .linha { border-top:1px solid #333; width:280px; margin:0 auto; padding-top:5px; }
  .rodape { margin-top:20px; display:flex; justify-content:space-between; align-items:flex-end; font-size:10px; color:#666; }
  .qr { text-align:center; }
</style></head><body>
  <div class="header"><h1>${esc(CLINICA.nome)}</h1><div class="sub">CNPJ ${esc(CLINICA.cnpj)} · ${esc(CLINICA.endereco)}</div></div>
  <div class="tipo">${tipoLabel}</div>
  <div class="paciente"><b>Paciente:</b> ${esc(rx.patient_name)}<br><b>Data:</b> ${fmt(rx.date)}</div>
  <div class="rx">${esc(rx.medications) || "—"}</div>
  <div class="assinatura"><div class="linha">${esc(rx.physician_name)}<br><span class="sub">${esc(rx.physician_crm) || "Médico"}</span></div></div>
  <div class="rodape">
    <div>Documento com validade legal · Valide em ${esc(validationUrl)}</div>
    <div class="qr"><img src="${qrSrc}" width="80" height="80" alt="QR"><br><b>${esc(rx.validation_code)}</b></div>
  </div>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) { alert("Permita pop-ups para gerar a receita em PDF."); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 600);
}
