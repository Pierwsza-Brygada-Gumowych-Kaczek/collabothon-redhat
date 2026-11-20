# --- build ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# Po pierwszym `npm install` lokalnie powstanie package-lock.json — wtedy zamień na `npm ci`.
RUN npm install
COPY . .
RUN npx ng build --configuration production

# --- runtime (działa jako non-root, port 8080 — zgodne z OpenShift restricted SCC) ---
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 8080
