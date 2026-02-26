import csv
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import llm_mention_benchmark as bench


class FakeResponsesAPI:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if not self.payloads:
            raise RuntimeError("No payload left")
        return self.payloads.pop(0)


class FakeMessagesAPI:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if not self.payloads:
            raise RuntimeError("No payload left")
        return self.payloads.pop(0)


class FakeClient:
    def __init__(self, payloads):
        self.responses = FakeResponsesAPI(payloads)


class FakeAnthropicClient:
    def __init__(self, payloads):
        self.messages = FakeMessagesAPI(payloads)


class FakeGeminiClient:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if not self.payloads:
            raise RuntimeError("No payload left")
        return self.payloads.pop(0)


class MentionDetectionTests(unittest.TestCase):
    def setUp(self):
        self.specs = bench.build_entity_specs(["EasyLLM"])
        self.patterns = bench.compile_entity_patterns(self.specs)

    def test_case_insensitive_alias_matches(self):
        text = (
            "Top picks are HIGHCHARTS, chart js, AG-CHARTS, and d3. "
            "EasyLLM also appears in this output."
        )
        mentions = bench.detect_mentions(text, self.patterns)
        self.assertTrue(mentions["our_brand"])
        self.assertTrue(mentions["highcharts"])
        self.assertTrue(mentions["chart_js"])
        self.assertTrue(mentions["ag_chart"])
        self.assertTrue(mentions["d3_js"])

    def test_boundary_blocks_partial_words(self):
        text = "This references flowchartjs and aggridding, but no target libraries."
        mentions = bench.detect_mentions(text, self.patterns)
        self.assertFalse(mentions["chart_js"])
        self.assertFalse(mentions["ag_grid"])


class ConfigLoadingTests(unittest.TestCase):
    def test_load_benchmark_config_from_json(self):
        payload = {
            "queries": ["q1", "q2"],
            "competitors": ["d3.js", "Highcharts", "visx"],
            "aliases": {"visx": ["visx", "vis x"]},
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "benchmark_config.json"
            config_path.write_text(json.dumps(payload), encoding="utf-8")

            queries, competitors, aliases, source = bench.load_benchmark_config(
                str(config_path)
            )

        self.assertEqual(queries, ["q1", "q2"])
        self.assertEqual(competitors, ["d3.js", "Highcharts", "visx"])
        self.assertIn("visx", aliases)
        self.assertEqual(aliases["visx"], ["visx", "vis x"])
        self.assertEqual(source, str(config_path.resolve()))


class AggregationTests(unittest.TestCase):
    def setUp(self):
        self.specs = bench.build_entity_specs(["EasyLLM"])

    def _record(self, query, true_keys, citations):
        mentions = {spec.key: False for spec in self.specs}
        for key in true_keys:
            mentions[key] = True
        return {
            "query": query,
            "mentions": mentions,
            "citations": [{"url": f"https://example.com/{i}"} for i in range(citations)],
        }

    def test_comparison_rows_and_overall_math(self):
        query_a = bench.DEFAULT_QUERIES[0]
        query_b = bench.DEFAULT_QUERIES[1]
        records = [
            self._record(query_a, ["highcharts", "chart_js"], citations=2),
            self._record(query_a, ["highcharts"], citations=0),
            self._record(query_a, ["our_brand"], citations=1),
            self._record(query_b, ["d3_js"], citations=1),
            self._record(query_b, [], citations=0),
            self._record(query_b, ["chart_js", "ag_grid"], citations=0),
        ]

        rows = bench.build_comparison_rows(
            records=records,
            specs=self.specs,
            queries=[query_a, query_b],
            runs_per_query=3,
            web_search_enabled=True,
        )
        row_a = next(row for row in rows if row["query"] == query_a)
        overall = next(row for row in rows if row["query"] == "OVERALL")

        self.assertEqual(row_a["highcharts_count"], 2)
        self.assertEqual(row_a["chart_js_count"], 1)
        self.assertEqual(row_a["our_brand_count"], 1)
        self.assertEqual(row_a["citation_count"], 3)
        self.assertEqual(row_a["viability_index_count"], 3)
        self.assertAlmostEqual(row_a["viability_index_rate"], 0.125, places=4)

        self.assertEqual(overall["runs"], 6)
        self.assertEqual(overall["viability_index_count"], 6)
        self.assertAlmostEqual(overall["viability_index_rate"], 0.125, places=4)


class CitationExtractionTests(unittest.TestCase):
    def test_extracts_from_annotations_and_content_lists(self):
        response_dict = {
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "Sample text.",
                            "citations": [
                                {
                                    "title": "Library docs",
                                    "url": "https://docs.example.com",
                                    "snippet": "Example snippet",
                                }
                            ],
                            "annotations": [
                                {
                                    "type": "url_citation",
                                    "title": "News source",
                                    "url": "https://news.example.com",
                                    "text": "News snippet",
                                }
                            ],
                        }
                    ],
                }
            ]
        }

        citations = bench.extract_citations(response_dict)
        urls = {item["url"] for item in citations}
        self.assertEqual(len(citations), 2)
        self.assertIn("https://docs.example.com", urls)
        self.assertIn("https://news.example.com", urls)

    def test_extracts_empty_when_no_citations(self):
        self.assertEqual(bench.extract_citations({"output": []}), [])


class ProviderRoutingTests(unittest.TestCase):
    def test_infers_provider_from_model(self):
        self.assertEqual(bench.infer_provider_from_model("gpt-4o-mini"), "openai")
        self.assertEqual(
            bench.infer_provider_from_model("claude-3-5-sonnet-latest"),
            "anthropic",
        )
        self.assertEqual(
            bench.infer_provider_from_model("gemini-2.0-flash"),
            "google",
        )

    def test_resolves_provider_default_api_key_env(self):
        self.assertEqual(bench.resolve_api_key_env("openai", ""), "OPENAI_API_KEY")
        self.assertEqual(
            bench.resolve_api_key_env("anthropic", ""),
            "ANTHROPIC_API_KEY",
        )
        self.assertEqual(
            bench.resolve_api_key_env("google", ""),
            "GEMINI_API_KEY",
        )
        self.assertEqual(
            bench.resolve_api_key_env("anthropic", "CUSTOM_KEY"),
            "CUSTOM_KEY",
        )

    def test_infers_model_owner_from_provider(self):
        self.assertEqual(bench.infer_model_owner("openai"), "OpenAI")
        self.assertEqual(bench.infer_model_owner("anthropic"), "Anthropic")
        self.assertEqual(bench.infer_model_owner("google"), "Google")


class CliIntegrationTests(unittest.TestCase):
    def test_main_writes_expected_outputs(self):
        template_payloads = [
            "Highcharts and chart.js are common.",
            "d3.js and Recharts are often used.",
            "AG Grid and AG Chart can appear together.",
            "echarts and amcharts support accessibility options.",
        ]
        payloads = []
        for idx, _query in enumerate(bench.DEFAULT_QUERIES):
            payloads.append(
                {
                    "output_text": template_payloads[idx % len(template_payloads)],
                    "citations": [
                        {
                            "title": f"Source {idx + 1}",
                            "url": f"https://example.com/{idx + 1}",
                        }
                    ],
                }
            )
        fake_client = FakeClient(payloads)

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "benchmark_config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "queries": bench.DEFAULT_QUERIES,
                        "competitors": bench.COMPETITORS,
                        "aliases": bench.COMPETITOR_ALIASES,
                    }
                ),
                encoding="utf-8",
            )
            with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=False):
                with mock.patch.object(
                    bench, "create_openai_client", return_value=fake_client
                ):
                    exit_code = bench.main(
                        [
                            "--our-terms",
                            "EasyLLM,Easy LLM Benchmarker",
                            "--runs",
                            "1",
                            "--web-search",
                            "--output-dir",
                            temp_dir,
                            "--config",
                            str(config_path),
                        ]
                    )

            self.assertEqual(exit_code, 0)
            jsonl_path = Path(temp_dir) / "llm_outputs.jsonl"
            comparison_path = Path(temp_dir) / "comparison_table.csv"
            viability_path = Path(temp_dir) / "viability_index.csv"

            self.assertTrue(jsonl_path.exists())
            self.assertTrue(comparison_path.exists())
            self.assertTrue(viability_path.exists())

            jsonl_lines = jsonl_path.read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(jsonl_lines), len(bench.DEFAULT_QUERIES))
            parsed = [json.loads(line) for line in jsonl_lines]
            self.assertTrue(all(item["web_search_enabled"] for item in parsed))
            self.assertTrue(all(isinstance(item["citations"], list) for item in parsed))

            with comparison_path.open(newline="", encoding="utf-8") as handle:
                comparison_rows = list(csv.DictReader(handle))
            self.assertEqual(len(comparison_rows), len(bench.DEFAULT_QUERIES) + 1)
            self.assertIn("viability_index_count", comparison_rows[0])
            self.assertIn("our_brand_yes", comparison_rows[0])
            self.assertIn("highcharts_yes", comparison_rows[0])
            self.assertIn("chart_js_yes", comparison_rows[0])
            self.assertTrue(all(row["web_search_enabled"] == "yes" for row in comparison_rows))

            with viability_path.open(newline="", encoding="utf-8") as handle:
                viability_rows = list(csv.DictReader(handle))
            expected_entities = len(bench.build_entity_specs(["EasyLLM"]))
            expected_rows = expected_entities * (len(bench.DEFAULT_QUERIES) + 1)
            self.assertEqual(len(viability_rows), expected_rows)

            for request_payload in fake_client.responses.calls:
                self.assertIn("tools", request_payload)
                self.assertEqual(request_payload["tools"], [{"type": "web_search_preview"}])

    def test_main_routes_claude_models_to_anthropic_client(self):
        payloads = []
        for idx, _query in enumerate(bench.DEFAULT_QUERIES):
            payloads.append(
                {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Claude response {idx + 1} mentioning Highcharts.",
                        }
                    ]
                }
            )
        fake_client = FakeAnthropicClient(payloads)

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "benchmark_config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "queries": bench.DEFAULT_QUERIES,
                        "competitors": bench.COMPETITORS,
                        "aliases": bench.COMPETITOR_ALIASES,
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch.dict(
                os.environ,
                {"ANTHROPIC_API_KEY": "test-key"},
                clear=False,
            ):
                with mock.patch.object(
                    bench,
                    "create_anthropic_client",
                    return_value=fake_client,
                ):
                    exit_code = bench.main(
                        [
                            "--our-terms",
                            "EasyLLM",
                            "--model",
                            "claude-3-5-sonnet-latest",
                            "--runs",
                            "1",
                            "--output-dir",
                            temp_dir,
                            "--config",
                            str(config_path),
                        ]
                    )

            self.assertEqual(exit_code, 0)

            for request_payload in fake_client.messages.calls:
                self.assertEqual(
                    request_payload["model"],
                    "claude-3-5-sonnet-latest",
                )
                self.assertNotIn("tools", request_payload)

    def test_main_routes_gemini_models_to_gemini_client(self):
        payloads = []
        for idx, _query in enumerate(bench.DEFAULT_QUERIES):
            payloads.append(
                {
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {
                                        "text": (
                                            f"Gemini response {idx + 1} mentioning Highcharts."
                                        )
                                    }
                                ]
                            }
                        }
                    ]
                }
            )
        fake_client = FakeGeminiClient(payloads)

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "benchmark_config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "queries": bench.DEFAULT_QUERIES,
                        "competitors": bench.COMPETITORS,
                        "aliases": bench.COMPETITOR_ALIASES,
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch.dict(
                os.environ,
                {"GEMINI_API_KEY": "test-key"},
                clear=False,
            ):
                with mock.patch.object(
                    bench,
                    "create_gemini_client",
                    return_value=fake_client,
                ):
                    exit_code = bench.main(
                        [
                            "--our-terms",
                            "EasyLLM",
                            "--model",
                            "gemini-2.0-flash",
                            "--runs",
                            "1",
                            "--output-dir",
                            temp_dir,
                            "--config",
                            str(config_path),
                        ]
                    )

            self.assertEqual(exit_code, 0)
            self.assertEqual(len(fake_client.calls), len(bench.DEFAULT_QUERIES))
            for request_payload in fake_client.calls:
                self.assertEqual(request_payload["model"], "gemini-2.0-flash")
                self.assertIn("system_prompt", request_payload)
                self.assertIn("user_prompt", request_payload)


if __name__ == "__main__":
    unittest.main()
