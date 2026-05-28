import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createMapServer, getClientConfig, isAuthorized } from "../scripts/serve-map.mjs";

function httpRequest(url, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpGet(url, headers = {}) {
  return httpRequest(url, { headers });
}

test("getClientConfig exposes JS API config without service API keys", () => {
  const config = getClientConfig({
    AMAP_JS_API_KEY: "js-key",
    AMAP_SECURITY_JS_CODE: "security-code",
    AMAP_API_KEY: "web-service-key",
  });

  assert.deepEqual(config, {
    ok: true,
    amap: {
      key: "js-key",
      securityJsCode: "security-code",
    },
  });
  assert.equal(JSON.stringify(config).includes("web-service-key"), false);
});

test("getClientConfig reports missing JS API credentials", () => {
  assert.deepEqual(getClientConfig({}), {
    ok: false,
    error: "missing_amap_js_credentials",
    missing: ["AMAP_JS_API_KEY", "AMAP_SECURITY_JS_CODE"],
  });
});

test("isAuthorized enforces Basic Auth only when credentials are configured", () => {
  assert.equal(isAuthorized({}, {}), true);
  assert.equal(isAuthorized({ authorization: "Basic bad" }, { MAP_BASIC_USER: "u", MAP_BASIC_PASSWORD: "p" }), false);

  const token = Buffer.from("u:p", "utf8").toString("base64");
  assert.equal(isAuthorized({ authorization: `Basic ${token}` }, { MAP_BASIC_USER: "u", MAP_BASIC_PASSWORD: "p" }), true);
});

test("createMapServer protects pages and serves /api/config when authorized", async () => {
  const env = {
    MAP_BASIC_USER: "u",
    MAP_BASIC_PASSWORD: "p",
    AMAP_JS_API_KEY: "js-key",
    AMAP_SECURITY_JS_CODE: "security-code",
  };
  const server = createMapServer({ root: process.cwd(), env });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const unauthorized = await httpGet(`http://127.0.0.1:${port}/map/`);
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.headers["www-authenticate"], 'Basic realm="7-day-hike-map"');

    const token = Buffer.from("u:p", "utf8").toString("base64");
    const authorized = await httpGet(`http://127.0.0.1:${port}/api/config`, {
      authorization: `Basic ${token}`,
    });
    assert.equal(authorized.statusCode, 200);
    assert.deepEqual(JSON.parse(authorized.body), {
      ok: true,
      amap: { key: "js-key", securityJsCode: "security-code" },
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("createMapServer reads and writes routebooks through an authorized JSON API", async () => {
  const dir = await mkdtemp(join(tmpdir(), "routebooks-api-"));
  const routebooksPath = join(dir, "routebooks.json");
  const env = {
    MAP_BASIC_USER: "u",
    MAP_BASIC_PASSWORD: "p",
    AMAP_JS_API_KEY: "js-key",
    AMAP_SECURITY_JS_CODE: "security-code",
    ROUTEBOOKS_PATH: routebooksPath,
  };
  const server = createMapServer({ root: process.cwd(), env });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const token = Buffer.from("u:p", "utf8").toString("base64");
  const headers = { authorization: `Basic ${token}` };

  try {
    const empty = await httpGet(`http://127.0.0.1:${port}/api/routebooks`, headers);
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(JSON.parse(empty.body), { routebooks: [] });

    const payload = {
      routebooks: [
        {
          id: "rb-test",
          name: "测试路书",
          region: "内蒙古",
          days: [
            {
              id: "day-1",
              dayIndex: 1,
              title: "Day1",
              start: { name: "经棚镇", lnglat: [117.54157, 43.25862], source: "manual", status: "resolved" },
              end: { name: "浩来呼热", lnglat: [117.18, 43.09], source: "manual", status: "resolved" },
              planKm: 20,
            },
          ],
        },
      ],
    };
    const saved = await httpRequest(`http://127.0.0.1:${port}/api/routebooks`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(JSON.parse(saved.body), { ok: true, routebooks: payload.routebooks });

    const persisted = JSON.parse(await readFile(routebooksPath, "utf8"));
    assert.deepEqual(persisted, payload);

    const reread = await httpGet(`http://127.0.0.1:${port}/api/routebooks`, headers);
    assert.deepEqual(JSON.parse(reread.body), payload);
  } finally {
    server.close();
    await once(server, "close");
    await rm(dir, { recursive: true, force: true });
  }
});

test("createMapServer keeps routebooks API behind Basic Auth and uses a local default path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "routebooks-default-"));
  const env = {
    MAP_BASIC_USER: "u",
    MAP_BASIC_PASSWORD: "p",
    AMAP_JS_API_KEY: "js-key",
    AMAP_SECURITY_JS_CODE: "security-code",
  };
  const server = createMapServer({ root: dir, env });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const token = Buffer.from("u:p", "utf8").toString("base64");

  try {
    const unauthorized = await httpGet(`http://127.0.0.1:${port}/api/routebooks`);
    assert.equal(unauthorized.statusCode, 401);

    const saved = await httpRequest(`http://127.0.0.1:${port}/api/routebooks`, {
      method: "PUT",
      headers: {
        authorization: `Basic ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ routebooks: [] }),
    });
    assert.equal(saved.statusCode, 200);

    const persisted = JSON.parse(await readFile(join(dir, "tmp", "routebooks.local.json"), "utf8"));
    assert.deepEqual(persisted, { routebooks: [] });
  } finally {
    server.close();
    await once(server, "close");
    await rm(dir, { recursive: true, force: true });
  }
});
