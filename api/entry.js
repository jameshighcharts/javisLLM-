// Keep these files in the serverless bundle. The API app expects the nested
// package metadata and benchmark config to exist at runtime.
require("../apps/api/package.json");
require("../apps/api/dist/handlers/package.json");
require("../config/benchmark/config.json");

let appPromise;

module.exports = async function sharedApiEntry(req, res) {
  const baseUrl = `https://${req.headers.host || "localhost"}`;
  const requestUrl = new URL(req.url || "/api/entry", baseUrl);
  const routedPath =
    requestUrl.searchParams.get("route") ||
    requestUrl.searchParams.get("path") ||
    requestUrl.searchParams.get("__route") ||
    "";
  requestUrl.searchParams.delete("route");
  requestUrl.searchParams.delete("path");
  requestUrl.searchParams.delete("__route");

  const normalizedPath = routedPath
    ? `/api/${routedPath.replace(/^\/+/, "")}`
    : "/api";
  const nextQuery = requestUrl.searchParams.toString();
  req.url = nextQuery ? `${normalizedPath}?${nextQuery}` : normalizedPath;

  appPromise ||= import("../apps/api/dist/server.js");
  const mod = await appPromise;
  const app = mod.app || mod.default;
  return app(req, res);
};
