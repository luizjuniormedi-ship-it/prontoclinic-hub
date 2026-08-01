import { features } from "@/lib/env";

export type WaveModuleId = 19 | 20 | 21 | 22 | 23 | 24;

export interface WaveModuleDefinition {
  id: WaveModuleId;
  title: string;
  path: string;
  enabled: boolean;
}

export const waveModules: readonly WaveModuleDefinition[] = [
  {
    id: 19,
    title: "Enfermagem clínica",
    path: "/nursing/clinical",
    enabled: features.module19,
  },
  {
    id: 20,
    title: "Prescrição eletrônica",
    path: "/prescriptions",
    enabled: features.module20,
  },
  {
    id: 21,
    title: "Protocolos assistenciais",
    path: "/care-protocols",
    enabled: features.module21,
  },
  {
    id: 22,
    title: "Solicitações de exames",
    path: "/exam-requests",
    enabled: features.module22,
  },
  {
    id: 23,
    title: "Laboratório / LIS",
    path: "/lab",
    enabled: features.module23,
  },
  {
    id: 24,
    title: "Imagem / RIS",
    path: "/dicom/orders",
    enabled: features.module24,
  },
] as const;

export function getWaveModule(id: WaveModuleId): WaveModuleDefinition {
  const definition = waveModules.find((item) => item.id === id);
  if (!definition) {
    throw new Error(`Módulo ${id} não está registrado na onda clínica`);
  }
  return definition;
}

export function isWaveModuleEnabled(id: WaveModuleId): boolean {
  return getWaveModule(id).enabled;
}
