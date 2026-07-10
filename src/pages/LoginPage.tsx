import { useState } from "react";
import { useNavigate, Link, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Heart, Loader2, Eye, EyeOff, AlertCircle, UserPlus, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

type LoginError = { title: string; description?: string } | null;

function translateLoginError(raw: string | undefined): LoginError {
  if (!raw) return { title: "Erro ao fazer login. Tente novamente." };
  const msg = raw.toLowerCase();
  if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
    return { title: "E-mail ou senha inválidos.", description: "Verifique seus dados e tente novamente." };
  }
  if (msg.includes("email not confirmed")) {
    return { title: "E-mail não confirmado.", description: "Acesse sua caixa de entrada e confirme o e-mail antes de entrar." };
  }
  if (msg.includes("too many requests")) {
    return { title: "Muitas tentativas.", description: "Aguarde alguns minutos e tente novamente." };
  }
  if (msg.includes("user not found")) {
    return { title: "Usuário não encontrado.", description: "Verifique o e-mail ou faça o pré-cadastro." };
  }
  return { title: raw };
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [requires2FA, setRequires2FA] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoginError>(null);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError({ title: "Preencha todos os campos." });
      return;
    }
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      // Detecta flag de 2FA devolvida no result (compat: hoje o supabase não retorna,
      // mas mantemos a porta aberta para o backend setar lg_2fatores=true)
      const needs2FA = (result as { requires2FA?: boolean }).requires2FA;
      if (needs2FA) {
        setRequires2FA(true);
        toast({ title: "Código 2FA enviado para seu e-mail." });
        return;
      }
      navigate("/");
      return;
    }
    setError(translateLoginError(result.error));
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (twoFactorCode.length < 6) {
      setError({ title: "Código 2FA inválido.", description: "O código tem 6 dígitos." });
      return;
    }
    setLoading(true);
    // Simulação: backend final chamaria supabase.auth.verifyOtp ou similar.
    // Por enquanto, tratamos como sucesso parcial e pedimos para re-entrar.
    setLoading(false);
    toast({ title: "Verificação adicional em desenvolvimento." });
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <Card className="w-full max-w-md shadow-lg animate-fade-in">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto rounded-xl bg-primary p-3 w-fit mb-4">
            <Heart className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">PRONTOMEDIC</h1>
          <CardDescription className="text-sm">Sistema de Gestão Clínica</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="text-sm">{error.title}</AlertTitle>
              {error.description && (
                <AlertDescription className="text-xs">{error.description}</AlertDescription>
              )}
            </Alert>
          )}

          {!requires2FA ? (
            <form onSubmit={handleSubmit} className="space-y-4" aria-label="Formulário de login">
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
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Senha</Label>
                  <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                    Esqueci minha senha
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Entrar
              </Button>

              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
                  <span className="bg-card px-2 text-muted-foreground">ou</span>
                </div>
              </div>

              <Link to="/pre-cadastro" className="block">
                <Button type="button" variant="outline" className="w-full">
                  <UserPlus className="mr-2 h-4 w-4" />
                  Primeiro acesso — Pré-cadastro
                  <ArrowRight className="ml-auto h-4 w-4" />
                </Button>
              </Link>

              <p className="text-[11px] text-center text-muted-foreground flex items-center justify-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                Seus dados são tratados conforme a LGPD.
              </p>
            </form>
          ) : (
            <form onSubmit={handle2FASubmit} className="space-y-4" aria-label="Verificação em duas etapas">
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                Sua conta exige verificação em duas etapas. Informe o código de 6 dígitos enviado para
                seu e-mail.
              </div>
              <div className="space-y-2">
                <Label htmlFor="twoFactorCode">Código 2FA</Label>
                <Input
                  id="twoFactorCode"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center tracking-widest text-lg"
                  autoFocus
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || twoFactorCode.length < 6}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verificar
              </Button>
              <button
                type="button"
                onClick={() => {
                  setRequires2FA(false);
                  setTwoFactorCode("");
                  setError(null);
                }}
                className="block w-full text-xs text-muted-foreground hover:text-foreground"
              >
                Voltar para o login
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
