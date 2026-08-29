# phf-hr-api — image tối giản, KHÔNG dùng chung image phf-api (CRM).
# node:22-alpine: đã verify thật trên server công ty (smoke test PASS) — đổi
# từ node:20-alpine theo đúng bằng chứng deploy thật, không phải suy đoán.
# Alpine vẫn là base nhỏ nhất trong các image Node chính thức, phù hợp máy
# RAM 1.9GiB (available ~849MiB lúc audit). Không multi-stage vì chỉ có 1
# dependency production duy nhất (@supabase/supabase-js) — multi-stage không
# giảm đáng kể size ở quy mô này, thêm phức tạp không cần thiết.
FROM node:22-alpine

WORKDIR /app

# Cài dependency trước, tách layer khỏi source — cache tốt hơn cho lần build
# sau nếu chỉ sửa code, không sửa package.json.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Chỉ copy đúng những gì service cần chạy — KHÔNG copy .env (đã chặn ở
# .dockerignore), KHÔNG copy toàn bộ repo lớn.
COPY lib ./lib
COPY server.js ./
COPY task-write-db-connection-test-dev.js ./

# Chạy bằng user "node" có sẵn trong image chính thức (không phải root) —
# giảm bề mặt tấn công nếu container bị chiếm quyền.
USER node

# Không EXPOSE cứng port — port thật đọc từ .env (PORT), khai báo ở
# docker-compose.yml để tránh 2 nguồn sự thật lệch nhau.

CMD ["node", "server.js"]
