FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MOCK_SPEAKER_OUTPUT_DIR=/data

WORKDIR /app

COPY server.py /app/server.py

EXPOSE 8081

CMD ["python3", "/app/server.py"]
