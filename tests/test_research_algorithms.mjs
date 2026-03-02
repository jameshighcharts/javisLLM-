import test from 'node:test'
import assert from 'node:assert/strict'
import shared from '../api/research/_shared.js'

const {
  inferDomainCandidates,
  scoreMentionDeficit,
  scoreCoverageFromDays,
  scoreComposite,
  computeProgressPct,
  hasNonEmptyCitationArray,
} = shared

test('inferDomainCandidates normalizes competitor name and known domains', () => {
  const candidates = inferDomainCandidates('ACME Charts', [
    'https://blog.acmecharts.io/posts/1',
    'http://www.acmecharts.com/resources',
  ])

  assert.ok(candidates.includes('https://acme-charts.com'))
  assert.ok(candidates.includes('https://www.acme-charts.com'))
  assert.ok(candidates.includes('https://blog.acmecharts.io'))
  assert.ok(candidates.includes('https://www.acmecharts.com/resources'))
  assert.ok(candidates.every((value) => value.startsWith('https://')))
})

test('gap scoring formula produces expected composite', () => {
  const mentionDeficit = scoreMentionDeficit(42, 17)
  assert.equal(mentionDeficit.toFixed(4), '0.2500')

  const coverageRaw = [0, 15, 45]
    .map((days) => scoreCoverageFromDays(days))
    .reduce((sum, value) => sum + value, 0)
  const competitorCoverage = Math.min(1, coverageRaw / 5)

  const composite = scoreComposite(mentionDeficit, competitorCoverage)
  const expected = (0.6 * mentionDeficit) + (0.4 * competitorCoverage)

  assert.equal(composite.toFixed(6), expected.toFixed(6))
  assert.ok(composite >= 0)
  assert.ok(composite <= 1)
})

test('progress computation clamps to configured range', () => {
  assert.equal(computeProgressPct(2.5, 5), 50)
  assert.equal(computeProgressPct(-20, 5), -100)
  assert.equal(computeProgressPct(30, 5), 200)
  assert.equal(computeProgressPct(1, 0), 0)
})

test('brief citation validation requires at least one usable URL', () => {
  assert.equal(hasNonEmptyCitationArray([]), false)
  assert.equal(hasNonEmptyCitationArray([{ title: 'Only title' }]), false)
  assert.equal(
    hasNonEmptyCitationArray([{ title: 'Doc', url: 'https://example.com/doc' }]),
    true,
  )
  assert.equal(
    hasNonEmptyCitationArray([{ title: 'Doc', link: 'https://example.com/doc' }]),
    true,
  )
})
