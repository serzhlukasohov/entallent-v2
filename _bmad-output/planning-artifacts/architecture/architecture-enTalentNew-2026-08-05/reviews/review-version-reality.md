# Version / Reality Review - MAF Runtime Migration Spine

Target: `/Users/serzh/Documents/enTalentNew/_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md`

Review date: 2026-08-05

## Verdict

**Changes required before treating the spine as current-version accurate.** The architecture direction is mostly credible for a brownfield strangler, and the MAF/FastAPI choices are broadly compatible with August 2026 reality. The currentness problem is concentrated in the stack table: it mixes old minimum specifiers, actual lockfile resolutions, and future service pins without saying which are deploy baselines, support floors, or intentional pins.

## Evidence Checked

Local evidence:

- `/Users/serzh/Documents/enTalentNew/package.json`
- `/Users/serzh/Documents/enTalentNew/pnpm-lock.yaml`
- `/Users/serzh/Documents/enTalentNew/apps/api/package.json`
- `/Users/serzh/Documents/enTalentNew/apps/worker/package.json`
- `/Users/serzh/Documents/enTalentNew/packages/database/package.json`
- `/Users/serzh/Documents/enTalentNew/apps/api/Dockerfile`
- `/Users/serzh/Documents/enTalentNew/apps/worker/Dockerfile`
- `/Users/serzh/Documents/enTalentNew/apps/dashboard/Dockerfile`
- `/Users/serzh/Documents/enTalentNew/docker-compose.yml`
- `/Users/serzh/Documents/enTalentNew/docker/docker-compose.yml`
- `/Users/serzh/Documents/enTalentNew/docker/docker-compose.dev.yml`
- `/Users/serzh/Documents/enTalentNew/packages/application/src/ports/agent-runtime.port.ts`
- `/Users/serzh/Documents/enTalentNew/apps/worker/src/conversation/conversation.processor.ts`

Current-version evidence:

- [Node.js previous releases](https://nodejs.org/en/about/previous-releases) and [Node.js EOL page](https://nodejs.org/en/about/eol)
- [Python devguide version status](https://devguide.python.org/versions/) and [Python 3.13.14 release page](https://www.python.org/downloads/release/python-31314/)
- [Python 3.12.13 release page](https://www.python.org/downloads/release/python-31213/)
- [FastAPI PyPI](https://pypi.org/project/fastapi/) and [FastAPI PyPI JSON](https://pypi.org/pypi/fastapi/json)
- [agent-framework PyPI JSON](https://pypi.org/pypi/agent-framework/json)
- [agent-framework-hosting PyPI](https://pypi.org/project/agent-framework-hosting/)
- [Microsoft Agent Framework self-hosting docs](https://learn.microsoft.com/en-us/agent-framework/hosting/self-hosting)
- [NestJS v10 to v11 migration guide](https://docs.nestjs.com/migration-guide)
- npm package pages for [pnpm](https://www.npmjs.com/package/pnpm), [@nestjs/core](https://www.npmjs.com/package/%40nestjs/core), [bullmq](https://www.npmjs.com/package/bullmq), [drizzle-orm](https://www.npmjs.com/package/drizzle-orm), [fastify](https://www.npmjs.com/package/fastify), and [typescript](https://www.npmjs.com/package/typescript)

## Findings

### [High] Node.js and pnpm rows are not safe August 2026 baselines

The spine says `Node.js >=20.0.0` and `pnpm 9.12.0` in the stack table. That is not a current production baseline in August 2026. Node.js 20 is listed as EOL by Node's own release tables, while local production Dockerfiles already use `node:22-alpine`. The root `package.json` still allows any Node `>=20.0.0`, so the spine is currently preserving an EOL runtime floor even though the containers are on Node 22.

`pnpm 9.12.0` matches the root `packageManager`, but npm shows pnpm 11 as the current line and pnpm 10/11 active tags. If the project intentionally pins pnpm 9 for lockfile or Corepack stability, the spine needs to say "intentionally pinned" and explain support risk. As written, it reads as a current stack choice.

Local mismatch:

- Spine: `Node.js >=20.0.0`, `pnpm 9.12.0`
- Root manifest: `engines.node >=20.0.0`, `engines.pnpm >=9.0.0`, `packageManager pnpm@9.12.0`
- Dockerfiles: `FROM node:22-alpine` for API, worker, and dashboard

Expected correction: treat Node 22.x as the current local deploy baseline, consider Node 24.x as the August 2026 LTS target, and mark pnpm 9 either as a migration debt item or an intentional temporary pin.

### [High] Stack table exact versions do not match the lockfile for TypeScript, BullMQ, and Drizzle

The spine stack table lists `TypeScript 5.6.3`, `BullMQ 5.12.12`, and `Drizzle ORM 0.35.0`. Those are package.json specifier floors, not the installed brownfield versions. The actual `pnpm-lock.yaml` resolutions are:

- TypeScript: `5.9.3`
- BullMQ: `5.80.5`
- Drizzle ORM: `0.35.3`
- NestJS: `10.4.22`, which does fit `10.4.x`
- Fastify: root app dependencies resolve to `4.29.1`, and `@nestjs/platform-fastify` pulls `4.28.1`

This matters because the architecture spine is supposed to be a build substrate. A stack table with exact-looking but non-installed versions will mislead implementation and validation, especially if generated contracts, TypeScript compiler behavior, BullMQ job semantics, or Drizzle migration behavior are being evaluated.

Expected correction: split the table into `declared specifier`, `locked version`, and `current upstream/latest` where relevant, or list only the actual locked brownfield versions.

### [Medium] Python 3.13.14 is real, but the target rationale is incomplete for new August 2026 service work

The spine correctly identifies Python 3.12 as security-fix-only. Python's devguide shows 3.12 in security status, and the Python 3.12.13 release page says 3.12 no longer receives regular bug fixes or binary installers. The spine also correctly uses a maintained Python line: Python 3.13.14 exists and is a maintenance release.

The incomplete part: Python 3.14 is already the latest feature release series, and Python's version table shows 3.14 in bugfix status while 3.13 is also in bugfix status. The MAF and FastAPI PyPI metadata both advertise Python 3.14 support. If this is a new Python service starting in August 2026, defaulting to 3.13.x is defensible only if the team wants a more conservative line or has dependency/runtime constraints. The spine currently states 3.13.14 as preferred without recording that tradeoff.

Expected correction: either target Python 3.14.x as the new-service default, or keep 3.13.x but explicitly call it an intentional compatibility pin with a review date before 3.13 leaves bugfix support.

### [Medium] MAF core pin is current, but hosting package language should stay strict because helper packages are still preview/alpha

The spine's MAF core row is current: PyPI JSON for `agent-framework` reports release `1.13.0`, requires `agent-framework-core[all]==1.13.0`, and classifies the package as Production/Stable with Python 3.10 through 3.14 classifiers.

The spine is also right to avoid `agent-framework-hosting` in the first service slice. The generic hosting package is still a pre-release/alpha package on PyPI, and Microsoft self-hosting docs still install it with `--pre`. Keep AD-11 exactly as a hard guard unless and until the helper packages graduate or the project accepts preview risk.

Expected correction: no architectural reversal needed. Add explicit wording that `agent-framework` core is stable but `agent-framework-hosting` is intentionally deferred because it is pre-release/alpha.

### [Low] FastAPI 0.141.1 is current, but the stability signal is mixed and should be recorded honestly

FastAPI `0.141.1` is present as the current PyPI release, and FastAPI supports Python 3.10 through 3.14. The choice fits a small owned JSON HTTP service behind the TypeScript runtime boundary.

The caveat is that FastAPI's PyPI classifier still says Development Status `4 - Beta`, even though the project description says it is ready for production and it is widely used for production APIs. That is not a blocker, but if the spine uses PyPI metadata as verification evidence, it should not imply all selected Python packages are Production/Stable in the same way MAF core is.

Expected correction: keep FastAPI, but distinguish "current and production-common" from "PyPI classifier Production/Stable."

## Passed Checks

- The brownfield host-shell claim matches local code: `ConversationProcessor` depends on `AGENT_RUNTIME_PORT` / `AgentRuntimePort`, and `TypeScriptAgentRuntime` implements the port by delegating to the existing orchestrator.
- PostgreSQL 16 and Redis 7 match local compose files. The root compose uses `pgvector/pgvector:pg16`; the docker compose files use `postgres:16-alpine` and `redis:7-alpine`.
- NestJS `10.4.x` matches the lockfile (`10.4.22`) and local `@nestjs/*` package usage, although current upstream NestJS is v11 and v10 is tagged legacy on npm.
- The `agent-service/` Python structure is a future seed only. There is no local `agent-service`, `pyproject.toml`, `requirements.txt`, `uv.lock`, or Python Dockerfile to verify yet, so Python/FastAPI/MAF rows are architecture choices rather than brownfield package claims.
- JSON HTTP first transport is appropriate for this migration slice. Microsoft self-hosting docs allow apps to bring their own framework/server, and the local `AgentRuntimePort` is already a narrow TypeScript insertion point.

## Review Conclusion

The spine is directionally sound but not version-clean. Fix the stack table semantics before implementation planning depends on it: Node/pnpm support posture, exact locked TypeScript/BullMQ/Drizzle versions, and Python 3.13 versus 3.14 rationale are the material reality-check issues.
