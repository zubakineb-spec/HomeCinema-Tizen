FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend /app/backend
COPY tv-app /app/tv-app
COPY VERSION /app/VERSION
ENV PYTHONPATH=/app/backend APP_HOST=0.0.0.0 APP_PORT=8096
EXPOSE 8096
CMD ["python", "/app/backend/run.py"]
