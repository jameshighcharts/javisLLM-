# apps/worker

- Queue/job invariants live here.
- Import benchmark logic from `benchmark_core`, not root shims.
- Preserve queue RPC wrapper usage and finalization idempotency.
- Avoid adding product-facing logic to the worker package.
