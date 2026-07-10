/**
 * useConfirm — substitui window.confirm/prompt/alert nativos por UI consistente (Radix).
 *
 * Uso:
 *   const { confirm, promptText, alertMsg } = useConfirm();
 *   if (await confirm({ title: "Fechar competência?", description: "Bloqueia alterações." })) { ... }
 *   const motivo = await promptText({ title: "Motivo da recusa" });
 *   await alertMsg({ title: "Snapshot bloqueado", description: "..." });
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface ConfirmOpts { title: string; description?: string; confirmText?: string; cancelText?: string; destructive?: boolean; }
interface PromptOpts { title: string; description?: string; label?: string; placeholder?: string; defaultValue?: string; required?: boolean; }
interface AlertOpts { title: string; description?: string; okText?: string; }

interface ConfirmCtx {
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  promptText: (o: PromptOpts) => Promise<string | null>;
  alertMsg: (o: AlertOpts) => Promise<void>;
}

const Ctx = createContext<ConfirmCtx | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { open: boolean }) | null>(null);
  const [promptState, setPromptState] = useState<(PromptOpts & { open: boolean; value: string }) | null>(null);
  const [alertState, setAlertState] = useState<(AlertOpts & { open: boolean }) | null>(null);
  const resolver = useRef<((v: unknown) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => {
    resolver.current = resolve as (v: unknown) => void;
    setConfirmState({ ...o, open: true });
  }), []);

  const promptText = useCallback((o: PromptOpts) => new Promise<string | null>((resolve) => {
    resolver.current = resolve as (v: unknown) => void;
    setPromptState({ ...o, open: true, value: o.defaultValue ?? "" });
  }), []);

  const alertMsg = useCallback((o: AlertOpts) => new Promise<void>((resolve) => {
    resolver.current = resolve as (v: unknown) => void;
    setAlertState({ ...o, open: true });
  }), []);

  const closeConfirm = (result: boolean) => { setConfirmState(null); resolver.current?.(result); resolver.current = null; };
  const closePrompt = (result: string | null) => { setPromptState(null); resolver.current?.(result); resolver.current = null; };
  const closeAlert = () => { setAlertState(null); resolver.current?.(undefined); resolver.current = null; };

  return (
    <Ctx.Provider value={{ confirm, promptText, alertMsg }}>
      {children}

      {/* Confirmação (sim/não) */}
      <AlertDialog open={!!confirmState?.open} onOpenChange={(v) => { if (!v) closeConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
            {confirmState?.description && <AlertDialogDescription>{confirmState.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => closeConfirm(false)}>{confirmState?.cancelText ?? "Cancelar"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => closeConfirm(true)}
              className={confirmState?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            >{confirmState?.confirmText ?? "Confirmar"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Prompt (input de texto) */}
      <Dialog open={!!promptState?.open} onOpenChange={(v) => { if (!v) closePrompt(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{promptState?.title}</DialogTitle>
            {promptState?.description && <DialogDescription>{promptState.description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            {promptState?.label && <Label>{promptState.label}</Label>}
            <Input
              autoFocus
              placeholder={promptState?.placeholder}
              value={promptState?.value ?? ""}
              onChange={(e) => setPromptState((s) => s ? { ...s, value: e.target.value } : s)}
              onKeyDown={(e) => { if (e.key === "Enter" && (!promptState?.required || promptState?.value.trim())) closePrompt(promptState?.value ?? ""); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => closePrompt(null)}>Cancelar</Button>
            <Button
              disabled={promptState?.required && !promptState?.value.trim()}
              onClick={() => closePrompt(promptState?.value ?? "")}
            >Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Alerta (só OK) */}
      <AlertDialog open={!!alertState?.open} onOpenChange={(v) => { if (!v) closeAlert(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{alertState?.title}</AlertDialogTitle>
            {alertState?.description && <AlertDialogDescription>{alertState.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={closeAlert}>{alertState?.okText ?? "OK"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm deve ser usado dentro de ConfirmProvider");
  return ctx;
}
