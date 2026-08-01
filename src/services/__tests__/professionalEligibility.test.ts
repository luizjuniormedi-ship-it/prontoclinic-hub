import { describe, expect, it } from "vitest";
import { canProfessionalExecute, canProfessionalSign } from "@/services/professionalEligibility";

const eligible = {
  professionalActive: true,
  unitAssigned: true,
  serviceEnabled: true,
  signatureEnabled: true,
  blocked: false,
  validityActive: true,
};

describe("professional eligibility", () => {
  it("allows execution only when the professional is active, assigned and habilitated", () => {
    expect(canProfessionalExecute(eligible)).toBe(true);
    expect(canProfessionalExecute({ ...eligible, serviceEnabled: false })).toBe(false);
    expect(canProfessionalExecute({ ...eligible, unitAssigned: false })).toBe(false);
  });

  it("blocks execution and signature while a scoped block is active", () => {
    expect(canProfessionalExecute({ ...eligible, blocked: true })).toBe(false);
    expect(canProfessionalSign({ ...eligible, blocked: true })).toBe(false);
  });

  it("requires an active signature profile for release", () => {
    expect(canProfessionalSign(eligible)).toBe(true);
    expect(canProfessionalSign({ ...eligible, signatureEnabled: false })).toBe(false);
    expect(canProfessionalSign({ ...eligible, validityActive: false })).toBe(false);
  });
});
