import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = resolve(process.cwd());
const defaultPort = Number(process.env.PORT || 4177);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

export function loadDotEnv(path = ".env", env = process.env) {
  if (!existsSync(path)) return env;
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in env)) env[key] = value;
  }
  return env;
}

export function getClientConfig(env = process.env) {
  const missing = [];
  if (!env.AMAP_JS_API_KEY) missing.push("AMAP_JS_API_KEY");
  if (!env.AMAP_SECURITY_JS_CODE) missing.push("AMAP_SECURITY_JS_CODE");

  if (missing.length) {
    return {
      ok: false,
      error: "missing_amap_js_credentials",
      missing,
    };
  }

  return {
    ok: true,
    amap: {
      key: env.AMAP_JS_API_KEY,
      securityJsCode: env.AMAP_SECURITY_JS_CODE,
    },
  };
}

export function isAuthorized(headers = {}, env = process.env) {
  const user = env.MAP_BASIC_USER;
  const password = env.MAP_BASIC_PASSWORD;
  if (!user && !password) return true;
  if (!user || !password) return false;

  const header = headers.authorization || headers.Authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const raw = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separator = raw.indexOf(":");
  if (separator === -1) return false;
  return raw.slice(0, separator) === user && raw.slice(separator + 1) === password;
}

function routebooksPath(root, env = process.env) {
  if (env.ROUTEBOOKS_PATH) return resolve(root, env.ROUTEBOOKS_PATH);
  return resolve(root, "tmp", "routebooks.local.json");
}

async function readRoutebooks(root, env = process.env) {
  const path = routebooksPath(root, env);
  try {
    const text = await readFile(path, "utf8");
    const data = JSON.parse(text.replace(/^\uFEFF/, ""));
    return Array.isArray(data?.routebooks) ? data : { routebooks: [] };
  } catch (error) {
    if (error.code === "ENOENT") return { routebooks: [] };
    throw error;
  }
}

async function writeRoutebooks(root, env = process.env, data) {
  if (!Array.isArray(data?.routebooks)) {
    const error = new Error("routebooks must be an array");
    error.statusCode = 400;
    throw error;
  }

  const path = routebooksPath(root, env);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify({ routebooks: data.routebooks }, null, 2);
  await writeFile(tempPath, `${payload}\n`, "utf8");
  await rename(tempPath, path);
  return { routebooks: data.routebooks };
}

function readRequestJson(req) {
  return new Promise((resolveJson, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        const error = new Error("request body too large");
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolveJson(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("invalid JSON body");
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function resolvePath(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const candidate = normalize(join(root, decoded === "/" ? "map/index.html" : decoded));
  if (!candidate.startsWith(root)) return null;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    return join(candidate, "index.html");
  }
  return candidate;
}

export function createMapServer({ root = defaultRoot, env = process.env } = {}) {
  return createServer((req, res) => {
    void handleMapRequest(req, res, { root, env });
  });
}

async function handleMapRequest(req, res, { root, env }) {
  try {
    if (!isAuthorized(req.headers, env)) {
      res.writeHead(401, {
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": 'Basic realm="7-day-hike-map"',
      });
      res.end("Authentication required");
      return;
    }

    const requestPath = (req.url || "").split("?")[0];

    if (requestPath === "/api/config") {
      sendJson(res, 200, getClientConfig(env));
      return;
    }

    if (requestPath === "/api/routebooks") {
      if (req.method === "GET") {
        sendJson(res, 200, await readRoutebooks(root, env));
        return;
      }
      if (req.method === "PUT") {
        const data = await writeRoutebooks(root, env, await readRequestJson(req));
        sendJson(res, 200, { ok: true, routebooks: data.routebooks });
        return;
      }
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, PUT" });
      res.end("Method not allowed");
      return;
    }

    const filePath = resolvePath(root, req.url || "/");
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "content-type": types[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, {
      ok: false,
      error: statusCode === 500 ? "internal_server_error" : error.message,
    });
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] || "") === currentFile) {
  loadDotEnv(resolve(defaultRoot, ".env"));
  createMapServer({ root: defaultRoot, env: process.env }).listen(defaultPort, "127.0.0.1", () => {
    console.log(`Map server listening at http://127.0.0.1:${defaultPort}/map/`);
  });
}
