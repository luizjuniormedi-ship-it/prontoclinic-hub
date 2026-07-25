import * as React from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface ExplainedActionButtonProps extends Omit<ButtonProps, "children"> {
  label: string;
  description: string;
  icon?: LucideIcon;
  loading?: boolean;
  loadingLabel?: string;
  disabledReason?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

export function ExplainedActionButton({
  label,
  description,
  icon: Icon,
  loading = false,
  loadingLabel = "Processando...",
  disabled = false,
  disabledReason,
  tooltipSide = "top",
  type = "button",
  ...buttonProps
}: ExplainedActionButtonProps) {
  const tooltipId = React.useId();
  const unavailable = disabled || loading;
  const explanation = disabled && disabledReason ? disabledReason : description;
  const accessibleLabel = `${label}. ${explanation}`;

  const button = (
    <Button
      {...buttonProps}
      type={type}
      disabled={unavailable}
      aria-label={accessibleLabel}
      aria-describedby={tooltipId}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : Icon ? (
        <Icon className="h-4 w-4" aria-hidden="true" />
      ) : null}
      {loading ? loadingLabel : label}
    </Button>
  );

  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        {unavailable ? (
          <span
            className="inline-flex"
            tabIndex={0}
            role="group"
            aria-label={accessibleLabel}
          >
            {button}
          </span>
        ) : button}
      </TooltipTrigger>
      <TooltipContent id={tooltipId} side={tooltipSide} className="max-w-xs">
        <p className="font-medium">{disabled && disabledReason ? `${label} indisponível` : label}</p>
        <p className="text-xs text-muted-foreground">{explanation}</p>
      </TooltipContent>
    </Tooltip>
  );
}
