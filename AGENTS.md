# Agent Instructions

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- MCP tools (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them. `codegraph_node` returns one symbol's source + callers, or reads a whole file with line numbers. If the tools are listed but deferred, load them by name via tool search.
- Shell (always works): `codegraph explore "<symbol names or question>"` and `codegraph node <symbol-or-file>` print the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## Project Memory

- Before making claims or decisions about Railway deployment, read `docs/superpowers/railway-deploy.md`.
- As of 2026-08-04, Railway GitHub auto-deploy for `main` is verified working for `api`, `worker`, and `dashboard` in project `reasonable-adaptation` / environment `production`; use manual `railway up` only as a fallback after checking Railway deployment history.
