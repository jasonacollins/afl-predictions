# AFL Predictions

A web application for predicting and tracking AFL match results.

## Overview

This application allows users to make predictions for Australian Football League matches and tracks prediction accuracy over time.

## Environment Details

- **Production Environment**: `/var/www/afl-predictions`
- **Database**: SQLite (sessions stored in `data/sessions.db`)

## Setup

### Prerequisites

- Node.js
- Git

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/jasonacollins/afl-predictions.git
   ```

2. Install dependencies:
   ```bash
   cd afl-predictions
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with appropriate values
   ```

### Development

```bash
npm run dev
```

### Production Deployment

1. Pull latest changes:
   ```bash
   cd /var/www/afl-predictions
   git pull
   ```

2. Install any new dependencies:
   ```bash
   npm install
   ```

3. Restart the application:
   ```bash
   pm2 restart afl-predictions  # Assuming PM2 is used
   ```

## Repository Access

This is a private repository. To access it:

1. Request access from the repository owner
2. Set up authentication using a Personal Access Token:
   ```bash
   git remote set-url origin https://username:your_token@github.com/jasonacollins/afl-predictions.git
   ```

## File Structure

- `/data` - Contains database files
  - Note: `sessions.db` should be in `.gitignore` as it contains environment-specific data
- `/public` - Static assets
- `/views` - Frontend templates
- `/routes` - API routes
- `/models` - Data models

## Database

The application uses SQLite for data storage. Database files are located in the `/data` directory.

## License

[Add appropriate license information]

## Contact

[Your contact information]