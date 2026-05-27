# Stage 1: Install dependencies
# We use a separate stage so node_modules doesn't get rebuilt on every code change
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Final image
FROM node:24-alpine
WORKDIR /app

# Create a non-root user — running as root inside a container is a security risk
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy dependencies from stage 1 and app code
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create directories the app writes to and give ownership to appuser
RUN mkdir -p data logs && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

CMD ["node", "server.js"]
