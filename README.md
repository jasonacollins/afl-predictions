# AFL Predictions

A web application that allows users to predict Australian Football League match outcomes and compete on prediction accuracy.

## Application Overview

The AFL Predictions app enables users to:

- Create accounts and make probability-based predictions for upcoming AFL matches
- Express their prediction confidence as a percentage (how likely they think the home team is to win)
- Track prediction accuracy using various scoring metrics:
  - **Tip Points**: Binary scoring for correct match outcome predictions
  - **Brier Score**: Measures prediction calibration (lower is better)
  - **Bits Score**: Information theory-based scoring (higher is better)
- Compare performance on a leaderboard with other predictors
- View historical prediction accuracy across multiple AFL seasons

The app synchronises with the Squiggle API to automatically retrieve match fixtures and results, ensuring up-to-date information throughout the AFL season.

## Key Features

- **Probability-Based Predictions**: Instead of simple win/loss tips, users express confidence as percentages
- **Advanced Scoring System**: Multiple accuracy metrics providing deeper insights into prediction quality
- **Live Match Updates**: Automatic synchronisation with AFL match results
- **User Leaderboards**: Competitive element to compare prediction performance
- **Multi-Season Support**: Historical tracking of predictions across multiple years
- **Admin Dashboard**: Tools for managing users and overseeing the prediction platform

## Environment Details

- **Production Environment**: `/var/www/afl-predictions`
- **Database**: SQLite (sessions stored in `data/sessions.db`)

## Docker Setup

### Prerequisites

- Docker
- Docker Compose

### Installation and Deployment

1. Clone the repository:
   ```bash
   git clone https://github.com/jasonacollins/afl-predictions.git
   cd afl-predictions
   ```

2. Build and start the Docker container:
   ```bash
   docker-compose up -d
   ```

3. The application will be available at http://localhost:3001

### Managing the Docker Deployment

- **View logs**:
  ```bash
  docker-compose logs
  ```

- **Stop the containers**:
  ```bash
  docker-compose down
  ```

- **After making code changes**, rebuild and restart:
  ```bash
  docker-compose down
  docker-compose build
  docker-compose up -d
  ```

- **For quick restarts** without rebuilding:
  ```bash
  docker-compose restart
  ```

## Traditional Setup (without Docker)

### Prerequisites

- Node.js
- Git

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with appropriate values
   ```

3. Run database initialization:
   ```bash
   npm run import
   ```

### Development

```bash
npm run dev
```

### Production Deployment with Docker

1. Pull latest changes:
   ```bash
   cd /var/www/afl-predictions
   git pull
   ```

2. Rebuild and restart the Docker containers:
   ```bash
   docker-compose down
   docker-compose build
   docker-compose up -d
   ```

3. Verify deployment:
   ```bash
   docker-compose ps
   docker-compose logs
   ```

## Data Sources

The application uses the Squiggle API (https://api.squiggle.com.au) to source match fixtures and results.