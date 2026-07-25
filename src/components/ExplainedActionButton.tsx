import { useId, useState, type ComponentType } from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Confirmation = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type ExplainedActionButtonProps = {
  label: string;
  description: string;
  icon?: ComponentType<{ className?: string }>;
  allowed?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
  confirmation?: Confirmation;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  labelClassName?: string;
  onClick: () => void | Promise<void>;
};

/**
 * Padrão único para ações que precisam explicar efeito, indisponibilidade e
 * confirmação. A autorização real continua sendo responsabilidade da rota,
 * API e banco; `allowed` apenas evita oferecer a ação na interface.
 */
export function ExplainedActionButton({
  label,
  description,
  icon: Icon,
  allowed = true,
  disabled = false,
  disabledReason,
  loading = false,
  confirmation,
  variant = "default",
  size = "default",
  className,
  labelClassName,
  onClick,
}: ExplainedActionButtonProps) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const descriptionId = useId();
  const disabledReasonId = useId();
  const unavailable = disabled || loading;
  const accessibleLabel = unavailable && disabledReason
    ? `${label} indisponível. ${disabledReason}`
    : label;

  if (!allowed) return null;

  const execute = () => {
    if (unavailable) return;
    if (confirmation) {
      setConfirmationOpen(true);
      return;
    }
    void onClick();
  };

  return (
    <>
      <span className="inline-flex max-w-full flex-col items-start gap-1">
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <span
              tabIndex={unavailable ? 0 : undefined}
              aria-label={unavailable ? accessibleLabel : undefined}
              aria-describedby={unavailable && disabledReason ? disabledReasonId : descriptionId}
              className="inline-flex max-w-full"
            >
              <Button
                type="button"
                variant={variant}
                size={size}
                disabled={unavailable}
                aria-label={accessibleLabel}
                aria-describedby={unavailable && disabledReason ? disabledReasonId : descriptionId}
                aria-busy={loading}
                className={cn("max-w-full", className)}
                onClick={execute}
              >
                {loading ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : Icon ? (
                  <Icon aria-hidden="true" />
                ) : null}
                <span className={cn("truncate", labelClassName)}>{loading ? "Processando..." : label}</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs" sideOffset={8}>
            <p className="font-medium">{unavailable && disabledReason ? `${label} indisponível` : label}</p>
            <p className="text-xs text-muted-foreground">
              {unavailable && disabledReason ? disabledReason : description}
            </p>
          </TooltipContent>
        </Tooltip>

        <span id={descriptionId} className="sr-only">{description}</span>
        {unavailable && disabledReason && (
          <span id={disabledReasonId} className="max-w-xs text-xs text-muted-foreground">
            {disabledReason}
          </span>
        )}
      </span>

      {confirmation && (
        <AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{confirmation.cancelLabel ?? "Cancelar"}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void onClick()}>
                {confirmation.confirmLabel ?? label}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
