# Static site (HTML/JS thuần, backend là Supabase)
# Serve bằng http.server có sẵn của Python — đơn giản, không cần config riêng
FROM python:3.12-alpine

WORKDIR /app

# Chỉ cần các file tĩnh cho frontend
COPY index.html config.js ./

EXPOSE 3000

CMD ["python", "-m", "http.server", "3000"]
