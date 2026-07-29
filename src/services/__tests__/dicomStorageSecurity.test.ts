import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("DICOM storage security contract", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/services/dicomService.ts"),
    "utf8",
  );
  const viewerSource = readFileSync(
    resolve(process.cwd(), "src/components/dicom/DicomViewer.tsx"),
    "utf8",
  );
  const bridgeSource = readFileSync(
    resolve(process.cwd(), "supabase/functions/dicom-bridge/index.ts"),
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

  it("never exposes Orthanc credentials or sensitive calls in the browser", () => {
    for (const browserSource of [source, viewerSource]) {
      expect(browserSource).not.toContain("VITE_ORTHANC_");
      expect(browserSource).not.toContain('Authorization: "Basic ');
      expect(browserSource).not.toMatch(/fetch\([^)]*ORTHANC/i);
      expect(browserSource).not.toContain("/modalities/${");
      expect(browserSource).not.toContain("/peers/${");
    }
    expect(source).toContain('supabase.functions.invoke("dicom-bridge"');
  });

  it("keeps Orthanc secrets mandatory and server-side", () => {
    expect(bridgeSource).toContain('Deno.env.get("ORTHANC_URL")');
    expect(bridgeSource).toContain('Deno.env.get("ORTHANC_USER")');
    expect(bridgeSource).toContain('Deno.env.get("ORTHANC_PASSWORD")');
    expect(bridgeSource).not.toMatch(/\?\?\s*"orthanc"/);
    expect(bridgeSource).toContain("Bridge DICOM não configurada");
    expect(bridgeSource).toContain("userClient.auth.getUser");
    expect(bridgeSource).toContain('.from("dicom_equipment")');
    expect(bridgeSource).toContain("C-STORE indisponível até homologação do contrato PACS");
    expect(bridgeSource).not.toContain('/peers/${encodeURIComponent');
  });

  it("loads the viewer only through signed private URLs", () => {
    expect(viewerSource).toContain("examService.getImages(exam.id)");
    expect(viewerSource).toContain("`wadouri:${image.bl_dicom_url}`");
    expect(viewerSource).not.toContain("/dicom-web/");
    expect(viewerSource).not.toContain("/instances/");
  });
});
