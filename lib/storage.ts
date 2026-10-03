import fs from "fs/promises";
import path from "path";
import { getEnv } from "@/lib/env";

/**
 * Durable file storage.
 *
 * Files must survive container redeploys (Railway's filesystem is ephemeral),
 * so when object storage is configured (Cloudflare R2 / S3) all reads and
 * writes go to the bucket. Without credentials we fall back to local disk —
 * fine for local dev, ephemeral in production, which is why R2 must be
 * configured in the deployed environment.
 *
 * The client is dependency-free: it uses S3 SigV4 presigned URLs, so uploads
 * and downloads are plain HTTPS PUT/GET against the R2 endpoint. No AWS SDK.
 */

export interface StoredFileRef {
  /** Opaque pointer stored on the DB document (replaces the old disk path). */
  storagePath: string;
}

const isR2Configured = Boolean(getEnv().S3_BUCKET && getEnv().S3_ACCESS_KEY_ID && getEnv().S3_SECRET_ACCESS_KEY);

/** True when durable object storage is active (vs ephemeral local disk). */
export function isDurableStorage(): boolean {
  return isR2Configured;
}

/**
 * Build the storage pointer for a key WITHOUT writing — for keys derived at
 * read time (e.g. TTS audio parts) rather than returned by putFile.
 */
export function storageRefFor(key: string): string {
  return isR2Configured ? r2Path(key) : path.join("data", "objects", key);
}

/* ---------------- public API ---------------- */

/** Persist a file and return the pointer to store on the DB document. */
export async function putFile(key: string, data: Buffer, contentType: string): Promise<StoredFileRef> {
  if (isR2Configured) {
    await r2Request("PUT", key, data, contentType);
    return { storagePath: r2Path(key) };
  }
  const diskPath = path.join("data", "objects", key);
  await fs.mkdir(path.dirname(diskPath), { recursive: true });
  await fs.writeFile(diskPath, data);
  return { storagePath: diskPath };
}

/** Read a file back by its stored pointer. */
export async function getFile(storagePath: string): Promise<Buffer> {
  if (storagePath.startsWith("r2://")) {
    const res = await r2Request("GET", r2Key(storagePath));
    return Buffer.from(res);
  }
  // Legacy + local-dev path: read straight from disk.
  return fs.readFile(storagePath);
}

/** Delete a file by its stored pointer (best-effort). */
export async function deleteFile(storagePath: string): Promise<void> {
  try {
    if (storagePath.startsWith("r2://")) {
      await r2Request("DELETE", r2Key(storagePath));
      return;
    }
    await fs.rm(storagePath, { force: true });
  } catch {
    /* deletion is best-effort */
  }
}

/* ---------------- key helpers ---------------- */

function r2Path(key: string): string {
  return `r2://${getEnv().S3_BUCKET}/${key}`;
}

function r2Key(storagePath: string): string {
  // strip "r2://<bucket>/"
  return storagePath.replace(/^r2:\/\/[^/]+\//, "");
}

/* ---------------- SigV4 presigned-url S3/R2 client ---------------- */

const encoder = new TextEncoder();

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === "string" ? encoder.encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data)));
}

function toAmzDate(d: Date): { amzDate: string; dateStamp: string } {
  const iso = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Perform an S3 operation via a presigned URL. For PUT, `body` is uploaded and
 * the resolved value is empty; for GET the resolved value is the object bytes;
 * for DELETE the resolved value is empty. Throws on non-2xx.
 */
async function r2Request(method: "GET" | "PUT" | "DELETE", key: string, body?: Buffer, contentType?: string): Promise<Uint8Array> {
  const bucket = getEnv().S3_BUCKET!;
  const region = getEnv().S3_REGION || "auto";
  const service = "s3";
  const endpoint = getEnv().S3_ENDPOINT;
  const host = endpoint ? new URL(endpoint).host : `${bucket}.s3.${region}.amazonaws.com`;
  // Path-style URL works for R2 and S3: https://<endpoint>/<bucket>/<key>
  const canonicalUri = `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

  const { amzDate, dateStamp } = toAmzDate(new Date());
  const payloadHash = "UNSIGNED-PAYLOAD";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${getEnv().S3_ACCESS_KEY_ID}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": "900",
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");

  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${host}\n`, "host", payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  // Derive the signing key.
  let keyBytes: Uint8Array = encoder.encode(`AWS4${getEnv().S3_SECRET_ACCESS_KEY}`);
  keyBytes = await hmac(keyBytes, dateStamp);
  keyBytes = await hmac(keyBytes, region);
  keyBytes = await hmac(keyBytes, service);
  keyBytes = await hmac(keyBytes, "aws4_request");
  const signature = [...(await hmac(keyBytes, stringToSign))].map((b) => b.toString(16).padStart(2, "0")).join("");

  const base = endpoint ?? `https://${host}`;
  const url = `${base}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;

  const res = await fetch(url, {
    method,
    body: method === "PUT" ? new Uint8Array(body ?? Buffer.alloc(0)) : undefined,
    headers: method === "PUT" && contentType ? { "Content-Type": contentType } : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`R2 ${method} ${key} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/** Resolve a content-type from a filename extension (for stored objects). */
export function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".pdf": return "application/pdf";
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".txt": return "text/plain";
    case ".mp3": return "audio/mpeg";
    case ".csv": return "text/csv";
    default: return "application/octet-stream";
  }
}
