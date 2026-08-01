import { useEffect, useState } from "react";
import { Loader2, MonitorSmartphone, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { authSessionService } from "@/services/authSessionService";

type Device = {
  device_id?: string;
  display_name?: string;
  platform?: string;
  last_seen_at?: string;
  revoked_at?: string | null;
};

export default function AccountSecurityPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const { toast } = useToast();

  const loadDevices = async () => {
    setLoading(true);
    try {
      setDevices((await authSessionService.listDevices()) as Device[]);
    } catch (error) {
      toast({
        title: "Não foi possível consultar as sessões",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDevices();
  }, []);

  const revoke = async (deviceId: string) => {
    setRevoking(deviceId);
    try {
      await authSessionService.revokeDevice(deviceId, "user_security_page");
      toast({ title: "Acesso do dispositivo revogado" });
      await loadDevices();
    } catch (error) {
      toast({
        title: "Não foi possível revogar o dispositivo",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setRevoking(null);
    }
  };

  const activeDevices = devices.filter((device) => !device.revoked_at);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          Segurança e sessões
        </h1>
        <p className="text-muted-foreground">
          Consulte os dispositivos autorizados e revogue acessos que não reconhece.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Sessões ativas</CardTitle>
          <Button variant="outline" size="icon" aria-label="Atualizar sessões" onClick={() => void loadDevices()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando sessões...
            </div>
          ) : activeDevices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma sessão ativa encontrada.</p>
          ) : activeDevices.map((device) => (
            <div key={device.device_id} className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div className="flex min-w-0 items-center gap-3">
                <MonitorSmartphone className="h-5 w-5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{device.display_name || "Dispositivo sem nome"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {device.platform || "Plataforma não informada"}
                    {device.last_seen_at ? ` · último acesso ${new Date(device.last_seen_at).toLocaleString("pt-BR")}` : ""}
                  </p>
                </div>
              </div>
              {device.device_id && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoking === device.device_id}
                  onClick={() => void revoke(device.device_id!)}
                >
                  {revoking === device.device_id ? "Revogando..." : "Revogar"}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
