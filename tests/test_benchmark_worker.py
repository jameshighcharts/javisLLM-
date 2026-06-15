import unittest

from apps.worker.benchmark_worker import BenchmarkWorker


class BenchmarkWorkerProviderRoutingTests(unittest.TestCase):
    def test_infers_non_openai_provider_when_stored_provider_is_stale_openai(self):
        self.assertEqual(
            BenchmarkWorker._resolve_job_provider(
                {"provider": "openai"},
                "deepseek-v4-pro",
            ),
            "deepseek",
        )
        self.assertEqual(
            BenchmarkWorker._resolve_job_provider(
                {"provider": "openai"},
                "kimi-k2.5",
            ),
            "moonshot",
        )
        self.assertEqual(
            BenchmarkWorker._resolve_job_provider(
                {"provider": "openai"},
                "MiniMax-M2.5",
            ),
            "minimax",
        )

    def test_preserves_explicit_non_openai_provider(self):
        self.assertEqual(
            BenchmarkWorker._resolve_job_provider(
                {"provider": "moonshot"},
                "gpt-4o-mini",
            ),
            "moonshot",
        )


if __name__ == "__main__":
    unittest.main()
