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

export type ExplainedActionButtonProps = Omit<ButtonProps, "children" | "onClick"> & {
  label: string;
  description: string;
  icon?: ComponentType<{ className?: string }>;
  allowed?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  disabledReason?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  confirmation?: Confirmation;
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
  loading = false,
  loadingLabel = "Processando...",
  disabledReason,
  tooltipSide = "top",
  confirmation,
  variant = "default",
  size = "default",
  type = "button",
  className,
  labelClassName,
  onClick,
  ...buttonProps
}: ExplainedActionButtonProps) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const descriptionId = useId();
  const disabledReasonId = useId();
  const unavailable = disabled || loading;
  const explanation = disabled && disabledReason ? disabledReason : description;
  const accessibleLabel = `${label}. ${explanation}`;

  if (!allowed) return null;

  const execute = () => {
    if (unavailable) return;
    if (confirmation) {
      setConfirmationOpen(true);
      return;
    }
    void onClick();
  };

  const button = (
    <Button
      {...buttonProps}
      type={type}
      variant={variant}
      size={size}
      disabled={unavailable}
      aria-label={accessibleLabel}
      aria-describedby={disabled && disabledReason ? disabledReasonId : descriptionId}
      aria-busy={loading}
      className={cn("max-w-full", className)}
      onClick={execute}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : Icon ? (
        <Icon className="h-4 w-4" aria-hidden="true" />
      ) : null}
      <span className={cn("truncate", labelClassName)}>
        {loading ? loadingLabel : label}
      </span>
    </Button>
  );

  return (
    <>
      <span className="inline-flex max-w-full flex-col items-start gap-1">
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            {unavailable ? (
              <span
                className="inline-flex max-w-full"
                tabIndex={0}
                role="group"
                aria-label={accessibleLabel}
                aria-describedby={disabled && disabledReason ? disabledReasonId : descriptionId}
              >
                {button}
              </span>
            ) : button}
          </TooltipTrigger>
          <TooltipContent className="max-w-xs" side={tooltipSide} sideOffset={8}>
            <p className="font-medium">
              {disabled && disabledReason ? `${label} indisponível` : label}
            </p>
            <p className="text-xs text-muted-foreground">{explanation}</p>
          </TooltipContent>
        </Tooltip>

        <span id={descriptionId} className="sr-only">{description}</span>
        {disabled && disabledReason && (
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
