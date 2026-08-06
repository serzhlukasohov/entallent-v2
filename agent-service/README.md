# agent-service

Python/FastAPI service foundation for the future MAF runtime.

Story 4.1 is intentionally limited to local scaffold, settings, checks, and `/health/live`.

Out of scope for this scaffold:

- `POST /runtime/process-message`
- scoped internal service authentication
- durable session or checkpoint storage
- MAF workflow or agent behavior
- TypeScript runtime client or router changes
- deployment envelope, Dockerfile, readiness endpoint, internal URL, or service registration

## Local Setup

Use Python 3.13.x.

```bash
cd agent-service
python3.13 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

## Run

```bash
python -m uvicorn agent_service.main:create_app --factory --host 127.0.0.1 --port 8001
```

Liveness:

```bash
curl http://127.0.0.1:8001/health/live
```

## Checks

```bash
python -m pytest
python -m ruff check .
python -m mypy src tests
```
