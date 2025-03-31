FROM denoland/deno:latest

ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Copy application files
COPY server/ ./server/
COPY game/ ./game/

# Set proper permissions
RUN chmod -R 755 /app

# Expose ports
EXPOSE 8100
EXPOSE 443
EXPOSE 3001

# Change to server directory
WORKDIR /app/server

# Run the appropriate command based on NODE_ENV
CMD if [ "$NODE_ENV" = "production" ]; then \
      deno run --allow-net --allow-read siteserver.ts 0.0.0.0 8100 443; \
    else \
      deno run --allow-net --allow-read siteserver.ts 0.0.0.0 8100 3001; \
    fi