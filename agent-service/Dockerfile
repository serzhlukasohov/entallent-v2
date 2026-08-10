FROM python:3.13-slim AS runner

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV AGENT_SERVICE_PORT=8001

WORKDIR /app

RUN addgroup --system agentservice \
    && adduser --system --ingroup agentservice agentservice \
    && mkdir -p /data/agent-service \
    && chown -R agentservice:agentservice /data/agent-service \
    && chmod 700 /data/agent-service

COPY pyproject.toml README.md ./
COPY src/ src/

RUN python -m pip install --upgrade pip \
    && pip install --no-cache-dir .

USER agentservice
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request; port=os.environ.get('AGENT_SERVICE_PORT','8001'); urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready', timeout=3).read()"

CMD ["sh", "-c", "python -m uvicorn agent_service.main:create_app --factory --host 0.0.0.0 --port ${AGENT_SERVICE_PORT:-8001}"]
