import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { enrollTotpFactor, unenrollTotpFactor, type TotpEnrollment } from "@/services/authMfaService";

export default function MfaEnrollmentPage() {
  const { session, mfaStep, verifyMfa, logout } = useAuth();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const started = useRef(false);
  const activeFactor = useRef<string | null>(null);
  const completed = useRef(false);

  useEffect(() => {
    if (!session || mfaStep !== "enroll" || started.current) return;
    started.current = true;
    void enrollTotpFactor(supabase.auth.mfa, "ProntoMedic")
      .then((result) => {
        activeFactor.current = result.factorId;
        setEnrollment(result);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível cadastrar o MFA."))
      .finally(() => setLoading(false));
  }, [mfaStep, session]);

  useEffect(() => () => {
    if (activeFactor.current && !completed.current) {
      void unenrollTotpFactor(supabase.auth.mfa, activeFactor.current).catch(() => undefined);
    }
  }, []);

  if (!session) return <Navigate to="/login" replace />;
  if (mfaStep === "challenge") return <Navigate to="/login" replace />;
  if (mfaStep === "verified") return <Navigate to="/" replace />;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!enrollment || !/^\d{6}$/.test(code)) return;
    setLoading(true);
    setError(null);
    const result = await verifyMfa(code, enrollment.factorId);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? "Código inválido. Tente novamente.");
      return;
    }
    completed.current = true;
    if (result.next === "password-change") navigate("/reset-password", { replace: true, state: { forced: true } });
    else navigate("/", { replace: true });
  };

  const cancel = async () => {
    if (activeFactor.current) await unenrollTotpFactor(supabase.auth.mfa, activeFactor.current).catch(() => undefined);
    activeFactor.current = null;
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold">Proteja sua conta</h1>
          <p className="text-sm text-muted-foreground">Cadastre um aplicativo autenticador para concluir o acesso.</p>
        </CardHeader>
        <CardContent>
          {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
          {loading && !enrollment ? (
            <div className="flex justify-center p-8" role="status"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : enrollment ? (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <img src={enrollment.qrCode} alt="QR code para cadastrar o autenticador" className="mx-auto h-48 w-48" />
              <div className="rounded-md bg-muted p-3 text-center">
                <p className="text-xs text-muted-foreground">Ou informe esta chave manualmente:</p>
                <code className="break-all text-sm font-semibold">{enrollment.secret}</code>
              </div>
              <div className="space-y-2">
                <Label htmlFor="totp-code">Código de 6 dígitos</Label>
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  maxLength={6}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  className="text-center text-lg tracking-widest"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Ativar MFA
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => void cancel()}>Cancelar e sair</Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
