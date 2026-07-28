export interface ProfessionalEligibilityInput {
  professionalActive: boolean;
  unitAssigned: boolean;
  serviceEnabled: boolean;
  signatureEnabled: boolean;
  blocked: boolean;
  validityActive: boolean;
}

export function canProfessionalExecute(input: ProfessionalEligibilityInput): boolean {
  return input.professionalActive
    && input.unitAssigned
    && input.serviceEnabled
    && !input.blocked
    && input.validityActive;
}

export function canProfessionalSign(input: ProfessionalEligibilityInput): boolean {
  return input.professionalActive
    && input.unitAssigned
    && input.signatureEnabled
    && !input.blocked
    && input.validityActive;
}
