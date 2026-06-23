/**
 * IaClinicaAssistant — Chatbot + sugestões CID.
 *
 * Decisão:
 *   - Chatbot conversa livre (Edge Function ou fallback)
 *   - Sugestões de CID busca por sintomas
 *   - LGPD: consentimento explícito, log de auditoria
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Send, Brain, ShieldCheck, MessageSquare, Lightbulb } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { useToast } from "@/hooks/use-toast";
import {
  iaClinicaService,
  type IaSugestaoCid,
  type SugestaoCidResultado,
} from "@/services/iaClinicaService";

type ChatMsg = { role: "user" | "assistant"; text: string; ts: number };

const MODELS_DISPLAY: Record<string, string> = {
  "claude-3-haiku": "Claude 3 Haiku",
  "claude-3-opus": "Claude 3 Opus",
  "gpt-4": "GPT-4",
  "llama-3": "Llama 3",
  lookup_local: "Lookup local",
  fallback: "Fallback",
};

export function IaClinicaAssistant() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"chat" | "sugestoes" | "sobre">("chat");
  const [consentimento, setConsentimento] = useState(false);

  // Chat state
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Sugestão state
  const [sintomas, setSintomas] = useState("");
  const [sugestoes, setSugestoes] = useState<IaSugestaoCid[]>([]);
  const [sugestaoResultado, setSugestaoResultado] = useState<SugestaoCidResultado | null>(null);
  const [loadingSugestoes, setLoadingSugestoes] = useState(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const handleEnviarMensagem = useCallback(async () => {
    if (!mensagem.trim()) return;
    if (!consentimento) {
      toast({
        title: "Consentimento LGPD necessário",
        description: "Marque o checkbox de consentimento antes de usar a IA.",
        variant: "destructive",
      });
      return;
    }
    const userMsg: ChatMsg = { role: "user", text: mensagem, ts: Date.now() };
    setChat((c) => [...c, userMsg]);
    setMensagem("");
    setEnviando(true);
    try {
      const result = await iaClinicaService.chatbot({
        mensagem: userMsg.text,
        consentimento: true,
      });
      setChat((c) => [
        ...c,
        { role: "assistant", text: result.resposta, ts: Date.now() },
      ]);
    } catch (err) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setEnviando(false);
    }
  }, [mensagem, consentimento, toast]);

  const handleBuscarSugestoes = useCallback(async () => {
    if (!consentimento) {
      toast({
        title: "Consentimento LGPD necessário",
        variant: "destructive",
      });
      return;
    }
    if (sintomas.trim().length < 3) {
      toast({ title: "Descreva ao menos 3 caracteres", variant: "destructive" });
      return;
    }
    setLoadingSugestoes(true);
    try {
      const result = await iaClinicaService.sugerirCid({
        sintomas,
        consentimento: true,
      });
      setSugestoes(result.sugestoes);
      setSugestaoResultado(result);
    } catch (err) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setLoadingSugestoes(false);
    }
  }, [sintomas, consentimento, toast]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="IA Clínica"
        description="Assistente de apoio à decisão clínica (LGPD + CFM 2.314/2022)"
      />

      <Card>
        <CardContent className="pt-4">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={consentimento}
              onChange={(e) => setConsentimento(e.target.checked)}
              className="mt-1"
              aria-label="Consentimento LGPD"
            />
            <div className="text-sm">
              <p className="font-medium flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> Consentimento LGPD
              </p>
              <p className="text-xs text-muted-foreground">
                Autorizo o registro desta consulta para fins de auditoria e melhoria
                clínica. Não substituo avaliação médica. Resol. CFM 2.314/2022.
              </p>
            </div>
          </label>
        </CardContent>
      </Card>

      <div className="flex gap-2 border-b">
        <Button
          variant={tab === "chat" ? "default" : "ghost"}
          onClick={() => setTab("chat")}
          size="sm"
        >
          <MessageSquare className="h-4 w-4 mr-1" /> Chatbot
        </Button>
        <Button
          variant={tab === "sugestoes" ? "default" : "ghost"}
          onClick={() => setTab("sugestoes")}
          size="sm"
        >
          <Lightbulb className="h-4 w-4 mr-1" /> Sugestões CID
        </Button>
        <Button
          variant={tab === "sobre" ? "default" : "ghost"}
          onClick={() => setTab("sobre")}
          size="sm"
        >
          <Brain className="h-4 w-4 mr-1" /> Sobre
        </Button>
      </div>

      {tab === "chat" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Chatbot IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="space-y-2 mb-3 min-h-[200px] max-h-[400px] overflow-y-auto p-2 bg-muted/30 rounded-md"
              role="log"
              aria-live="polite"
            >
              {chat.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Comece digitando uma pergunta clínica…
                </p>
              ) : (
                chat.map((msg, i) => (
                  <div
                    key={i}
                    className={`p-2 rounded-md max-w-[85%] ${
                      msg.role === "user"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-card border"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                  </div>
                ))
              )}
              {enviando && (
                <div className="p-2 rounded-md bg-card border max-w-[85%]">
                  <p className="text-sm text-muted-foreground">Digitando…</p>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Ex: Qual a dosagem de amoxicilina para adulto?"
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleEnviarMensagem();
                  }
                }}
                disabled={!consentimento || enviando}
              />
              <Button onClick={() => void handleEnviarMensagem()} disabled={!consentimento || enviando}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "sugestoes" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4" /> Sugestões de CID-10
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="sintomas">Sintomas do paciente</Label>
                <Input
                  id="sintomas"
                  placeholder="Ex: febre, tosse, dispneia há 3 dias"
                  value={sintomas}
                  onChange={(e) => setSintomas(e.target.value)}
                />
              </div>
              <Button
                onClick={() => void handleBuscarSugestoes()}
                disabled={!consentimento || loadingSugestoes}
              >
                {loadingSugestoes ? "Buscando..." : "Buscar sugestões"}
              </Button>
            </CardContent>
          </Card>

          {sugestaoResultado && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Resultado</span>
                  <Badge variant="secondary">
                    {MODELS_DISPLAY[sugestaoResultado.modelo] ?? sugestaoResultado.modelo} ·{" "}
                    {sugestaoResultado.latenciaMs}ms
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm italic">{sugestaoResultado.respostaTexto}</p>
                {sugestoes.length > 0 ? (
                  sugestoes.map((s) => (
                    <div key={s.id} className="p-3 border rounded-md">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{s.ds_observacao ?? "Sugestão"}</p>
                        {s.nr_confianca != null && (
                          <Badge className="bg-blue-600">
                            {(Number(s.nr_confianca) * 100).toFixed(0)}% confiança
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{s.ds_fonte}</p>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    icon={Lightbulb}
                    title="Nenhuma sugestão encontrada"
                    description="Tente descrever os sintomas com mais detalhes."
                  />
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === "sobre" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-4 w-4" /> Sobre a IA Clínica
            </CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm max-w-none">
            <p>
              A IA Clínica do ProntoClinic Hub oferece apoio à decisão clínica
              por meio de sugestões de CID-10 e chatbot baseado em LLM.
            </p>
            <h4>Como funciona</h4>
            <ul>
              <li>Sugestões são geradas por modelo de IA rodando server-side (Edge Function)</li>
              <li>Em modo de contingência, usa lookup local pré-computado</li>
              <li>Todo uso é registrado em log LGPD (com hash da query)</li>
            </ul>
            <h4>Conformidade</h4>
            <ul>
              <li>LGPD: consentimento obrigatório, log de auditoria</li>
              <li>Resolução CFM 2.314/2022: IA é apoio, decisão final do médico</li>
              <li>Não substitui diagnóstico médico</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
