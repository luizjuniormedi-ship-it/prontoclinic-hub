/**
 * DicomViewer — Wrapper do Cornerstone.js (DICOM viewer open source)
 *
 * Carrega imagens DICOM do Orthanc (VITE_ORTHANC_URL) via WADO-RS/WADO-URI
 * Suporte a:
 *   - Zoom, pan, window/level
 *   - Medições (distância, ângulo)
 *   - Anotações
 *   - Exporta snapshot para o laudo
 *
 * LGPD: bloquear download sem consentimento (cd_canal=4 PUSH deve estar ativo)
 *
 * Bibliotecas usadas via CDN (sem npm install):
 *   - cornerstone-core:    https://unpkg.com/cornerstone-core@2.6.1/dist/cornerstone.min.js
 *   - cornerstone-tools:  https://unpkg.com/cornerstone-tools@2.6.1/dist/cornerstone-tools.min.js
 *   - dicom-parser:       https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js
 *
 * Em ambiente offline, oferece um fallback com visualização JPEG.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { ZoomIn, ZoomOut, Move, Sun, Ruler, Type, Download, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { dicomWeb, type DicomExamImage, type DicomExam } from "@/services/dicomService";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";


interface CornerstoneLike {
  enable(el: HTMLElement): void;
  disable(el: HTMLElement): void;
  loadAndCacheImage(imageId: string): Promise<unknown>;
  loadImage(imageId: string): Promise<unknown>;
  displayImage(el: HTMLElement, image: unknown): void;
  getViewport(el: HTMLElement): { voi: { windowCenter: number; windowWidth: number }; scale: number };
  setViewport(el: HTMLElement, viewport: { voi: { windowCenter: number; windowWidth: number }; scale: number }): void;
  elements: { getEnabledElement(el: HTMLElement): { element: HTMLCanvasElement } };
}

interface CornerstoneToolsLike {
  init(): void;
  setToolActive(tool: string, opts?: { mouseButtonMask?: number }): void;
}

declare global {
  interface Window {
    cornerstone: CornerstoneLike | undefined;
    cornerstoneTools: CornerstoneToolsLike | undefined;
    dicomParser: unknown;
  }
}

const CDN_SCRIPTS = [
  { src: "https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js", check: "dicomParser" },
  { src: "https://unpkg.com/cornerstone-core@2.6.1/dist/cornerstone.min.js", check: "cornerstone" },
  { src: "https://unpkg.com/cornerstone-tools@2.6.1/dist/cornerstone-tools.min.js", check: "cornerstoneTools" },
];

async function loadCornerstone(): Promise<boolean> {
  if (window.cornerstone && window.cornerstoneTools) return true;
  return new Promise((resolve) => {
    let loaded = 0;
    const tryResolve = () => {
      loaded++;
      if (loaded === CDN_SCRIPTS.length) {
        setTimeout(() => resolve(!!(window.cornerstone && window.cornerstoneTools)), 100);
      }
    };
    CDN_SCRIPTS.forEach(({ src, check }) => {
      if ((window as any)[check]) {
        tryResolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = tryResolve;
      s.onerror = tryResolve;
      document.head.appendChild(s);
    });
    setTimeout(() => resolve(false), 8000);
  });
}

interface Props {
  exam: DicomExam;
  image: DicomExamImage;
  onSnapshot?: (dataUrl: string) => void;
  lgpdConsentPush?: boolean; // bloqueia download se false
}

export function DicomViewer({ exam, image, onSnapshot, lgpdConsentPush = false }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "fallback">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [windowWidth, setWindowWidth] = useState(400);
  const [windowCenter, setWindowCenter] = useState(40);
  const [zoom, setZoom] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [images, setImages] = useState<DicomExamImage[]>([]);
  const [activeTool, setActiveTool] = useState<"wwwc" | "zoom" | "pan" | "length" | "angle">("wwwc");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("dicom_exam_images")
        .select("*")
        .eq("cd_dicom_exam", exam.id)
        .order("nr_series")
        .order("nr_instance");
      if (!cancelled && data) setImages(data as DicomExamImage[]);
    })();
    return () => { cancelled = true; };
  }, [exam.id]);

  const displayImage = images[currentIndex] || image;

  // Carregar Cornerstone + imagem
  useEffect(() => {
    let mounted = true;
    let currentObjectUrl: string | undefined;
    const cs = window.cornerstone;
    const cst = window.cornerstoneTools;
    (async () => {
      try {
        setStatus("loading");
        const ok = await loadCornerstone();
        if (!ok || !window.cornerstone) {
          // Fallback: usar WADO-URI JPEG
          setStatus("fallback");
          return;
        }
        if (!mounted) return;
        const el = elementRef.current;
        if (!el) return;
        cs.enable(el);
        if (cst) cst.init();

        const resource = await buildImageResource(displayImage, exam);
        if (!resource) {
          setStatus("fallback");
          return;
        }
        currentObjectUrl = resource.objectUrl;
        const imageId = resource.imageId;
        await cs.loadAndCacheImage(imageId);
        if (!mounted) return;
        const img = await cs.loadImage(imageId);
        cs.displayImage(el, img);

        // Ativar tool padrao
        if (cst) {
          cst.setToolActive("WwwcTool", { mouseButtonMask: 1 });
        }
        setStatus("ready");
      } catch (e) {
        if (!mounted) return;
        setStatus("fallback");
        setErrorMsg(e instanceof Error ? e.message : "Falha ao carregar imagem");
      }
    })();
    return () => {
      mounted = false;
      try {
        if (elementRef.current && cs) cs.disable(elementRef.current);
      } catch { /* noop */ }
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [displayImage.id, exam.id]);

  // Ajustar window/level em tempo real
  useEffect(() => {
    if (status !== "ready" || !elementRef.current || !window.cornerstone) return;
    try {
      const viewport = window.cornerstone.getViewport(elementRef.current);
      viewport.voi.windowCenter = windowCenter;
      viewport.voi.windowWidth = windowWidth;
      viewport.scale = zoom;
      window.cornerstone.setViewport(elementRef.current, viewport);
    } catch { /* noop */ }
  }, [windowWidth, windowCenter, zoom, status]);

  // Mudar tool ativa
  useEffect(() => {
    if (status !== "ready" || !window.cornerstoneTools) return;
    const toolMap: Record<typeof activeTool, string> = {
      wwwc: "WwwcTool",
      zoom: "ZoomTool",
      pan: "PanTool",
      length: "LengthTool",
      angle: "AngleTool",
    };
    try {
      window.cornerstoneTools.setToolActive(toolMap[activeTool], { mouseButtonMask: 1 });
    } catch { /* noop */ }
  }, [activeTool, status]);

  const handleSnapshot = useCallback(() => {
    if (status !== "ready" || !elementRef.current || !window.cornerstone) {
      toast({ title: "Viewer não inicializado", variant: "destructive" });
      return;
    }
    try {
      const canvas = window.cornerstone.elements.getEnabledElement(elementRef.current).element;
      const dataUrl = canvas.toDataURL("image/png");
      onSnapshot?.(dataUrl);
      // download opcional (somente se LGPD ok)
      if (lgpdConsentPush) {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `${exam.cd_dicom_exame || exam.id}_${displayImage.nr_instance || 0}.png`;
        a.click();
      } else {
        toast({ title: "Download bloqueado", description: "LGPD: paciente sem consentimento PUSH.", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Falha ao gerar snapshot", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }, [status, exam, displayImage, lgpdConsentPush, onSnapshot]);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Visualizador DICOM</CardTitle>
            <CardDescription>
              {displayImage.ds_filename || displayImage.ds_sop_instance_uid || "Imagem"}
              {" — "}{displayImage.nr_instance || "?"}/{images.length || 1}
              {displayImage.dt_acquisition && ` — ${new Date(displayImage.dt_acquisition).toLocaleString()}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {!lgpdConsentPush && (
              <Badge variant="outline" className="text-amber-700">
                <AlertCircle className="h-3 w-3 mr-1" /> Download bloqueado (LGPD)
              </Badge>
            )}
            {status === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
            <Button size="sm" variant="outline" onClick={handleSnapshot}>
              <Download className="h-4 w-4 mr-1" />Snapshot
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {status === "error" && (
          <div className="p-4 text-red-600 bg-red-50 rounded">
            Erro: {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-12 gap-3">
          {/* Toolbar */}
          <div className="col-span-12 flex flex-wrap gap-1">
            <Button size="sm" variant={activeTool === "wwwc" ? "default" : "outline"}
              onClick={() => setActiveTool("wwwc")} title="Window/Level (W/L)">
              <Sun className="h-4 w-4" />
            </Button>
            <Button size="sm" variant={activeTool === "zoom" ? "default" : "outline"}
              onClick={() => setActiveTool("zoom")} title="Zoom">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button size="sm" variant={activeTool === "pan" ? "default" : "outline"}
              onClick={() => setActiveTool("pan")} title="Pan">
              <Move className="h-4 w-4" />
            </Button>
            <Button size="sm" variant={activeTool === "length" ? "default" : "outline"}
              onClick={() => setActiveTool("length")} title="Medição de distância">
              <Ruler className="h-4 w-4" />
            </Button>
            <Button size="sm" variant={activeTool === "angle" ? "default" : "outline"}
              onClick={() => setActiveTool("angle")} title="Ângulo">
              <Type className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setZoom((z) => z + 0.25)}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setZoom(1); setWindowCenter(40); setWindowWidth(400); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {images.length > 1 && (
              <div className="flex items-center gap-1 ml-2">
                <Button size="sm" variant="outline" onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}>
                  ←
                </Button>
                <span className="text-sm text-muted-foreground">
                  {currentIndex + 1} / {images.length}
                </span>
                <Button size="sm" variant="outline" onClick={() => setCurrentIndex((i) => Math.min(images.length - 1, i + 1))}>
                  →
                </Button>
              </div>
            )}
          </div>

          {/* Window/Level sliders */}
          <div className="col-span-12 grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Window Width: {windowWidth}</Label>
              <Slider
                value={[windowWidth]}
                onValueChange={(v) => setWindowWidth(v[0])}
                min={1} max={2000} step={1}
                disabled={status !== "ready"}
              />
            </div>
            <div>
              <Label className="text-xs">Window Center: {windowCenter}</Label>
              <Slider
                value={[windowCenter]}
                onValueChange={(v) => setWindowCenter(v[0])}
                min={-1000} max={1000} step={1}
                disabled={status !== "ready"}
              />
            </div>
          </div>

          {/* Viewer / Fallback */}
          <div className="col-span-12 relative bg-black rounded min-h-[500px] flex items-center justify-center">
            {status !== "fallback" ? (
              <div
                ref={elementRef}
                className="w-full h-[500px]"
                style={{ background: "#000" }}
              />
            ) : (
              <FallbackViewer image={displayImage} studyUID={exam.cd_dicom_exame} />
            )}
            {status === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando imagem DICOM…
              </div>
            )}
          </div>

          <div className="col-span-12 text-xs text-muted-foreground">
            W/L: arraste botão esquerdo • Zoom: scroll • Pan: botão direito
            {displayImage.bl_dicom_url && (
              <> • Arquivo: <a href={displayImage.bl_dicom_url} target="_blank" rel="noreferrer" className="underline">
                {displayImage.ds_filename || "S3"}
              </a></>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

async function buildImageResource(image: DicomExamImage, exam: DicomExam): Promise<{ imageId: string; objectUrl: string } | null> {
  if (image.ds_sop_instance_uid) {
    if (exam.cd_dicom_exame) {
      const objectUrl = await dicomWeb.getInstanceObjectUrl(
        exam.cd_dicom_exame,
        image.ds_sop_instance_uid,
        { nodeId: exam.source_node_id ?? undefined, unitId: exam.unit_id ?? undefined }
      );
      return { imageId: `wadouri:${objectUrl}`, objectUrl };
    }
  }
  if (exam.cd_dicom_exame && image.nr_instance !== undefined) {
    const objectUrl = await dicomWeb.getInstanceObjectUrl(
      exam.cd_dicom_exame,
      String(image.nr_instance),
      { nodeId: exam.source_node_id ?? undefined, unitId: exam.unit_id ?? undefined }
    );
    return { imageId: `wadouri:${objectUrl}`, objectUrl };
  }
  return null;
}

function FallbackViewer({ image, studyUID }: { image: DicomExamImage; studyUID?: string }) {
  // Fallback: renderizar JPEG via WADO-URI se a imagem for JPG/PNG
  if (image.bl_dicom_url) {
    return (
      <div className="text-center text-white p-4">
        <img
          src={image.bl_dicom_url}
          alt={image.ds_filename || "DICOM"}
          className="max-w-full max-h-[480px] mx-auto"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <p className="mt-2 text-xs text-gray-400">
          Modo fallback (Cornerstone indisponível). URL: {image.bl_dicom_url}
        </p>
        {studyUID && (
          <p className="text-xs text-gray-500">Study: {studyUID}</p>
        )}
      </div>
    );
  }
  return (
    <div className="text-center text-gray-400 p-8">
      <p>Sem URL de imagem DICOM para exibir.</p>
      {studyUID && <p className="text-xs mt-2">StudyInstanceUID: {studyUID}</p>}
    </div>
  );
}

export default DicomViewer;
