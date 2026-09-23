"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Trash2, ArrowUp, ArrowDown, Loader2, X, CheckCircle2 } from "lucide-react";
import { Button, Modal } from "@/components/ui";

/**
 * Built-in document scanner: uses the device camera to photograph hard-copy
 * tender pages, assembles them into a PDF in the browser (jsPDF), uploads it
 * to the project, and starts processing. Works on phones, tablets and laptops.
 */

interface ScannedPage { dataUrl: string; width: number; height: number }
interface ProjectOption { _id: string; name: string }

/** Scanning is a mobile-only feature (hard copies are photographed on-site). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry/i.test(navigator.userAgent);
  const coarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
  return uaMobile || Boolean(coarsePointer);
}

export function ScanButton({ projectId, label = "Scan Tender" }: { projectId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  // Detect device on mount (client-only) — button is hidden on desktop.
  useEffect(() => { setMobile(isMobileDevice()); }, []);
  if (!mobile) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Camera size={14} /> {label}
      </Button>
      <ScanModal open={open} onClose={() => setOpen(false)} projectId={projectId} />
    </>
  );
}

export function ScanModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [targetProject, setTargetProject] = useState(projectId ?? "");
  const [busy, setBusy] = useState<"idle" | "building" | "uploading">("idle");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  // Camera lifecycle tied to modal open state — mobile devices only
  useEffect(() => {
    if (!open) { stopCamera(); return; }
    if (!isMobileDevice()) {
      setCameraError("Scanning is only available on mobile devices. On desktop, please use file upload.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (err) {
        setCameraError(
          "Camera unavailable. Grant camera permission (HTTPS required) or use file upload instead."
        );
      }
    })();
    if (!projectId) {
      fetch("/api/projects")
        .then((r) => r.json())
        .then((j) => { if (j.ok) setProjects(j.data as ProjectOption[]); })
        .catch(() => {});
    }
    return () => { cancelled = true; stopCamera(); };
  }, [open, projectId, stopCamera]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPages((p) => [...p, { dataUrl, width: canvas.width, height: canvas.height }]);
  }

  function removePage(i: number) { setPages((p) => p.filter((_, idx) => idx !== i)); }
  function movePage(i: number, dir: -1 | 1) {
    setPages((p) => {
      const to = i + dir;
      if (to < 0 || to >= p.length) return p;
      const next = [...p];
      [next[i], next[to]] = [next[to], next[i]];
      return next;
    });
  }

  async function buildPdfAndUpload() {
    if (pages.length === 0) { setError("Capture at least one page."); return; }
    const pid = projectId ?? targetProject;
    if (!pid) { setError("Choose a project for this scan."); return; }
    setError(null);

    setBusy("building");
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "pt", format: [pages[0].width, pages[0].height] });
    pages.forEach((page, i) => {
      if (i > 0) pdf.addPage([page.width, page.height]);
      pdf.addImage(page.dataUrl, "JPEG", 0, 0, page.width, page.height);
    });
    const blob = pdf.output("blob");

    setBusy("uploading");
    const form = new FormData();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    form.append("file", blob, `scan_${stamp}.pdf`);
    const up = await fetch(`/api/projects/${pid}/documents`, { method: "POST", body: form });
    const upJson = await up.json();
    if (!upJson.ok) { setError(upJson.error?.message ?? "Upload failed."); setBusy("idle"); return; }

    const proc = await fetch(`/api/projects/${pid}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: upJson.data.document._id }),
    });
    const procJson = await proc.json();
    setBusy("idle");
    if (!procJson.ok) {
      // Upload succeeded; processing didn't auto-start — not fatal
      setDone("Scanned document uploaded. Open the project to start processing.");
    } else {
      setDone(`Scan uploaded (${pages.length} page${pages.length === 1 ? "" : "s"}) — processing started.`);
    }
    setPages([]);
  }

  function close() {
    stopCamera();
    setPages([]);
    setDone(null);
    setError(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title="Scan tender document">
      {done ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 size={32} className="text-green-600" />
          <p className="text-sm">{done}</p>
          <Button onClick={close}>Done</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {cameraError ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{cameraError}</p>
          ) : (
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} playsInline muted className="max-h-[50vh] w-full object-contain" />
              <div className="pointer-events-none absolute inset-4 rounded border-2 border-dashed border-white/40" />
            </div>
          )}

          {!projectId && (
            <div className="space-y-1">
              <label className="text-xs font-medium">Save into project</label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={targetProject}
                onChange={(e) => setTargetProject(e.target.value)}
              >
                <option value="">— select a project —</option>
                {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {pages.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Captured pages ({pages.length})</p>
              <div className="flex flex-wrap gap-2">
                {pages.map((p, i) => (
                  <div key={i} className="group relative">
                    <img src={p.dataUrl} alt={`Page ${i + 1}`} className="h-20 rounded border border-border object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
                    <span className="absolute right-1 top-1 flex gap-0.5">
                      <button onClick={() => movePage(i, -1)} className="rounded bg-black/60 p-0.5 text-white" aria-label="Move earlier"><ArrowUp size={10} /></button>
                      <button onClick={() => movePage(i, 1)} className="rounded bg-black/60 p-0.5 text-white" aria-label="Move later"><ArrowDown size={10} /></button>
                      <button onClick={() => removePage(i)} className="rounded bg-destructive/80 p-0.5 text-white" aria-label="Remove page"><Trash2 size={10} /></button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" onClick={capture} disabled={!cameraReady || busy !== "idle"}>
              <Camera size={14} /> Capture page
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={close} disabled={busy !== "idle"}><X size={14} /> Cancel</Button>
              <Button onClick={buildPdfAndUpload} disabled={pages.length === 0 || busy !== "idle"}>
                {busy !== "idle" ? <Loader2 size={14} className="animate-spin" /> : null}
                {busy === "building" ? "Building PDF…" : busy === "uploading" ? "Uploading…" : `Create PDF & process (${pages.length})`}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Photograph pages in order, one at a time — the pages become one PDF and go straight into
            the extraction pipeline (OCR included). Good light and a flat page give the best OCR results.
          </p>
        </div>
      )}
    </Modal>
  );
}
