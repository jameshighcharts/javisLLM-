import cors from "cors";
import { parse } from "csv-parse/sync";
import express from "express";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

type CsvRow = Record<string, string>;

type BenchmarkConfig = {
  queries: string[];
  queryTags: Record<string, string[]>;
  competitors: string[];
  aliases: Record<string, string[]>;
  pausedQueries: string[];
};

type UnderTheHoodRange = "1d" | "7d" | "30d" | "all";

type MvRunSummaryRow = {
  run_id: string;
  run_month: string | null;
  model: string | null;
  models?: string[] | string | null;
  models_csv?: string | null;
  model_owners?: string[] | string | null;
  model_owners_csv?: string | null;
  model_owner_map?: string | null;
  web_search_enabled: boolean | null;
  overall_score: number | null;
  created_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  response_count: number | null;
  query_count: number | null;
  competitor_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  total_duration_ms: number | null;
  avg_duration_ms: number | null;
};

type MvModelPerformanceRow = {
  run_id: string;
  model: string;
  owner: string;
  response_count: number | null;
  success_count: number | null;
  failure_count: number | null;
  web_search_enabled_count: number | null;
  total_duration_ms: number | null;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_tokens: number | null;
  avg_input_tokens: number | null;
  avg_output_tokens: number | null;
  avg_total_tokens: number | null;
};

type MvCompetitorMentionRateRow = {
  run_id: string;
  query_id: string | null;
  query_key: string;
  query_text: string;
  competitor_id: string;
  entity: string;
  entity_key: string;
  is_highcharts: boolean;
  is_overall_row: boolean;
  response_count: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  total_duration_ms?: number | null;
  mentions_count: number | null;
  mentions_rate_pct: number | null;
  share_of_voice_rate_pct: number | null;
};

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serverDir, "..", "..");
const configPath = path.join(repoRoot, "config", "benchmark_config.json");
const outputDir = path.join(repoRoot, "output");
const SUPABASE_PAGE_SIZE = 1000;
const DASHBOARD_RECENT_RUN_SCAN_LIMIT = 25;
const localEnvPaths = [
  path.join(repoRoot, ".env.monthly"),
  path.join(repoRoot, ".env"),
  path.join(repoRoot, "ui", ".env.local"),
];

function loadLocalEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const separatorIndex = withoutExport.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) {
      continue;
    }

    let value = withoutExport.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

for (const envPath of localEnvPaths) {
  loadLocalEnvFile(envPath);
}

const DASHBOARD_SOURCE = String(process.env.DASHBOARD_SOURCE ?? "csv")
  .trim()
  .toLowerCase();
const SUPABASE_URL = String(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
).trim();
const SUPABASE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    "",
).trim();
const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

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
const PROMPT_LAB_DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const PROMPT_LAB_DEFAULT_CLAUDE_OPUS_MODEL = "claude-opus-4-5-20251101";
const PROMPT_LAB_DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const PROMPT_LAB_MODEL_ALIASES: Record<string, string> = {
  "claude-3-5-sonnet-latest": PROMPT_LAB_DEFAULT_CLAUDE_MODEL,
  "claude-4-6-sonnet-latest": PROMPT_LAB_DEFAULT_CLAUDE_MODEL,
  "claude-sonnet-4-6": PROMPT_LAB_DEFAULT_CLAUDE_MODEL,
  "claude-4-6-opus-latest": PROMPT_LAB_DEFAULT_CLAUDE_OPUS_MODEL,
  "claude-opus-4-6": PROMPT_LAB_DEFAULT_CLAUDE_OPUS_MODEL,
  "gemini-3.0-flash": PROMPT_LAB_DEFAULT_GEMINI_MODEL,
  "gemini-3-flash-preview": PROMPT_LAB_DEFAULT_GEMINI_MODEL,
};
const PROMPT_LAB_FALLBACK_MODELS = [
  PROMPT_LAB_DEFAULT_MODEL,
  "gpt-4o",
  "gpt-5.2",
  PROMPT_LAB_DEFAULT_CLAUDE_MODEL,
  PROMPT_LAB_DEFAULT_CLAUDE_OPUS_MODEL,
  PROMPT_LAB_DEFAULT_GEMINI_MODEL,
];
const PROMPT_LAB_SYSTEM_PROMPT =
  "You are a helpful assistant. Answer with concise bullets and include direct library names.";
const PROMPT_LAB_USER_PROMPT_TEMPLATE =
  "Query: {query}\nList relevant libraries/tools with a short rationale for each in bullet points.";
const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const ANTHROPIC_MESSAGES_API_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_GENERATE_CONTENT_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const ANTHROPIC_API_VERSION = "2023-06-01";

const promptLabRunSchema = z.object({
  query: z.string().min(1).max(600),
  model: z.string().min(1).max(100).optional(),
  models: z.union([z.array(z.string().min(1).max(100)).max(32), z.string().max(2000)]).optional(),
  selectAllModels: z.boolean().optional(),
  webSearch: z.boolean().optional(),
});

type HttpError = Error & {
  statusCode?: number;
  exposeMessage?: boolean;
};

type PromptLabProvider = "openai" | "anthropic" | "google";

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
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const UNDER_THE_HOOD_RANGE_OPTIONS: UnderTheHoodRange[] = ["1d", "7d", "30d", "all"];

function normalizeUnderTheHoodRange(value: unknown): UnderTheHoodRange {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase() as UnderTheHoodRange;
  return UNDER_THE_HOOD_RANGE_OPTIONS.includes(normalized) ? normalized : "all";
}

function rangeLabelForUnderTheHood(range: UnderTheHoodRange): string {
  if (range === "1d") return "Last 1 day";
  if (range === "7d") return "Last 7 days";
  if (range === "30d") return "Last 30 days";
  return "All time";
}

function rangeStartMsForUnderTheHood(range: UnderTheHoodRange, nowMs: number): number | null {
  if (range === "1d") return nowMs - 24 * 60 * 60 * 1000;
  if (range === "7d") return nowMs - 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return nowMs - 30 * 24 * 60 * 60 * 1000;
  return null;
}

function timestampMs(value: unknown): number | null {
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

type ModelPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

const MODEL_PRICING_BY_MODEL: Record<string, ModelPricing> = {
  "gpt-5.2": { inputUsdPerMillion: 1.75, outputUsdPerMillion: 14 },
  "gpt-4o": { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 },
  "gpt-4o-mini": { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 },
  "claude-sonnet-4-5-20250929": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  "claude-opus-4-1-20250805": { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  "claude-opus-4-20250514": { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  "gemini-2.5-flash": { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
};

const MODEL_PRICING_FAMILY_RULES: Array<{
  test: (normalizedModel: string) => boolean;
  pricing: ModelPricing;
}> = [
  {
    test: (model) => model === "gpt-5.2" || model.startsWith("gpt-5.2-"),
    pricing: MODEL_PRICING_BY_MODEL["gpt-5.2"],
  },
  {
    test: (model) => model === "gpt-4o",
    pricing: MODEL_PRICING_BY_MODEL["gpt-4o"],
  },
  {
    test: (model) => model === "gpt-4o-mini" || model.startsWith("gpt-4o-mini-"),
    pricing: MODEL_PRICING_BY_MODEL["gpt-4o-mini"],
  },
  {
    test: (model) => model === "claude-sonnet-4-5" || model.startsWith("claude-sonnet-4-5-"),
    pricing: MODEL_PRICING_BY_MODEL["claude-sonnet-4-5-20250929"],
  },
  {
    test: (model) => model === "claude-sonnet-4" || model.startsWith("claude-sonnet-4-"),
    pricing: MODEL_PRICING_BY_MODEL["claude-sonnet-4-5-20250929"],
  },
  {
    test: (model) => model.startsWith("claude-opus-4-5"),
    pricing: MODEL_PRICING_BY_MODEL["claude-opus-4-1-20250805"],
  },
  {
    test: (model) => model === "claude-opus-4-1" || model.startsWith("claude-opus-4-1-"),
    pricing: MODEL_PRICING_BY_MODEL["claude-opus-4-1-20250805"],
  },
  {
    test: (model) => model === "claude-opus-4" || model.startsWith("claude-opus-4-"),
    pricing: MODEL_PRICING_BY_MODEL["claude-opus-4-20250514"],
  },
  {
    test: (model) => model === "gemini-2.5-flash" || model.startsWith("gemini-2.5-flash-"),
    pricing: MODEL_PRICING_BY_MODEL["gemini-2.5-flash"],
  },
];

function safeTokenInt(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(0, Math.round(parsed));
}

function resolveModelPricingForServer(model: string): ModelPricing | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  const exact = MODEL_PRICING_BY_MODEL[normalized];
  if (exact) return exact;
  const familyMatch = MODEL_PRICING_FAMILY_RULES.find((rule) => rule.test(normalized));
  return familyMatch?.pricing ?? null;
}

function estimateResponseCostForServer(
  model: string,
  inputTokens: number,
  outputTokens: number,
): {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  priced: boolean;
} {
  const pricing = resolveModelPricingForServer(model);
  if (!pricing) {
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, priced: false };
  }
  const inputCostUsd = (inputTokens / 1_000_000) * pricing.inputUsdPerMillion;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    priced: true,
  };
}

function inferModelOwnerFromModel(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return "Unknown";
  if (
    normalized.startsWith("gpt") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("openai/")
  ) {
    return "OpenAI";
  }
  if (normalized.startsWith("claude") || normalized.startsWith("anthropic/")) {
    return "Anthropic";
  }
  if (normalized.startsWith("gemini") || normalized.startsWith("google/")) {
    return "Google";
  }
  return "Unknown";
}

function parseModelOwnerMap(rawValue: string): Record<string, string> {
  const entries = rawValue
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const parsed: Record<string, string> = {};
  for (const entry of entries) {
    const separatorIndex = entry.includes("=>") ? entry.indexOf("=>") : entry.indexOf(":");
    if (separatorIndex < 0) continue;
    const model = entry.slice(0, separatorIndex).trim();
    const owner = entry.slice(separatorIndex + (entry.includes("=>") ? 2 : 1)).trim();
    if (!model || !owner) continue;
    parsed[model] = owner;
  }
  return parsed;
}

function buildModelOwnerSummaryFromRows(rows: Array<Record<string, unknown>>): {
  modelOwners: string[];
  modelOwnerMap: Record<string, string>;
  modelOwnerStats: Array<{ owner: string; models: string[]; responseCount: number }>;
} {
  const ownerByModel = new Map<string, string>();
  const countByOwner = new Map<string, number>();
  const modelsByOwner = new Map<string, Set<string>>();

  for (const row of rows) {
    const model = String(row.model ?? "").trim();
    if (!model) continue;
    const rowOwner = String(row.model_owner ?? "").trim();
    const owner = rowOwner || inferModelOwnerFromModel(model);
    ownerByModel.set(model, owner);
    countByOwner.set(owner, (countByOwner.get(owner) ?? 0) + 1);
    const ownerModels = modelsByOwner.get(owner) ?? new Set<string>();
    ownerModels.add(model);
    modelsByOwner.set(owner, ownerModels);
  }

  const modelOwners = [...new Set(ownerByModel.values())].sort((a, b) =>
    a.localeCompare(b),
  );
  const modelOwnerMap = Object.fromEntries(
    [...ownerByModel.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  const modelOwnerStats = [...countByOwner.entries()]
    .map(([owner, responseCount]) => ({
      owner,
      models: [...(modelsByOwner.get(owner) ?? new Set<string>())].sort((a, b) =>
        a.localeCompare(b),
      ),
      responseCount,
    }))
    .sort((left, right) => {
      if (right.responseCount !== left.responseCount) {
        return right.responseCount - left.responseCount;
      }
      return left.owner.localeCompare(right.owner);
    });

  return { modelOwners, modelOwnerMap, modelOwnerStats };
}

function normalizePromptLabModelAlias(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  return PROMPT_LAB_MODEL_ALIASES[normalized.toLowerCase()] ?? normalized;
}

function normalizePromptLabModelList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizePromptLabModelAlias(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function getPromptLabAllowedModels(): string[] {
  const configured = String(process.env.BENCHMARK_ALLOWED_MODELS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return normalizePromptLabModelList(
    configured.length > 0 ? configured : PROMPT_LAB_FALLBACK_MODELS,
  );
}

function resolvePromptLabModel(modelInput: string, allowedModels: string[]): string {
  const normalizedMap = new Map(allowedModels.map((name) => [name.toLowerCase(), name]));
  const resolved = normalizedMap.get(normalizePromptLabModelAlias(modelInput).toLowerCase());
  if (!resolved) {
    const error = new Error(
      `Unsupported model "${modelInput}". Allowed models: ${allowedModels.join(", ")}`,
    ) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

function parsePromptLabRequestedModels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function resolvePromptLabModels(
  payload: { model?: string; models?: unknown; selectAllModels?: boolean },
  allowedModels: string[],
): string[] {
  const shouldSelectAll = payload.selectAllModels === true;
  let candidates = shouldSelectAll
    ? allowedModels
    : parsePromptLabRequestedModels(payload.models);

  if (candidates.length === 0 && typeof payload.model === "string" && payload.model.trim()) {
    candidates = [payload.model.trim()];
  }
  if (candidates.length === 0) {
    candidates = [PROMPT_LAB_DEFAULT_MODEL];
  }

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const model = resolvePromptLabModel(candidate, allowedModels);
    const key = model.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(model);
  }
  return resolved;
}

function inferPromptLabProvider(modelInput: string): PromptLabProvider {
  const normalized = modelInput.trim().toLowerCase();
  if (normalized.startsWith("claude") || normalized.startsWith("anthropic/")) {
    return "anthropic";
  }
  if (normalized.startsWith("gemini") || normalized.startsWith("google/")) {
    return "google";
  }
  return "openai";
}

function resolvePromptLabApiKey(provider: PromptLabProvider): string {
  const keyName =
    provider === "anthropic"
      ? "ANTHROPIC_API_KEY"
      : provider === "google"
        ? "GEMINI_API_KEY"
        : "OPENAI_API_KEY";
  const apiKey = String(process.env[keyName] ?? "").trim();
  if (!apiKey) {
    const error = new Error(
      `Prompt lab is not configured. Set ${keyName} on the server.`,
    ) as HttpError;
    error.statusCode = 503;
    error.exposeMessage = true;
    throw error;
  }
  return apiKey;
}

function resolvePromptLabModelOwner(provider: PromptLabProvider): string {
  if (provider === "anthropic") return "Anthropic";
  if (provider === "google") return "Google";
  if (provider === "openai") return "OpenAI";
  return "Unknown";
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

  const contentItems = Array.isArray(responsePayload.content) ? responsePayload.content : [];
  for (const content of contentItems) {
    if (!content || typeof content !== "object") {
      continue;
    }
    const text = (content as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) {
      texts.push(text.trim());
    }
  }

  const candidates = Array.isArray(responsePayload.candidates) ? responsePayload.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") {
      continue;
    }
    const parts = Array.isArray((content as { parts?: unknown }).parts)
      ? (content as { parts: unknown[] }).parts
      : [];
    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const text = (part as { text?: unknown }).text;
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

  const contentItems = Array.isArray(responsePayload.content) ? responsePayload.content : [];
  for (const content of contentItems) {
    if (!content || typeof content !== "object") continue;
    const contentCitations = (content as { citations?: unknown }).citations;
    if (Array.isArray(contentCitations)) {
      for (const citation of contentCitations) {
        appendCitation(citation);
      }
    }
  }

  const candidates = Array.isArray(responsePayload.candidates) ? responsePayload.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const grounding = (candidate as { groundingMetadata?: unknown }).groundingMetadata;
    if (!grounding || typeof grounding !== "object") continue;

    const chunks = Array.isArray((grounding as { groundingChunks?: unknown }).groundingChunks)
      ? (grounding as { groundingChunks: unknown[] }).groundingChunks
      : [];
    for (const chunk of chunks) {
      if (!chunk || typeof chunk !== "object") continue;
      appendCitation(chunk);
      const web = (chunk as { web?: unknown }).web;
      appendCitation(web);
    }

    const citationSources = Array.isArray(
      (grounding as { citationMetadata?: { citationSources?: unknown } }).citationMetadata
        ?.citationSources,
    )
      ? ((grounding as { citationMetadata?: { citationSources?: unknown[] } }).citationMetadata
          ?.citationSources as unknown[])
      : [];
    for (const source of citationSources) {
      appendCitation(source);
    }
  }

  return citations;
}

function toNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

function extractPromptLabTokenUsage(responsePayload: Record<string, unknown>): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const usage =
    typeof responsePayload.usage === "object" && responsePayload.usage !== null
      ? (responsePayload.usage as Record<string, unknown>)
      : {};
  const usageMetadata =
    typeof responsePayload.usageMetadata === "object" && responsePayload.usageMetadata !== null
      ? (responsePayload.usageMetadata as Record<string, unknown>)
      : {};

  const inputTokens = Math.max(
    toNonNegativeInt(usage.input_tokens),
    toNonNegativeInt(usage.prompt_tokens),
    toNonNegativeInt(usageMetadata.promptTokenCount),
    toNonNegativeInt(usageMetadata.prompt_tokens),
  );
  const outputTokens = Math.max(
    toNonNegativeInt(usage.output_tokens),
    toNonNegativeInt(usage.completion_tokens),
    toNonNegativeInt(usageMetadata.candidatesTokenCount),
    toNonNegativeInt(usageMetadata.completion_tokens),
  );
  const totalTokens =
    Math.max(
      toNonNegativeInt(usage.total_tokens),
      toNonNegativeInt(usageMetadata.totalTokenCount),
      toNonNegativeInt(usageMetadata.total_tokens),
    ) || inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

async function runOpenAiPromptLabQuery(
  query: string,
  model: string,
  webSearch: boolean,
): Promise<{
  responseText: string;
  citations: string[];
  tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
}> {
  const apiKey = resolvePromptLabApiKey("openai");

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
    tokens: extractPromptLabTokenUsage(responsePayload),
  };
}

async function runAnthropicPromptLabQuery(
  query: string,
  model: string,
): Promise<{
  responseText: string;
  citations: string[];
  tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
}> {
  const apiKey = resolvePromptLabApiKey("anthropic");

  const body: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    temperature: 0.7,
    system: PROMPT_LAB_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: PROMPT_LAB_USER_PROMPT_TEMPLATE.replace("{query}", query),
      },
    ],
  };

  const upstreamResponse = await fetch(ANTHROPIC_MESSAGES_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
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
        : `Anthropic request failed (${upstreamResponse.status}).`;
    const error = new Error(upstreamMessage) as Error & { statusCode?: number };
    error.statusCode = upstreamResponse.status >= 500 ? 502 : upstreamResponse.status;
    throw error;
  }

  const responsePayload =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

  return {
    responseText: extractPromptLabResponseText(responsePayload),
    citations: extractPromptLabCitations(responsePayload),
    tokens: extractPromptLabTokenUsage(responsePayload),
  };
}

async function runGeminiPromptLabQuery(
  query: string,
  model: string,
): Promise<{
  responseText: string;
  citations: string[];
  tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
}> {
  const apiKey = resolvePromptLabApiKey("google");
  const modelPath = encodeURIComponent(model);
  const url =
    `${GEMINI_GENERATE_CONTENT_API_ROOT}/${modelPath}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: PROMPT_LAB_SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ text: PROMPT_LAB_USER_PROMPT_TEMPLATE.replace("{query}", query) }],
      },
    ],
    generationConfig: { temperature: 0.7 },
  };

  const upstreamResponse = await fetch(url, {
    method: "POST",
    headers: {
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
        : `Gemini request failed (${upstreamResponse.status}).`;
    const error = new Error(upstreamMessage) as Error & { statusCode?: number };
    error.statusCode = upstreamResponse.status >= 500 ? 502 : upstreamResponse.status;
    throw error;
  }

  const responsePayload =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

  return {
    responseText: extractPromptLabResponseText(responsePayload),
    citations: extractPromptLabCitations(responsePayload),
    tokens: extractPromptLabTokenUsage(responsePayload),
  };
}

async function runPromptLabQuery(
  query: string,
  model: string,
  webSearch: boolean,
): Promise<{
  responseText: string;
  citations: string[];
  tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
}> {
  const provider = inferPromptLabProvider(model);
  if (provider === "anthropic") {
    return runAnthropicPromptLabQuery(query, model);
  }
  if (provider === "google") {
    return runGeminiPromptLabQuery(query, model);
  }
  return runOpenAiPromptLabQuery(query, model, webSearch);
}

async function runPromptLabQueryForModel(
  query: string,
  model: string,
  requestedWebSearch: boolean,
): Promise<{
  ok: boolean;
  model: string;
  provider: PromptLabProvider;
  modelOwner: string;
  webSearchEnabled: boolean;
  responseText: string;
  citations: string[];
  tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
  durationMs: number;
  error: string | null;
}> {
  const provider = inferPromptLabProvider(model);
  const modelOwner = resolvePromptLabModelOwner(provider);
  const webSearchEnabled = provider === "openai" ? requestedWebSearch : false;
  const startedAt = Date.now();

  try {
    const result = await runPromptLabQuery(query, model, webSearchEnabled);
    return {
      ok: true,
      model,
      provider,
      modelOwner,
      webSearchEnabled,
      responseText: result.responseText,
      citations: result.citations,
      tokens: result.tokens,
      durationMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      model,
      provider,
      modelOwner,
      webSearchEnabled,
      responseText: "",
      citations: [],
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizePromptLabModelResults(
  results: Array<{
    ok: boolean;
    durationMs: number;
    tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>,
): {
  modelCount: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
} {
  return results.reduce(
    (summary, result) => {
      summary.modelCount += 1;
      if (result.ok) {
        summary.successCount += 1;
      } else {
        summary.failureCount += 1;
      }
      summary.totalDurationMs += Math.max(0, Math.round(result.durationMs));
      summary.totalInputTokens += Math.max(0, Math.round(result.tokens.inputTokens));
      summary.totalOutputTokens += Math.max(0, Math.round(result.tokens.outputTokens));
      summary.totalTokens += Math.max(0, Math.round(result.tokens.totalTokens));
      return summary;
    },
    {
      modelCount: 0,
      successCount: 0,
      failureCount: 0,
      totalDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    },
  );
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

type DashboardModelStat = {
  model: string;
  owner: string;
  responseCount: number;
  successCount: number;
  failureCount: number;
  webSearchEnabledCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p95DurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
};

function percentile(values: number[], target: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const clampedTarget = Math.max(0, Math.min(1, target));
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(clampedTarget * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function buildModelStatsFromRows(rows: Array<Record<string, unknown>>): {
  modelStats: DashboardModelStat[];
  tokenTotals: { inputTokens: number; outputTokens: number; totalTokens: number };
  durationTotals: { totalDurationMs: number; avgDurationMs: number };
} {
  const byModel = new Map<
    string,
    {
      owner: string;
      responseCount: number;
      successCount: number;
      failureCount: number;
      webSearchEnabledCount: number;
      durations: number[];
      totalDurationMs: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
    }
  >();

  let totalDurationMs = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;

  for (const row of rows) {
    const model = String(row.model ?? "").trim();
    if (!model) continue;

    const owner = String(row.model_owner ?? "").trim() || inferModelOwnerFromModel(model);
    const durationMs = Math.max(0, Math.round(asNumber(row.duration_ms)));
    const inputTokens = Math.max(0, Math.round(asNumber(row.prompt_tokens)));
    const outputTokens = Math.max(0, Math.round(asNumber(row.completion_tokens)));
    const rowTotalTokens = Math.max(
      0,
      Math.round(asNumber(row.total_tokens) || inputTokens + outputTokens),
    );
    const hasError = Boolean(String(row.error ?? "").trim());
    const webEnabled = isTruthyFlag(row.web_search_enabled);

    let bucket = byModel.get(model);
    if (!bucket) {
      bucket = {
        owner,
        responseCount: 0,
        successCount: 0,
        failureCount: 0,
        webSearchEnabledCount: 0,
        durations: [],
        totalDurationMs: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      };
      byModel.set(model, bucket);
    }

    bucket.responseCount += 1;
    if (hasError) {
      bucket.failureCount += 1;
    } else {
      bucket.successCount += 1;
    }
    if (webEnabled) {
      bucket.webSearchEnabledCount += 1;
    }
    bucket.durations.push(durationMs);
    bucket.totalDurationMs += durationMs;
    bucket.totalInputTokens += inputTokens;
    bucket.totalOutputTokens += outputTokens;
    bucket.totalTokens += rowTotalTokens;

    totalDurationMs += durationMs;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalTokens += rowTotalTokens;
  }

  const modelStats = [...byModel.entries()]
    .map(([model, bucket]) => {
      const responseCount = bucket.responseCount;
      return {
        model,
        owner: bucket.owner,
        responseCount,
        successCount: bucket.successCount,
        failureCount: bucket.failureCount,
        webSearchEnabledCount: bucket.webSearchEnabledCount,
        totalDurationMs: bucket.totalDurationMs,
        avgDurationMs:
          responseCount > 0
            ? Number((bucket.totalDurationMs / responseCount).toFixed(2))
            : 0,
        p95DurationMs: Number(percentile(bucket.durations, 0.95).toFixed(2)),
        totalInputTokens: bucket.totalInputTokens,
        totalOutputTokens: bucket.totalOutputTokens,
        totalTokens: bucket.totalTokens,
        avgInputTokens:
          responseCount > 0
            ? Number((bucket.totalInputTokens / responseCount).toFixed(2))
            : 0,
        avgOutputTokens:
          responseCount > 0
            ? Number((bucket.totalOutputTokens / responseCount).toFixed(2))
            : 0,
        avgTotalTokens:
          responseCount > 0
            ? Number((bucket.totalTokens / responseCount).toFixed(2))
            : 0,
      };
    })
    .sort((left, right) => {
      if (right.responseCount !== left.responseCount) {
        return right.responseCount - left.responseCount;
      }
      return left.model.localeCompare(right.model);
    });

  return {
    modelStats,
    tokenTotals: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
    },
    durationTotals: {
      totalDurationMs,
      avgDurationMs:
        rows.length > 0 ? Number((totalDurationMs / rows.length).toFixed(2)) : 0,
    },
  };
}

function inferWindowFromJsonl(rows: Array<Record<string, unknown>>): {
  start: string | null;
  end: string | null;
  models: string[];
  modelOwners: string[];
  modelOwnerMap: Record<string, string>;
  modelOwnerStats: Array<{ owner: string; models: string[]; responseCount: number }>;
  modelStats: DashboardModelStat[];
  tokenTotals: { inputTokens: number; outputTokens: number; totalTokens: number };
  durationTotals: { totalDurationMs: number; avgDurationMs: number };
} {
  const timestamps = rows
    .map((row) => String(row.timestamp ?? ""))
    .filter(Boolean)
    .sort();
  const models = [...new Set(rows.map((row) => String(row.model ?? "")).filter(Boolean))];
  const ownerSummary = buildModelOwnerSummaryFromRows(rows);
  const modelStatsSummary = buildModelStatsFromRows(rows);
  return {
    start: timestamps[0] ?? null,
    end: timestamps.at(-1) ?? null,
    models,
    modelOwners: ownerSummary.modelOwners,
    modelOwnerMap: ownerSummary.modelOwnerMap,
    modelOwnerStats: ownerSummary.modelOwnerStats,
    modelStats: modelStatsSummary.modelStats,
    tokenTotals: modelStatsSummary.tokenTotals,
    durationTotals: modelStatsSummary.durationTotals,
  };
}

function shouldUseSupabaseDashboardSource(): boolean {
  return DASHBOARD_SOURCE === "supabase";
}

function requireSupabaseClient() {
  if (!supabase) {
    throw new Error(
      "DASHBOARD_SOURCE=supabase requires SUPABASE_URL and a Supabase key (service role or anon).",
    );
  }
  return supabase;
}

function isMissingRelation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: string }).code;
  return code === "42P01";
}

function isMissingColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: string }).code;
  if (code === "42703" || code === "PGRST204") {
    return true;
  }
  const message = String((error as { message?: string }).message ?? "").toLowerCase();
  return (
    message.includes("could not find the") &&
    message.includes("column") &&
    message.includes("schema cache")
  );
}

function asError(error: unknown, context: string): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) {
      return new Error(`${context}: ${message}`);
    }
  }
  return new Error(`${context}: ${String(error)}`);
}

function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function hasRunResponses(responseCount: unknown): boolean {
  return Math.max(0, Math.round(asNumber(responseCount))) > 0;
}

function selectDashboardRun<T extends { response_count: number | null; ended_at: string | null }>(
  runs: T[],
): T | null {
  if (runs.length === 0) return null;

  const completedWithResponses = runs.find(
    (run) => hasRunResponses(run.response_count) && Boolean(String(run.ended_at ?? "").trim()),
  );
  if (completedWithResponses) return completedWithResponses;

  const withResponses = runs.find((run) => hasRunResponses(run.response_count));
  if (withResponses) return withResponses;

  return runs[0];
}

function parseSupabaseList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueNonEmpty(value.map((item) => String(item ?? "")));
  }
  if (typeof value === "string") {
    return uniqueNonEmpty(value.split(",").map((item) => item.trim()));
  }
  return [];
}

function pickTimestamp(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) continue;
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return null;
}

function resolveRunModels(row: MvRunSummaryRow): string[] {
  if (Array.isArray(row.models)) {
    const fromArray = parseSupabaseList(row.models);
    if (fromArray.length > 0) return fromArray;
  }
  const fromCsv = parseSupabaseList(row.models_csv);
  if (fromCsv.length > 0) return fromCsv;
  return parseSupabaseList(row.model);
}

function resolveRunModelOwners(row: MvRunSummaryRow): string[] {
  if (Array.isArray(row.model_owners)) {
    const fromArray = parseSupabaseList(row.model_owners);
    if (fromArray.length > 0) return fromArray;
  }
  return parseSupabaseList(row.model_owners_csv);
}

function buildModelSummaryFromViewRows(rows: MvModelPerformanceRow[]): {
  modelStats: DashboardModelStat[];
  tokenTotals: { inputTokens: number; outputTokens: number; totalTokens: number };
  durationTotals: { totalDurationMs: number; avgDurationMs: number };
  modelOwners: string[];
  modelOwnerMap: Record<string, string>;
  modelOwnerStats: Array<{ owner: string; models: string[]; responseCount: number }>;
} {
  const modelOwnerMap: Record<string, string> = {};
  const ownerResponseCount = new Map<string, number>();
  const ownerModels = new Map<string, Set<string>>();

  let totalResponses = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalDurationMs = 0;

  const modelStats = rows
    .map((row) => {
      const model = String(row.model ?? "").trim();
      const owner = String(row.owner ?? "").trim() || inferModelOwnerFromModel(model);
      const responseCount = Math.max(0, Math.round(asNumber(row.response_count)));
      const successCount = Math.max(0, Math.round(asNumber(row.success_count)));
      const failureCount = Math.max(0, Math.round(asNumber(row.failure_count)));
      const webSearchEnabledCount = Math.max(
        0,
        Math.round(asNumber(row.web_search_enabled_count)),
      );
      const modelTotalDurationMs = Math.max(0, Math.round(asNumber(row.total_duration_ms)));
      const modelInputTokens = Math.max(0, Math.round(asNumber(row.total_input_tokens)));
      const modelOutputTokens = Math.max(0, Math.round(asNumber(row.total_output_tokens)));
      const modelTotalTokens = Math.max(0, Math.round(asNumber(row.total_tokens)));

      modelOwnerMap[model] = owner;
      ownerResponseCount.set(owner, (ownerResponseCount.get(owner) ?? 0) + responseCount);
      const ownerModelSet = ownerModels.get(owner) ?? new Set<string>();
      ownerModelSet.add(model);
      ownerModels.set(owner, ownerModelSet);

      totalResponses += responseCount;
      totalInputTokens += modelInputTokens;
      totalOutputTokens += modelOutputTokens;
      totalTokens += modelTotalTokens;
      totalDurationMs += modelTotalDurationMs;

      return {
        model,
        owner,
        responseCount,
        successCount,
        failureCount,
        webSearchEnabledCount,
        totalDurationMs: modelTotalDurationMs,
        avgDurationMs: roundTo(asNumber(row.avg_duration_ms), 2),
        p95DurationMs: roundTo(asNumber(row.p95_duration_ms), 2),
        totalInputTokens: modelInputTokens,
        totalOutputTokens: modelOutputTokens,
        totalTokens: modelTotalTokens,
        avgInputTokens: roundTo(asNumber(row.avg_input_tokens), 2),
        avgOutputTokens: roundTo(asNumber(row.avg_output_tokens), 2),
        avgTotalTokens: roundTo(asNumber(row.avg_total_tokens), 2),
      } satisfies DashboardModelStat;
    })
    .sort((left, right) => {
      if (right.responseCount !== left.responseCount) {
        return right.responseCount - left.responseCount;
      }
      return left.model.localeCompare(right.model);
    });

  const modelOwners = [...new Set(Object.values(modelOwnerMap))].sort((a, b) =>
    a.localeCompare(b),
  );
  const modelOwnerStats = [...ownerResponseCount.entries()]
    .map(([owner, responseCount]) => ({
      owner,
      models: [...(ownerModels.get(owner) ?? new Set<string>())].sort((a, b) =>
        a.localeCompare(b),
      ),
      responseCount,
    }))
    .sort((left, right) => {
      if (right.responseCount !== left.responseCount) {
        return right.responseCount - left.responseCount;
      }
      return left.owner.localeCompare(right.owner);
    });

  return {
    modelStats,
    tokenTotals: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
    },
    durationTotals: {
      totalDurationMs,
      avgDurationMs: totalResponses > 0 ? roundTo(totalDurationMs / totalResponses, 2) : 0,
    },
    modelOwners,
    modelOwnerMap,
    modelOwnerStats,
  };
}

async function fetchModelPerformanceRowsByRunIds(
  runIds: string[],
): Promise<MvModelPerformanceRow[]> {
  if (runIds.length === 0) {
    return [];
  }
  const client = requireSupabaseClient();
  const rows: MvModelPerformanceRow[] = [];
  const chunkSize = 100;

  for (let index = 0; index < runIds.length; index += chunkSize) {
    const runIdChunk = runIds.slice(index, index + chunkSize);
    let offset = 0;

    while (true) {
      const result = await client
        .from("mv_model_performance")
        .select(
          "run_id,model,owner,response_count,success_count,failure_count,web_search_enabled_count,total_duration_ms,avg_duration_ms,p95_duration_ms,total_input_tokens,total_output_tokens,total_tokens,avg_input_tokens,avg_output_tokens,avg_total_tokens",
        )
        .in("run_id", runIdChunk)
        .order("run_id", { ascending: true })
        .order("model", { ascending: true })
        .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

      if (result.error) {
        throw asError(result.error, "Failed to load mv_model_performance rows");
      }
      const pageRows = (result.data ?? []) as MvModelPerformanceRow[];
      if (pageRows.length === 0) {
        break;
      }
      rows.push(...pageRows);
      offset += pageRows.length;
    }
  }

  return rows;
}

async function fetchMentionRateRowsByRunIds(
  runIds: string[],
  options: { overallOnly?: boolean } = {},
): Promise<MvCompetitorMentionRateRow[]> {
  if (runIds.length === 0) {
    return [];
  }
  const client = requireSupabaseClient();
  const rows: MvCompetitorMentionRateRow[] = [];
  const chunkSize = 100;

  for (let index = 0; index < runIds.length; index += chunkSize) {
    const runIdChunk = runIds.slice(index, index + chunkSize);
    let offset = 0;

    while (true) {
      let query = client
        .from("mv_competitor_mention_rates")
        .select(
          "run_id,query_id,query_key,query_text,competitor_id,entity,entity_key,is_highcharts,is_overall_row,response_count,input_tokens,output_tokens,total_tokens,total_duration_ms,mentions_count,mentions_rate_pct,share_of_voice_rate_pct",
        )
        .in("run_id", runIdChunk)
        .order("run_id", { ascending: true })
        .order("query_key", { ascending: true })
        .order("entity_key", { ascending: true })
        .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

      if (typeof options.overallOnly === "boolean") {
        query = query.eq("is_overall_row", options.overallOnly);
      }

      const result = await query;
      if (result.error) {
        throw asError(result.error, "Failed to load mv_competitor_mention_rates rows");
      }
      const pageRows = (result.data ?? []) as MvCompetitorMentionRateRow[];
      if (pageRows.length === 0) {
        break;
      }
      rows.push(...pageRows);
      offset += pageRows.length;
    }
  }

  return rows;
}

async function fetchHistoricalRunsByQueryIds(
  queryIds: string[],
): Promise<Map<string, Set<string>>> {
  const runsByQuery = new Map<string, Set<string>>();
  if (queryIds.length === 0) {
    return runsByQuery;
  }
  const client = requireSupabaseClient();
  const chunkSize = 100;

  for (let index = 0; index < queryIds.length; index += chunkSize) {
    const queryIdChunk = queryIds.slice(index, index + chunkSize);
    let offset = 0;
    while (true) {
      const result = await client
        .from("mv_competitor_mention_rates")
        .select("run_id,query_id")
        .eq("is_overall_row", false)
        .in("query_id", queryIdChunk)
        .order("run_id", { ascending: true })
        .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

      if (result.error) {
        throw asError(
          result.error,
          "Failed to load historical run counts from mv_competitor_mention_rates",
        );
      }
      const pageRows = (result.data ?? []) as Array<{ run_id: string; query_id: string | null }>;
      if (pageRows.length === 0) {
        break;
      }
      for (const row of pageRows) {
        if (!row.query_id) continue;
        const runSet = runsByQuery.get(row.query_id) ?? new Set<string>();
        runSet.add(row.run_id);
        runsByQuery.set(row.query_id, runSet);
      }
      offset += pageRows.length;
    }
  }

  return runsByQuery;
}

function emptyDashboardFromConfig(config: BenchmarkConfig) {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      overallScore: 0,
      queryCount: config.queries.length,
      competitorCount: config.competitors.length,
      totalResponses: 0,
      models: [],
      modelOwners: [],
      modelOwnerMap: {},
      modelOwnerStats: [],
      modelStats: [],
      tokenTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      durationTotals: { totalDurationMs: 0, avgDurationMs: 0 },
      runMonth: null,
      webSearchEnabled: null,
      windowStartUtc: null,
      windowEndUtc: null,
    },
    kpi: null,
    competitorSeries: config.competitors.map((entity) => ({
      entity,
      entityKey: slugifyEntity(entity),
      isHighcharts: entity.toLowerCase() === "highcharts",
      mentionRatePct: 0,
      shareOfVoicePct: 0,
    })),
    promptStatus: config.queries.map((query) => ({
      query,
      tags: inferPromptTags(query),
      isPaused: Boolean((config.pausedQueries ?? []).includes(query)),
      status: "awaiting_run",
      runs: 0,
      highchartsRatePct: 0,
      highchartsRank: null,
      highchartsRankOutOf: config.competitors.length,
      viabilityRatePct: 0,
      topCompetitor: null,
      latestRunResponseCount: null,
      latestInputTokens: 0,
      latestOutputTokens: 0,
      latestTotalTokens: 0,
      estimatedInputCostUsd: 0,
      estimatedOutputCostUsd: 0,
      estimatedTotalCostUsd: 0,
      estimatedAvgCostPerResponseUsd: 0,
      competitorRates: config.competitors.map((name) => ({
        entity: name,
        entityKey: slugifyEntity(name),
        isHighcharts: name.toLowerCase() === "highcharts",
        mentions: 0,
        ratePct: 0,
      })),
    })),
    comparisonRows: [],
    files: {
      comparisonTablePresent: true,
      competitorChartPresent: true,
      kpiPresent: false,
      llmOutputsPresent: false,
    },
  };
}

async function fetchDashboardFromSupabaseViewsForServer(config: BenchmarkConfig) {
  const client = requireSupabaseClient();

  const promptWithTags = await client
    .from("prompt_queries")
    .select("id,query_text,sort_order,is_active,tags")
    .order("sort_order", { ascending: true });
  let promptRowsError = promptWithTags.error;
  let promptRows = (promptWithTags.data ?? []) as Array<{
    id: string;
    query_text: string;
    sort_order: number;
    is_active: boolean;
    tags?: string[] | null;
  }>;
  if (promptRowsError && isMissingColumn(promptRowsError)) {
    const fallbackRows = await client
      .from("prompt_queries")
      .select("id,query_text,sort_order,is_active")
      .order("sort_order", { ascending: true });
    promptRowsError = fallbackRows.error;
    promptRows = ((fallbackRows.data ?? []) as Array<{
      id: string;
      query_text: string;
      sort_order: number;
      is_active: boolean;
    }>).map((row) => ({ ...row, tags: null }));
  }
  if (promptRowsError) {
    throw asError(promptRowsError, "Failed to load prompt metadata for dashboard");
  }

  const competitorResult = await client
    .from("competitors")
    .select("id,name,slug,is_primary,sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (competitorResult.error) {
    throw asError(competitorResult.error, "Failed to load competitors for dashboard");
  }
  const competitorRows = (competitorResult.data ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    is_primary: boolean;
    sort_order: number;
  }>;

  const recentRunsResult = await client
    .from("mv_run_summary")
    .select(
      "run_id,run_month,model,models,models_csv,model_owners,model_owners_csv,model_owner_map,web_search_enabled,overall_score,created_at,started_at,ended_at,response_count,query_count,competitor_count,input_tokens,output_tokens,total_tokens,total_duration_ms,avg_duration_ms",
    )
    .order("created_at", { ascending: false })
    .limit(DASHBOARD_RECENT_RUN_SCAN_LIMIT);

  if (recentRunsResult.error) {
    if (isMissingRelation(recentRunsResult.error)) {
      return emptyDashboardFromConfig(config);
    }
    throw asError(recentRunsResult.error, "Failed to load mv_run_summary for dashboard");
  }

  const latestRun = selectDashboardRun((recentRunsResult.data ?? []) as MvRunSummaryRow[]);
  if (!latestRun) {
    return emptyDashboardFromConfig(config);
  }

  const runId = latestRun.run_id;
  const [mentionRows, modelRows, historicalRunsByQuery] = await Promise.all([
    fetchMentionRateRowsByRunIds([runId]),
    fetchModelPerformanceRowsByRunIds([runId]),
    fetchHistoricalRunsByQueryIds(promptRows.map((row) => row.id)),
  ]);

  const modelSummary = buildModelSummaryFromViewRows(modelRows);
  const runModels = resolveRunModels(latestRun);
  const runModelOwners = resolveRunModelOwners(latestRun);
  const ownerMapFromRun = parseModelOwnerMap(String(latestRun.model_owner_map ?? ""));
  const modelOwnerMap =
    Object.keys(modelSummary.modelOwnerMap).length > 0
      ? { ...modelSummary.modelOwnerMap }
      : { ...ownerMapFromRun };
  for (const model of runModels) {
    if (!modelOwnerMap[model]) {
      modelOwnerMap[model] = inferModelOwnerFromModel(model);
    }
  }
  const modelOwners =
    modelSummary.modelOwners.length > 0
      ? modelSummary.modelOwners
      : runModelOwners.length > 0
        ? runModelOwners
        : [...new Set(Object.values(modelOwnerMap))].sort((a, b) => a.localeCompare(b));

  const mentionRowsForRun = mentionRows.filter((row) => row.run_id === runId);
  const mentionByQueryAndCompetitor = new Map<string, MvCompetitorMentionRateRow>();
  const overallByCompetitorId = new Map<string, MvCompetitorMentionRateRow>();
  for (const row of mentionRowsForRun) {
    if (row.is_overall_row) {
      overallByCompetitorId.set(row.competitor_id, row);
      continue;
    }
    if (row.query_id) {
      mentionByQueryAndCompetitor.set(`${row.query_id}:${row.competitor_id}`, row);
    }
  }

  const competitorSeries = competitorRows.map((competitor) => {
    const row = overallByCompetitorId.get(competitor.id);
    return {
      entity: competitor.name,
      entityKey: competitor.slug,
      isHighcharts: Boolean(row?.is_highcharts) || competitor.is_primary || competitor.slug === "highcharts",
      mentionRatePct: roundTo(asNumber(row?.mentions_rate_pct), 2),
      shareOfVoicePct: roundTo(asNumber(row?.share_of_voice_rate_pct), 2),
    };
  });

  const highchartsCompetitor =
    competitorRows.find((row) => row.is_primary) ??
    competitorRows.find((row) => row.slug === "highcharts") ??
    null;
  const nonHighchartsCompetitors = competitorRows.filter(
    (row) => row.id !== highchartsCompetitor?.id,
  );

  let pricedInputTokens = 0;
  let pricedOutputTokens = 0;
  let pricedInputCostUsd = 0;
  let pricedOutputCostUsd = 0;
  for (const row of modelRows) {
    const model = String(row.model ?? "").trim();
    if (!model) continue;
    const inputTokens = Math.max(0, Math.round(asNumber(row.total_input_tokens)));
    const outputTokens = Math.max(0, Math.round(asNumber(row.total_output_tokens)));
    const costs = estimateResponseCostForServer(model, inputTokens, outputTokens);
    if (!costs.priced) continue;
    pricedInputTokens += inputTokens;
    pricedOutputTokens += outputTokens;
    pricedInputCostUsd += costs.inputCostUsd;
    pricedOutputCostUsd += costs.outputCostUsd;
  }
  const blendedInputCostPerToken = pricedInputTokens > 0 ? pricedInputCostUsd / pricedInputTokens : 0;
  const blendedOutputCostPerToken = pricedOutputTokens > 0 ? pricedOutputCostUsd / pricedOutputTokens : 0;

  const promptStatus = promptRows.map((queryRow) => {
    const competitorRatesAll = competitorRows.map((competitor) => {
      const row = mentionByQueryAndCompetitor.get(`${queryRow.id}:${competitor.id}`);
      const mentions = Math.max(0, Math.round(asNumber(row?.mentions_count)));
      const ratePct = roundTo(asNumber(row?.mentions_rate_pct), 2);
      const isHighcharts = highchartsCompetitor
        ? competitor.id === highchartsCompetitor.id
        : competitor.slug === "highcharts";
      return {
        entity: competitor.name,
        entityKey: competitor.slug,
        isHighcharts,
        ratePct,
        mentions,
        inputTokens: Math.max(0, Math.round(asNumber(row?.input_tokens))),
        outputTokens: Math.max(0, Math.round(asNumber(row?.output_tokens))),
        totalTokens: Math.max(0, Math.round(asNumber(row?.total_tokens))),
      };
    });

    const queryMetrics =
      competitorRatesAll.find((entry) => entry.totalTokens > 0) ??
      competitorRatesAll[0] ??
      null;
    const latestRunResponseCount = Math.max(
      0,
      Math.round(
        asNumber(
          mentionByQueryAndCompetitor.get(
            `${queryRow.id}:${highchartsCompetitor?.id ?? competitorRows[0]?.id ?? ""}`,
          )?.response_count,
        ),
      ),
    );
    const latestInputTokens = queryMetrics?.inputTokens ?? 0;
    const latestOutputTokens = queryMetrics?.outputTokens ?? 0;
    const latestTotalTokens = queryMetrics?.totalTokens ?? latestInputTokens + latestOutputTokens;

    const competitorRates = competitorRatesAll.filter((entry) => !entry.isHighcharts);
    const highchartsRateEntry =
      competitorRatesAll.find((entry) => entry.isHighcharts) ?? null;
    const highchartsRatePct = highchartsRateEntry?.ratePct ?? 0;

    const highchartsRank =
      latestRunResponseCount > 0 && highchartsRateEntry
        ? (() => {
            const sortedRates = competitorRatesAll
              .slice()
              .sort((left, right) => {
                if (right.ratePct !== left.ratePct) {
                  return right.ratePct - left.ratePct;
                }
                return left.entity.localeCompare(right.entity);
              });
            const index = sortedRates.findIndex((entry) => entry.isHighcharts);
            return index >= 0 ? index + 1 : null;
          })()
        : null;

    const viabilityCount = competitorRates.reduce((sum, entry) => sum + entry.mentions, 0);
    const viabilityDenominator = latestRunResponseCount * nonHighchartsCompetitors.length;
    const viabilityRatePct =
      viabilityDenominator > 0 ? (viabilityCount / viabilityDenominator) * 100 : 0;

    const topCompetitor =
      competitorRates
        .slice()
        .sort((left, right) => right.ratePct - left.ratePct)
        .map((entry) => ({ entity: entry.entity, ratePct: roundTo(entry.ratePct, 2) }))
        .at(0) ?? null;

    const estimatedInputCostUsd = latestInputTokens * blendedInputCostPerToken;
    const estimatedOutputCostUsd = latestOutputTokens * blendedOutputCostPerToken;
    const estimatedTotalCostUsd = estimatedInputCostUsd + estimatedOutputCostUsd;
    const runs = historicalRunsByQuery.get(queryRow.id)?.size ?? 0;

    return {
      query: queryRow.query_text,
      tags: normalizePromptTags(queryRow.tags, queryRow.query_text),
      isPaused: !queryRow.is_active,
      status: runs > 0 ? "tracked" : "awaiting_run",
      runs,
      highchartsRatePct: roundTo(highchartsRatePct, 2),
      highchartsRank,
      highchartsRankOutOf: competitorRows.length,
      viabilityRatePct: roundTo(viabilityRatePct, 2),
      topCompetitor,
      latestRunResponseCount,
      latestInputTokens,
      latestOutputTokens,
      latestTotalTokens,
      estimatedInputCostUsd: roundTo(estimatedInputCostUsd, 6),
      estimatedOutputCostUsd: roundTo(estimatedOutputCostUsd, 6),
      estimatedTotalCostUsd: roundTo(estimatedTotalCostUsd, 6),
      estimatedAvgCostPerResponseUsd:
        latestRunResponseCount > 0 ? roundTo(estimatedTotalCostUsd / latestRunResponseCount, 6) : 0,
      competitorRates: competitorRatesAll.map((entry) => ({
        entity: entry.entity,
        entityKey: entry.entityKey,
        isHighcharts: entry.isHighcharts,
        ratePct: roundTo(entry.ratePct, 2),
        mentions: entry.mentions,
      })),
    };
  });

  const totalResponses = Math.max(0, Math.round(asNumber(latestRun.response_count)));
  const overallScore = roundTo(asNumber(latestRun.overall_score), 2);
  const modelOwnerMapString = Object.entries(modelOwnerMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, owner]) => `${model}=>${owner}`)
    .join(";");
  const summaryTokenTotals =
    modelSummary.tokenTotals.totalTokens > 0
      ? modelSummary.tokenTotals
      : {
          inputTokens: Math.max(0, Math.round(asNumber(latestRun.input_tokens))),
          outputTokens: Math.max(0, Math.round(asNumber(latestRun.output_tokens))),
          totalTokens: Math.max(0, Math.round(asNumber(latestRun.total_tokens))),
        };
  const summaryDurationTotals =
    modelSummary.durationTotals.totalDurationMs > 0
      ? modelSummary.durationTotals
      : {
          totalDurationMs: Math.max(0, Math.round(asNumber(latestRun.total_duration_ms))),
          avgDurationMs: roundTo(asNumber(latestRun.avg_duration_ms), 2),
        };

  const kpi = {
    metric_name: "AI Visibility Overall",
    ai_visibility_overall_score: overallScore,
    score_scale: "0-100",
    queries_count: String(promptRows.length),
    window_start_utc: latestRun.started_at ?? "",
    window_end_utc: latestRun.ended_at ?? "",
    models: runModels.join(","),
    model_owners: modelOwners.join(","),
    model_owner_map: modelOwnerMapString,
    web_search_enabled:
      typeof latestRun.web_search_enabled === "boolean"
        ? latestRun.web_search_enabled
          ? "yes"
          : "no"
        : "",
    run_month: latestRun.run_month ?? "",
    run_id: latestRun.run_id,
  };

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      overallScore,
      queryCount: config.queries.length,
      competitorCount: config.competitors.length,
      totalResponses,
      models: runModels,
      modelOwners,
      modelOwnerMap,
      modelOwnerStats: modelSummary.modelOwnerStats,
      modelStats: modelSummary.modelStats,
      tokenTotals: summaryTokenTotals,
      durationTotals: summaryDurationTotals,
      runMonth: latestRun.run_month,
      webSearchEnabled:
        typeof latestRun.web_search_enabled === "boolean"
          ? latestRun.web_search_enabled
            ? "yes"
            : "no"
          : null,
      windowStartUtc: latestRun.started_at,
      windowEndUtc: latestRun.ended_at,
    },
    kpi,
    competitorSeries,
    promptStatus,
    comparisonRows: [],
    files: {
      comparisonTablePresent: true,
      competitorChartPresent: true,
      kpiPresent: true,
      llmOutputsPresent: totalResponses > 0,
    },
  };
}

async function fetchUnderTheHoodFromSupabaseViewsForServer(
  config: BenchmarkConfig,
  rangeInput: UnderTheHoodRange,
) {
  const client = requireSupabaseClient();
  const range = normalizeUnderTheHoodRange(rangeInput);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const rangeStartMs = rangeStartMsForUnderTheHood(range, nowMs);
  const rangeStartIso = rangeStartMs !== null ? new Date(rangeStartMs).toISOString() : null;

  let runQuery = client
    .from("mv_run_summary")
    .select(
      "run_id,run_month,model,models,models_csv,model_owners,model_owners_csv,model_owner_map,web_search_enabled,overall_score,created_at,started_at,ended_at,response_count,query_count,competitor_count,input_tokens,output_tokens,total_tokens,total_duration_ms,avg_duration_ms",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (rangeStartIso) {
    runQuery = runQuery.gte("created_at", rangeStartIso);
  }
  const runResult = await runQuery;
  if (runResult.error) {
    if (isMissingRelation(runResult.error)) {
      return {
        generatedAt: new Date().toISOString(),
        range,
        rangeLabel: rangeLabelForUnderTheHood(range),
        rangeStartUtc: rangeStartIso,
        rangeEndUtc: nowIso,
        summary: {
          overallScore: 0,
          queryCount: config.queries.length,
          competitorCount: config.competitors.length,
          totalResponses: 0,
          models: [],
          modelOwners: [],
          modelOwnerMap: {},
          modelOwnerStats: [],
          modelStats: [],
          tokenTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationTotals: { totalDurationMs: 0, avgDurationMs: 0 },
          runMonth: null,
          webSearchEnabled: null,
          windowStartUtc: null,
          windowEndUtc: null,
        },
      };
    }
    throw asError(runResult.error, "Failed to load mv_run_summary for under-the-hood");
  }

  const selectedRuns = (runResult.data ?? []) as MvRunSummaryRow[];
  if (selectedRuns.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      range,
      rangeLabel: rangeLabelForUnderTheHood(range),
      rangeStartUtc: rangeStartIso,
      rangeEndUtc: nowIso,
      summary: {
        overallScore: 0,
        queryCount: config.queries.length,
        competitorCount: config.competitors.length,
        totalResponses: 0,
        models: [],
        modelOwners: [],
        modelOwnerMap: {},
        modelOwnerStats: [],
        modelStats: [],
        tokenTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationTotals: { totalDurationMs: 0, avgDurationMs: 0 },
        runMonth: null,
        webSearchEnabled: null,
        windowStartUtc: null,
        windowEndUtc: null,
      },
    };
  }

  const runIds = selectedRuns.map((run) => run.run_id);
  const modelRows = await fetchModelPerformanceRowsByRunIds(runIds);
  const modelSummary = buildModelSummaryFromViewRows(modelRows);

  const aggregatedModelOwnerMap = { ...modelSummary.modelOwnerMap };
  const aggregatedModels = new Set<string>();
  for (const run of selectedRuns) {
    for (const model of resolveRunModels(run)) {
      aggregatedModels.add(model);
      if (!aggregatedModelOwnerMap[model]) {
        aggregatedModelOwnerMap[model] = inferModelOwnerFromModel(model);
      }
    }
  }

  const runTimestamps = selectedRuns
    .map((run) => pickTimestamp(run.started_at, run.created_at, run.ended_at))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right));

  const latestRun = selectDashboardRun(selectedRuns) ?? selectedRuns[0];
  const webSearchStates = new Set(
    selectedRuns
      .map((run) => run.web_search_enabled)
      .filter((value): value is boolean => typeof value === "boolean"),
  );
  const webSearchEnabled =
    webSearchStates.size === 0
      ? null
      : webSearchStates.size === 1
        ? webSearchStates.has(true)
          ? "yes"
          : "no"
        : "mixed";

  const totalsFromRuns = selectedRuns.reduce(
    (totals, run) => {
      totals.responses += Math.max(0, Math.round(asNumber(run.response_count)));
      totals.inputTokens += Math.max(0, Math.round(asNumber(run.input_tokens)));
      totals.outputTokens += Math.max(0, Math.round(asNumber(run.output_tokens)));
      totals.totalTokens += Math.max(0, Math.round(asNumber(run.total_tokens)));
      totals.totalDurationMs += Math.max(0, Math.round(asNumber(run.total_duration_ms)));
      return totals;
    },
    {
      responses: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalDurationMs: 0,
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    range,
    rangeLabel: rangeLabelForUnderTheHood(range),
    rangeStartUtc: rangeStartIso,
    rangeEndUtc: nowIso,
    summary: {
      overallScore: roundTo(asNumber(latestRun.overall_score), 2),
      queryCount: config.queries.length,
      competitorCount: config.competitors.length,
      totalResponses: totalsFromRuns.responses,
      models: [...aggregatedModels].sort((a, b) => a.localeCompare(b)),
      modelOwners:
        modelSummary.modelOwners.length > 0
          ? modelSummary.modelOwners
          : [...new Set(Object.values(aggregatedModelOwnerMap))].sort((a, b) =>
              a.localeCompare(b),
            ),
      modelOwnerMap: aggregatedModelOwnerMap,
      modelOwnerStats: modelSummary.modelOwnerStats,
      modelStats: modelSummary.modelStats,
      tokenTotals:
        modelSummary.tokenTotals.totalTokens > 0
          ? modelSummary.tokenTotals
          : {
              inputTokens: totalsFromRuns.inputTokens,
              outputTokens: totalsFromRuns.outputTokens,
              totalTokens: totalsFromRuns.totalTokens,
            },
      durationTotals:
        modelSummary.durationTotals.totalDurationMs > 0
          ? modelSummary.durationTotals
          : {
              totalDurationMs: totalsFromRuns.totalDurationMs,
              avgDurationMs:
                totalsFromRuns.responses > 0
                  ? roundTo(totalsFromRuns.totalDurationMs / totalsFromRuns.responses, 2)
                  : 0,
            },
      runMonth: latestRun.run_month,
      webSearchEnabled,
      windowStartUtc: runTimestamps[0] ?? null,
      windowEndUtc: runTimestamps.at(-1) ?? null,
    },
  };
}

async function fetchRunCostsFromSupabaseViewsForServer(limit = 30) {
  const client = requireSupabaseClient();
  const clampedLimit = Math.max(1, Math.min(200, Math.round(limit)));
  const runResult = await client
    .from("mv_run_summary")
    .select(
      "run_id,run_month,model,models,models_csv,web_search_enabled,overall_score,created_at,started_at,ended_at,response_count,input_tokens,output_tokens,total_tokens",
    )
    .order("created_at", { ascending: false })
    .limit(clampedLimit);

  if (runResult.error) {
    if (isMissingRelation(runResult.error)) {
      return {
        generatedAt: new Date().toISOString(),
        runCount: 0,
        totals: {
          responseCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedInputCostUsd: 0,
          estimatedOutputCostUsd: 0,
          estimatedTotalCostUsd: 0,
        },
        runs: [],
      };
    }
    throw asError(runResult.error, "Failed to load mv_run_summary for run costs");
  }

  const runRows = (runResult.data ?? []) as MvRunSummaryRow[];
  if (runRows.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      runCount: 0,
      totals: {
        responseCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedInputCostUsd: 0,
        estimatedOutputCostUsd: 0,
        estimatedTotalCostUsd: 0,
      },
      runs: [],
    };
  }

  const modelRows = await fetchModelPerformanceRowsByRunIds(
    runRows.map((row) => row.run_id),
  );
  const modelRowsByRun = new Map<string, MvModelPerformanceRow[]>();
  for (const row of modelRows) {
    const bucket = modelRowsByRun.get(row.run_id) ?? [];
    bucket.push(row);
    modelRowsByRun.set(row.run_id, bucket);
  }

  const runs = runRows.map((run) => {
    const rowsForRun = modelRowsByRun.get(run.run_id) ?? [];
    const resolvedModels =
      resolveRunModels(run).length > 0
        ? resolveRunModels(run)
        : [...new Set(rowsForRun.map((row) => row.model).filter(Boolean))].sort((a, b) =>
            a.localeCompare(b),
          );

    let estimatedInputCostUsd = 0;
    let estimatedOutputCostUsd = 0;
    let estimatedTotalCostUsd = 0;
    let pricedResponseCount = 0;
    const unpricedModels = new Set<string>();

    for (const row of rowsForRun) {
      const model = String(row.model ?? "").trim();
      if (!model) continue;
      const inputTokens = Math.max(0, Math.round(asNumber(row.total_input_tokens)));
      const outputTokens = Math.max(0, Math.round(asNumber(row.total_output_tokens)));
      const responseCount = Math.max(0, Math.round(asNumber(row.response_count)));
      const costs = estimateResponseCostForServer(model, inputTokens, outputTokens);
      estimatedInputCostUsd += costs.inputCostUsd;
      estimatedOutputCostUsd += costs.outputCostUsd;
      estimatedTotalCostUsd += costs.totalCostUsd;
      if (costs.priced) {
        pricedResponseCount += responseCount;
      } else {
        unpricedModels.add(model);
      }
    }

    return {
      runId: run.run_id,
      runMonth: run.run_month,
      createdAt: run.created_at,
      startedAt: run.started_at,
      endedAt: run.ended_at,
      webSearchEnabled:
        typeof run.web_search_enabled === "boolean" ? run.web_search_enabled : null,
      responseCount: Math.max(0, Math.round(asNumber(run.response_count))),
      models: resolvedModels,
      inputTokens: Math.max(0, Math.round(asNumber(run.input_tokens))),
      outputTokens: Math.max(0, Math.round(asNumber(run.output_tokens))),
      totalTokens: Math.max(0, Math.round(asNumber(run.total_tokens))),
      pricedResponseCount,
      unpricedModels: [...unpricedModels].sort((a, b) => a.localeCompare(b)),
      estimatedInputCostUsd: roundTo(estimatedInputCostUsd, 6),
      estimatedOutputCostUsd: roundTo(estimatedOutputCostUsd, 6),
      estimatedTotalCostUsd: roundTo(estimatedTotalCostUsd, 6),
    };
  });

  const totals = runs.reduce(
    (sum, run) => {
      sum.responseCount += run.responseCount;
      sum.inputTokens += run.inputTokens;
      sum.outputTokens += run.outputTokens;
      sum.totalTokens += run.totalTokens;
      sum.estimatedInputCostUsd += run.estimatedInputCostUsd;
      sum.estimatedOutputCostUsd += run.estimatedOutputCostUsd;
      sum.estimatedTotalCostUsd += run.estimatedTotalCostUsd;
      return sum;
    },
    {
      responseCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedInputCostUsd: 0,
      estimatedOutputCostUsd: 0,
      estimatedTotalCostUsd: 0,
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    runCount: runs.length,
    totals: {
      responseCount: totals.responseCount,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      totalTokens: totals.totalTokens,
      estimatedInputCostUsd: roundTo(totals.estimatedInputCostUsd, 6),
      estimatedOutputCostUsd: roundTo(totals.estimatedOutputCostUsd, 6),
      estimatedTotalCostUsd: roundTo(totals.estimatedTotalCostUsd, 6),
    },
    runs,
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

app.post("/api/prompt-lab/run", async (req, res) => {
  try {
    const parsed = promptLabRunSchema.parse(req.body ?? {});
    const query = parsed.query.trim();
    if (!query) {
      res.status(400).json({ error: "query is required." });
      return;
    }
    const allowedModels = getPromptLabAllowedModels();
    const requestedWebSearch = parsed.webSearch ?? true;
    const models = resolvePromptLabModels(
      {
        model: parsed.model,
        models: parsed.models,
        selectAllModels: parsed.selectAllModels,
      },
      allowedModels,
    );
    const results = await Promise.all(
      models.map((model) => runPromptLabQueryForModel(query, model, requestedWebSearch)),
    );
    const summary = summarizePromptLabModelResults(results);
    const primaryResult = results[0] ?? null;

    res.json({
      ok: summary.successCount > 0,
      query,
      models,
      results,
      summary,
      // Backwards compatibility for older single-model clients.
      model: primaryResult?.model ?? null,
      provider: primaryResult?.provider ?? null,
      modelOwner: primaryResult?.modelOwner ?? null,
      webSearchEnabled: primaryResult?.webSearchEnabled ?? false,
      responseText: primaryResult?.responseText ?? "",
      citations: primaryResult?.citations ?? [],
      durationMs: primaryResult?.durationMs ?? 0,
      tokens: primaryResult?.tokens ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid payload.", issues: error.issues });
      return;
    }

    const httpError =
      typeof error === "object" && error !== null ? (error as HttpError) : null;
    const statusCode =
      httpError && Number(httpError.statusCode)
        ? Number(httpError.statusCode)
        : 500;
    if (statusCode >= 500 && !httpError?.exposeMessage) {
      sendApiError(res, statusCode, "Prompt lab run failed.", error);
      return;
    }
    res
      .status(statusCode)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/under-the-hood", async (req, res) => {
  try {
    const range = normalizeUnderTheHoodRange(req.query.range);
    if (shouldUseSupabaseDashboardSource()) {
      const config = await loadConfig();
      const payload = await fetchUnderTheHoodFromSupabaseViewsForServer(config, range);
      res.json(payload);
      return;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const rangeStartMs = rangeStartMsForUnderTheHood(range, nowMs);
    const rangeStartUtc = rangeStartMs !== null ? new Date(rangeStartMs).toISOString() : null;

    const [config, jsonlRows] = await Promise.all([
      loadConfig(),
      readJsonl(dashboardFiles.jsonl),
    ]);

    const filteredRows = jsonlRows.filter((row) => {
      if (rangeStartMs === null) return true;
      const rowTs =
        timestampMs(row.timestamp) ??
        timestampMs(row.created_at) ??
        timestampMs(row.run_created_at);
      if (rowTs === null) return false;
      return rowTs >= rangeStartMs && rowTs <= nowMs;
    });

    const inferredWindow = inferWindowFromJsonl(filteredRows);
    const runMonths = filteredRows
      .map((row) => String(row.run_month ?? "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const latestRunMonth = runMonths.at(-1) ?? null;

    const webSearchStates = new Set(
      filteredRows.map((row) => isTruthyFlag(row.web_search_enabled)),
    );
    const webSearchEnabled =
      webSearchStates.size === 0
        ? null
        : webSearchStates.size === 1
          ? webSearchStates.has(true)
            ? "yes"
            : "no"
          : "mixed";

    res.json({
      generatedAt: new Date().toISOString(),
      range,
      rangeLabel: rangeLabelForUnderTheHood(range),
      rangeStartUtc,
      rangeEndUtc: nowIso,
      summary: {
        overallScore: 0,
        queryCount: config.queries.length,
        competitorCount: config.competitors.length,
        totalResponses: filteredRows.length,
        models: inferredWindow.models,
        modelOwners: inferredWindow.modelOwners,
        modelOwnerMap: inferredWindow.modelOwnerMap,
        modelOwnerStats: inferredWindow.modelOwnerStats,
        modelStats: inferredWindow.modelStats,
        tokenTotals: inferredWindow.tokenTotals,
        durationTotals: inferredWindow.durationTotals,
        runMonth: latestRunMonth,
        webSearchEnabled,
        windowStartUtc: inferredWindow.start,
        windowEndUtc: inferredWindow.end,
      },
    });
  } catch (error) {
    sendApiError(res, 500, "Unable to build under-the-hood response.", error);
  }
});

app.get("/api/run-costs", async (req, res) => {
  try {
    const parsedLimit = Number(req.query.limit);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(200, Math.round(parsedLimit)))
      : 30;

    if (shouldUseSupabaseDashboardSource()) {
      const payload = await fetchRunCostsFromSupabaseViewsForServer(limit);
      res.json(payload);
      return;
    }

    const jsonlRows = await readJsonl(dashboardFiles.jsonl);
    if (jsonlRows.length === 0) {
      res.json({
        generatedAt: new Date().toISOString(),
        runCount: 0,
        totals: {
          responseCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedInputCostUsd: 0,
          estimatedOutputCostUsd: 0,
          estimatedTotalCostUsd: 0,
        },
        runs: [],
      });
      return;
    }

    const buckets = new Map<
      string,
      {
        runId: string;
        runMonth: string | null;
        createdAt: string | null;
        startedAt: string | null;
        endedAt: string | null;
        webSearchValues: Set<boolean>;
        models: Set<string>;
        unpricedModels: Set<string>;
        responseCount: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        pricedResponseCount: number;
        estimatedInputCostUsd: number;
        estimatedOutputCostUsd: number;
        estimatedTotalCostUsd: number;
      }
    >();

    for (const row of jsonlRows) {
      const timestampRaw = String(
        row.timestamp ?? row.created_at ?? row.run_created_at ?? "",
      ).trim();
      const runIdRaw = String(row.run_id ?? row.runId ?? "").trim();
      const runMonthRaw = String(row.run_month ?? "").trim();
      const runCreatedAtRaw = String(row.run_created_at ?? "").trim();
      const fallbackRunId =
        runMonthRaw && runCreatedAtRaw
          ? `${runMonthRaw}-${runCreatedAtRaw}`
          : runCreatedAtRaw
            ? `run-${runCreatedAtRaw}`
            : runMonthRaw && timestampRaw
              ? `${runMonthRaw}-${timestampRaw.slice(0, 10)}`
          : timestampRaw
            ? `run-${timestampRaw.slice(0, 10)}`
            : "run-unknown";
      const runId = runIdRaw || fallbackRunId;

      let bucket = buckets.get(runId);
      if (!bucket) {
        bucket = {
          runId,
          runMonth: runMonthRaw || null,
          createdAt: timestampRaw || null,
          startedAt: timestampRaw || null,
          endedAt: timestampRaw || null,
          webSearchValues: new Set<boolean>(),
          models: new Set<string>(),
          unpricedModels: new Set<string>(),
          responseCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          pricedResponseCount: 0,
          estimatedInputCostUsd: 0,
          estimatedOutputCostUsd: 0,
          estimatedTotalCostUsd: 0,
        };
        buckets.set(runId, bucket);
      }

      const modelName = String(row.model ?? "").trim();
      if (modelName) {
        bucket.models.add(modelName);
      }
      if (timestampRaw) {
        if (!bucket.createdAt || timestampRaw < bucket.createdAt) bucket.createdAt = timestampRaw;
        if (!bucket.startedAt || timestampRaw < bucket.startedAt) bucket.startedAt = timestampRaw;
        if (!bucket.endedAt || timestampRaw > bucket.endedAt) bucket.endedAt = timestampRaw;
      }

      bucket.webSearchValues.add(isTruthyFlag(row.web_search_enabled));

      const inputTokens = safeTokenInt(
        row.prompt_tokens ?? row.input_tokens ?? row.usage?.prompt_tokens,
      );
      const outputTokens = safeTokenInt(
        row.completion_tokens ?? row.output_tokens ?? row.usage?.completion_tokens,
      );
      const totalTokens =
        safeTokenInt(row.total_tokens ?? row.usage?.total_tokens) || inputTokens + outputTokens;
      bucket.responseCount += 1;
      bucket.inputTokens += inputTokens;
      bucket.outputTokens += outputTokens;
      bucket.totalTokens += totalTokens;

      const costs = estimateResponseCostForServer(modelName, inputTokens, outputTokens);
      bucket.estimatedInputCostUsd += costs.inputCostUsd;
      bucket.estimatedOutputCostUsd += costs.outputCostUsd;
      bucket.estimatedTotalCostUsd += costs.totalCostUsd;
      if (costs.priced) {
        bucket.pricedResponseCount += 1;
      } else if (modelName) {
        bucket.unpricedModels.add(modelName);
      }
    }

    const runs = [...buckets.values()]
      .map((bucket) => ({
        runId: bucket.runId,
        runMonth: bucket.runMonth,
        createdAt: bucket.createdAt,
        startedAt: bucket.startedAt,
        endedAt: bucket.endedAt,
        webSearchEnabled:
          bucket.webSearchValues.size === 1
            ? bucket.webSearchValues.has(true)
            : bucket.webSearchValues.size === 0
              ? null
              : null,
        responseCount: bucket.responseCount,
        models: [...bucket.models].sort((left, right) => left.localeCompare(right)),
        inputTokens: bucket.inputTokens,
        outputTokens: bucket.outputTokens,
        totalTokens: bucket.totalTokens,
        pricedResponseCount: bucket.pricedResponseCount,
        unpricedModels: [...bucket.unpricedModels].sort((left, right) => left.localeCompare(right)),
        estimatedInputCostUsd: Number(bucket.estimatedInputCostUsd.toFixed(6)),
        estimatedOutputCostUsd: Number(bucket.estimatedOutputCostUsd.toFixed(6)),
        estimatedTotalCostUsd: Number(bucket.estimatedTotalCostUsd.toFixed(6)),
      }))
      .sort((left, right) => {
        const leftMs = Date.parse(left.createdAt ?? "");
        const rightMs = Date.parse(right.createdAt ?? "");
        if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
          return rightMs - leftMs;
        }
        if (Number.isFinite(leftMs)) return -1;
        if (Number.isFinite(rightMs)) return 1;
        return right.runId.localeCompare(left.runId);
      })
      .slice(0, limit);

    const totals = runs.reduce(
      (sum, run) => {
        sum.responseCount += run.responseCount;
        sum.inputTokens += run.inputTokens;
        sum.outputTokens += run.outputTokens;
        sum.totalTokens += run.totalTokens;
        sum.estimatedInputCostUsd += run.estimatedInputCostUsd;
        sum.estimatedOutputCostUsd += run.estimatedOutputCostUsd;
        sum.estimatedTotalCostUsd += run.estimatedTotalCostUsd;
        return sum;
      },
      {
        responseCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedInputCostUsd: 0,
        estimatedOutputCostUsd: 0,
        estimatedTotalCostUsd: 0,
      },
    );

    res.json({
      generatedAt: new Date().toISOString(),
      runCount: runs.length,
      totals: {
        responseCount: totals.responseCount,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        totalTokens: totals.totalTokens,
        estimatedInputCostUsd: Number(totals.estimatedInputCostUsd.toFixed(6)),
        estimatedOutputCostUsd: Number(totals.estimatedOutputCostUsd.toFixed(6)),
        estimatedTotalCostUsd: Number(totals.estimatedTotalCostUsd.toFixed(6)),
      },
      runs,
    });
  } catch (error) {
    sendApiError(res, 500, "Unable to build run-costs response.", error);
  }
});

app.get("/api/dashboard", async (_req, res) => {
  try {
    const config = await loadConfig();
    if (shouldUseSupabaseDashboardSource()) {
      const payload = await fetchDashboardFromSupabaseViewsForServer(config);
      res.json(payload);
      return;
    }

    const [comparisonRows, competitorRows, kpiRows, jsonlRows] = await Promise.all([
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
    // JSONL artifacts are rewritten per benchmark run, so the full file is the active snapshot.
    const latestRunRows = jsonlRows;

    const responsesByQueryKey = new Map<string, Array<Record<string, unknown>>>();
    for (const row of latestRunRows) {
      const queryText = String(
        row.query ?? row.query_text ?? row.prompt ?? row.prompt_text ?? "",
      ).trim();
      if (!queryText) continue;
      const key = queryText.toLowerCase();
      const bucket = responsesByQueryKey.get(key) ?? [];
      bucket.push(row);
      responsesByQueryKey.set(key, bucket);
    }
    const queryTags = normalizeQueryTagsMap(config.queries, config.queryTags);

    const pausedSet = new Set(config.pausedQueries ?? []);
    const promptStatus = config.queries.map((query) => {
      const row = promptLookup.get(query);
      const queryResponses = responsesByQueryKey.get(query.trim().toLowerCase()) ?? [];
      const latestRunResponseCount = row
        ? Math.max(0, Math.round(asNumber(row.runs)))
        : 0;
      const latestInputTokens = queryResponses.reduce(
        (sum, responseRow) =>
          sum +
          safeTokenInt(
            responseRow.prompt_tokens ??
              responseRow.input_tokens ??
              responseRow.usage?.prompt_tokens,
          ),
        0,
      );
      const latestOutputTokens = queryResponses.reduce(
        (sum, responseRow) =>
          sum +
          safeTokenInt(
            responseRow.completion_tokens ??
              responseRow.output_tokens ??
              responseRow.usage?.completion_tokens,
          ),
        0,
      );
      const latestTotalTokens = queryResponses.reduce((sum, responseRow) => {
        const inputTokens = safeTokenInt(
          responseRow.prompt_tokens ??
            responseRow.input_tokens ??
            responseRow.usage?.prompt_tokens,
        );
        const outputTokens = safeTokenInt(
          responseRow.completion_tokens ??
            responseRow.output_tokens ??
            responseRow.usage?.completion_tokens,
        );
        const totalTokens =
          safeTokenInt(responseRow.total_tokens ?? responseRow.usage?.total_tokens) ||
          inputTokens + outputTokens;
        return sum + totalTokens;
      }, 0);
      const promptCostTotals = queryResponses.reduce(
        (totals, responseRow) => {
          const modelName = String(responseRow.model ?? "");
          const inputTokens = safeTokenInt(
            responseRow.prompt_tokens ??
              responseRow.input_tokens ??
              responseRow.usage?.prompt_tokens,
          );
          const outputTokens = safeTokenInt(
            responseRow.completion_tokens ??
              responseRow.output_tokens ??
              responseRow.usage?.completion_tokens,
          );
          const costs = estimateResponseCostForServer(modelName, inputTokens, outputTokens);
          totals.inputCostUsd += costs.inputCostUsd;
          totals.outputCostUsd += costs.outputCostUsd;
          totals.totalCostUsd += costs.totalCostUsd;
          if (costs.priced) {
            totals.pricedResponses += 1;
          }
          return totals;
        },
        {
          inputCostUsd: 0,
          outputCostUsd: 0,
          totalCostUsd: 0,
          pricedResponses: 0,
        },
      );

      const competitorRatesAll = config.competitors.map((name) => {
        const entityKey = slugifyEntity(name);
        return {
          entity: name,
          entityKey,
          isHighcharts: name.toLowerCase() === "highcharts",
          mentions: Math.max(0, Math.round(asNumber(row?.[`${entityKey}_count`]))),
          ratePct: Number((asNumber(row?.[`${entityKey}_rate`]) * 100).toFixed(2)),
        };
      });

      const highchartsRatePct =
        competitorRatesAll.find((entry) => entry.isHighcharts)?.ratePct ?? 0;
      const competitorRates = competitorRatesAll.filter((entry) => !entry.isHighcharts);
      const highchartsRank = row && latestRunResponseCount > 0
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
      const rivalMentionCount = competitorRates.reduce(
        (sum, entry) => sum + entry.mentions,
        0,
      );
      const viabilityDenominator = latestRunResponseCount * competitorRates.length;
      const viabilityRatePct =
        viabilityDenominator > 0 ? (rivalMentionCount / viabilityDenominator) * 100 : 0;

      return {
        query,
        tags: queryTags[query] ?? inferPromptTags(query),
        isPaused: pausedSet.has(query),
        status: row ? "tracked" : "awaiting_run",
        runs: asNumber(row?.runs),
        highchartsRatePct,
        highchartsRank: highchartsRank && highchartsRank > 0 ? highchartsRank : null,
        highchartsRankOutOf: config.competitors.length,
        viabilityRatePct: Number(viabilityRatePct.toFixed(2)),
        topCompetitor,
        latestRunResponseCount,
        latestInputTokens,
        latestOutputTokens,
        latestTotalTokens,
        estimatedInputCostUsd: Number(promptCostTotals.inputCostUsd.toFixed(6)),
        estimatedOutputCostUsd: Number(promptCostTotals.outputCostUsd.toFixed(6)),
        estimatedTotalCostUsd: Number(promptCostTotals.totalCostUsd.toFixed(6)),
        estimatedAvgCostPerResponseUsd:
          promptCostTotals.pricedResponses > 0
            ? Number((promptCostTotals.totalCostUsd / promptCostTotals.pricedResponses).toFixed(6))
            : 0,
        competitorRates: competitorRatesAll.map((entry) => ({
          entity: entry.entity,
          entityKey: entry.entityKey,
          isHighcharts: entry.isHighcharts,
          ratePct: entry.ratePct,
          mentions: entry.mentions,
        })),
      };
    });

    const models = kpi ? splitCsvish(String(kpi.models ?? "")) : inferredWindow.models;
    const parsedModelOwners = kpi ? splitCsvish(String(kpi.model_owners ?? "")) : [];
    const fallbackModelOwnerMap = Object.fromEntries(
      models.map((modelName) => [modelName, inferModelOwnerFromModel(modelName)]),
    );
    const modelOwnerMap =
      kpi && String(kpi.model_owner_map ?? "").trim()
        ? parseModelOwnerMap(String(kpi.model_owner_map ?? ""))
        : Object.keys(inferredWindow.modelOwnerMap).length > 0
          ? inferredWindow.modelOwnerMap
          : fallbackModelOwnerMap;
    const modelOwners =
      parsedModelOwners.length > 0
        ? parsedModelOwners
        : inferredWindow.modelOwners.length > 0
          ? inferredWindow.modelOwners
          : [...new Set(Object.values(modelOwnerMap))].sort((a, b) => a.localeCompare(b));
    const windowStartUtc = kpi?.window_start_utc ?? inferredWindow.start;
    const windowEndUtc = kpi?.window_end_utc ?? inferredWindow.end;
    const tokenTotals = inferredWindow.tokenTotals;
    const durationTotals = inferredWindow.durationTotals;
    const modelStats = inferredWindow.modelStats;

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        overallScore: Number(asNumber(kpi?.ai_visibility_overall_score).toFixed(2)),
        queryCount: config.queries.length,
        competitorCount: config.competitors.length,
        totalResponses: jsonlRows.length,
        models,
        modelOwners,
        modelOwnerMap,
        modelOwnerStats: inferredWindow.modelOwnerStats,
        modelStats,
        tokenTotals,
        durationTotals,
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
