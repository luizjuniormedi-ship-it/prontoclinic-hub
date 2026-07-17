import { useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Loader2, ArrowLeft, Mail, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { requestPasswordReset } from "@/services/authPasswordService";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email) {
      setErrorMsg("Informe seu e-mail para continuar.");
      return;
    }
    // Validacao simples
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrorMsg("E-mail inválido.");
      return;
    }
    setLoading(true);
    await requestPasswordReset(
      supabase.auth,
      email,
      `${window.location.origin}/reset-password`,
    );
    setSent(true);
    toast({ title: "Se o e-mail existir, enviaremos um link de recuperação." });
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <Card className="w-full max-w-md shadow-lg animate-fade-in">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto rounded-xl bg-primary p-3 w-fit mb-4">
            <Heart className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Recuperar Senha</h1>
          <p className="text-sm text-muted-foreground">
            {sent
              ? "Verifique seu e-mail para redefinir a senha"
              : "Informe seu e-mail para receber o link de recuperação"}
          </p>
        </CardHeader>
        <CardContent>
          {errorMsg && !sent && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle className="text-sm">Atenção</AlertTitle>
              <AlertDescription className="text-xs">{errorMsg}</AlertDescription>
            </Alert>
          )}

          {sent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto rounded-full bg-success/10 p-4 w-fit">
                <Mail className="h-8 w-8 text-success" />
              </div>
              <p className="text-sm text-muted-foreground">
                Se <strong>{email}</strong> estiver cadastrado, enviaremos um link de
                recuperação. Verifique também a pasta de spam.
              </p>
              <p className="text-xs text-muted-foreground">
                O link expira em 1 hora.
              </p>
              <Link to="/login">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar ao Login
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar Link de Recuperação
              </Button>
              <Link to="/login" className="block">
                <Button type="button" variant="ghost" className="w-full text-sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar ao Login
                </Button>
              </Link>
              <div className="text-center pt-2 border-t">
                <Link
                  to="/pre-cadastro"
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <UserPlus className="h-3 w-3" />
                  Primeiro acesso? Faça seu pré-cadastro
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}