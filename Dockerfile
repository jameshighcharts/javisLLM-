FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
COPY packages/py/benchmark_core /app/packages/py/benchmark_core
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r /app/requirements.txt \
  && pip install --no-cache-dir /app/packages/py/benchmark_core

COPY main.py /app/main.py
COPY llm_mention_benchmark.py /app/llm_mention_benchmark.py
COPY apps/worker /app/apps/worker
COPY scripts/trigger_benchmark_run.py /app/scripts/trigger_benchmark_run.py
RUN ln -s /app/apps/worker /app/worker

CMD ["python", "-m", "worker.benchmark_worker"]
