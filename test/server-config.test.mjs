import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { test } from "node:test";

import { createMapServer, getClientConfig, isAuthorized } from "../scripts/serve-map.mjs";

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
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
