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
  competitors: z.array(z.string().min(1)).min(1),
  aliases: z.record(z.string(), z.array(z.string().min(1))).default({}),
  pausedQueries: z.array(z.string()).optional().default([]),
});

const toggleSchema = z.object({
  query: z.string().min(1),
  active: z.boolean(),
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
const isProduction = process.env.NODE_ENV === "production";

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

function splitCsvish(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeConfig(rawConfig: BenchmarkConfig): BenchmarkConfig {
  const queries = uniqueNonEmpty(rawConfig.queries);
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

app.put("/api/config", async (req, res) => {
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

app.patch("/api/prompts/toggle", async (req, res) => {
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

    const pausedSet = new Set(config.pausedQueries ?? []);
    const promptStatus = config.queries.map((query) => {
      const row = promptLookup.get(query);
      const highchartsRatePct = Number((asNumber(row?.highcharts_rate) * 100).toFixed(2));
      const competitorRates = config.competitors
        .filter((name) => name.toLowerCase() !== "highcharts")
        .map((name) => ({
          entity: name,
          ratePct: Number((asNumber(row?.[`${slugifyEntity(name)}_rate`]) * 100).toFixed(2)),
        }));
      const topCompetitor = competitorRates
        .sort((a, b) => b.ratePct - a.ratePct)
        .at(0) ?? null;

      return {
        query,
        isPaused: pausedSet.has(query),
        status: row ? "tracked" : "awaiting_run",
        runs: asNumber(row?.runs),
        highchartsRatePct,
        viabilityRatePct: Number((asNumber(row?.viability_index_rate) * 100).toFixed(2)),
        topCompetitor,
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

app.get("/api/timeseries", async (_req, res) => {
  try {
    const [config, jsonlRows] = await Promise.all([
      loadConfig(),
      readJsonl(dashboardFiles.jsonl),
    ]);

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
    }));

    type DayBucket = { total: number; mentions: Record<string, number> };
    const byDate = new Map<string, DayBucket>();

    for (const row of jsonlRows) {
      const ts = String(row.timestamp ?? "");
      const date = ts.length >= 10 ? ts.slice(0, 10) : null;
      if (!date) continue;

      // Try various field names for the raw LLM response text
      const responseText = String(
        row.response ?? row.text ?? row.content ?? row.completion ?? row.output ?? "",
      ).toLowerCase();

      const entry = byDate.get(date) ?? { total: 0, mentions: {} };
      entry.total++;

      for (const { name, patterns } of competitorPatterns) {
        if (patterns.some((p) => responseText.includes(p))) {
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
