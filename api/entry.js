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

  const mod = await import("../apps/api/dist/server.js");
  const app = mod.app || mod.default;
  return app(req, res);
};
