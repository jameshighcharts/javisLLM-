module.exports = async function sharedApiApp(req, res) {
  const mod = await import("../apps/api/dist/server.js");
  const app = mod.app || mod.default;
  return app(req, res);
};
