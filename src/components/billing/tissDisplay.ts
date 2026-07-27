import type { TissXml } from "@/services/tissService";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const integerFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

export function toFiniteTissNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function finiteTissNumberOrZero(value: unknown): number {
  return toFiniteTissNumber(value) ?? 0;
}

export function formatTissCurrency(value: unknown): string {
  const parsed = toFiniteTissNumber(value);
  return parsed === null ? "—" : currencyFormatter.format(parsed);
}

export function formatTissInteger(value: unknown): string {
  const parsed = toFiniteTissNumber(value);
  return parsed === null ? "—" : integerFormatter.format(parsed);
}

export function formatTissPercent(value: unknown): string {
  const parsed = toFiniteTissNumber(value);
  return parsed === null ? "—" : `${parsed.toFixed(2)}%`;
}

export function formatTissDateTime(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    return "—";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR");
}

export function downloadTissXml(fatura: TissXml) {
  if (!fatura.bl_xml_enviado) return;

  const blob = new Blob([fatura.bl_xml_enviado], { type: "text/xml" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fatura.ds_filename || `tiss_${fatura.id}.xml`;
  anchor.click();
  URL.revokeObjectURL(url);
}
