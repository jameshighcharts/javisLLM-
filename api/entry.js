// Keep these files in the serverless bundle. The API app expects the nested
// package metadata and benchmark config to exist at runtime.
require("../apps/api/package.json");
require("../apps/api/dist/handlers/package.json");
require("../config/benchmark/config.json");

let appPromise;

module.exports = async function sharedApiEntry(req, res) {
  let debugEnabled = false;

  try {
    const baseUrl = `https://${req.headers.host || "localhost"}`;
    const requestUrl = new URL(req.url || "/api/entry", baseUrl);
    debugEnabled = requestUrl.searchParams.get("__debug") === "1";

    const routedPath =
      requestUrl.searchParams.get("route") ||
      requestUrl.searchParams.get("path") ||
      requestUrl.searchParams.get("__route") ||
      "";
    requestUrl.searchParams.delete("route");
    requestUrl.searchParams.delete("path");
    requestUrl.searchParams.delete("__route");
    requestUrl.searchParams.delete("__debug");

    const normalizedPath = routedPath
      ? `/api/${routedPath.replace(/^\/+/, "")}`
      : "/api";
    const nextQuery = requestUrl.searchParams.toString();
    req.url = nextQuery ? `${normalizedPath}?${nextQuery}` : normalizedPath;

    appPromise ||= import("../apps/api/dist/server.js");
    const mod = await appPromise;
    const app = mod.app || mod.default;
    return app(req, res);
  } catch (error) {
    if (res.headersSent) {
      throw error;
    }

    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        debugEnabled
          ? {
              error: "API bootstrap failed.",
              message: error?.message ?? String(error),
              code: error?.code ?? null,
              stack: error?.stack ?? null,
            }
          : { error: "Internal server error." },
      ),
    );
  }
};
