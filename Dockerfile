# Sistema de Cartões de Estacionamento – SSM Bagé (versão internet)
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    DADOS_DIR=/data FUSO_HORARIO=-3
WORKDIR /app
COPY servidor.py ./
COPY web ./web
EXPOSE 8080
CMD ["python", "servidor.py"]
