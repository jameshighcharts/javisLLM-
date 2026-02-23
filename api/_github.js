const DEFAULT_API_BASE = 'https://api.github.com'

function getGitHubConfig() {
  const token = process.env.GITHUB_TOKEN
  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  const workflow = process.env.GITHUB_WORKFLOW_FILE || 'run-benchmark.yml'
  const ref = process.env.GITHUB_WORKFLOW_REF || 'main'

  if (!token || !owner || !repo) {
    throw new Error(
      'Missing GitHub env config. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.',
    )
  }

  return { token, owner, repo, workflow, ref }
}

function getAuthToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim()
  }
  const headerToken =
    req.headers['x-benchmark-token'] || req.headers['X-Benchmark-Token']
  if (typeof headerToken === 'string') {
    return headerToken.trim()
  }
  return ''
}

function enforceTriggerToken(req) {
  const required = process.env.BENCHMARK_TRIGGER_TOKEN
  if (!required) {
    return
  }
  const provided = getAuthToken(req)
  if (!provided || provided !== required) {
    const error = new Error('Unauthorized trigger token.')
    error.statusCode = 401
    throw error
  }
}

async function githubRequest(pathname, options = {}) {
  const { token } = getGitHubConfig()
  const response = await fetch(`${DEFAULT_API_BASE}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
    body: options.body,
  })

  const text = await response.text()
  let parsed = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  if (!response.ok) {
    const message =
      (parsed && typeof parsed === 'object' && parsed.message) ||
      `GitHub API error (${response.status})`
    const error = new Error(message)
    error.statusCode = response.status
    error.payload = parsed
    throw error
  }

  return parsed
}

async function dispatchWorkflow(inputs) {
  const { owner, repo, workflow, ref } = getGitHubConfig()
  await githubRequest(
    `/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref,
        inputs,
      }),
    },
  )
}

async function listWorkflowRuns(perPage = 10) {
  const { owner, repo, workflow } = getGitHubConfig()
  const data = await githubRequest(
    `/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=${perPage}`,
  )
  const workflowRuns = Array.isArray(data?.workflow_runs) ? data.workflow_runs : []
  return workflowRuns.map((run) => ({
    id: Number(run.id),
    runNumber: Number(run.run_number),
    status: String(run.status || 'unknown'),
    conclusion: run.conclusion ? String(run.conclusion) : null,
    htmlUrl: String(run.html_url || ''),
    createdAt: String(run.created_at || ''),
    updatedAt: String(run.updated_at || ''),
    headBranch: String(run.head_branch || ''),
    title: String(run.display_title || run.name || 'Benchmark run'),
    actor: run?.actor?.login ? String(run.actor.login) : '',
  }))
}

module.exports = {
  dispatchWorkflow,
  enforceTriggerToken,
  getGitHubConfig,
  listWorkflowRuns,
}
