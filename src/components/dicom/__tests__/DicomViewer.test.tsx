import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DicomViewer } from "@/components/dicom/DicomViewer";
import {
  examService,
  type DicomExam,
  type DicomExamImage,
} from "@/services/dicomService";

vi.mock("@/services/dicomService", () => ({
  examService: {
    getImages: vi.fn(),
  },
}));

const exam: DicomExam = {
  id: 42,
  company_id: "company-qa",
  nr_images: 1,
  ds_status: "RECEIVED",
  created_at: "2026-09-02T12:00:00.000Z",
  updated_at: "2026-09-02T12:00:00.000Z",
};

function image(url: string): DicomExamImage {
  return {
    id: 7,
    cd_dicom_exam: exam.id,
    bl_dicom_url: url,
    created_at: "2026-09-02T12:00:00.000Z",
  };
}

describe("DicomViewer lifecycle", () => {
  const cornerstone = {
    enable: vi.fn(),
    disable: vi.fn(),
    loadAndCacheImage: vi.fn().mockResolvedValue({}),
    loadImage: vi.fn().mockResolvedValue({}),
    displayImage: vi.fn(),
    getViewport: vi.fn(() => ({
      voi: { windowCenter: 40, windowWidth: 400 },
      scale: 1,
    })),
    setViewport: vi.fn(),
    elements: {
      getEnabledElement: vi.fn(() => ({
        element: document.createElement("canvas"),
      })),
    },
  };

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class ResizeObserverMock {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    vi.mocked(examService.getImages).mockResolvedValue([]);
    window.cornerstone = cornerstone;
    window.cornerstoneTools = {
      init: vi.fn(),
      setToolActive: vi.fn(),
    };
  });

  it("reloads the image when only its signed URL changes", async () => {
    const firstUrl = "https://storage.test/signed/image.dcm?token=first";
    const secondUrl = "https://storage.test/signed/image.dcm?token=second";
    const view = render(<DicomViewer exam={exam} image={image(firstUrl)} />);

    await waitFor(() => {
      expect(cornerstone.loadAndCacheImage).toHaveBeenCalledWith(`wadouri:${firstUrl}`);
    });

    view.rerender(<DicomViewer exam={exam} image={image(secondUrl)} />);

    await waitFor(() => {
      expect(cornerstone.loadAndCacheImage).toHaveBeenCalledWith(`wadouri:${secondUrl}`);
    });
  });

  it("disables the same element captured and enabled by the effect", async () => {
    const view = render(
      <DicomViewer
        exam={exam}
        image={image("https://storage.test/signed/image.dcm?token=cleanup")}
      />,
    );

    await waitFor(() => expect(cornerstone.enable).toHaveBeenCalledOnce());
    const enabledElement = cornerstone.enable.mock.calls[0][0];

    view.unmount();

    expect(cornerstone.disable).toHaveBeenCalledWith(enabledElement);
  });
});
