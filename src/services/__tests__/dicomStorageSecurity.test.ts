import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("DICOM storage security contract", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/services/dicomService.ts"),
    "utf8",
  );

  it("does not expose uploaded studies through public bucket URLs", () => {
    expect(source).not.toContain(".getPublicUrl(");
    expect(source).toContain(".createSignedUrl(");
  });

  it("persists private object paths and signs them only when read", () => {
    expect(source).toContain("bl_dicom_url: path");
    expect(source).toContain("resolvePrivateDicomUrl(image.bl_dicom_url)");
  });
});
