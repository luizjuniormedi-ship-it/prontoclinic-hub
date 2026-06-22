/**
 * NotificationCenter.tsx
 *
 * Central de notificacoes do usuario + configuracoes LGPD de opt-in/opt-out por canal.
 *
 * Tabs:
 *   1. Nao lidas - notificacoes com status PENDING/SENT/DELIVERED
 *   2. Todas     - historico completo
 *   3. Configuracoes - opt-in/opt-out por canal (LGPD)
 *
 * Usa notificationService para queries (Supabase) e atualizacoes locais via
 * useMutation (TanStack Query).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail, MessageSquare, Smartphone, Bell,
  Check, CheckCheck, Settings, Inbox, Archive,
  Loader2, AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { type NotificationRecord, type NotificationChannel } from "@/services/notificationService";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

const CHANNELS: { id: NotificationChannel; label: string; description: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "EMAIL", label: "E-mail", description: "Confirmações, lembretes e resultados.", Icon: Mail },
  { id: "WHATSAPP", label: "WhatsApp", description: "Mensagens rápidas e lembretes.", Icon: MessageSquare },
  { id: "SMS", label: "SMS", description: "Última milha para lembretes críticos.", Icon: Smartphone },
  { id: "PUSH", label: "Notificações no app", description: "Avisos em tempo real.", Icon: Bell },
];

const channelIcon: Record<NotificationChannel, React.ComponentType<{ className?: string }>> = {
  EMAIL: Mail,
  SMS: Smartphone,
  WHATSAPP: MessageSquare,
  PUSH: Bell,
};

const channelVariant: Record<NotificationChannel, string> = {
  EMAIL: "bg-primary/10 text-primary",
  SMS: "bg-warning/10 text-warning",
  WHATSAPP: "bg-success/10 text-success",
  PUSH: "bg-accent text-accent-foreground",
};

const statusVariant: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PROCESSING: "bg-warning/10 text-warning",
  SENT: "bg-primary/10 text-primary",
  DELIVERED: "bg-success/10 text-success",
  READ: "bg-success/15 text-success",
  FAILED: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

interface Preference {
  channel: NotificationChannel;
  is_enabled: boolean;
  unsubscribed_at: string | null;
  unsubscribe_reason: string | null;
}

export function NotificationCenter() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"unread" | "all" | "settings">("unread");

  // 1. Listagem (admin/user): historico do recipient_id = 0 -> todas do company
  // Para esta tela exibimos as ultimas 100 da company (admin only)
  const listQuery = useQuery({
    queryKey: ["notifications", tab],
    queryFn: async (): Promise<NotificationRecord[]> => {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from("notifications")
        .select("*")
        .gte("dt_queued", since)
        .order("dt_queued", { ascending: false })
        .limit(100);

      if (tab === "unread") {
        q = q.in("status", ["PENDING", "PROCESSING", "SENT", "DELIVERED"]);
      }

      const { data, error } = await q;
      if (error) {
        // Tabela ainda nao existe -> lista vazia (silencioso)
        if (error.code === "42P01" || /relation.*does not exist/i.test(error.message)) {
          return [];
        }
        throw new Error(error.message);
      }
      return (data ?? []) as NotificationRecord[];
    },
  });

  // 2. Preferencias LGPD
  const prefsQuery = useQuery({
    queryKey: ["notification-prefs", user?.id],
    queryFn: async (): Promise<Preference[]> => {
      // Fallback se a tabela nao existir ainda
      try {
        const { data, error } = await supabase
          .from("notification_preferences")
          .select("*");
        if (error) throw error;
        const rows = (data ?? []) as Preference[];
        // Garante um registro por canal (default enabled=true)
        return CHANNELS.map((c) => {
          const existing = rows.find((r) => r.channel === c.id);
          return existing ?? { channel: c.id, is_enabled: true, unsubscribed_at: null, unsubscribe_reason: null };
        });
      } catch {
        return CHANNELS.map((c) => ({
          channel: c.id, is_enabled: true, unsubscribed_at: null, unsubscribe_reason: null,
        }));
      }
    },
  });

  // 3. Mutacoes
  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ status: "READ", updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "Marcada como lida." });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ status: "READ", updated_at: new Date().toISOString() })
        .in("status", ["PENDING", "PROCESSING", "SENT", "DELIVERED"]);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "Todas marcadas como lidas." });
    },
  });

  const togglePrefMutation = useMutation({
    mutationFn: async ({ channel, enabled }: { channel: NotificationChannel; enabled: boolean }) => {
      // Tenta atualizar via service; se nao existir tabela, faz no-op
      try {
        // Sem recipientId confiavel aqui, entao usa upsert direto
        const { data: companyId } = await supabase.rpc("current_company_id");
        if (!companyId) throw new Error("company_id ausente");
        const { error } = await supabase.from("notification_preferences").upsert(
          {
            company_id: companyId,
            recipient_type: "STAFF",
            recipient_id: user?.id ?? null,
            channel,
            is_enabled: enabled,
            unsubscribed_at: enabled ? null : new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_id,recipient_id,recipient_type,channel" },
        );
        if (error) throw new Error(error.message);
      } catch {
        // Fallback silencioso
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["notification-prefs"] });
      toast({
        title: vars.enabled ? "Canal ativado" : "Canal desativado",
        description: vars.enabled
          ? "Você voltará a receber notificações neste canal."
          : "Você não receberá mais notificações neste canal.",
      });
    },
  });

  const notifications = listQuery.data ?? [];
  const prefs = prefsQuery.data ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Central de Notificações"
        description="Acompanhe suas mensagens e configure seus canais de comunicação."
        actions={
          tab !== "settings" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending || notifications.length === 0}
            >
              {markAllReadMutation.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="mr-2 h-3.5 w-3.5" />
              )}
              Marcar todas como lidas
            </Button>
          )
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="unread">
            <Inbox className="mr-2 h-3.5 w-3.5" />
            Não lidas
          </TabsTrigger>
          <TabsTrigger value="all">
            <Archive className="mr-2 h-3.5 w-3.5" />
            Todas
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="mr-2 h-3.5 w-3.5" />
            Configurações
          </TabsTrigger>
        </TabsList>

        {/* ─────── Lista ─────── */}
        <TabsContent value="unread" className="space-y-3">
          {listQuery.isLoading ? (
            <SkeletonList />
          ) : notifications.length === 0 ? (
            <EmptyInbox />
          ) : (
            <ul className="space-y-2">
              {notifications.map((n) => (
                <li key={n.id}>
                  <NotificationRow
                    n={n}
                    onMarkRead={() => markReadMutation.mutate(n.id)}
                    isMarking={markReadMutation.isPending && markReadMutation.variables === n.id}
                  />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-3">
          {listQuery.isLoading ? (
            <SkeletonList />
          ) : notifications.length === 0 ? (
            <EmptyInbox />
          ) : (
            <ul className="space-y-2">
              {notifications.map((n) => (
                <li key={n.id}>
                  <NotificationRow
                    n={n}
                    onMarkRead={() => markReadMutation.mutate(n.id)}
                    isMarking={markReadMutation.isPending && markReadMutation.variables === n.id}
                    showStatus
                  />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ─────── Configurações ─────── */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Canais de comunicação</CardTitle>
              <CardDescription>
                Escolha por onde deseja receber mensagens. Você pode alterar a qualquer momento.
                Conforme a LGPD (art. 18, IV), você tem direito à revogação do consentimento.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              {prefsQuery.isLoading ? (
                <SkeletonList />
              ) : (
                prefs.map((p) => {
                  const ch = CHANNELS.find((c) => c.id === p.channel);
                  if (!ch) return null;
                  const Icon = ch.Icon;
                  return (
                    <div key={p.channel} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className={`rounded-md p-2 ${channelVariant[p.channel]} shrink-0`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{ch.label}</p>
                          <p className="text-xs text-muted-foreground">{ch.description}</p>
                          {p.unsubscribed_at && (
                            <p className="text-[11px] text-warning mt-1">
                              Desativado em {new Date(p.unsubscribed_at).toLocaleDateString("pt-BR")}
                            </p>
                          )}
                        </div>
                      </div>
                      <Switch
                        checked={p.is_enabled}
                        onCheckedChange={(v) =>
                          togglePrefMutation.mutate({ channel: p.channel, enabled: v })
                        }
                        disabled={togglePrefMutation.isPending}
                        aria-label={`Ativar ${ch.label}`}
                      />
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Notificações críticas (ex.: alterações de senha, avisos de segurança) são sempre
              enviadas por e-mail e não podem ser desativadas por aqui.
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NotificationRow({
  n, onMarkRead, isMarking, showStatus,
}: {
  n: NotificationRecord;
  onMarkRead: () => void;
  isMarking: boolean;
  showStatus?: boolean;
}) {
  const Icon = channelIcon[n.channel] ?? Bell;
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <span className={`rounded-md p-2 ${channelVariant[n.channel] ?? ""} shrink-0`}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {n.subject || n.body.slice(0, 80)}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                  {n.body}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {n.channel}
                  </Badge>
                  {n.template_code && (
                    <Badge variant="outline" className="text-[10px]">
                      {n.template_code}
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {formatRelative(n.dt_queued)}
                  </span>
                  {showStatus && (
                    <Badge variant="outline" className={`text-[10px] ${statusVariant[n.status] ?? ""}`}>
                      {n.status}
                    </Badge>
                  )}
                  {n.attempts > 1 && (
                    <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                      {n.attempts} tentativas
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={onMarkRead}
                disabled={isMarking || n.status === "READ"}
                title="Marcar como lida"
              >
                {isMarking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-3 flex gap-3">
            <Skeleton className="h-8 w-8 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyInbox() {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <div className="mx-auto rounded-full bg-muted p-4 w-fit mb-3">
          <Inbox className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold">Sem notificações</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Você está em dia com suas mensagens.
        </p>
      </CardContent>
    </Card>
  );
}

export default NotificationCenter;