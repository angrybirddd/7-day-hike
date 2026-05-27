import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
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
    if (!isAuthorized(req.headers, env)) {
      res.writeHead(401, {
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": 'Basic realm="7-day-hike-map"',
      });
      res.end("Authentication required");
      return;
    }

    if ((req.url || "").split("?")[0] === "/api/config") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(getClientConfig(env)));
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
  });
}

const currentFile = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] || "") === currentFile) {
  loadDotEnv(resolve(defaultRoot, ".env"));
  createMapServer({ root: defaultRoot, env: process.env }).listen(defaultPort, "127.0.0.1", () => {
    console.log(`Map server listening at http://127.0.0.1:${defaultPort}/map/`);
  });
}
