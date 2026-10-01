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

/**
 * Soft cap on pages per scan. Each captured page is a ~0.4–0.6 MB JPEG, so
 * ~30 pages stays comfortably under the server's 20 MB upload limit and keeps
 * the browser-side PDF build from straining a phone's memory.
 */
const MAX_PAGES = 30;

/** Scanning is a mobile-only feature (hard copies are photographed on-site). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry/i.test(navigator.userAgent);
  const coarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
  return uaMobile || Boolean(coarsePointer);
}

/**
 * Open the camera with a graceful constraint ladder: try the rear camera first,
 * then fall back to any available camera. A hard `facingMode: "environment"`
 * throws OverconstrainedError on devices with no rear camera (some tablets and
 * laptops), so we retry with it only as an "ideal" before dropping it entirely.
 */
async function openCameraStream(): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) throw new Error("unsupported");
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { facingMode: "environment" }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr: unknown = null;
  for (const constraints of attempts) {
    try {
      return await md.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      // Only keep retrying on constraint/device problems — a permission denial
      // or "in use elsewhere" won't be fixed by relaxing the constraints.
      const name = (err as DOMException)?.name;
      if (name === "NotAllowedError" || name === "NotFoundError" || name === "NotReadableError" || name === "AbortError") break;
    }
  }
  throw lastErr ?? new Error("unknown");
}

/** Turn a getUserMedia failure into an actionable message. */
function describeCameraError(err: unknown): string {
  const name = (err as DOMException)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was blocked. Tap the lock icon in your browser's address bar and allow the camera, then reopen the scanner — or add photos from your gallery below.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found on this device. You can add photos from your gallery below instead.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is busy in another app. Close the other app and reopen the scanner — or add photos from your gallery below.";
    case "OverconstrainedError":
      return "This device's camera doesn't meet the scanner's requirements. You can add photos from your gallery below instead.";
    default:
      return "The camera couldn't be opened (a secure HTTPS connection is required). You can add photos from your gallery below instead.";
  }
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
  const galleryRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [targetProject, setTargetProject] = useState(projectId ?? "");
  const [busy, setBusy] = useState<"idle" | "building" | "uploading">("idle");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped to force the camera to (re)start, e.g. after a permission retry. */
  const [retryNonce, setRetryNonce] = useState(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  /**
   * Attach the stream to the (already-mounted) <video> and mark the camera
   * ready only once frames are actually flowing. This runs in an effect that
   * depends on [cameraReady === false + open], so it executes AFTER React has
   * committed the <video> element — fixing the race where the camera started
   * before the element existed and the Capture button never enabled.
   */
  useEffect(() => {
    if (!open || cameraReady) return;
    const stream = streamRef.current;
    const video = videoRef.current;
    if (!stream || !video) return;
    video.srcObject = stream;
    const onReady = () => setCameraReady(true);
    video.addEventListener("playing", onReady);
    video.play().catch(() => {
      // Some browsers reject play() if the tab is hidden; "playing" may still fire.
    });
    return () => video.removeEventListener("playing", onReady);
  }, [open, cameraReady]);

  // Camera lifecycle tied to the modal open state (and the retry nonce).
  useEffect(() => {
    if (!open) { stopCamera(); return; }
    if (!isMobileDevice()) {
      setCameraError("Scanning is only available on mobile devices. On desktop, please use file upload.");
      return;
    }
    let cancelled = false;
    (async () => {
      setCameraError(null);
      try {
        const stream = await openCameraStream();
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        // Attachment happens in the effect above once the <video> is mounted.
      } catch (err) {
        setCameraError(describeCameraError(err));
      }
    })();
    if (!projectId) {
      fetch("/api/projects")
        .then((r) => r.json())
        .then((j) => { if (j.ok) setProjects(j.data as ProjectOption[]); })
        .catch(() => {});
    }
    return () => { cancelled = true; stopCamera(); };
  }, [open, projectId, stopCamera, retryNonce]);

  function capture() {
    setError(null);
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("The camera isn't ready yet — wait a moment for the preview to appear, then capture.");
      return;
    }
    if (pages.length >= MAX_PAGES) {
      setError(`Page limit reached (${MAX_PAGES}). Create the PDF now, then scan the rest as a second document.`);
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { setError("Couldn't prepare the image on this device. Try the gallery upload below."); return; }
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      if (!dataUrl || dataUrl.length < 1024) { setError("The capture came out empty — try again in better light."); return; }
      setPages((p) => [...p, { dataUrl, width: canvas.width, height: canvas.height }]);
    } catch {
      setError("Capture failed on this device. Try the gallery upload below.");
    }
  }

  /** Fallback when the camera can't be used: pick photos from the gallery. */
  function onGalleryPicked(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow picking the same file again
    if (files.length === 0) return;
    const room = MAX_PAGES - pages.length;
    if (files.length > room) setError(`Only ${room} more page${room === 1 ? "" : "s"} fit in this scan — extra photos were ignored.`);
    files.slice(0, room).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // Re-encode to JPEG so every page matches the PDF pipeline.
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          setPages((p) => (p.length >= MAX_PAGES ? p : [...p, { dataUrl: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height }]));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
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
    if (pages.length > MAX_PAGES) { setError(`Too many pages — split this into two scans of up to ${MAX_PAGES} pages each.`); return; }
    const pid = projectId ?? targetProject;
    if (!pid) { setError("Choose a project for this scan."); return; }
    setError(null);

    setBusy("building");
    let blob: Blob;
    try {
      const { jsPDF } = await import("jspdf");
      // Fixed A4 page in inches, orientation chosen per page so landscape photos
      // stay landscape. Passing camera PIXELS as the page size (in pt) previously
      // made jsPDF build a ~27"x15" page that pdftoppm rendered at ~9MP/page —
      // far too large for the vision OCR endpoint. A4 keeps OCR renders sane and
      // the aspect correct; the photo is letterboxed inside, never distorted.
      const A4: [number, number] = [8.27, 11.69]; // inches
      const firstLandscape = pages[0].width > pages[0].height;
      const pdf = new jsPDF({ unit: "in", format: "a4", orientation: firstLandscape ? "landscape" : "portrait", compress: true });
      let added = 0;
      pages.forEach((page, i) => {
        const landscape = page.width > page.height;
        const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
        if (added > 0) pdf.addPage("a4", landscape ? "landscape" : "portrait");
        // Letterbox: scale the photo to fit the page, preserving aspect ratio.
        const scale = Math.min(pw / page.width, ph / page.height);
        const w = page.width * scale;
        const h = page.height * scale;
        try {
          pdf.addImage(page.dataUrl, "JPEG", (pw - w) / 2, (ph - h) / 2, w, h);
          added++;
        } catch {
          // A single corrupt/oversized frame shouldn't sink the whole scan.
          console.warn(`scan: skipped page ${i + 1} (addImage failed)`);
        }
      });
      if (added === 0) { setError("None of the captured images could be added to the PDF. Please re-capture them."); setBusy("idle"); return; }
      blob = pdf.output("blob");
    } catch (err) {
      console.error("scan: PDF build failed", err);
      setError("Couldn't build the PDF on this device — the images may be too large. Try fewer pages per scan.");
      setBusy("idle");
      return;
    }

    setBusy("uploading");
    let upJson: { ok: boolean; data?: { document: { _id: string } }; error?: { message?: string } };
    try {
      const form = new FormData();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      form.append("file", blob, `scan_${stamp}.pdf`);
      const up = await fetch(`/api/projects/${pid}/documents`, { method: "POST", body: form });
      upJson = await up.json();
    } catch {
      setError("Upload failed — check your connection and try again.");
      setBusy("idle");
      return;
    }
    if (!upJson.ok) { setError(upJson.error?.message ?? "Upload failed."); setBusy("idle"); return; }

    let procJson: { ok: boolean } = { ok: false };
    try {
      const proc = await fetch(`/api/projects/${pid}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: upJson.data!.document._id }),
      });
      procJson = await proc.json();
    } catch {
      procJson = { ok: false };
    }
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
        <div className="flex max-h-[85dvh] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {cameraError ? (
            <div className="space-y-3">
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{cameraError}</p>
              <Button variant="outline" size="sm" onClick={() => setRetryNonce((n) => n + 1)}>
                <Camera size={14} /> Retry camera
              </Button>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} playsInline muted autoPlay className="max-h-[50vh] w-full object-contain" />
              <div className="pointer-events-none absolute inset-4 rounded border-2 border-dashed border-white/40" />
              {!cameraReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
                  <Loader2 size={22} className="animate-spin" />
                  <p className="text-xs">Starting camera…</p>
                </div>
              )}
            </div>
          )}

          {/* Hidden gallery picker — the fallback when the camera can't be used. */}
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onGalleryPicked}
          />

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
              <p className="mb-2 text-xs font-medium text-muted-foreground">Captured pages ({pages.length}/{MAX_PAGES})</p>
              <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
                {pages.map((p, i) => (
                  <div key={i} className="group relative shrink-0">
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
        </div>

          {/* Pinned action bar — stays visible no matter how many pages are captured */}
          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card pt-4">
            <div className="flex gap-2">
              <Button variant="outline" onClick={capture} disabled={!cameraReady || busy !== "idle" || pages.length >= MAX_PAGES}>
                <Camera size={14} /> Capture page
              </Button>
              <Button variant="outline" onClick={() => galleryRef.current?.click()} disabled={busy !== "idle" || pages.length >= MAX_PAGES}>
                Add from gallery
              </Button>
            </div>
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
