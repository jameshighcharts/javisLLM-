import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractChatGptWebCitationUrls,
  isTruthyEnvFlag,
  normalizeChatGptWebCitationHost,
  normalizeChatGptWebCitationRefs,
  parseChatGptSessionCookieHeader,
} from '../ui/server/prompt-lab/chatgptWebUtils.js'

test('parseChatGptSessionCookieHeader parses semicolon cookie header and ignores set-cookie attributes', () => {
  const parsed = parseChatGptSessionCookieHeader(
    'Cookie: __Secure-next-auth.session-token=abc123; Path=/; Secure; HttpOnly; cf_clearance=xyz',
  )

  assert.deepEqual(parsed, [
    { name: '__Secure-next-auth.session-token', value: 'abc123' },
    { name: 'cf_clearance', value: 'xyz' },
  ])
})

test('isTruthyEnvFlag supports common truthy values', () => {
  assert.equal(isTruthyEnvFlag('true'), true)
  assert.equal(isTruthyEnvFlag('1'), true)
  assert.equal(isTruthyEnvFlag('yes'), true)
  assert.equal(isTruthyEnvFlag('on'), true)
  assert.equal(isTruthyEnvFlag('false'), false)
  assert.equal(isTruthyEnvFlag('0'), false)
  assert.equal(isTruthyEnvFlag(undefined), false)
})

test('normalizeChatGptWebCitationHost normalizes valid URLs', () => {
  assert.equal(
    normalizeChatGptWebCitationHost('https://www.highcharts.com/docs/accessibility/accessibility-module'),
    'highcharts.com',
  )
  assert.equal(normalizeChatGptWebCitationHost('not-a-url'), '')
})

test('normalizeChatGptWebCitationRefs dedupes and computes citation bounds for repeated anchors', () => {
  const responseText = 'Highcharts supports accessibility. Highcharts also supports sonification.'
  const refs = normalizeChatGptWebCitationRefs(
    [
      {
        url: 'https://www.highcharts.com/docs/accessibility/accessibility-module',
        title: 'Accessibility module',
        snippet: 'Accessibility docs',
        anchorText: 'Highcharts',
      },
      {
        url: 'https://www.highcharts.com/docs/sonification/sonification-module',
        title: 'Sonification module',
        snippet: 'Sonification docs',
        anchorText: 'Highcharts',
      },
      {
        url: 'https://www.highcharts.com/docs/sonification/sonification-module',
        title: 'Sonification module',
        snippet: 'Duplicate entry',
        anchorText: 'Highcharts',
      },
    ],
    responseText,
  )

  assert.equal(refs.length, 2)
  assert.equal(refs[0].id, 'c1')
  assert.equal(refs[1].id, 'c2')
  assert.equal(refs[0].provider, 'chatgpt-web')
  assert.equal(refs[0].startIndex, 0)
  assert.equal(refs[0].endIndex, 10)
  assert.equal(refs[1].startIndex, 35)
  assert.equal(refs[1].endIndex, 45)

  assert.deepEqual(extractChatGptWebCitationUrls(refs), [
    'https://www.highcharts.com/docs/accessibility/accessibility-module',
    'https://www.highcharts.com/docs/sonification/sonification-module',
  ])
})
