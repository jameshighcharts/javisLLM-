import cors from "cors";
import { parse } from "csv-parse/sync";
import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

type CsvRow = Record<string, string>;

type BenchmarkConfig = {
  queries: string[];
  queryTags: Record<string, string[]>;
  competitors: string[];
  aliases: Record<string, string[]>;
  pausedQueries: string[];
};

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serverDir, "..", "..");
const configPath = path.join(repoRoot, "config", "benchmark_config.json");
const outputDir = path.join(repoRoot, "output");

const dashboardFiles = {
  comparison: path.join(outputDir, "comparison_table.csv"),
  competitorChart: path.join(outputDir, "looker_competitor_chart.csv"),
  kpi: path.join(outputDir, "looker_kpi.csv"),
  jsonl: path.join(outputDir, "llm_outputs.jsonl"),
};

const configSchema = z.object({
  queries: z.array(z.string().min(1)).min(1),
  queryTags: z.record(z.string(), z.array(z.string().min(1))).optional().default({}),
  competitors: z.array(z.string().min(1)).min(1),
  aliases: z.record(z.string(), z.array(z.string().min(1))).default({}),
  pausedQueries: z.array(z.string()).optional().default([]),
});

const toggleSchema = z.object({
  query: z.string().min(1),
  active: z.boolean(),
});

const PROMPT_LAB_DEFAULT_MODEL = "gpt-4o-mini";
const PROMPT_LAB_FALLBACK_MODELS = [PROMPT_LAB_DEFAULT_MODEL, "gpt-4o"];
const PROMPT_LAB_SYSTEM_PROMPT =
  "You are a helpful assistant. Answer with concise bullets and include direct library names.";
const PROMPT_LAB_USER_PROMPT_TEMPLATE =
  "Query: {query}\nList relevant libraries/tools with a short rationale for each in bullet points.";
const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";

const promptLabRunSchema = z.object({
  query: z.string().min(1).max(600),
  model: z.string().min(1).max(100).optional(),
  webSearch: z.boolean().optional(),
});

const app = express();
app.disable("x-powered-by");
const isProduction = process.env.NODE_ENV === "production";
const configuredCorsOrigins = String(process.env.UI_API_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedCorsOrigins =
  configuredCorsOrigins.length > 0
    ? configuredCorsOrigins
    : [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
      ];
const writeToken = String(process.env.UI_API_WRITE_TOKEN ?? "").trim();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowedCorsOrigins.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-UI-Token"],
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none';");
  next();
});

function getRequestToken(req: express.Request): string {
  const auth = req.headers.authorization ?? req.headers.Authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const headerToken = req.headers["x-ui-token"] ?? req.headers["X-UI-Token"];
  if (typeof headerToken === "string") {
    return headerToken.trim();
  }
  return "";
}

function isLocalhostRequest(req: express.Request): boolean {
  const remote = req.socket.remoteAddress;
  return (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1" ||
    remote === "localhost"
  );
}

function requireWriteAccess(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (writeToken) {
    const provided = getRequestToken(req);
    if (!provided || provided !== writeToken) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    next();
    return;
  }

  if (isProduction) {
    res.status(500).json({ error: "Internal server error." });
    return;
  }

  if (!isLocalhostRequest(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  next();
}

function sendApiError(
  res: express.Response,
  statusCode: number,
  message: string,
  error: unknown,
) {
  console.error(`[ui-api] ${message}`, error);
  const payload: Record<string, unknown> = { error: message };
  if (!isProduction) {
    payload.details = String(error);
  }
  res.status(statusCode).json(payload);
}

function uniqueNonEmpty(values: string[]): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return [...new Set(normalized)];
}

function inferPromptTags(query: string): string[] {
  const normalized = query.toLowerCase();
  const tags: string[] = [];

  if (normalized.includes("react")) {
    tags.push("react");
  }
  if (normalized.includes("javascript") || /\bjs\b/.test(normalized)) {
    tags.push("javascript");
  }
  if (tags.length === 0) {
    tags.push("general");
  }

  return tags;
}

function normalizePromptTags(rawTags: unknown, query: string): string[] {
  const candidates =
    typeof rawTags === "string"
      ? rawTags.split(",")
      : Array.isArray(rawTags)
        ? rawTags.map((value) => String(value))
        : [];

  const normalized = uniqueNonEmpty(
    candidates.map((value) => {
      const normalizedTag = value.trim().toLowerCase();
      return normalizedTag === "generic" ? "general" : normalizedTag;
    }),
  );
  return normalized.length > 0 ? normalized : inferPromptTags(query);
}

function normalizeQueryTagsMap(
  queries: string[],
  rawQueryTags: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const lookup = new Map<string, unknown>();
  for (const [query, tags] of Object.entries(rawQueryTags ?? {})) {
    lookup.set(query.trim().toLowerCase(), tags);
  }

  return Object.fromEntries(
    queries.map((query) => [
      query,
      normalizePromptTags(lookup.get(query.trim().toLowerCase()), query),
    ]),
  );
}

function normalizeSelectedTags(rawTags: unknown): string[] {
  if (typeof rawTags !== "string") {
    return [];
  }
  return uniqueNonEmpty(
    rawTags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  );
}

function promptMatchesTagFilter(
  promptTags: string[],
  selectedTagSet: Set<string>,
  mode: "any" | "all",
): boolean {
  if (selectedTagSet.size === 0) {
    return true;
  }

  const promptTagSet = new Set(promptTags.map((tag) => tag.toLowerCase()));
  if (mode === "all") {
    for (const tag of selectedTagSet) {
      if (!promptTagSet.has(tag)) {
        return false;
      }
    }
    return true;
  }

  for (const tag of selectedTagSet) {
    if (promptTagSet.has(tag)) {
      return true;
    }
  }

  return false;
}

function slugifyEntity(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asYesNo(value: unknown): "yes" | "no" {
  return String(value ?? "").toLowerCase() === "yes" ? "yes" : "no";
}

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function splitCsvish(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getPromptLabAllowedModels(): string[] {
  const configured = String(process.env.BENCHMARK_ALLOWED_MODELS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : PROMPT_LAB_FALLBACK_MODELS;
}

function resolvePromptLabModel(modelInput: string, allowedModels: string[]): string {
  const normalizedMap = new Map(allowedModels.map((name) => [name.toLowerCase(), name]));
  const resolved = normalizedMap.get(modelInput.toLowerCase());
  if (!resolved) {
    const error = new Error(
      `Unsupported model "${modelInput}". Allowed models: ${allowedModels.join(", ")}`,
    ) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

function extractPromptLabResponseText(responsePayload: Record<string, unknown>): string {
  const outputText = responsePayload.output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText.trim();
  }

  const texts: string[] = [];
  const outputItems = Array.isArray(responsePayload.output) ? responsePayload.output : [];
  for (const outputItem of outputItems) {
    if (!outputItem || typeof outputItem !== "object") {
      continue;
    }
    const contentItems = Array.isArray((outputItem as { content?: unknown }).content)
      ? (outputItem as { content: unknown[] }).content
      : [];
    for (const content of contentItems) {
      if (!content || typeof content !== "object") {
        continue;
      }
      const text = (content as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) {
        texts.push(text.trim());
      }
    }
  }

  return texts.join("\n").trim();
}

function extractPromptLabCitations(responsePayload: Record<string, unknown>): string[] {
  const citations: string[] = [];
  const seen = new Set<string>();

  const appendCitation = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    const entry = candidate as { url?: unknown; uri?: unknown; href?: unknown; source?: unknown };
    const urlValue = [entry.url, entry.uri, entry.href, entry.source].find(
      (value) => typeof value === "string" && value.trim(),
    );
    if (typeof urlValue !== "string") return;
    const normalized = urlValue.trim();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    citations.push(normalized);
  };

  for (const key of ["citations", "sources", "references"] as const) {
    const topLevelValue = responsePayload[key];
    if (Array.isArray(topLevelValue)) {
      for (const item of topLevelValue) {
        appendCitation(item);
      }
    }
  }

  const outputItems = Array.isArray(responsePayload.output) ? responsePayload.output : [];
  for (const outputItem of outputItems) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const contentItems = Array.isArray((outputItem as { content?: unknown }).content)
      ? (outputItem as { content: unknown[] }).content
      : [];
    for (const content of contentItems) {
      if (!content || typeof content !== "object") continue;

      const contentCitations = (content as { citations?: unknown }).citations;
      if (Array.isArray(contentCitations)) {
        for (const citation of contentCitations) {
          appendCitation(citation);
        }
      }

      const annotations = (content as { annotations?: unknown }).annotations;
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (!annotation || typeof annotation !== "object") continue;
        appendCitation(annotation);
        const nested = (annotation as { url_citation?: unknown }).url_citation;
        appendCitation(nested);
      }
    }
  }

  return citations;
}

async function runPromptLabQuery(
  query: string,
  model: string,
  webSearch: boolean,
): Promise<{ responseText: string; citations: string[] }> {
  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    const error = new Error("Prompt lab is not configured on the server.") as Error & {
      statusCode?: number;
    };
    error.statusCode = 500;
    throw error;
  }

  const body: Record<string, unknown> = {
    model,
    temperature: 0.7,
    input: [
      { role: "system", content: PROMPT_LAB_SYSTEM_PROMPT },
      {
        role: "user",
        content: PROMPT_LAB_USER_PROMPT_TEMPLATE.replace("{query}", query),
      },
    ],
  };
  if (webSearch) {
    body.tools = [{ type: "web_search_preview" }];
  }

  const upstreamResponse = await fetch(OPENAI_RESPONSES_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await upstreamResponse.text();
  let payload: unknown = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
  }

  if (!upstreamResponse.ok) {
    const upstreamMessage =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
        ? (payload as { error: { message: string } }).error.message
        : `OpenAI request failed (${upstreamResponse.status}).`;
    const error = new Error(upstreamMessage) as Error & { statusCode?: number };
    error.statusCode = upstreamResponse.status >= 500 ? 502 : upstreamResponse.status;
    throw error;
  }

  const responsePayload =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

  return {
    responseText: extractPromptLabResponseText(responsePayload),
    citations: extractPromptLabCitations(responsePayload),
  };
}

function inferPromptResponseCount(row: CsvRow | undefined, competitors: string[]): number | null {
  if (!row) {
    return null;
  }

  const estimates: number[] = [];

  for (const competitor of competitors) {
    const key = slugifyEntity(competitor);
    const count = asNumber(row[`${key}_count`]);
    const rate = asNumber(row[`${key}_rate`]);
    if (count > 0 && rate > 0) {
      const estimate = count / rate;
      if (Number.isFinite(estimate) && estimate > 0) {
        estimates.push(estimate);
      }
    }
  }

  const rivals = competitors.filter((name) => name.toLowerCase() !== "highcharts");
  const viabilityCount = asNumber(row.viability_index_count);
  const viabilityRate = asNumber(row.viability_index_rate);
  if (rivals.length > 0 && viabilityCount > 0 && viabilityRate > 0) {
    const estimate = viabilityCount / viabilityRate / rivals.length;
    if (Number.isFinite(estimate) && estimate > 0) {
      estimates.push(estimate);
    }
  }

  if (estimates.length === 0) {
    return null;
  }

  const average = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
  return Math.max(0, Math.round(average));
}

function normalizeConfig(rawConfig: BenchmarkConfig): BenchmarkConfig {
  const queries = uniqueNonEmpty(rawConfig.queries);
  const queryTags = normalizeQueryTagsMap(queries, rawConfig.queryTags);
  const competitors = uniqueNonEmpty(rawConfig.competitors);
  if (!competitors.some((name) => name.toLowerCase() === "highcharts")) {
    throw new Error('`competitors` must include "Highcharts".');
  }

  const aliases: Record<string, string[]> = {};
  for (const competitor of competitors) {
    const candidateAliases =
      rawConfig.aliases[competitor] ??
      rawConfig.aliases[competitor.toLowerCase()] ??
      [];
    aliases[competitor] = uniqueNonEmpty([competitor, ...candidateAliases]);
  }

  return {
    queries,
    queryTags,
    competitors,
    aliases,
    pausedQueries: uniqueNonEmpty(rawConfig.pausedQueries ?? []),
  };
}

async function readCsv(filePath: string): Promise<CsvRow[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    if (!content.trim()) {
      return [];
    }
    return parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as CsvRow[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readJsonl(filePath: string): Promise<Array<Record<string, unknown>>> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line);
          return typeof parsed === "object" && parsed !== null ? [parsed as Record<string, unknown>] : [];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function loadConfig(): Promise<BenchmarkConfig> {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = configSchema.parse(JSON.parse(raw));
  return normalizeConfig(parsed);
}

function inferWindowFromJsonl(rows: Array<Record<string, unknown>>): {
  start: string | null;
  end: string | null;
  models: string[];
} {
  const timestamps = rows
    .map((row) => String(row.timestamp ?? ""))
    .filter(Boolean)
    .sort();
  const models = [...new Set(rows.map((row) => String(row.model ?? "")).filter(Boolean))];
  return {
    start: timestamps[0] ?? null,
    end: timestamps.at(-1) ?? null,
    models,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ui-api", repoRoot: "ui-api" });
});

app.get("/api/config", async (_req, res) => {
  try {
    const [config, stats] = await Promise.all([loadConfig(), fs.stat(configPath)]);
    res.json({
      config,
      meta: {
        source: "config/benchmark_config.json",
        updatedAt: stats.mtime.toISOString(),
        queries: config.queries.length,
        competitors: config.competitors.length,
      },
    });
  } catch (error) {
    sendApiError(res, 500, "Unable to load benchmark config.", error);
  }
});

app.put("/api/config", requireWriteAccess, async (req, res) => {
  try {
    const parsed = configSchema.parse(req.body);
    const normalized = normalizeConfig(parsed);
    await fs.writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    const stats = await fs.stat(configPath);
    res.json({
      config: normalized,
      meta: {
        source: "config/benchmark_config.json",
        updatedAt: stats.mtime.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid config payload.",
        issues: error.issues,
      });
      return;
    }

    sendApiError(res, 500, "Could not save config.", error);
  }
});

app.patch("/api/prompts/toggle", requireWriteAccess, async (req, res) => {
  try {
    const { query, active } = toggleSchema.parse(req.body);
    const raw = await fs.readFile(configPath, "utf8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const paused = (config.pausedQueries as string[] | undefined) ?? [];
    const pausedQueries = active
      ? paused.filter((q) => q !== query)
      : [...new Set([...paused, query])];
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ ...config, pausedQueries }, null, 2)}\n`,
      "utf8",
    );
    res.json({ ok: true, query, active });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid payload.", issues: error.issues });
      return;
    }
    sendApiError(res, 500, "Failed to toggle prompt.", error);
  }
});

app.post("/api/prompt-lab/run", requireWriteAccess, async (req, res) => {
  try {
    const parsed = promptLabRunSchema.parse(req.body ?? {});
    const query = parsed.query.trim();
    if (!query) {
      res.status(400).json({ error: "query is required." });
      return;
    }
    const allowedModels = getPromptLabAllowedModels();
    const requestedModel =
      typeof parsed.model === "string" && parsed.model.trim()
        ? parsed.model.trim()
        : PROMPT_LAB_DEFAULT_MODEL;
    const model = resolvePromptLabModel(requestedModel, allowedModels);
    const webSearch = parsed.webSearch ?? true;
    const startedAt = Date.now();

    const result = await runPromptLabQuery(query, model, webSearch);
    res.json({
      ok: true,
      query,
      model,
      webSearchEnabled: webSearch,
      responseText: result.responseText,
      citations: result.citations,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid payload.", issues: error.issues });
      return;
    }

    const statusCode =
      typeof error === "object" && error !== null && Number((error as { statusCode?: number }).statusCode)
        ? Number((error as { statusCode?: number }).statusCode)
        : 500;
    if (statusCode >= 500) {
      sendApiError(res, statusCode, "Prompt lab run failed.", error);
      return;
    }
    res
      .status(statusCode)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/dashboard", async (_req, res) => {
  try {
    const [config, comparisonRows, competitorRows, kpiRows, jsonlRows] = await Promise.all([
      loadConfig(),
      readCsv(dashboardFiles.comparison),
      readCsv(dashboardFiles.competitorChart),
      readCsv(dashboardFiles.kpi),
      readJsonl(dashboardFiles.jsonl),
    ]);

    const overallRow = comparisonRows.find((row) => row.query === "OVERALL") ?? null;
    const queryRows = comparisonRows.filter((row) => row.query !== "OVERALL");
    const kpi = kpiRows[0] ?? null;

    const inferredWindow = inferWindowFromJsonl(jsonlRows);
    const entityKeys = overallRow
      ? Object.keys(overallRow)
          .filter((column) => column.endsWith("_rate"))
          .map((column) => column.replace(/_rate$/, ""))
          .filter((key) => !key.startsWith("viability_index"))
          .filter((key) => key !== "our_brand")
      : config.competitors.map(slugifyEntity);

    const overallCompetitorRows = competitorRows.filter(
      (row) => asYesNo(row.is_overall_row) === "yes",
    );

    const competitorSeries =
      overallCompetitorRows.length > 0
        ? overallCompetitorRows.map((row) => ({
            entity: row.entity,
            entityKey: row.entity_key,
            isHighcharts: asYesNo(row.is_highcharts) === "yes",
            mentionRatePct: Number((asNumber(row.mentions_rate) * 100).toFixed(2)),
            shareOfVoicePct: Number(
              (
                asNumber(row.share_of_voice_rate_pct) ||
                asNumber(row.share_of_voice_rate) * 100
              ).toFixed(2),
            ),
          }))
        : entityKeys.map((entityKey) => ({
            entity: config.competitors.find((name) => slugifyEntity(name) === entityKey) ?? entityKey,
            entityKey,
            isHighcharts: entityKey === "highcharts",
            mentionRatePct: Number((asNumber(overallRow?.[`${entityKey}_rate`]) * 100).toFixed(2)),
            shareOfVoicePct: 0,
          }));

    const promptLookup = new Map(queryRows.map((row) => [row.query, row]));
    const queryTags = normalizeQueryTagsMap(config.queries, config.queryTags);

    const pausedSet = new Set(config.pausedQueries ?? []);
    const promptStatus = config.queries.map((query) => {
      const row = promptLookup.get(query);
      const latestRunResponseCount = inferPromptResponseCount(row, config.competitors);

      const competitorRatesAll = config.competitors.map((name) => {
        const entityKey = slugifyEntity(name);
        return {
          entity: name,
          entityKey,
          isHighcharts: name.toLowerCase() === "highcharts",
          mentions: asNumber(row?.[`${entityKey}_count`]),
          ratePct: Number((asNumber(row?.[`${entityKey}_rate`]) * 100).toFixed(2)),
        };
      });

      const highchartsRatePct =
        competitorRatesAll.find((entry) => entry.isHighcharts)?.ratePct ?? 0;
      const competitorRates = competitorRatesAll.filter((entry) => !entry.isHighcharts);
      const highchartsRank = row
        ? competitorRatesAll
            .slice()
            .sort((a, b) => {
              if (b.ratePct !== a.ratePct) {
                return b.ratePct - a.ratePct;
              }
              return a.entity.localeCompare(b.entity);
            })
            .findIndex((entry) => entry.isHighcharts) + 1
        : null;
      const topCompetitor = competitorRates
        .slice()
        .sort((a, b) => b.ratePct - a.ratePct)
        .at(0) ?? null;

      return {
        query,
        tags: queryTags[query] ?? inferPromptTags(query),
        isPaused: pausedSet.has(query),
        status: row ? "tracked" : "awaiting_run",
        runs: asNumber(row?.runs),
        highchartsRatePct,
        highchartsRank: highchartsRank && highchartsRank > 0 ? highchartsRank : null,
        highchartsRankOutOf: config.competitors.length,
        viabilityRatePct: Number((asNumber(row?.viability_index_rate) * 100).toFixed(2)),
        topCompetitor,
        latestRunResponseCount,
        competitorRates: competitorRatesAll.map((entry) => ({
          entity: entry.entity,
          entityKey: entry.entityKey,
          isHighcharts: entry.isHighcharts,
          ratePct: entry.ratePct,
          mentions: entry.mentions,
        })),
      };
    });

    const models = kpi ? splitCsvish(kpi.models) : inferredWindow.models;
    const windowStartUtc = kpi?.window_start_utc ?? inferredWindow.start;
    const windowEndUtc = kpi?.window_end_utc ?? inferredWindow.end;

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        overallScore: Number(asNumber(kpi?.ai_visibility_overall_score).toFixed(2)),
        queryCount: config.queries.length,
        competitorCount: config.competitors.length,
        totalResponses: jsonlRows.length,
        models,
        runMonth: kpi?.run_month ?? null,
        webSearchEnabled: kpi?.web_search_enabled ?? null,
        windowStartUtc,
        windowEndUtc,
      },
      kpi,
      competitorSeries,
      promptStatus,
      comparisonRows: queryRows,
      files: {
        comparisonTablePresent: comparisonRows.length > 0,
        competitorChartPresent: competitorRows.length > 0,
        kpiPresent: kpi !== null,
        llmOutputsPresent: jsonlRows.length > 0,
      },
    });
  } catch (error) {
    sendApiError(res, 500, "Unable to build dashboard response.", error);
  }
});

app.get("/api/timeseries", async (req, res) => {
  try {
    const [config, jsonlRows] = await Promise.all([
      loadConfig(),
      readJsonl(dashboardFiles.jsonl),
    ]);

    const selectedTags = normalizeSelectedTags(req.query.tags);
    const selectedTagSet = new Set(selectedTags);
    const tagFilterMode: "any" | "all" =
      String(req.query.mode ?? "any").toLowerCase() === "all" ? "all" : "any";
    const shouldFilterByTags = selectedTagSet.size > 0;
    const queryTags = normalizeQueryTagsMap(config.queries, config.queryTags);
    const tagsByQuery = new Map(
      Object.entries(queryTags).map(([query, tags]) => [query.trim().toLowerCase(), tags]),
    );

    if (jsonlRows.length === 0) {
      res.json({ ok: true, competitors: config.competitors, points: [] });
      return;
    }

    // Build per-competitor alias patterns (lowercase)
    const competitorPatterns = config.competitors.map((name) => ({
      name,
      patterns: uniqueNonEmpty([name, ...(config.aliases[name] ?? [])]).map((a) =>
        a.toLowerCase(),
      ),
      mentionKeys: uniqueNonEmpty([slugifyEntity(name)]),
    }));

    type DayBucket = { total: number; mentions: Record<string, number> };
    const byDate = new Map<string, DayBucket>();

    for (const row of jsonlRows) {
      if (shouldFilterByTags) {
        const queryText = String(
          row.query ?? row.query_text ?? row.prompt ?? row.prompt_text ?? "",
        ).trim();
        if (!queryText) {
          continue;
        }

        const promptTags = tagsByQuery.get(queryText.toLowerCase()) ?? inferPromptTags(queryText);
        if (!promptMatchesTagFilter(promptTags, selectedTagSet, tagFilterMode)) {
          continue;
        }
      }

      const ts = String(row.timestamp ?? "");
      const date = ts.length >= 10 ? ts.slice(0, 10) : null;
      if (!date) continue;

      const mentionMap =
        typeof row.mentions === "object" && row.mentions !== null && !Array.isArray(row.mentions)
          ? (row.mentions as Record<string, unknown>)
          : null;

      // Try various field names for the raw LLM response text
      const responseText = String(
        row.response_text ??
          row.response ??
          row.text ??
          row.content ??
          row.completion ??
          row.output ??
          "",
      ).toLowerCase();

      const entry = byDate.get(date) ?? { total: 0, mentions: {} };
      entry.total++;

      for (const { name, patterns, mentionKeys } of competitorPatterns) {
        const mentionedFromMap = mentionMap
          ? mentionKeys.some((key) => isTruthyFlag(mentionMap[key]))
          : false;
        const mentionedFromText = patterns.some((p) => responseText.includes(p));
        if (mentionedFromMap || (!mentionMap && mentionedFromText)) {
          entry.mentions[name] = (entry.mentions[name] ?? 0) + 1;
        }
      }

      byDate.set(date, entry);
    }

    const points = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { total, mentions }]) => ({
        date,
        total,
        rates: Object.fromEntries(
          config.competitors.map((name) => [
            name,
            total > 0 ? Number((((mentions[name] ?? 0) / total) * 100).toFixed(2)) : 0,
          ]),
        ),
      }));

    res.json({ ok: true, competitors: config.competitors, points });
  } catch (error) {
    sendApiError(res, 500, "Failed to build time series.", error);
  }
});

const port = Number(process.env.API_PORT ?? 8787);
app.listen(port, () => {
  console.log(`[ui-api] listening on http://localhost:${port}`);
});
