const { enforceTriggerToken, getGitHubConfig, listWorkflowRuns } = require('../_github')

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed. Use GET.' })
    }

    enforceTriggerToken(req)
    const config = getGitHubConfig()
    const runs = await listWorkflowRuns(15)

    return sendJson(res, 200, {
      ok: true,
      workflow: config.workflow,
      repo: `${config.owner}/${config.repo}`,
      runs,
    })
  } catch (error) {
    const statusCode =
      typeof error === 'object' && error !== null && Number(error.statusCode)
        ? Number(error.statusCode)
        : 500
    return sendJson(res, statusCode, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
