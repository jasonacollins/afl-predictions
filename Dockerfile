FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Create data directory for SQLite
RUN mkdir -p data

# Expose port
EXPOSE 3001

# Run database initialization during build
RUN npm run import

# Start the application
CMD ["npm", "start"]