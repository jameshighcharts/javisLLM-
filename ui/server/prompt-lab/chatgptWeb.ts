import {
  extractChatGptWebCitationUrls,
  isTruthyEnvFlag,
  normalizeChatGptWebCitationRefs,
  parseChatGptSessionCookieHeader,
} from './chatgptWebUtils.js'

export const CHATGPT_WEB_MODEL = 'chatgpt-web'

const CHATGPT_WEB_URL = 'https://chatgpt.com/'
const PROMPT_INPUT_SELECTOR = '#prompt-textarea'
const SEND_BUTTON_SELECTOR = '[data-testid="send-button"]'
const STOP_BUTTON_SELECTOR = '[data-testid="stop-button"]'
const ASSISTANT_TURN_SELECTOR = '[data-message-author-role="assistant"]'

const DEFAULT_TIMEOUT_MS = 90_000
const MIN_TIMEOUT_MS = 15_000
const MAX_TIMEOUT_MS = 240_000

type HttpError = Error & {
  statusCode?: number
  exposeMessage?: boolean
}

type RawCitationCandidate = {
  url?: string
  title?: string
  snippet?: string
  anchorText?: string | null
}

export type ChatGptWebCitationRef = {
  id: string
  url: string
  title: string
  host: string
  snippet?: string
  startIndex?: number | null
  endIndex?: number | null
  anchorText?: string | null
  provider: 'chatgpt-web'
}

export type ChatGptWebPromptLabQueryResult = {
  responseText: string
  citationRefs: ChatGptWebCitationRef[]
  citations: string[]
  effectiveQuery: string
  rawHtml?: string
  tokens: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

function buildHttpError(message: string, statusCode: number, exposeMessage = true): HttpError {
  const error = new Error(message) as HttpError
  error.statusCode = statusCode
  error.exposeMessage = exposeMessage
  return error
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

function resolveTimeoutMs(): number {
  return clampNumber(
    process.env.CHATGPT_WEB_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  )
}

function resolveSlowMoMs(): number {
  return clampNumber(process.env.CHATGPT_WEB_SLOW_MO_MS, 0, 0, 1_000)
}

function resolveHeadlessMode(): boolean {
  const raw = String(process.env.CHATGPT_WEB_HEADLESS ?? '').trim()
  if (!raw) return true
  return isTruthyEnvFlag(raw)
}

function ensureScraperEnabled(): void {
  if (!isTruthyEnvFlag(process.env.ENABLE_CHATGPT_WEB_SCRAPER)) {
    throw buildHttpError(
      'ChatGPT web scraper is disabled. Set ENABLE_CHATGPT_WEB_SCRAPER=true to enable local scraping.',
      403,
    )
  }
}

function resolveSessionCookies(): Array<{ name: string; value: string }> {
  const rawCookieHeader = String(process.env.CHATGPT_SESSION_COOKIE ?? '').trim()
  if (!rawCookieHeader) {
    throw buildHttpError(
      'ChatGPT web scraper is not configured. Set CHATGPT_SESSION_COOKIE with your browser session cookies.',
      503,
    )
  }

  const parsedCookies = parseChatGptSessionCookieHeader(rawCookieHeader)
  if (parsedCookies.length === 0) {
    throw buildHttpError(
      'CHATGPT_SESSION_COOKIE is invalid. Provide a semicolon-separated cookie header (for example: name=value; other=value).',
      400,
    )
  }

  return parsedCookies
}

async function importPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright')
  } catch {
    throw buildHttpError(
      'Playwright is not installed for the local UI server. Run `npm install --prefix ui playwright` and retry.',
      503,
    )
  }
}

async function isLocatorVisible(locator: { count(): Promise<number>; isVisible(): Promise<boolean> }) {
  try {
    const count = await locator.count()
    if (count === 0) return false
    return await locator.isVisible()
  } catch {
    return false
  }
}

async function waitForPromptInput(page: import('playwright').Page, timeoutMs: number): Promise<void> {
  const promptInput = page.locator(PROMPT_INPUT_SELECTOR).first()

  try {
    await promptInput.waitFor({ state: 'visible', timeout: timeoutMs })
    return
  } catch {
    const loginLink = page.locator('a[href*="auth/login"], a[href*="/login"], button:has-text("Log in")').first()
    if (await isLocatorVisible(loginLink)) {
      throw buildHttpError(
        'ChatGPT session appears signed out or expired. Refresh CHATGPT_SESSION_COOKIE from a logged-in browser session.',
        401,
      )
    }
    throw buildHttpError(
      'Timed out waiting for the ChatGPT prompt input. Check cookie validity and anti-bot challenges.',
      504,
    )
  }
}

async function submitPrompt(page: import('playwright').Page, query: string): Promise<number> {
  const promptInput = page.locator(PROMPT_INPUT_SELECTOR).first()
  const assistantTurns = page.locator(ASSISTANT_TURN_SELECTOR)
  const assistantCountBefore = await assistantTurns.count()

  await promptInput.fill(query)

  const sendButton = page.locator(SEND_BUTTON_SELECTOR).first()
  const canClickSend = await isLocatorVisible(sendButton)
  if (canClickSend) {
    await sendButton.click()
  } else {
    await promptInput.press('Enter')
  }

  return assistantCountBefore
}

async function waitForAssistantTurn(
  page: import('playwright').Page,
  assistantCountBefore: number,
  timeoutMs: number,
): Promise<number> {
  const assistantTurns = page.locator(ASSISTANT_TURN_SELECTOR)
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const count = await assistantTurns.count()
    if (count > assistantCountBefore) {
      return count - 1
    }
    await page.waitForTimeout(250)
  }

  throw buildHttpError('Timed out waiting for assistant response to start.', 504)
}

async function waitForResponseToSettle(
  page: import('playwright').Page,
  assistantIndex: number,
  timeoutMs: number,
): Promise<string> {
  const assistantTurn = page.locator(ASSISTANT_TURN_SELECTOR).nth(assistantIndex)
  const stopButton = page.locator(STOP_BUTTON_SELECTOR).first()
  const startedAt = Date.now()

  let lastText = ''
  let stableCycles = 0

  while (Date.now() - startedAt < timeoutMs) {
    const currentText = (await assistantTurn.innerText()).trim()
    const stopVisible = await isLocatorVisible(stopButton)

    if (currentText === lastText) {
      stableCycles += 1
    } else {
      lastText = currentText
      stableCycles = 0
    }

    if (currentText && !stopVisible && stableCycles >= 3) {
      return currentText
    }

    await page.waitForTimeout(500)
  }

  if (lastText) {
    return lastText
  }

  throw buildHttpError('Timed out waiting for assistant response to finish streaming.', 504)
}

async function extractCitationCandidates(
  page: import('playwright').Page,
  assistantIndex: number,
): Promise<RawCitationCandidate[]> {
  return await page.evaluate(
    ({ assistantSelector, assistantTurnIndex }) => {
      const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
      const candidates: Array<{ url: string; title: string; snippet: string; anchorText: string }> = []
      const seen = new Set<string>()

      const pushAnchor = (anchor: Element | null) => {
        if (!anchor || !(anchor instanceof HTMLAnchorElement)) return

        const rawHref = clean(anchor.getAttribute('href') ?? anchor.href)
        if (!rawHref || !/^https?:\/\//i.test(rawHref)) {
          return
        }

        const anchorText = clean(anchor.textContent)
        const title =
          clean(anchor.getAttribute('title')) ||
          clean(anchor.getAttribute('aria-label')) ||
          anchorText

        const snippetContainer = anchor.closest('li, p, div, article, section')
        const snippet = clean(snippetContainer?.textContent).slice(0, 220)

        const dedupeKey = `${rawHref}|${title.toLowerCase()}|${anchorText.toLowerCase()}`
        if (seen.has(dedupeKey)) return
        seen.add(dedupeKey)

        candidates.push({
          url: rawHref,
          title,
          snippet,
          anchorText,
        })
      }

      const assistantTurns = Array.from(document.querySelectorAll(assistantSelector))
      const assistantTurn = assistantTurns[assistantTurnIndex] ?? null

      if (assistantTurn) {
        for (const anchor of Array.from(assistantTurn.querySelectorAll('a[href]'))) {
          pushAnchor(anchor)
        }
      }

      const panelSelectors = [
        '[data-testid*="citation"] a[href]',
        '[data-testid*="source"] a[href]',
        'aside a[href*="utm_source=chatgpt.com"]',
        'aside a[href]',
      ]

      for (const selector of panelSelectors) {
        for (const anchor of Array.from(document.querySelectorAll(selector))) {
          pushAnchor(anchor)
        }
      }

      return candidates
    },
    {
      assistantSelector: ASSISTANT_TURN_SELECTOR,
      assistantTurnIndex: assistantIndex,
    },
  )
}

export async function runChatGptWebPromptLabQuery(options: {
  query: string
  includeRawHtml?: boolean
}): Promise<ChatGptWebPromptLabQueryResult> {
  const query = String(options.query ?? '').trim()
  if (!query) {
    throw buildHttpError('query is required.', 400)
  }

  ensureScraperEnabled()
  const cookies = resolveSessionCookies()

  const timeoutMs = resolveTimeoutMs()
  const slowMoMs = resolveSlowMoMs()
  const headless = resolveHeadlessMode()

  const playwright = await importPlaywright()

  const browser = await playwright.chromium.launch({
    headless,
    ...(slowMoMs > 0 ? { slowMo: slowMoMs } : {}),
  })

  let context: import('playwright').BrowserContext | null = null

  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: 980 },
    })

    await context.addCookies(
      cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url: CHATGPT_WEB_URL,
      })),
    )

    const page = await context.newPage()
    await page.goto(CHATGPT_WEB_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    await waitForPromptInput(page, timeoutMs)

    const assistantCountBefore = await submitPrompt(page, query)
    const assistantIndex = await waitForAssistantTurn(page, assistantCountBefore, timeoutMs)
    const responseText = await waitForResponseToSettle(page, assistantIndex, timeoutMs)

    const assistantTurn = page.locator(ASSISTANT_TURN_SELECTOR).nth(assistantIndex)
    const rawHtml = (await assistantTurn.innerHTML()).trim()
    const citationCandidates = await extractCitationCandidates(page, assistantIndex)
    const citationRefs = normalizeChatGptWebCitationRefs(citationCandidates, responseText)

    return {
      responseText,
      citationRefs,
      citations: extractChatGptWebCitationUrls(citationRefs),
      effectiveQuery: query,
      rawHtml: options.includeRawHtml ? rawHtml : undefined,
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    }
  } finally {
    try {
      if (context) {
        await context.close()
      }
    } finally {
      await browser.close()
    }
  }
}
