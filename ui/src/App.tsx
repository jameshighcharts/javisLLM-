import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Database,
  Download,
  Gauge,
  Plus,
  RefreshCcw,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type BenchmarkConfig = {
  queries: string[];
  competitors: string[];
  aliases: Record<string, string[]>;
};

type CompetitorPoint = {
  entity: string;
  entityKey: string;
  isHighcharts: boolean;
  mentionRatePct: number;
  shareOfVoicePct: number;
};

type PromptStatus = {
  query: string;
  status: "tracked" | "awaiting_run";
  runs: number;
  highchartsRatePct: number;
  viabilityRatePct: number;
  topCompetitor: {
    entity: string;
    ratePct: number;
  } | null;
};

type DashboardPayload = {
  generatedAt: string;
  summary: {
    overallScore: number;
    queryCount: number;
    competitorCount: number;
    totalResponses: number;
    models: string[];
    runMonth: string | null;
    webSearchEnabled: string | null;
    windowStartUtc: string | null;
    windowEndUtc: string | null;
  };
  competitorSeries: CompetitorPoint[];
  promptStatus: PromptStatus[];
  files: {
    comparisonTablePresent: boolean;
    competitorChartPresent: boolean;
    kpiPresent: boolean;
    llmOutputsPresent: boolean;
  };
};

type ConfigResponse = {
  config: BenchmarkConfig;
};

type DashboardResponse = DashboardPayload;

type DataSource = "api" | "snapshot";

const LOCAL_CONFIG_KEY = "easy_llm_benchmarker.config.override.v1";

function uniqueStrings(values: string[]): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return [...new Set(normalized)];
}

function isConfigShape(value: unknown): value is BenchmarkConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.queries) || !Array.isArray(candidate.competitors)) {
    return false;
  }

  return true;
}

function normalizeDraft(config: BenchmarkConfig): BenchmarkConfig {
  const competitors = uniqueStrings(config.competitors);
  const queries = uniqueStrings(config.queries);
  const aliases: Record<string, string[]> = {};

  for (const competitor of competitors) {
    aliases[competitor] = uniqueStrings([
      competitor,
      ...(config.aliases[competitor] ?? config.aliases[competitor.toLowerCase()] ?? []),
    ]);
  }

  return {
    queries,
    competitors,
    aliases,
  };
}

function readLocalConfigOverride(): BenchmarkConfig | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_CONFIG_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isConfigShape(parsed)) {
      return null;
    }

    return normalizeDraft(parsed);
  } catch {
    return null;
  }
}

function fmtDate(value: string | null): string {
  if (!value) {
    return "n/a";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "n/a";
  }
  return parsed.toLocaleString();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let details = `${response.status} ${response.statusText}`;
    try {
      const errorBody = (await response.json()) as { error?: string; details?: string };
      details = errorBody.error
        ? `${errorBody.error}${errorBody.details ? ` ${errorBody.details}` : ""}`
        : details;
    } catch {
      // Fallback to status text when the response body is not JSON.
    }
    throw new Error(details);
  }
  return (await response.json()) as T;
}

function MetricCard({
  label,
  value,
  accent,
  caption,
}: {
  label: string;
  value: string;
  accent?: boolean;
  caption?: string;
}) {
  return (
    <Card className={accent ? "metric-card border-primary/40" : "metric-card"}>
      <CardHeader className="pb-2">
        <CardDescription className="text-[11px] uppercase tracking-[0.2em]">{label}</CardDescription>
        <CardTitle className="metric-value">{value}</CardTitle>
      </CardHeader>
      {caption ? (
        <CardContent className="pt-0 text-xs text-muted-foreground">{caption}</CardContent>
      ) : null}
    </Card>
  );
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [config, setConfig] = useState<BenchmarkConfig | null>(null);
  const [draft, setDraft] = useState<BenchmarkConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newCompetitor, setNewCompetitor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<DataSource | null>(null);
  const [isLocalOverrideActive, setIsLocalOverrideActive] = useState(false);

  const loadData = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    setError(null);

    const localOverride = readLocalConfigOverride();
    setIsLocalOverrideActive(Boolean(localOverride));

    try {
      const [dashboardResponse, configResponse] = await Promise.all([
        fetchJson<DashboardResponse>("/api/dashboard"),
        fetchJson<ConfigResponse>("/api/config"),
      ]);
      const normalizedConfig = normalizeDraft(configResponse.config);
      setDashboard(dashboardResponse);
      setConfig(normalizedConfig);
      setDraft(normalizedConfig);
      setDataSource("api");
    } catch (apiError) {
      try {
        const [dashboardSnapshot, configSnapshot] = await Promise.all([
          fetchJson<DashboardResponse>("/data/dashboard.json"),
          fetchJson<BenchmarkConfig>("/data/config.json"),
        ]);

        const normalizedConfig = localOverride ?? normalizeDraft(configSnapshot);
        setDashboard(dashboardSnapshot);
        setConfig(normalizedConfig);
        setDraft(normalizedConfig);
        setDataSource("snapshot");
        setFeedback(
          localOverride
            ? "Loaded your locally saved config override for this deployment."
            : "Using bundled snapshot data (no live API detected).",
        );
      } catch (snapshotError) {
        const apiReason = apiError instanceof Error ? apiError.message : String(apiError);
        const snapshotReason =
          snapshotError instanceof Error ? snapshotError.message : String(snapshotError);
        setError(
          `Failed to load both API and snapshot data. API: ${apiReason}. Snapshot: ${snapshotReason}.`,
        );
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const isDirty = useMemo(() => {
    if (!config || !draft) {
      return false;
    }
    return JSON.stringify(config) !== JSON.stringify(draft);
  }, [config, draft]);

  const mentionLeaderboard = useMemo(() => {
    const points = dashboard?.competitorSeries ?? [];
    return [...points].sort((a, b) => b.mentionRatePct - a.mentionRatePct);
  }, [dashboard]);

  const promptStatusRows = useMemo(() => {
    const rows = dashboard?.promptStatus ?? [];
    const rowByQuery = new Map(rows.map((row) => [row.query, row]));

    const computed = (config?.queries ?? []).map((query) => {
      const existing = rowByQuery.get(query);
      if (existing) {
        return existing;
      }
      return {
        query,
        status: "awaiting_run" as const,
        runs: 0,
        highchartsRatePct: 0,
        viabilityRatePct: 0,
        topCompetitor: null,
      };
    });

    return [...computed].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "tracked" ? -1 : 1;
      }
      return b.highchartsRatePct - a.highchartsRatePct;
    });
  }, [config, dashboard]);

  const missingData = useMemo(() => {
    if (!dashboard) {
      return [] as string[];
    }
    const issues: string[] = [];
    if (!dashboard.files.comparisonTablePresent) {
      issues.push("comparison_table.csv is missing or empty");
    }
    if (!dashboard.files.competitorChartPresent) {
      issues.push("looker_competitor_chart.csv is missing or empty");
    }
    if (!dashboard.files.kpiPresent) {
      issues.push("looker_kpi.csv is missing or empty");
    }
    if (!dashboard.files.llmOutputsPresent) {
      issues.push("llm_outputs.jsonl is missing or empty");
    }
    return issues;
  }, [dashboard]);

  const addPrompt = () => {
    if (!draft) {
      return;
    }
    const candidate = newPrompt.trim();
    if (!candidate) {
      return;
    }
    if (draft.queries.some((query) => query.toLowerCase() === candidate.toLowerCase())) {
      setFeedback("Prompt already exists.");
      return;
    }

    setDraft({
      ...draft,
      queries: [...draft.queries, candidate],
    });
    setNewPrompt("");
    setFeedback(null);
  };

  const removePrompt = (index: number) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        queries: current.queries.filter((_, currentIndex) => currentIndex !== index),
      };
    });
  };

  const updatePrompt = (index: number, value: string) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const queries = [...current.queries];
      queries[index] = value;
      return {
        ...current,
        queries,
      };
    });
  };

  const addCompetitor = () => {
    if (!draft) {
      return;
    }

    const candidate = newCompetitor.trim();
    if (!candidate) {
      return;
    }

    if (draft.competitors.some((entity) => entity.toLowerCase() === candidate.toLowerCase())) {
      setFeedback("Competitor already exists.");
      return;
    }

    setDraft({
      ...draft,
      competitors: [...draft.competitors, candidate],
      aliases: {
        ...draft.aliases,
        [candidate]: uniqueStrings([candidate, candidate.toLowerCase()]),
      },
    });
    setNewCompetitor("");
    setFeedback(null);
  };

  const removeCompetitor = (name: string) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const nextAliases = { ...current.aliases };
      delete nextAliases[name];

      return {
        ...current,
        competitors: current.competitors.filter((entity) => entity !== name),
        aliases: nextAliases,
      };
    });
  };

  const resetDraft = () => {
    if (!config) {
      return;
    }
    setDraft(config);
    setFeedback("Edits reset to saved config.");
  };

  const downloadConfig = () => {
    if (!draft || typeof window === "undefined") {
      return;
    }

    const payload = `${JSON.stringify(normalizeDraft(draft), null, 2)}\n`;
    const blob = new Blob([payload], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "benchmark_config.json";
    link.click();
    URL.revokeObjectURL(href);
  };

  const saveDraft = async () => {
    if (!draft) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setFeedback(null);

    try {
      const normalized = normalizeDraft(draft);
      if (normalized.queries.length === 0) {
        throw new Error("At least one prompt is required.");
      }
      if (normalized.competitors.length === 0) {
        throw new Error("At least one competitor is required.");
      }
      if (!normalized.competitors.some((entity) => entity.toLowerCase() === "highcharts")) {
        throw new Error("Highcharts must remain in the competitors list.");
      }

      if (dataSource === "api") {
        const response = await fetchJson<ConfigResponse>("/api/config", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(normalized),
        });

        const saved = normalizeDraft(response.config);
        setConfig(saved);
        setDraft(saved);
        setFeedback("Config saved to config/benchmark_config.json.");
        await loadData("refresh");
      } else {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(normalized));
        }
        setConfig(normalized);
        setDraft(normalized);
        setIsLocalOverrideActive(true);
        setFeedback(
          "Config saved in this browser for the deployed app. Use Download JSON to share or commit changes.",
        );
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save config.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="app-shell">
        <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6">
          <Card className="w-full max-w-xl border-primary/25 bg-card/90 text-center backdrop-blur">
            <CardHeader>
              <CardTitle className="font-display text-2xl">Booting dashboard</CardTitle>
              <CardDescription>Loading benchmark outputs and configuration files.</CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main className="relative mx-auto w-full max-w-7xl px-4 py-8 md:px-8 lg:py-10">
        <section className="hero-card mb-5 rounded-[2rem] border border-border/80 bg-card/80 p-6 backdrop-blur-md md:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <p className="eyebrow mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase">
                <Gauge className="size-3.5" />
                LLM Visibility Command Center
              </p>
              <h1 className="font-display text-3xl leading-tight tracking-tight md:text-5xl">
                Dashboard and Admin Panel for Prompt Benchmarking
              </h1>
              <p className="mt-3 max-w-3xl text-sm text-muted-foreground md:text-base">
                Monitor current benchmark performance, track prompt-level mention rates, and manage the live prompt
                list used by the benchmark runner.
              </p>
            </div>

            <div className="grid gap-3 rounded-2xl border border-primary/20 bg-background/85 p-4">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <span>Run context</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="border-primary/35 bg-primary/5 text-primary">
                    {dashboard?.summary.runMonth ?? "No run month"}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      dataSource === "api"
                        ? "border-emerald-500/40 bg-emerald-100/60 text-emerald-900"
                        : "border-amber-500/40 bg-amber-100/60 text-amber-900"
                    }
                  >
                    {dataSource === "api" ? "Live API" : "Snapshot"}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Window start:</span>{" "}
                  <span className="font-medium">{fmtDate(dashboard?.summary.windowStartUtc ?? null)}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Window end:</span>{" "}
                  <span className="font-medium">{fmtDate(dashboard?.summary.windowEndUtc ?? null)}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Model(s):</span>{" "}
                  <span className="font-medium">{dashboard?.summary.models.join(", ") || "n/a"}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Web search:</span>{" "}
                  <span className="font-medium">{dashboard?.summary.webSearchEnabled ?? "n/a"}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="border-primary/35 bg-background/80"
              onClick={() => {
                void loadData("refresh");
              }}
              disabled={isRefreshing}
            >
              <RefreshCcw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh data
            </Button>
            <Button variant="outline" className="border-primary/35 bg-background/80" onClick={downloadConfig}>
              <Download className="size-4" />
              Download config JSON
            </Button>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              {fmtDate(dashboard?.generatedAt ?? null)}
            </Badge>
          </div>
        </section>

        {dataSource === "snapshot" ? (
          <Alert className="mb-5 border-amber-500/45 bg-amber-100/50 text-amber-950">
            <Database className="size-4" />
            <AlertTitle>Snapshot mode active</AlertTitle>
            <AlertDescription>
              The deployment is running without a writable backend. Admin saves are stored in your browser and can
              be exported via Download config JSON.
            </AlertDescription>
          </Alert>
        ) : null}

        {isLocalOverrideActive && dataSource === "snapshot" ? (
          <Alert className="mb-5 border-blue-500/40 bg-blue-100/45 text-blue-950">
            <AlertTitle>Local override loaded</AlertTitle>
            <AlertDescription>
              This browser has a saved prompt/competitor override applied on top of the bundled snapshot.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive" className="mb-5">
            <AlertCircle className="size-4" />
            <AlertTitle>Interface error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {feedback ? (
          <Alert className="mb-5 border-primary/30 bg-primary/10">
            <AlertTitle>Update</AlertTitle>
            <AlertDescription>{feedback}</AlertDescription>
          </Alert>
        ) : null}

        {missingData.length > 0 ? (
          <Alert className="mb-5 border-amber-400/45 bg-amber-100/40 text-amber-900">
            <AlertTitle>Some benchmark outputs are missing</AlertTitle>
            <AlertDescription>{missingData.join("; ")}</AlertDescription>
          </Alert>
        ) : null}

        <Tabs defaultValue="dashboard" className="gap-4">
          <TabsList className="w-full max-w-md border border-border/70 bg-card/70 backdrop-blur">
            <TabsTrigger value="dashboard" className="gap-2">
              <BarChart3 className="size-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="admin" className="gap-2">
              <Settings2 className="size-4" />
              Admin Panel
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-5">
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="AI Visibility Overall"
                value={`${dashboard?.summary.overallScore.toFixed(2) ?? "0.00"} / 100`}
                caption="From output/looker_kpi.csv"
                accent
              />
              <MetricCard
                label="Tracked prompts"
                value={String(config?.queries.length ?? 0)}
                caption="Current active config"
              />
              <MetricCard
                label="Competitors"
                value={String(config?.competitors.length ?? 0)}
                caption="Includes Highcharts"
              />
              <MetricCard
                label="Total responses"
                value={String(dashboard?.summary.totalResponses ?? 0)}
                caption="Rows in output/llm_outputs.jsonl"
              />
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <Card className="panel-card">
                <CardHeader>
                  <CardTitle className="font-display text-xl">Entity mention rates</CardTitle>
                  <CardDescription>
                    Percentage of responses that mention each tracked entity in the latest benchmark window.
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mentionLeaderboard} margin={{ top: 16, right: 12, left: 0, bottom: 24 }}>
                      <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="entity"
                        angle={-28}
                        interval={0}
                        height={64}
                        tick={{ fontSize: 12 }}
                        textAnchor="end"
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                        tick={{ fontSize: 12 }}
                        width={40}
                      />
                      <Tooltip
                        formatter={(value: number | string | undefined) =>
                          `${Number(value ?? 0).toFixed(2)}%`
                        }
                        contentStyle={{ borderRadius: 12, borderColor: "hsl(var(--border))" }}
                      />
                      <Bar dataKey="mentionRatePct" radius={[8, 8, 0, 0]}>
                        {mentionLeaderboard.map((entry) => (
                          <Cell
                            key={entry.entityKey}
                            fill={entry.isHighcharts ? "hsl(var(--chart-2))" : "hsl(var(--chart-4))"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="panel-card">
                <CardHeader>
                  <CardTitle className="font-display text-xl">Share of voice</CardTitle>
                  <CardDescription>
                    Share of total mentions captured by each entity across all responses in the latest run.
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mentionLeaderboard} margin={{ top: 16, right: 12, left: 0, bottom: 24 }}>
                      <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="entity"
                        angle={-28}
                        interval={0}
                        height={64}
                        tick={{ fontSize: 12 }}
                        textAnchor="end"
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                        tick={{ fontSize: 12 }}
                        width={40}
                      />
                      <Tooltip
                        formatter={(value: number | string | undefined) =>
                          `${Number(value ?? 0).toFixed(2)}%`
                        }
                        contentStyle={{ borderRadius: 12, borderColor: "hsl(var(--border))" }}
                      />
                      <Bar dataKey="shareOfVoicePct" radius={[8, 8, 0, 0]}>
                        {mentionLeaderboard.map((entry) => (
                          <Cell
                            key={`${entry.entityKey}-sov`}
                            fill={entry.isHighcharts ? "hsl(var(--chart-1))" : "hsl(var(--chart-5))"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </section>

            <Card className="panel-card">
              <CardHeader>
                <CardTitle className="font-display text-xl">Prompt tracker</CardTitle>
                <CardDescription>
                  Compare configured prompts against latest benchmark data and identify prompts awaiting a new run.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[420px] rounded-lg border border-border/80">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[36%]">Prompt</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Runs</TableHead>
                        <TableHead className="text-right">Highcharts rate</TableHead>
                        <TableHead className="text-right">Viability</TableHead>
                        <TableHead>Top competitor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {promptStatusRows.map((row) => (
                        <TableRow key={row.query}>
                          <TableCell className="max-w-[460px] whitespace-normal font-medium">{row.query}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                row.status === "tracked"
                                  ? "border-emerald-500/40 bg-emerald-100/60 text-emerald-900"
                                  : "border-amber-500/40 bg-amber-100/60 text-amber-900"
                              }
                            >
                              {row.status === "tracked" ? "tracked" : "awaiting run"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">{row.runs}</TableCell>
                          <TableCell className="text-right font-mono">{row.highchartsRatePct.toFixed(2)}%</TableCell>
                          <TableCell className="text-right font-mono">{row.viabilityRatePct.toFixed(2)}%</TableCell>
                          <TableCell className="whitespace-normal text-sm text-muted-foreground">
                            {row.topCompetitor
                              ? `${row.topCompetitor.entity} (${row.topCompetitor.ratePct.toFixed(2)}%)`
                              : "n/a"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="admin" className="space-y-5">
            <section className="grid gap-5 lg:grid-cols-2">
              <Card className="panel-card">
                <CardHeader>
                  <CardTitle className="font-display text-xl">Prompt admin</CardTitle>
                  <CardDescription>
                    Add, remove, and revise prompts that feed the benchmark query set.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={newPrompt}
                      onChange={(event) => setNewPrompt(event.target.value)}
                      placeholder="Add a new benchmark prompt"
                    />
                    <Button onClick={addPrompt} className="sm:w-[140px]">
                      <Plus className="size-4" />
                      Add prompt
                    </Button>
                  </div>

                  <Separator />

                  <ScrollArea className="max-h-[360px] pr-2">
                    <div className="space-y-2">
                      {(draft?.queries ?? []).map((prompt, index) => (
                        <div
                          key={`prompt-${index}`}
                          className="flex items-center gap-2 rounded-lg border border-border/70 p-2"
                        >
                          <Input
                            value={prompt}
                            onChange={(event) => updatePrompt(index, event.target.value)}
                            placeholder="Prompt text"
                            className="bg-background/80"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="shrink-0"
                            onClick={() => removePrompt(index)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card className="panel-card">
                <CardHeader>
                  <CardTitle className="font-display text-xl">Competitor tracking</CardTitle>
                  <CardDescription>
                    Maintain the active competitor list. Highcharts should stay in the list for score comparisons.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={newCompetitor}
                      onChange={(event) => setNewCompetitor(event.target.value)}
                      placeholder="Add competitor"
                    />
                    <Button onClick={addCompetitor} className="sm:w-[140px]">
                      <Plus className="size-4" />
                      Add entity
                    </Button>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    {(draft?.competitors ?? []).map((entity) => (
                      <div
                        key={entity}
                        className="flex items-center justify-between rounded-lg border border-border/70 bg-background/70 px-3 py-2"
                      >
                        <div>
                          <p className="font-medium">{entity}</p>
                          <p className="text-xs text-muted-foreground">
                            Aliases: {(draft?.aliases[entity] ?? []).join(", ") || "auto"}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => removeCompetitor(entity)}
                          disabled={entity.toLowerCase() === "highcharts"}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </section>

            <Card className="panel-card">
              <CardHeader>
                <CardTitle className="font-display text-xl">Save changes</CardTitle>
                <CardDescription>
                  {dataSource === "api"
                    ? "Persist updates directly into config/benchmark_config.json for the benchmark runner."
                    : "Persist updates in browser storage for this deployment and export JSON for sharing."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void saveDraft()} disabled={!isDirty || isSaving}>
                  <Save className="size-4" />
                  {isSaving ? "Saving..." : dataSource === "api" ? "Save config" : "Save in browser"}
                </Button>
                <Button variant="outline" onClick={downloadConfig}>
                  <Download className="size-4" />
                  Download JSON
                </Button>
                <Button variant="outline" onClick={resetDraft} disabled={!isDirty || isSaving}>
                  Reset edits
                </Button>
                <Badge
                  variant="outline"
                  className={
                    isDirty ? "border-amber-500/45 text-amber-900" : "border-emerald-500/45 text-emerald-900"
                  }
                >
                  {isDirty ? "Unsaved changes" : "All changes saved"}
                </Badge>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default App;
