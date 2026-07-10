import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ShieldCheck, ShieldAlert, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { reportsService, STATUS_LABELS, type Report } from "@/services/reportsService";

/**
 * Página pública de validação de laudo por código (acessada via QR Code do PDF).
 * Não exige login — mostra apenas metadados de autenticidade, sem conteúdo clínico.
 */
export default function ValidarLaudoPage() {
  const { codigo } = useParams<{ codigo: string }>();
  const [input, setInput] = useState(codigo || "");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const validate = async (code: string) => {
    if (!code.trim()) return;
    setLoading(true); setNotFound(false); setReport(null);
    try {
      const r = await reportsService.validateByCode(code.trim().toUpperCase());
      if (r) setReport(r); else setNotFound(true);
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (codigo) void validate(codigo); }, [codigo]);

  const autentico = report && ["assinado", "liberado", "entregue"].includes(report.status);

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <FileText className="h-8 w-8 mx-auto text-primary mb-2" />
          <CardTitle>Validação de Laudo</CardTitle>
          <p className="text-xs text-muted-foreground">POLICLINICA MEDILIFE · Verifique a autenticidade do documento</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="Código de validação" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && validate(input)} />
            <Button onClick={() => validate(input)} disabled={loading}>{loading ? "..." : "Validar"}</Button>
          </div>

          {notFound && (
            <div className="rounded-lg bg-destructive/10 p-4 flex items-center gap-3 text-destructive">
              <ShieldAlert className="h-6 w-6 flex-shrink-0" />
              <div><p className="font-medium">Laudo não encontrado</p><p className="text-xs">Nenhum documento com este código de validação.</p></div>
            </div>
          )}

          {report && (
            <div className={`rounded-lg p-4 space-y-2 ${autentico ? "bg-success/10" : "bg-warning/10"}`}>
              <div className="flex items-center gap-3">
                {autentico ? <ShieldCheck className="h-6 w-6 text-success" /> : <ShieldAlert className="h-6 w-6 text-warning" />}
                <div>
                  <p className="font-medium">{autentico ? "Documento autêntico" : "Documento não assinado/liberado"}</p>
                  <p className="text-xs text-muted-foreground">Status: {STATUS_LABELS[report.status]}</p>
                </div>
              </div>
              <div className="text-sm space-y-1 pt-2 border-t">
                <p><b>Código:</b> <span className="font-mono">{report.validation_code}</span></p>
                <p><b>Exame:</b> {report.title || "—"}</p>
                {report.signed_by_name && <p><b>Assinado por:</b> {report.signed_by_name} {report.signed_by_crm ? `(${report.signed_by_crm})` : ""}</p>}
                {report.signed_at && <p><b>Data da assinatura:</b> {new Date(report.signed_at).toLocaleString("pt-BR")}</p>}
                {report.is_rectified && <Badge variant="outline" className="text-[10px]">Laudo retificado — versão {report.version}</Badge>}
              </div>
              <p className="text-[10px] text-muted-foreground pt-2">Por privacidade (LGPD), o conteúdo clínico não é exibido nesta validação pública.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
