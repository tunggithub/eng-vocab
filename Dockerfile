# Static site (HTML/JS thuần, backend là Supabase)
# Serve bằng http.server có sẵn của Python — đơn giản, không cần config riêng
FROM python:3.12-alpine

WORKDIR /app

# Chỉ cần các file tĩnh cho frontend
COPY index.html config.js ./

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8000/ >/dev/null 2>&1 || exit 1

CMD ["python", "-m", "http.server", "8000"]
