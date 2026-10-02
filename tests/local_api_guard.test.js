"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { enforceLocalApiRequest } = require("../scripts/local_api_guard");

test("loopback API gate rejects browser/rebinding requests before stub actions", async (t) => {
  let actions = 0;
  const server = http.createServer((req, res) => {
    if (!enforceLocalApiRequest(req, res, server.address().port)) return;
    if (req.method === "POST") actions += 1;
    res.end("synthetic context");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const authority = `127.0.0.1:${port}`;
  async function request(method, headers, body = "") {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/stub", method,
        headers: { Host: authority, ...headers } }, (res) => {
        let text = "";
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  }
  for (const method of ["GET", "POST"]) {
    for (const headers of [{ Host: `attacker.example:${port}` }, { Origin: "https://attacker.example" }, { Origin: "null" }]) {
      const r = await request(method, headers, method === "POST" ? "{}" : "");
      assert.equal(r.status, 403);
      assert.equal(r.text.includes("synthetic context"), false);
    }
  }
  assert.equal(actions, 0);
  assert.equal((await request("POST", { "Content-Type": "text/plain" }, "{}")).status, 415);
  assert.equal(actions, 0);
  assert.equal((await request("POST", { "Content-Type": "application/json", Origin: `http://${authority}` }, "{}")).status, 200);
  assert.equal((await request("POST", { "Content-Type": "application/json; charset=utf-8" }, "{}")).status, 200);
  assert.equal((await request("GET", { Host: `localhost:${port}`, Origin: `http://localhost:${port}` })).status, 200);
  assert.equal((await request("POST", {})).status, 200); // bodyless local CLI actions remain allowed
  assert.equal(actions, 3);
});
