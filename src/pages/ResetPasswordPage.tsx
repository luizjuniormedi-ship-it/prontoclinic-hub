import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { PASSWORD_POLICY, validatePassword } from "@/lib/authSecurity";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    let active = true;

    const detectAccess = async () => {
      // Recovery links may be exchanged for a session asynchronously by
      // supabase-js, while first-access users already have a normal session.
      const hash = window.location.hash;
      if (hash.includes("type=recovery")) setIsAuthorized(true);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (active && session) setIsAuthorized(true);
      } catch {
        // A sessão pode ter expirado ou o adaptador de Auth pode estar indisponível.
        // Em ambos os casos, não mantemos a tela presa no estado de carregamento.
      } finally {
        if (active) setCheckingAccess(false);
      }
    };

    void detectAccess();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsAuthorized(true);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      toast({ title: "A senha não atende à política de segurança", description: passwordErrors.join(" "), variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "As senhas não coincidem", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error: profileError } = await supabase
          .from("auth_account_security")
          .upsert({
            user_id: user.id,
            must_change_password: false,
            password_changed_at: new Date().toISOString(),
            password_expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
          }, { onConflict: "user_id" });
        if (profileError) throw profileError;
      }
      setSuccess(true);
      toast({ title: "Senha redefinida com sucesso!" });
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      toast({ title: "Não foi possível redefinir a senha", description: "Confira os requisitos e tente novamente.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (checkingAccess && !success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="p-6 text-center text-muted-foreground">Validando acesso...</CardContent>
        </Card>
      </div>
    );
  }

  if (!isAuthorized && !success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Link de recuperação inválido ou expirado.</p>
            <Button className="mt-4" onClick={() => navigate("/login")}>Voltar ao Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <Card className="w-full max-w-md shadow-lg animate-fade-in">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto rounded-xl bg-primary p-3 w-fit mb-4">
            <Heart className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {success ? "Senha Redefinida!" : "Nova Senha"}
          </h1>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="text-center space-y-4">
              <div className="mx-auto rounded-full bg-success/10 p-4 w-fit">
                <CheckCircle className="h-8 w-8 text-success" />
              </div>
              <p className="text-sm text-muted-foreground">Redirecionando para o login...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Nova Senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={PASSWORD_POLICY.minLength}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirmar Senha</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={PASSWORD_POLICY.minLength}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Use pelo menos {PASSWORD_POLICY.minLength} caracteres, com maiúscula, minúscula, número e símbolo.
              </p>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Redefinir Senha
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
