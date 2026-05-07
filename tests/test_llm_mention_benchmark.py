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
        text_block = "Highcharts has robust accessibility support."
        response_dict = {
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": text_block,
                            "citations": [
                                {
                                    "title": "Library docs",
                                    "url": "https://docs.example.com",
                                    "snippet": "Example snippet",
                                    "start_index": 0,
                                    "end_index": 10,
                                }
                            ],
                            "annotations": [
                                {
                                    "type": "url_citation",
                                    "url_citation": {
                                        "title": "News source",
                                        "url": "https://news.example.com",
                                        "text": "News snippet",
                                        "start_index": 12,
                                        "end_index": 18,
                                    },
                                }
                            ],
                        }
                    ],
                }
            ]
        }

        citations = bench.extract_citations(response_dict)
        by_url = {item["url"]: item for item in citations}
        self.assertEqual(len(citations), 2)
        self.assertIn("https://docs.example.com", by_url)
        self.assertIn("https://news.example.com", by_url)
        self.assertEqual(by_url["https://docs.example.com"]["host"], "docs.example.com")
        self.assertEqual(by_url["https://docs.example.com"]["start_index"], 0)
        self.assertEqual(by_url["https://docs.example.com"]["end_index"], 10)
        self.assertEqual(by_url["https://docs.example.com"]["anchor_text"], "Highcharts")
        self.assertEqual(by_url["https://news.example.com"]["anchor_text"], "as rob")
        self.assertEqual(by_url["https://docs.example.com"]["provider"], "openai")

    def test_extracts_empty_when_no_citations(self):
        self.assertEqual(bench.extract_citations({"output": []}), [])

    def test_legacy_citation_objects_remain_supported(self):
        citations = bench.extract_citations(
            {
                "citations": [
                    {
                        "title": "Legacy source",
                        "url": "https://legacy.example.com/path",
                        "snippet": "Legacy snippet",
                    }
                ]
            }
        )
        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0]["url"], "https://legacy.example.com/path")
        self.assertEqual(citations[0]["host"], "legacy.example.com")
        self.assertIsNone(citations[0]["start_index"])
        self.assertIsNone(citations[0]["end_index"])


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

    def test_parses_model_names_from_csv(self):
        models = bench.parse_model_names("gpt-4o-mini, claude-3-5-sonnet-latest, gpt-4o-mini")
        self.assertEqual(models, ["gpt-4o-mini", "claude-3-5-sonnet-latest"])

    def test_extracts_token_usage_from_multiple_provider_shapes(self):
        openai_usage = bench.extract_token_usage(
            {"usage": {"input_tokens": 11, "output_tokens": 7, "total_tokens": 18}}
        )
        anthropic_usage = bench.extract_token_usage(
            {"usage": {"input_tokens": 5, "output_tokens": 3}}
        )
        gemini_usage = bench.extract_token_usage(
            {"usageMetadata": {"promptTokenCount": 9, "candidatesTokenCount": 6}}
        )

        self.assertEqual(openai_usage["prompt_tokens"], 11)
        self.assertEqual(openai_usage["completion_tokens"], 7)
        self.assertEqual(openai_usage["total_tokens"], 18)

        self.assertEqual(anthropic_usage["prompt_tokens"], 5)
        self.assertEqual(anthropic_usage["completion_tokens"], 3)
        self.assertEqual(anthropic_usage["total_tokens"], 8)

        self.assertEqual(gemini_usage["prompt_tokens"], 9)
        self.assertEqual(gemini_usage["completion_tokens"], 6)
        self.assertEqual(gemini_usage["total_tokens"], 15)

    def test_openai_uses_openai_specific_system_prompt(self):
        fake_client = FakeClient([{"output_text": "OpenAI response mentioning Highcharts."}])

        text, citations, usage = bench.generate_with_optional_retry(
            fake_client,
            "openai",
            "gpt-4o",
            "charting libraries",
            0.7,
            False,
        )

        self.assertEqual(text, "OpenAI response mentioning Highcharts.")
        self.assertEqual(citations, [])
        self.assertEqual(usage["total_tokens"], 0)
        self.assertEqual(len(fake_client.responses.calls), 1)
        system_prompt = fake_client.responses.calls[0]["input"][0]["content"]
        self.assertEqual(system_prompt, bench.OPENAI_SYSTEM_PROMPT)
        self.assertEqual(fake_client.responses.calls[0]["temperature"], 0.7)

    def test_anthropic_keeps_default_system_prompt(self):
        fake_client = FakeAnthropicClient(
            [{"content": [{"type": "text", "text": "Anthropic response."}]}]
        )

        text, citations, usage = bench.generate_with_optional_retry(
            fake_client,
            "anthropic",
            "claude-3-5-sonnet-latest",
            "charting libraries",
            0.7,
            False,
        )

        self.assertEqual(text, "Anthropic response.")
        self.assertEqual(citations, [])
        self.assertEqual(usage["total_tokens"], 0)
        self.assertEqual(len(fake_client.messages.calls), 1)
        self.assertEqual(fake_client.messages.calls[0]["system"], bench.SYSTEM_PROMPT)
        self.assertEqual(fake_client.messages.calls[0]["temperature"], 0.7)

    def test_omits_temperature_for_models_that_reject_it(self):
        openai_client = FakeClient([{"output_text": "OpenAI response."}])
        anthropic_client = FakeAnthropicClient(
            [{"content": [{"type": "text", "text": "Anthropic response."}]}]
        )

        bench.generate_with_optional_retry(
            openai_client,
            "openai",
            "gpt-5.5",
            "charting libraries",
            0.7,
            False,
        )
        bench.generate_with_optional_retry(
            anthropic_client,
            "anthropic",
            "claude-opus-4-7",
            "charting libraries",
            0.7,
            False,
        )

        self.assertNotIn("temperature", openai_client.responses.calls[0])
        self.assertNotIn("temperature", anthropic_client.messages.calls[0])


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

    def test_main_supports_multiple_models_in_single_run(self):
        payloads = []
        for idx, _query in enumerate(bench.DEFAULT_QUERIES):
            payloads.append(
                {
                    "output_text": f"Model A response {idx + 1} mentioning Highcharts.",
                    "usage": {"input_tokens": 10, "output_tokens": 4, "total_tokens": 14},
                }
            )
            payloads.append(
                {
                    "output_text": f"Model B response {idx + 1} mentioning chart.js.",
                    "usage": {"input_tokens": 8, "output_tokens": 5, "total_tokens": 13},
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
                            "EasyLLM",
                            "--model",
                            "gpt-4o-mini,gpt-4o",
                            "--runs",
                            "1",
                            "--output-dir",
                            temp_dir,
                            "--config",
                            str(config_path),
                        ]
                    )

            self.assertEqual(exit_code, 0)

            jsonl_path = Path(temp_dir) / "llm_outputs.jsonl"
            jsonl_lines = jsonl_path.read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(jsonl_lines), len(bench.DEFAULT_QUERIES) * 2)

            parsed = [json.loads(line) for line in jsonl_lines]
            model_set = {row["model"] for row in parsed}
            self.assertEqual(model_set, {"gpt-4o-mini", "gpt-4o"})
            self.assertTrue(all("duration_ms" in row for row in parsed))
            self.assertTrue(all("prompt_tokens" in row for row in parsed))
            self.assertTrue(all("completion_tokens" in row for row in parsed))
            self.assertTrue(all("total_tokens" in row for row in parsed))
            self.assertTrue(all(isinstance(row["duration_ms"], int) for row in parsed))

            with (Path(temp_dir) / "comparison_table.csv").open(
                newline="", encoding="utf-8"
            ) as handle:
                comparison_rows = list(csv.DictReader(handle))
            non_overall_rows = [row for row in comparison_rows if row["query"] != "OVERALL"]
            self.assertTrue(all(row["runs"] == "2" for row in non_overall_rows))

    def test_main_respects_prompt_limit(self):
        config_queries = [
            "prompt one",
            "prompt two",
            "prompt three",
            "prompt four",
        ]
        fake_client = FakeClient(
            [
                {"output_text": "Highcharts mention in first prompt."},
                {"output_text": "Highcharts mention in second prompt."},
            ]
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "benchmark_config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "queries": config_queries,
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
                            "EasyLLM",
                            "--model",
                            "gpt-4o-mini",
                            "--runs",
                            "1",
                            "--prompt-limit",
                            "2",
                            "--output-dir",
                            temp_dir,
                            "--config",
                            str(config_path),
                        ]
                    )

            self.assertEqual(exit_code, 0)
            self.assertEqual(len(fake_client.responses.calls), 2)

            jsonl_path = Path(temp_dir) / "llm_outputs.jsonl"
            parsed = [
                json.loads(line)
                for line in jsonl_path.read_text(encoding="utf-8").strip().splitlines()
            ]
            self.assertEqual(len(parsed), 2)
            self.assertEqual([row["query"] for row in parsed], config_queries[:2])

            with (Path(temp_dir) / "comparison_table.csv").open(
                newline="", encoding="utf-8"
            ) as handle:
                comparison_rows = list(csv.DictReader(handle))
            self.assertEqual(len(comparison_rows), 3)
            self.assertEqual(
                [row["query"] for row in comparison_rows],
                ["prompt one", "prompt two", "OVERALL"],
            )


if __name__ == "__main__":
    unittest.main()
