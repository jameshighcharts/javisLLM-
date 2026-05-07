const {
	getBenchmarkDefaultModelIds,
	getResolvedPublicBenchmarkModelOptions,
} = require("../_benchmark-models");

function sendJson(res, statusCode, payload) {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
}

module.exports = async (req, res) => {
	if (req.method !== "GET") {
		return sendJson(res, 405, { error: "Method not allowed. Use GET." });
	}
	return sendJson(res, 200, {
		ok: true,
		defaultModelIds: getBenchmarkDefaultModelIds(),
		models: await getResolvedPublicBenchmarkModelOptions({ logger: console }),
	});
};
