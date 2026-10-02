"use strict";

// This is a loopback browser boundary, not authentication for local processes.
function enforceLocalApiRequest(req, res, port) {
  const host = String(req.headers.host || "").toLowerCase();
  const authorities = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (port === 80) {
    authorities.add("127.0.0.1");
    authorities.add("localhost");
  }
  function reject(status, message) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: message }));
    return false;
  }
  if (!authorities.has(host)) return reject(403, "Invalid local API Host");
  // Browser Origin must match the requested local authority. CLI callers may omit it.
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) {
    return reject(403, "Cross-origin API access is not allowed");
  }
  const hasBody = Number(req.headers["content-length"] || 0) > 0 ||
    req.headers["transfer-encoding"] !== undefined;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && hasBody && !isJsonRequest(req)) {
    return reject(415, "API request bodies must use application/json");
  }
  return true;
}

function isJsonRequest(req) {
  return String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase() === "application/json";
}

module.exports = { enforceLocalApiRequest, isJsonRequest };
