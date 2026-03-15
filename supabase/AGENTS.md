# supabase

- `migrations/` is the source of truth. `sql/` is a compatibility symlink.
- Add new migrations; never rewrite old ones for product changes.
- Preserve queue RPC wrappers, materialized views, and `finalize_benchmark_run` semantics.
