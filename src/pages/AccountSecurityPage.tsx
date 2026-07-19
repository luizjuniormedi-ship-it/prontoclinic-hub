import { useCallback, useEffect, useState } from "react";
import { Monitor, ShieldCheck, LogOut, Ban, KeyRound, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { getAuthDeviceId, listAuthDevices, revokeAuthDevice, recordAuthSecurityEvent } from "@/lib/authSecurity";
import { supabase } from "@/lib/supabase";

type AuthDevice = {
  id: string;
  device_id: string;
  device_label: string;
  user_agent: string | null;
  last_seen_at: string;
  created_at: string;
  revoked_at: string | null;
};

export default function AccountSecurityPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [devices, setDevices] = useState<AuthDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [mfaReady, setMfaReady] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await listAuthDevices() as AuthDevice[]);
    } catch (error) {
      toast({ title: "Não foi possível carregar os dispositivos", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const loadMfa = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error) setMfaReady(data.totp.some((factor) => factor.status === "verified"));
  }, []);

  useEffect(() => { void loadMfa(); }, [loadMfa]);

  const startMfaSetup = async () => {
    setMfaLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "ProntoMedic" });
      if (error) throw error;
      setMfaSetup({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch (error) {
      toast({ title: "Não foi possível iniciar o autenticador", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setMfaLoading(false);
    }
  };

  const verifyMfaSetup = async () => {
    if (!mfaSetup || !/^\d{6}$/.test(mfaCode)) return;
    setMfaLoading(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaSetup.factorId, code: mfaCode });
      if (error) throw error;
      setMfaReady(true);
      setMfaSetup(null);
      setMfaCode("");
      if (user) void recordAuthSecurityEvent("mfa_success", user.id, user.company_id, { factor: "totp" });
      toast({ title: "Autenticação em dois fatores ativada" });
    } catch (error) {
      if (user) void recordAuthSecurityEvent("mfa_failure", user.id, user.company_id, { factor: "totp" });
      toast({ title: "Código inválido", description: "Confira o código atual no aplicativo autenticador.", variant: "destructive" });
    } finally {
      setMfaLoading(false);
    }
  };

  const revoke = async (device: AuthDevice) => {
    try {
      await revokeAuthDevice(device.id);
      if (user) void recordAuthSecurityEvent("device_revoked", user.id, user.company_id, { device_id: device.device_id });
      await load();
      toast({ title: "Dispositivo revogado" });
    } catch (error) {
      toast({ title: "Não foi possível revogar", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
    }
  };

  const logoutAll = async () => {
    await logout("global");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Segurança da conta" description="Sessões, dispositivos e autenticação" />
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-primary" />Autenticação em dois fatores</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {mfaReady ? (
            <p className="text-sm text-muted-foreground">Autenticador TOTP configurado. O código será solicitado quando a política da sua conta exigir segundo fator.</p>
          ) : !mfaSetup ? (
            <>
              <p className="text-sm text-muted-foreground">Proteja a conta com um aplicativo autenticador. O segredo só é exibido durante esta configuração.</p>
              <Button variant="outline" onClick={() => void startMfaSetup()} disabled={mfaLoading}>
                {mfaLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Configurar autenticador
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Escaneie o QR Code no aplicativo autenticador e confirme com o código de seis dígitos.</p>
              <img src={mfaSetup.qrCode} alt="QR Code para configurar o autenticador" className="h-44 w-44 rounded border bg-white p-2" />
              <p className="break-all text-xs text-muted-foreground">Chave manual: {mfaSetup.secret}</p>
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="Código do autenticador" inputMode="numeric" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))} className="h-10 w-36 rounded-md border bg-background px-3 text-sm" />
                <Button onClick={() => void verifyMfaSetup()} disabled={mfaLoading || !/^\d{6}$/.test(mfaCode)}>
                  {mfaLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" />Sessões ativas</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">As sessões expiram após período de inatividade. Tokens não são armazenados nesta tela. Para invalidar sessões já emitidas em todos os dispositivos, use o encerramento global.</p>
          <Button variant="destructive" onClick={() => void logoutAll()}><LogOut className="mr-2 h-4 w-4" />Encerrar em todos os dispositivos</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Dispositivos autorizados</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">Este registro identifica os navegadores que acessaram a conta, sem guardar tokens. Revogar remove o dispositivo do cadastro; o encerramento global invalida as sessões do provedor.</p>
          {loading ? <p className="text-sm text-muted-foreground">Carregando...</p> : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum dispositivo registrado nesta sessão.</p>
          ) : (
            <div className="space-y-3">
              {devices.map((device) => {
                const current = device.device_id === getAuthDeviceId();
                return (
                  <div key={device.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <Monitor className="mt-1 h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{device.device_label} {current && <Badge variant="secondary" className="ml-2">Este dispositivo</Badge>}</p>
                        <p className="text-xs text-muted-foreground">Última atividade: {new Date(device.last_seen_at).toLocaleString("pt-BR")}</p>
                        {device.user_agent && <p className="max-w-xl truncate text-xs text-muted-foreground">{device.user_agent}</p>}
                      </div>
                    </div>
                    {!device.revoked_at && <Button variant="outline" size="sm" onClick={() => void revoke(device)}><Ban className="mr-2 h-3.5 w-3.5" />Revogar registro</Button>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
