FROM denoland/deno:latest

# Set working directory
WORKDIR /app

# Copy application files
COPY server/ ./server/
COPY game/ ./game/

# Set proper permissions, probably not needed
RUN chmod -R 755 /app

# Expose both HTTP and WebSocket ports
EXPOSE 8100
EXPOSE 3001

# Change the working directory to server before running
WORKDIR /app/server

# Run the server from the server directory
# Note: Using 0.0.0.0 instead of localhost to allow external connections
CMD ["deno", "run", "--allow-net", "--allow-read", "siteserver.ts", "0.0.0.0", "8100", "3001"]