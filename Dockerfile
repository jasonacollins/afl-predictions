FROM node:18-alpine

WORKDIR /app

# Install cron
RUN apk add --no-cache dcron

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Add crontab file
COPY crontab /etc/crontabs/root

# Create data directory for SQLite and logs directory
RUN mkdir -p data
RUN mkdir -p /var/log && touch /var/log/afl-sync.log

# Expose port
EXPOSE 3001

# Run database initialization during build
RUN npm run import

# Start cron and the application
CMD crond -b && npm start