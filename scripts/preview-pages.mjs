import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../packages/web/dist");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const basePath = "/sfcapp";

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"]
]);

function getContentType(filePath) {
  return mimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function toSafeFilePath(relativePath) {
  const candidatePath = path.resolve(distDir, relativePath);
  const relativeToDist = path.relative(distDir, candidatePath);
  if (relativeToDist.startsWith("..") || path.isAbsolute(relativeToDist)) {
    return null;
  }

  return candidatePath;
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function serveFile(response, filePath, method) {
  response.statusCode = 200;
  response.setHeader("Content-Type", getContentType(filePath));

  if (method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.statusCode = 405;
    response.end("Method Not Allowed");
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `localhost:${port}`}`);
  const pathname = url.pathname;

  if (pathname === "/") {
    response.statusCode = 302;
    response.setHeader("Location", `${basePath}/`);
    response.end();
    return;
  }

  if (pathname === basePath) {
    response.statusCode = 302;
    response.setHeader("Location", `${basePath}/`);
    response.end();
    return;
  }

  if (!pathname.startsWith(`${basePath}/`)) {
    response.statusCode = 404;
    response.end("Not Found");
    return;
  }

  const relativePath = decodeURIComponent(pathname.slice(basePath.length + 1));
  const requestedFilePath = toSafeFilePath(relativePath || "index.html");

  if (requestedFilePath && (await fileExists(requestedFilePath))) {
    await serveFile(response, requestedFilePath, method);
    return;
  }

  const spaFallbackPath = path.join(distDir, "index.html");
  const fallbackHtml = await readFile(spaFallbackPath);
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (method === "HEAD") {
    response.end();
    return;
  }

  response.end(fallbackHtml);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Pages preview running at http://localhost:${port}${basePath}/`);
});