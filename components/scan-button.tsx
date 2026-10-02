"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Trash2, RotateCcw, Loader2, X, CheckCircle2, Plus, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Fullscreen document scanner: photograph hard-copy tender pages with the
 * device camera, review the captures, then assemble them into a PDF in the
 * browser (jsPDF), upload to the project, and start processing.
 *
 * Flow: capture (fullscreen, one shutter, numbered filmstrip) → review hub
 * (see all pages, retake/delete, add more) → process. Captured pages persist
 * to IndexedDB between states so an interrupted scan (phone call, tab killed)
 * can be resumed. Capped at MAX_PAGES; longer documents should go through the
 * normal file-upload path.
 */

interface ScannedPage { key: string; blob: Blob; width: number; height: number; url: string }

/** Hard cap on pages per scan. Beyond this, a physical/office scanner to PDF is the right tool. */
const MAX_PAGES = 50;
/** Abandoned scan sessions are cleared after this long (tender docs shouldn't linger on-device). */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const IDB_DB = "persis-scan";
const IDB_STORE = "sessions";
const SESSION_PREFIX = "scan:";

/* ---------------- device detection ---------------- */

/** Scanning is a mobile-only feature (hard copies are photographed on-site). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry/i.test(navigator.userAgent);
  const coarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
  return uaMobile || Boolean(coarsePointer);
}

/* ---------------- camera helpers ---------------- */

/**
 * Open the camera with a graceful constraint ladder: try the rear camera first,
 * then fall back to any available camera. A hard `facingMode: "environment"`
 * throws OverconstrainedError on devices with no rear camera, so we retry with
 * it as an "ideal" before dropping it entirely.
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
      const name = (err as DOMException)?.name;
      // Permission denial / device busy / no device won't be fixed by relaxing constraints.
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
      return "Camera permission was blocked. Tap the lock icon in your browser's address bar and allow the camera, then retry — or add photos from your gallery instead.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found on this device. You can add photos from your gallery instead.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is busy in another app. Close the other app and retry — or add photos from your gallery instead.";
    case "OverconstrainedError":
      return "This device's camera doesn't meet the scanner's requirements. You can add photos from your gallery instead.";
    default:
      return "The camera couldn't be opened (a secure HTTPS connection is required). You can add photos from your gallery instead.";
  }
}

/* ---------------- IndexedDB persistence ---------------- */

interface StoredPage { key: string; width: number; height: number; blob: Blob }
interface ScanSession { savedAt: number; pages: StoredPage[] }

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist the current pages for a session key (write-through on every change). */
async function saveScanSession(key: string, pages: ScannedPage[]): Promise<void> {
  const db = await idbOpen();
  try {
    const stored: StoredPage[] = pages.map((p) => ({ key: p.key, width: p.width, height: p.height, blob: p.blob }));
    const session: ScanSession = { savedAt: Date.now(), pages: stored };
    await idbReq(db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(session, SESSION_PREFIX + key));
  } finally {
    db.close();
  }
}

/** Load a stored session, or null if none / expired. Expired sessions are cleaned up. */
async function loadScanSession(key: string): Promise<ScanSession | null> {
  try {
    const db = await idbOpen();
    try {
      const store = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
      const session = (await idbReq(store.get(SESSION_PREFIX + key))) as ScanSession | undefined;
      if (!session) return null;
      if (Date.now() - session.savedAt > SESSION_TTL_MS) {
        await idbReq(store.delete(SESSION_PREFIX + key));
        return null;
      }
      return session;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function clearScanSession(key: string): Promise<void> {
  try {
    const db = await idbOpen();
    try {
      await idbReq(db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).delete(SESSION_PREFIX + key));
    } finally {
      db.close();
    }
  } catch {
    /* non-fatal */
  }
}

/* ---------------- public button ---------------- */

export function ScanButton({ projectId, label = "Scan Tender" }: { projectId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
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

/* ---------------- the scanner modal ---------------- */

type Mode = "capture" | "review" | "confirmExit";

export function ScanModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef(0);

  const [mode, setMode] = useState<Mode>("capture");
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [resumeCandidate, setResumeCandidate] = useState<ScanSession | null>(null);
  const [busy, setBusy] = useState<"idle" | "building" | "uploading">("idle");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped to force the camera to (re)start, e.g. after a permission retry. */
  const [retryNonce, setRetryNonce] = useState(0);

  const sessionKey = projectId ?? "pending";

  /* ----- helpers ----- */
  const releasePages = useCallback((list: ScannedPage[]) => {
    list.forEach((p) => URL.revokeObjectURL(p.url));
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const persist = useCallback(
    (list: ScannedPage[]) => {
      saveScanSession(sessionKey, list).catch(() => {});
    },
    [sessionKey]
  );

  function addPage(blob: Blob, width: number, height: number) {
    setPages((prev) => {
      if (prev.length >= MAX_PAGES) return prev;
      const page: ScannedPage = {
        key: `${Date.now()}_${counterRef.current++}`,
        blob,
        width,
        height,
        url: URL.createObjectURL(blob),
      };
      const next = [...prev, page];
      persist(next);
      return next;
    });
    // Scroll the filmstrip to the newest page.
    requestAnimationFrame(() => {
      const el = filmstripRef.current;
      if (el) el.scrollLeft = el.scrollWidth;
    });
  }

  function removePage(key: string) {
    setPages((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target) URL.revokeObjectURL(target.url);
      const next = prev.filter((p) => p.key !== key);
      persist(next);
      return next;
    });
  }

  function discardAll() {
    releasePages(pages);
    setPages([]);
    clearScanSession(sessionKey);
  }

  /* ----- load any saved session when the modal opens ----- */
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDone(null);
    (async () => {
      const saved = await loadScanSession(sessionKey);
      if (saved && saved.pages.length > 0) {
        setResumeCandidate(saved);
        setMode("review"); // land on review so they can decide to resume or start fresh
      }
    })();
  }, [open, sessionKey]);

  function resumeSaved() {
    if (!resumeCandidate) return;
    const restored: ScannedPage[] = resumeCandidate.pages.map((p) => ({
      key: p.key,
      blob: p.blob,
      width: p.width,
      height: p.height,
      url: URL.createObjectURL(p.blob),
    }));
    setPages(restored);
    setResumeCandidate(null);
    setMode("review");
  }

  function startFresh() {
    releasePages(pages);
    setPages([]);
    clearScanSession(sessionKey);
    setResumeCandidate(null);
    setMode("capture");
  }

  /* ----- camera lifecycle (capture mode only) ----- */
  useEffect(() => {
    if (!open || mode !== "capture") { stopCamera(); return; }
    if (!isMobileDevice()) {
      setCameraError("Scanning is only available on mobile devices. On desktop, please use file upload.");
      return;
    }
    let cancelled = false;
    let localStream: MediaStream | null = null;

    const video = videoRef.current;
    // Ready when frames are actually flowing: listen to several events AND poll
    // dimensions, because not every browser fires "playing" reliably.
    const markReady = () => { if (!cancelled) setCameraReady(true); };
    const checkDimensions = () => { if (!cancelled && videoRef.current && videoRef.current.videoWidth > 0) markReady(); };
    video?.addEventListener("playing", markReady);
    video?.addEventListener("loadeddata", markReady);
    video?.addEventListener("canplay", markReady);
    const poll = window.setInterval(checkDimensions, 400);

    (async () => {
      setCameraError(null);
      setCameraReady(false);
      try {
        const stream = await openCameraStream();
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStream = stream;
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.play().catch(() => { /* events/poll still catch readiness */ });
        }
      } catch (err) {
        if (!cancelled) setCameraError(describeCameraError(err));
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      video?.removeEventListener("playing", markReady);
      video?.removeEventListener("loadeddata", markReady);
      video?.removeEventListener("canplay", markReady);
      if (video) video.srcObject = null;
      localStream?.getTracks().forEach((t) => t.stop());
      stopCamera();
    };
  }, [open, mode, stopCamera, retryNonce]);

  /* ----- capture ----- */
  function capture() {
    setError(null);
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("The camera isn't ready yet — wait for the preview, then capture.");
      return;
    }
    if (pages.length >= MAX_PAGES) return; // shutter is disabled at the cap
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { setError("Couldn't prepare the image on this device. Try adding from your gallery."); return; }
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            addPage(blob, canvas.width, canvas.height);
            // Shutter feedback.
            setFlash(true);
            setTimeout(() => setFlash(false), 180);
            navigator.vibrate?.(15);
          } else {
            setError("The capture came out empty — try again in better light.");
          }
        },
        "image/jpeg",
        0.85
      );
    } catch {
      setError("Capture failed on this device. Try adding from your gallery.");
    }
  }

  /* ----- gallery fallback ----- */
  function onGalleryPicked(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const room = MAX_PAGES - pages.length;
    if (files.length > room) setError(`Only ${room} more page${room === 1 ? "" : "s"} fit in this scan — extra photos were ignored.`);
    files.slice(0, room).forEach((file) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        URL.revokeObjectURL(objectUrl);
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => { if (blob) addPage(blob, canvas.width, canvas.height); }, "image/jpeg", 0.85);
      };
      img.src = objectUrl;
    });
  }

  /* ----- build PDF + upload ----- */
  async function processScan() {
    if (pages.length === 0) { setError("Capture at least one page."); return; }
    const pid = projectId;
    if (!pid) { setError("Open a project first — scanning is tied to a specific tender."); return; }
    setError(null);

    setBusy("building");
    let blob: Blob;
    try {
      const { jsPDF } = await import("jspdf");
      // Fixed A4 in inches, orientation per page; the photo is letterboxed inside.
      const A4: [number, number] = [8.27, 11.69];
      const firstLandscape = pages[0].width > pages[0].height;
      const pdf = new jsPDF({ unit: "in", format: "a4", orientation: firstLandscape ? "landscape" : "portrait", compress: true });
      let added = 0;
      for (const page of pages) {
        const landscape = page.width > page.height;
        const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
        if (added > 0) pdf.addPage("a4", landscape ? "landscape" : "portrait");
        const scale = Math.min(pw / page.width, ph / page.height);
        const w = page.width * scale;
        const h = page.height * scale;
        try {
          const dataUrl = await blobToDataUrl(page.blob);
          pdf.addImage(dataUrl, "JPEG", (pw - w) / 2, (ph - h) / 2, w, h);
          added++;
        } catch {
          // A single corrupt frame shouldn't sink the whole scan.
        }
      }
      if (added === 0) { setError("None of the captured images could be added to the PDF. Please re-capture them."); setBusy("idle"); return; }
      blob = pdf.output("blob");
    } catch (err) {
      console.error("scan: PDF build failed", err);
      setError("Couldn't build the PDF on this device — the images may be too large. Try fewer pages.");
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

    let procOk = false;
    try {
      const proc = await fetch(`/api/projects/${pid}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: upJson.data!.document._id }),
      });
      procOk = (await proc.json()).ok;
    } catch {
      procOk = false;
    }
    setBusy("idle");
    clearScanSession(sessionKey);
    const count = pages.length;
    releasePages(pages);
    setPages([]);
    setDone(
      procOk
        ? `Scan uploaded (${count} page${count === 1 ? "" : "s"}) — processing started.`
        : "Scanned document uploaded. Open the project to start processing."
    );
  }

  /* ----- close / exit ----- */
  function requestExit() {
    stopCamera();
    if (pages.length > 0) setMode("confirmExit");
    else closeAll();
  }

  /** Exit the camera into the review hub (pages kept). */
  function exitToReview() {
    stopCamera();
    setMode("review");
  }

  /** Fully close the scanner. Pages persist (IndexedDB) unless explicitly discarded. */
  function closeAll() {
    stopCamera();
    onClose();
    // Reset transient UI but keep pages persisted for resume.
    setMode("capture");
    setDone(null);
    setError(null);
  }

  const atCap = pages.length >= MAX_PAGES;

  /* ================= render ================= */
  if (!open) return null;

  // Success screen
  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <CheckCircle2 size={40} className="text-green-600" />
          <p className="text-sm">{done}</p>
          <Button onClick={closeAll}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* hidden gallery picker */}
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={onGalleryPicked} />

      {/* ---- CAPTURE MODE ---- */}
      {mode === "capture" && (
        <>
          {/* top bar */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4">
            <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white">
              {pages.length} / {MAX_PAGES}
            </span>
            <button
              onClick={requestExit}
              aria-label="Close camera"
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white"
            >
              <X size={20} />
            </button>
          </div>

          {/* live preview */}
          <div className="relative flex-1 overflow-hidden">
            {cameraError ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                <p role="alert" className="max-w-sm rounded-md bg-destructive/20 px-4 py-3 text-sm text-white">{cameraError}</p>
                <div className="flex gap-3">
                  <Button variant="outline" size="sm" onClick={() => setRetryNonce((n) => n + 1)}>
                    <Camera size={14} /> Retry camera
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => galleryRef.current?.click()}>
                    <ImagePlus size={14} /> Add from gallery
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
                <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-white/40" />
                {!cameraReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
                    <Loader2 size={24} className="animate-spin" />
                    <p className="text-xs">Starting camera…</p>
                  </div>
                )}
                {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}
              </>
            )}
          </div>

          {/* filmstrip of captured pages */}
          {pages.length > 0 && (
            <div className="absolute inset-x-0 bottom-28 z-20">
              <div ref={filmstripRef} className="flex gap-2 overflow-x-auto px-4 pb-1">
                {pages.map((p, i) => (
                  <div key={p.key} className="relative h-16 w-12 shrink-0 overflow-hidden rounded border border-white/50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Page ${i + 1}`} className="h-full w-full object-cover" />
                    <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[10px] font-semibold text-white">
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* bottom bar: shutter */}
          <div className="relative z-20 flex items-center justify-center gap-6 pb-8 pt-4">
            <button
              onClick={() => galleryRef.current?.click()}
              aria-label="Add from gallery"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ImagePlus size={18} />
            </button>
            <button
              onClick={capture}
              disabled={!cameraReady || atCap}
              aria-label="Capture page"
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/20 disabled:opacity-40"
            >
              <span className="h-12 w-12 rounded-full bg-white" />
            </button>
            <button
              onClick={exitToReview}
              aria-label="Review pages"
              className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <CheckCircle2 size={18} />
              {pages.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {pages.length}
                </span>
              )}
            </button>
          </div>

          {error && <p role="alert" className="absolute inset-x-4 bottom-24 z-30 rounded-md bg-destructive/80 px-3 py-2 text-center text-xs text-white">{error}</p>}
        </>
      )}

      {/* ---- REVIEW MODE (hub) ---- */}
      {mode === "review" && (
        <div className="flex h-full flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <h2 className="text-base font-semibold">Review scan</h2>
              <p className="text-xs text-muted-foreground">{pages.length} page{pages.length === 1 ? "" : "s"} captured</p>
            </div>
            <button onClick={closeAll} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
              <X size={18} />
            </button>
          </div>

          {/* resume prompt */}
          {resumeCandidate && pages.length === 0 && (
            <div className="m-4 flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
              <p className="text-sm">You have an unfinished scan with <strong>{resumeCandidate.pages.length}</strong> page{resumeCandidate.pages.length === 1 ? "" : "s"} from earlier.</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={resumeSaved}><RotateCcw size={14} /> Resume scan</Button>
                <Button size="sm" variant="outline" onClick={startFresh}><Trash2 size={14} /> Start fresh</Button>
              </div>
            </div>
          )}

          {atCap && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              That&apos;s {MAX_PAGES} pages — the camera limit. For longer documents, scan to a PDF with a physical or office scanner and upload it here instead; it&apos;ll be faster and sharper.
            </div>
          )}

          {pages.length === 0 && !resumeCandidate ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <Camera size={36} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No pages captured yet.</p>
              <Button onClick={() => setMode("capture")}><Camera size={14} /> Open camera</Button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {pages.map((p, i) => (
                  <div key={p.key} className="group relative overflow-hidden rounded-lg border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white">{i + 1}</span>
                    <button
                      onClick={() => removePage(p.key)}
                      aria-label={`Delete page ${i + 1}`}
                      className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-destructive/90 text-white"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p role="alert" className="mx-4 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">{error}</p>}

          {/* review action bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMode("capture")} disabled={busy !== "idle" || atCap}>
                <Plus size={14} /> Add more
              </Button>
              <Button variant="outline" onClick={() => galleryRef.current?.click()} disabled={busy !== "idle" || atCap}>
                <ImagePlus size={14} /> From gallery
              </Button>
            </div>
            <Button onClick={processScan} disabled={pages.length === 0 || busy !== "idle"}>
              {busy !== "idle" ? <Loader2 size={14} className="animate-spin" /> : null}
              {busy === "building" ? "Building PDF…" : busy === "uploading" ? "Uploading…" : `Process ${pages.length} page${pages.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}

      {/* ---- CONFIRM EXIT ---- */}
      {mode === "confirmExit" && (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-black/80 p-6 text-center text-white">
          <p className="max-w-sm text-sm">
            You&apos;ve captured <strong>{pages.length}</strong> page{pages.length === 1 ? "" : "s"}. They&apos;re saved on this device — close to review them, or keep capturing.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={exitToReview}><CheckCircle2 size={14} /> Review {pages.length} page{pages.length === 1 ? "" : "s"}</Button>
            <Button variant="outline" onClick={() => setMode("capture")}><Camera size={14} /> Keep capturing</Button>
            <Button variant="outline" onClick={() => { discardAll(); closeAll(); }}><Trash2 size={14} /> Discard &amp; close</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- small utils ---------------- */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
