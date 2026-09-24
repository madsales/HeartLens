import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { analyze, LIMITS, MODEL } from "./lib/analyze.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 64 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("Body must be JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function handleAnalyze(req, res) {
  try {
    const body = await readJsonBody(req);
    const pick = (k) => (typeof body[k] === "string" ? body[k] : "");
    const result = await analyze({
      profile: pick("profile"),
      conversation: pick("conversation"),
      about: pick("about"),
    });
    sendJson(res, 200, { ok: true, result, model: process.env.HEARTLENS_MOCK ? "mock" : MODEL });
  } catch (err) {
    if (err.status) return sendJson(res, err.status, { ok: false, error: err.message });
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic auth failed. Is ANTHROPIC_API_KEY set?");
      return sendJson(res, 500, { ok: false, error: "Server is missing a valid API key." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return sendJson(res, 429, { ok: false, error: "Too many requests right now. Try again in a moment." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${err.status}:`, err.message);
      return sendJson(res, 502, { ok: false, error: "The analysis service had a problem. Try again shortly." });
    }
    console.error(err);
    sendJson(res, 500, { ok: false, error: "Unexpected server error." });
  }
}

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname === "/") pathname = "/index.html";
  // Allow extensionless links like /privacy and /terms.
  if (!path.extname(pathname)) pathname += ".html";

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/analyze")) {
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Use POST." });
    return handleAnalyze(req, res);
  }
  if (req.url === "/api/limits") return sendJson(res, 200, LIMITS);
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  serveStatic(req, res);
});

server.listen(PORT, () => {
  const mode = process.env.HEARTLENS_MOCK ? "MOCK mode (no API calls)" : `model ${MODEL}`;
  console.log(`HeartLens listening on http://localhost:${PORT}  [${mode}]`);
  if (!process.env.HEARTLENS_MOCK && !process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY is not set. Requests will fail unless another credential source is configured.");
  }
});
