export interface InsuranceRuleCandidate {
  contractId: string;
  versionId: string;
  insuranceCompanyId: number;
  planId?: number | null;
  unitId?: number | null;
  professionalIds?: number[];
  versionNo: number;
  validFrom: string;
  validTo?: string | null;
  status: "draft" | "active" | "retired";
}

export interface InsuranceRuleResolutionInput {
  insuranceCompanyId: number;
  planId?: number | null;
  unitId: number;
  professionalId?: number | null;
  referenceDate: string;
}

export function selectInsuranceRule(
  candidates: InsuranceRuleCandidate[],
  input: InsuranceRuleResolutionInput,
): InsuranceRuleCandidate | null {
  const reference = Date.parse(input.referenceDate);
  const eligible = candidates.filter((candidate) => {
    const dateFrom = Date.parse(candidate.validFrom);
    const dateTo = candidate.validTo ? Date.parse(candidate.validTo) : Number.POSITIVE_INFINITY;
    const professionalMatch =
      input.professionalId == null ||
      !candidate.professionalIds?.length ||
      candidate.professionalIds.includes(input.professionalId);
    return (
      candidate.status === "active" &&
      candidate.insuranceCompanyId === input.insuranceCompanyId &&
      (candidate.planId == null || candidate.planId === input.planId) &&
      (candidate.unitId == null || candidate.unitId === input.unitId) &&
      professionalMatch &&
      reference >= dateFrom &&
      reference <= dateTo
    );
  });

  return eligible.sort((left, right) => {
    const planSpecificity = Number(right.planId != null) - Number(left.planId != null);
    if (planSpecificity !== 0) return planSpecificity;
    const unitSpecificity = Number(right.unitId != null) - Number(left.unitId != null);
    if (unitSpecificity !== 0) return unitSpecificity;
    const professionalSpecificity =
      Number(Boolean(right.professionalIds?.length)) - Number(Boolean(left.professionalIds?.length));
    if (professionalSpecificity !== 0) return professionalSpecificity;
    if (right.versionNo !== left.versionNo) return right.versionNo - left.versionNo;
    return Date.parse(right.validFrom) - Date.parse(left.validFrom);
  })[0] ?? null;
}
