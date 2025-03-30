#!/bin/bash

# Create necessary directories
mkdir -p data

# Run database initialization and data import
npm run import

echo "Deployment preparation complete!"