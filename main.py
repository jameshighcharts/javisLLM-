#!/usr/bin/env python3
"""Railway fallback entrypoint for the benchmark worker."""


def main() -> int:
    from worker.benchmark_worker import main as worker_main

    return worker_main()


if __name__ == "__main__":
    raise SystemExit(main())
