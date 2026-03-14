import assert from 'node:assert/strict'
import test from 'node:test'

import benchmarkTriggerHandler from '../api/benchmark/trigger.js'
import promptLabRunHandler from '../api/prompt-lab/run.js'
import competitorResearchHandler from '../api/research/competitors/run.js'
import briefGenerateHandler from '../api/research/briefs/generate.js'
import promptCohortsHandler from '../api/research/prompt-cohorts.js'
import shared from '../api/research/_shared.js'

const { runOpenAiJsonWithRetry } = shared

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload)
    },
  }
}

function createMockReq({
  method = 'POST',
  headers = {},
  body = {},
  query = {},
} = {}) {
  return {
    method,
    headers,
    body,
    query,
    socket: { remoteAddress: '127.0.0.1' },
  }
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value)
    },
    end(payload) {
      this.body = String(payload ?? '')
    },
  }
}

async function invokeHandler(handler, reqOptions) {
  const req = createMockReq(reqOptions)
  const res = createMockRes()
  await handler(req, res)
  return {
    statusCode: res.statusCode,
    payload: res.body ? JSON.parse(res.body) : null,
    headers: res.headers,
  }
}

async function withEnv(overrides, run) {
  const snapshot = new Map()
  for (const [key, value] of Object.entries(overrides)) {
    snapshot.set(key, process.env[key])
    if (value === null || value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = String(value)
    }
  }

  try {
    await run()
  } finally {
    for (const [key, value] of snapshot.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('competitor research endpoint rejects missing token', async () => {
  await withEnv(
    {
      ENABLE_RESEARCH_FEATURES: 'true',
      BENCHMARK_TRIGGER_TOKEN: 'secret-token',
    },
    async () => {
      const result = await invokeHandler(competitorResearchHandler, {
        method: 'POST',
        headers: {},
        body: {},
      })

      assert.equal(result.statusCode, 401)
      assert.equal(result.payload?.error, 'Unauthorized trigger token.')
    },
  )
})

test('benchmark trigger returns 400 when cohort tag has no matching prompts', async () => {
  const originalFetch = global.fetch
  await withEnv(
    {
      USE_QUEUE_TRIGGER: 'true',
      BENCHMARK_TRIGGER_TOKEN: 'secret-token',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    async () => {
      global.fetch = async () => createJsonResponse([])

      const result = await invokeHandler(benchmarkTriggerHandler, {
        method: 'POST',
        headers: { authorization: 'Bearer secret-token' },
        body: {
          model: 'gpt-4o-mini',
          runs: 1,
          temperature: 0.7,
          webSearch: true,
          ourTerms: 'Highcharts',
          cohortTag: 'cohort:not-found',
        },
      })

      assert.equal(result.statusCode, 400)
      assert.match(result.payload?.error ?? '', /No active prompts match cohortTag/i)
    },
  )
  global.fetch = originalFetch
})

test('brief generation endpoint fails when citations are missing', async () => {
  const originalFetch = global.fetch
  await withEnv(
    {
      ENABLE_RESEARCH_FEATURES: 'true',
      BENCHMARK_TRIGGER_TOKEN: 'secret-token',
      OPENAI_API_KEY: 'openai-test-key',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    async () => {
      global.fetch = async (url, options = {}) => {
        const method = String(options.method || 'GET').toUpperCase()
        const target = String(url)

        if (target.endsWith('/rest/v1/research_runs') && method === 'POST') {
          return createJsonResponse([{ id: 'run-test' }])
        }

        if (
          target.includes('/rest/v1/content_gap_items?') &&
          target.includes('id=eq.gap-1') &&
          method === 'GET'
        ) {
          return createJsonResponse([
            {
              id: 'gap-1',
              topic_key: 'react-ssr',
              topic_label: 'react ssr charting',
              mention_deficit_score: 0.5,
              competitor_coverage_score: 0.4,
              composite_score: 0.46,
              evidence_count: 3,
              evidence_citations: [
                {
                  title: 'Example Source',
                  source: 'Example',
                  link: 'https://example.com/post',
                },
              ],
            },
          ])
        }

        if (target === 'https://api.openai.com/v1/responses') {
          return createJsonResponse({
            output_text: JSON.stringify({
              brief_markdown: [
                '## Opportunity',
                '## Why This Gap Exists',
                '## Recommended Page Target',
                '## Section Outline',
                '## Conversational Long-tail Queries',
                '## Entity/Citation Strategy',
                '## Action Checklist',
                '## Validation Steps',
              ].join('\n\n'),
              action_checklist: ['Draft the section headings'],
              brief_citations: [],
            }),
          })
        }

        if (target.includes('/rest/v1/research_runs?id=eq.run-test') && method === 'PATCH') {
          return createJsonResponse([])
        }

        throw new Error(`Unexpected fetch call: ${method} ${target}`)
      }

      const result = await invokeHandler(briefGenerateHandler, {
        method: 'POST',
        headers: { authorization: 'Bearer secret-token' },
        body: { gapId: 'gap-1' },
      })

      assert.equal(result.statusCode, 400)
      assert.match(result.payload?.error ?? '', /must include non-empty citations/i)
    },
  )
  global.fetch = originalFetch
})

test('OpenAI JSON helper retries once on invalid JSON and succeeds', async () => {
  const originalFetch = global.fetch
  await withEnv({ OPENAI_API_KEY: 'openai-test-key' }, async () => {
    let attempt = 0
    global.fetch = async () => {
      attempt += 1
      if (attempt === 1) {
        return createJsonResponse({
          output_text: 'not json',
        })
      }
      return createJsonResponse({
        output_text: '{"items":[{"title":"ok"}]}',
      })
    }

    const result = await runOpenAiJsonWithRetry({
      model: 'gpt-5.2',
      systemPrompt: 'Return JSON',
      userPrompt: 'Test',
      maxAttempts: 2,
      webSearch: true,
    })

    assert.equal(result.attempt, 2)
    assert.equal(Array.isArray(result.parsed.items), true)
    assert.equal(result.parsed.items.length, 1)
  })
  global.fetch = originalFetch
})

test('prompt lab run returns effectiveQuery + citationRefs while keeping legacy citations list', async () => {
  const originalFetch = global.fetch
  await withEnv(
    {
      OPENAI_API_KEY: 'openai-test-key',
      PROMPT_LAB_RATE_MAX: '50',
      PROMPT_LAB_RATE_WINDOW_MS: '60000',
    },
    async () => {
      global.fetch = async (url, options = {}) => {
        const target = String(url)
        assert.equal(target, 'https://api.openai.com/v1/responses')
        const payload = JSON.parse(String(options.body ?? '{}'))
        const systemContent = payload?.input?.[0]?.content ?? ''
        const userContent = payload?.input?.[1]?.content ?? ''
        assert.match(
          systemContent,
          /You are a research assistant for software and tooling questions\./,
        )
        assert.match(
          userContent,
          /\(The user's location is United States\. Be sure to reply in en language\)/,
        )
        assert.match(userContent, /Answer with this structure:/)
        assert.match(userContent, /1\) Top options \(ranked\)/)
        assert.match(userContent, /Use web search before finalizing and include source-grounded statements\./)
        return createJsonResponse({
          output_text: 'Highcharts supports WCAG and keyboard navigation.',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Highcharts supports WCAG and keyboard navigation.',
                  annotations: [
                    {
                      type: 'url_citation',
                      url_citation: {
                        title: 'Highcharts accessibility',
                        url: 'https://www.highcharts.com/docs/accessibility/accessibility-module',
                        start_index: 0,
                        end_index: 10,
                        snippet: 'Accessibility module docs',
                      },
                    },
                  ],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8,
            total_tokens: 20,
          },
        })
      }

      const result = await invokeHandler(promptLabRunHandler, {
        method: 'POST',
        body: {
          query: 'charting libraries with accessibility support',
          model: 'gpt-4o',
          webSearch: true,
          searchContext: {
            enabled: true,
            location: 'United States',
            language: 'en',
          },
        },
      })

      assert.equal(result.statusCode, 200)
      assert.equal(result.payload?.ok, true)
      assert.match(
        result.payload?.effectiveQuery ?? '',
        /\(The user's location is United States\. Be sure to reply in en language\)$/,
      )
      assert.ok(Array.isArray(result.payload?.citationRefs))
      assert.equal(result.payload?.citationRefs?.length, 1)
      assert.equal(
        result.payload?.citationRefs?.[0]?.url,
        'https://www.highcharts.com/docs/accessibility/accessibility-module',
      )
      assert.equal(result.payload?.citationRefs?.[0]?.startIndex, 0)
      assert.equal(result.payload?.citationRefs?.[0]?.endIndex, 10)
      assert.equal(result.payload?.citationRefs?.[0]?.anchorText, 'Highcharts')
      assert.ok(Array.isArray(result.payload?.citations))
      assert.deepEqual(result.payload?.citations, [
        'https://www.highcharts.com/docs/accessibility/accessibility-module',
      ])
      assert.ok(Array.isArray(result.payload?.results))
      assert.equal(result.payload?.results?.[0]?.effectiveQuery, result.payload?.effectiveQuery)
    },
  )
  global.fetch = originalFetch
})

test('prompt cohorts update preserves existing baseline when baselineRunId is omitted', async () => {
  const originalFetch = global.fetch
  await withEnv(
    {
      ENABLE_RESEARCH_FEATURES: 'true',
      BENCHMARK_TRIGGER_TOKEN: 'secret-token',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    async () => {
      let benchmarkRunLookupCount = 0
      let upsertBody = null

      global.fetch = async (url, options = {}) => {
        const method = String(options.method || 'GET').toUpperCase()
        const target = String(url)

        if (
          target.includes('/rest/v1/prompt_research_cohorts?') &&
          target.includes('tag=eq.cohort%3Aweekly') &&
          method === 'GET'
        ) {
          return createJsonResponse([
            {
              id: 'cohort-1',
              tag: 'cohort:weekly',
              display_name: 'Existing Cohort',
              baseline_run_id: 'baseline-old',
              target_pp: 9,
              target_weeks: 10,
              is_active: true,
            },
          ])
        }

        if (
          target.includes('/rest/v1/prompt_queries?') &&
          target.includes('tags=cs.%7Bcohort%3Aweekly%7D') &&
          method === 'GET'
        ) {
          return createJsonResponse([{ id: 'prompt-1' }])
        }

        if (target.includes('/rest/v1/benchmark_runs?') && method === 'GET') {
          benchmarkRunLookupCount += 1
          return createJsonResponse([{ id: 'run-latest', ended_at: '2026-02-20T00:00:00Z' }])
        }

        if (
          target.includes('/rest/v1/prompt_research_cohorts?on_conflict=tag') &&
          method === 'POST'
        ) {
          upsertBody = JSON.parse(String(options.body ?? '[]'))
          return createJsonResponse(upsertBody)
        }

        throw new Error(`Unexpected fetch call: ${method} ${target}`)
      }

      const result = await invokeHandler(promptCohortsHandler, {
        method: 'POST',
        headers: { authorization: 'Bearer secret-token' },
        body: {
          tag: 'cohort:weekly',
          displayName: 'Weekly Refresh',
        },
      })

      assert.equal(result.statusCode, 200)
      assert.equal(benchmarkRunLookupCount, 0)
      assert.ok(Array.isArray(upsertBody))
      assert.equal(upsertBody?.[0]?.baseline_run_id, 'baseline-old')
      assert.equal(upsertBody?.[0]?.display_name, 'Weekly Refresh')
      assert.equal(upsertBody?.[0]?.target_pp, 9)
      assert.equal(upsertBody?.[0]?.target_weeks, 10)
    },
  )
  global.fetch = originalFetch
})
