---
"@dudousxd/nestjs-diagnostics": patch
---

perf: keep the emit envelope monomorphic on the hot path — build it with a stable key set (traceId always present) instead of a conditional spread, avoiding a throwaway intermediate object per emit (~30% faster envelope build).
