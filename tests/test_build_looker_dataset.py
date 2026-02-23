import importlib.util
import sys
import unittest
from pathlib import Path


def _load_builder_module():
    module_path = (
        Path(__file__).resolve().parents[1] / "scripts" / "build_looker_dataset.py"
    )
    spec = importlib.util.spec_from_file_location("build_looker_dataset", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to import module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


builder = _load_builder_module()


class DynamicEntityTests(unittest.TestCase):
    def test_infer_entity_keys_excludes_our_brand_and_special_counts(self):
        rows = [
            {
                "query": "q1",
                "runs": "2",
                "web_search_enabled": "yes",
                "our_brand_yes": "no",
                "our_brand_count": "0",
                "our_brand_rate": "0.0",
                "highcharts_yes": "yes",
                "highcharts_count": "1",
                "highcharts_rate": "0.5",
                "d3_js_yes": "yes",
                "d3_js_count": "2",
                "d3_js_rate": "1.0",
                "visx_yes": "no",
                "visx_count": "0",
                "visx_rate": "0.0",
                "citation_count": "0",
                "viability_index_count": "2",
                "viability_index_rate": "0.5",
            }
        ]
        keys = builder.infer_entity_keys(rows)
        self.assertEqual(keys, ["highcharts", "d3_js", "visx"])

    def test_build_rows_uses_dynamic_competitor_keys(self):
        comparison_rows = [
            {
                "query": "q1",
                "runs": "2",
                "web_search_enabled": "yes",
                "highcharts_yes": "yes",
                "highcharts_count": "1",
                "highcharts_rate": "0.5",
                "d3_js_yes": "yes",
                "d3_js_count": "2",
                "d3_js_rate": "1.0",
                "visx_yes": "no",
                "visx_count": "0",
                "visx_rate": "0.0",
                "citation_count": "0",
                "viability_index_count": "2",
                "viability_index_rate": "0.5",
            },
            {
                "query": "OVERALL",
                "runs": "2",
                "web_search_enabled": "yes",
                "highcharts_yes": "yes",
                "highcharts_count": "1",
                "highcharts_rate": "0.5",
                "d3_js_yes": "yes",
                "d3_js_count": "2",
                "d3_js_rate": "1.0",
                "visx_yes": "no",
                "visx_count": "0",
                "visx_rate": "0.0",
                "citation_count": "0",
                "viability_index_count": "2",
                "viability_index_rate": "0.5",
            },
        ]
        entity_keys = builder.infer_entity_keys(comparison_rows)
        labels_by_key = builder.infer_entity_labels(
            viability_rows=[
                {"query": "OVERALL", "entity": "Highcharts"},
                {"query": "OVERALL", "entity": "d3.js"},
                {"query": "OVERALL", "entity": "visx"},
            ],
            entity_keys=entity_keys,
        )
        entity_meta = builder.build_entity_meta(entity_keys, labels_by_key)
        rows, overall_score = builder.build_rows(
            comparison_rows=comparison_rows,
            entity_meta=entity_meta,
            context={
                "window_start_utc": "2026-02-16T10:00:00+00:00",
                "window_end_utc": "2026-02-16T10:01:00+00:00",
                "models": "gpt-4o-mini",
            },
            run_month="2026-02",
            run_id="test-run-id",
        )

        self.assertEqual(len(rows), 6)
        highcharts_row = next(
            row for row in rows if row["query"] == "q1" and row["entity_key"] == "highcharts"
        )
        self.assertEqual(highcharts_row["entity_chart_sort"], 1)
        self.assertEqual(highcharts_row["ai_visibility_query_score"], "45.00")
        self.assertEqual(highcharts_row["query_viability_excl_highcharts_count"], 2)
        self.assertAlmostEqual(
            float(highcharts_row["query_viability_excl_highcharts_rate"]), 0.5
        )
        self.assertEqual(highcharts_row["highcharts_query_mentions_count"], 1)
        self.assertEqual(highcharts_row["d3_js_query_mentions_count"], 2)
        self.assertEqual(highcharts_row["visx_query_mentions_count"], 0)
        self.assertEqual(highcharts_row["d3_js_query_mentioned_yes"], "yes")
        self.assertEqual(highcharts_row["visx_query_mentioned_yes"], "no")
        self.assertAlmostEqual(overall_score, 45.0)

    def test_competitor_metric_rows_include_share_of_voice(self):
        comparison_rows = [
            {
                "query": "q1",
                "runs": "2",
                "web_search_enabled": "yes",
                "highcharts_yes": "yes",
                "highcharts_count": "1",
                "highcharts_rate": "0.5",
                "d3_js_yes": "yes",
                "d3_js_count": "2",
                "d3_js_rate": "1.0",
                "visx_yes": "no",
                "visx_count": "0",
                "visx_rate": "0.0",
                "citation_count": "0",
                "viability_index_count": "2",
                "viability_index_rate": "0.5",
            },
            {
                "query": "OVERALL",
                "runs": "2",
                "web_search_enabled": "yes",
                "highcharts_yes": "yes",
                "highcharts_count": "1",
                "highcharts_rate": "0.5",
                "d3_js_yes": "yes",
                "d3_js_count": "2",
                "d3_js_rate": "1.0",
                "visx_yes": "no",
                "visx_count": "0",
                "visx_rate": "0.0",
                "citation_count": "0",
                "viability_index_count": "2",
                "viability_index_rate": "0.5",
            },
        ]
        entity_keys = builder.infer_entity_keys(comparison_rows)
        labels_by_key = {
            "highcharts": "Highcharts",
            "d3_js": "d3.js",
            "visx": "visx",
        }
        entity_meta = builder.build_entity_meta(entity_keys, labels_by_key)
        rows = builder.build_competitor_metric_rows(
            comparison_rows=comparison_rows,
            entity_meta=entity_meta,
            context={
                "window_start_utc": "2026-02-16T10:00:00+00:00",
                "window_end_utc": "2026-02-16T10:01:00+00:00",
                "models": "gpt-4o-mini",
            },
            run_month="2026-02",
            run_id="test-run-id",
        )

        self.assertEqual(len(rows), 6)
        d3_q1 = next(
            row for row in rows if row["query"] == "q1" and row["entity_key"] == "d3_js"
        )
        self.assertEqual(d3_q1["mentions_count"], 2)
        self.assertAlmostEqual(float(d3_q1["mentions_rate"]), 1.0)
        self.assertEqual(d3_q1["share_of_voice_total_mentions"], 3)
        self.assertAlmostEqual(float(d3_q1["share_of_voice_rate"]), 0.666667, places=6)
        self.assertAlmostEqual(float(d3_q1["share_of_voice_rate_pct"]), 66.67, places=2)


if __name__ == "__main__":
    unittest.main()
