import { describe, expect, it } from "vitest";
import { parseSettingValue, serializeSettingValue } from "@/services/systemSettingsService";

describe("system settings value contract", () => {
  it("serializes supported scalar values without losing false or zero", () => {
    expect(serializeSettingValue(false)).toBe("false");
    expect(serializeSettingValue(0)).toBe("0");
    expect(serializeSettingValue("America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(serializeSettingValue(null)).toBeNull();
  });

  it("restores typed values from the persisted representation", () => {
    expect(parseSettingValue("false", "boolean")).toBe(false);
    expect(parseSettingValue("0", "number")).toBe(0);
    expect(parseSettingValue("agenda", "string")).toBe("agenda");
    expect(parseSettingValue(null, "string")).toBeNull();
  });
});
