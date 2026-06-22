/**
 * ConfirmarEmailPage.tsx
 *
 * Pagina PUBLICA acessada via link do e-mail de confirmacao do pre-cadastro.
 * URL: /pre-cadastro/confirmar?token=<token>
 * (tambem aceita /confirmar-email?token=<token> para compatibilidade)
 *
 * Fluxo:
 *   1. Le o token da URL
 *   2. Busca os dados publicos do pre-cadastro (preCadastroService.buscarPorToken)
 *   3. Mostra resumo dos dados
 *   4. Usuario confirma -> preCadastroService.confirmar(token)
 *   5. Sucesso -> "Bem-vindo! Aguarde contato da clinica"
 */

import { useEffect, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Heart, Loader2, CheckCircle2, AlertCircle, ArrowLeft, ArrowRight,
  ShieldCheck, Mail, Edit3, XCircle, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { preCadastroService } from "@/services/preCadastroService";

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "warning" | "success" | "destructive" }> = {
  PENDENTE: { label: "Aguardando confirmação", variant: "warning" },
  CONFIRMADO: { label: "Confirmado", variant: "success" },
  EXPIRADO: { label: "Expirado", variant: "destructive" },
  CANCELADO: { label: "Cancelado", variant: "destructive" },
  MIGRADO: { label: "Cadastro concluído", variant: "success" },
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

export default function ConfirmarEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { toast } = useToast();
  const [confirmed, setConfirmed] = useState(false);

  const query = useQuery({
    queryKey: ["pre-cadastro", token],
    queryFn: async () => {
      if (!token) return null;
      return preCadastroService.buscarPorToken(token);
    },
    enabled: !!token,
  });

  const mutation = useMutation({
    mutationFn: async (t: string) => preCadastroService.confirmar(t),
    onSuccess: () => {
      setConfirmed(true);
      toast({ title: "Pré-cadastro confirmado!" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao confirmar", description: err.message, variant: "destructive" });
    },
  });

  // Se nao tem token, mostra erro
  if (!token) {
    return (
      <Shell>
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="h-10 w-10 mx-auto text-destructive" />
            <h1 className="text-lg font-semibold">Link inválido</h1>
            <p className="text-sm text-muted-foreground">
              O link de confirmação precisa de um token válido. Verifique o link recebido por e-mail.
            </p>
            <Button asChild className="w-full">
              <Link to="/pre-cadastro">Iniciar um novo pré-cadastro</Link>
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // Sucesso
  if (confirmed) {
    return (
      <Shell>
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="mx-auto rounded-full bg-success/10 p-4 w-fit">
              <CheckCircle2 className="h-10 w-10 text-success" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Bem-vindo!</h1>
            <p className="text-sm text-muted-foreground">
              Seu pré-cadastro foi confirmado. A clínica entrará em contato para finalizar seu cadastro e agendar sua primeira consulta.
            </p>
            <div className="rounded-md bg-muted/50 p-3 text-xs text-left space-y-1">
              <p className="font-medium">Próximos passos:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                <li>Aguarde o contato da clínica por e-mail ou telefone</li>
                <li>Tenha em mãos documentos e cartão do convênio</li>
                <li>Chegue 15 minutos antes da primeira consulta</li>
              </ul>
            </div>
            <Button onClick={() => navigate("/login")} className="w-full">
              Ir para o login
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <p className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              Seus dados estão protegidos pela LGPD.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const record = query.data;
  const isLoading = query.isLoading;
  const isError = query.isError;
  const statusInfo = record?.status ? STATUS_LABEL[record.status] : null;

  // Token expirado / cancelado / ja confirmado
  if (record && record.status && record.status !== "PENDENTE") {
    return (
      <Shell>
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="pt-8 text-center space-y-4">
            {record.status === "CONFIRMADO" || record.status === "MIGRADO" ? (
              <CheckCircle2 className="h-10 w-10 mx-auto text-success" />
            ) : (
              <XCircle className="h-10 w-10 mx-auto text-destructive" />
            )}
            <h1 className="text-xl font-bold">{statusInfo?.label}</h1>
            <p className="text-sm text-muted-foreground">
              {record.status === "CONFIRMADO" && "Este pré-cadastro já foi confirmado. Você pode fazer login."}
              {record.status === "MIGRADO" && "Este pré-cadastro já foi migrado para paciente definitivo."}
              {record.status === "EXPIRADO" && "O link de confirmação expirou (validade de 72h). Inicie um novo pré-cadastro."}
              {record.status === "CANCELADO" && "Este pré-cadastro foi cancelado. Entre em contato com a clínica."}
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <Button onClick={() => navigate("/login")}>Ir para o login</Button>
              {record.status === "EXPIRADO" && (
                <Button variant="outline" onClick={() => navigate("/pre-cadastro")}>
                  Iniciar novo pré-cadastro
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Confirme seus dados
          </CardTitle>
          <CardDescription>
            Verifique se as informações abaixo estão corretas antes de finalizar seu pré-cadastro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Não foi possível validar o token.</AlertTitle>
              <AlertDescription className="text-xs">
                O link pode ter expirado ou sido utilizado. Inicie um novo pré-cadastro.
              </AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : record ? (
            <>
              <dl className="divide-y rounded-md border">
                <Row label="Nome" value={record.full_name ?? "—"} />
                <Row label="E-mail" value={record.email ?? "—"} />
                {record.cpf && <Row label="CPF" value={record.cpf} />}
                {record.birth_date && <Row label="Data de nascimento" value={formatDate(record.birth_date)} />}
                <Row
                  label="Validade do link"
                  value={
                    record.dt_token_exp
                      ? `${formatDate(record.dt_token_exp)} ${
                          new Date(record.dt_token_exp).getTime() < Date.now() ? "(expirado)" : ""
                        }`
                      : "—"
                  }
                />
              </dl>

              {record.dt_token_exp && new Date(record.dt_token_exp).getTime() < Date.now() && (
                <Alert>
                  <Clock className="h-4 w-4" />
                  <AlertTitle className="text-sm">Link expirado</AlertTitle>
                  <AlertDescription className="text-xs">
                    Este link ultrapassou o prazo de 72h. Inicie um novo pré-cadastro.
                  </AlertDescription>
                </Alert>
              )}

              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Ao confirmar, você declara que as informações são verdadeiras e aceita o tratamento dos seus dados conforme a LGPD.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate(`/pre-cadastro?token=${token}`)}
                >
                  <Edit3 className="mr-2 h-4 w-4" />
                  Editar
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => mutation.mutate(token)}
                  disabled={
                    mutation.isPending ||
                    !!(record.dt_token_exp && new Date(record.dt_token_exp).getTime() < Date.now())
                  }
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Confirmando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Confirmar pré-cadastro
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            !isError && (
              <p className="text-sm text-muted-foreground">
                Não encontramos um pré-cadastro para este link.
              </p>
            )
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-2 px-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 font-medium">{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <header className="px-4 py-4 flex items-center justify-between max-w-3xl mx-auto w-full">
        <Link to="/login" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary p-1.5">
            <Heart className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-sm font-bold">PRONTOMEDIC</span>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        {children}
      </main>
    </div>
  );
}