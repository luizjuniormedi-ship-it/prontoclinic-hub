import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export function PWAUpdatePrompt() {
  const [dismissed, setDismissed] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl) {
      console.log("SW registered:", swUrl);
    },
    onRegisterError(error) {
      console.error("SW registration error:", error);
    },
  });

  useEffect(() => {
    if (needRefresh && !dismissed) {
      const id = toast({
        title: "Nova versão disponível",
        description: "Clique em atualizar para obter a versão mais recente.",
        duration: Infinity,
        action: (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                updateServiceWorker(true);
              }}
            >
              Atualizar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDismissed(true);
                setNeedRefresh(false);
                id.dismiss();
              }}
            >
              Depois
            </Button>
          </div>
        ),
      });
    }
  }, [needRefresh, dismissed, setNeedRefresh, updateServiceWorker]);

  useEffect(() => {
    if (offlineReady) {
      toast({
        title: "ProntoMedic pronto offline",
        description: "Você pode usar o app mesmo sem internet.",
      });
      setOfflineReady(false);
    }
  }, [offlineReady, setOfflineReady]);

  return null;
}
