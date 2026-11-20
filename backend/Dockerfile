FROM registry.access.redhat.com/ubi9/python-312:latest

# Obraz UBI działa jako użytkownik 1001 (grupa 0) — zgodnie z restricted SCC w OpenShift.
WORKDIR /opt/app-root/src

COPY --chown=1001:0 requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=1001:0 app ./app

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
