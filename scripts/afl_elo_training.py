import pandas as pd
import numpy as np
import sqlite3
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import log_loss, brier_score_loss
import matplotlib.pyplot as plt
import json
import os


class AFLEloModel:
    def __init__(self, base_rating=1500, k_factor=30, home_advantage=50, 
                 margin_factor=0.5, season_carryover=0.75, max_margin=100):
        """
        Initialize the AFL ELO model with configurable parameters
        
        Parameters:
        -----------
        base_rating: int
            Starting ELO rating for all teams
        k_factor: float
            Determines how quickly ratings change
        home_advantage: float
            Points added to home team's rating when calculating win probability
        margin_factor: float
            How much the margin of victory affects rating changes
        season_carryover: float
            Percentage of rating retained between seasons (0.75 = 75%)
        max_margin: int
            Maximum margin to consider (to limit effect of blowouts)
        """
        self.base_rating = base_rating
        self.k_factor = k_factor
        self.home_advantage = home_advantage
        self.margin_factor = margin_factor
        self.season_carryover = season_carryover
        self.max_margin = max_margin
        self.team_ratings = {}
        self.rating_history = []  # To track rating changes over time
        self.predictions = []     # To store model predictions
    
    def initialize_ratings(self, teams):
        """Initialize all team ratings to the base rating"""
        self.team_ratings = {team: self.base_rating for team in teams}
    
    def _cap_margin(self, margin):
        """Cap margin to reduce effect of blowouts"""
        return min(abs(margin), self.max_margin) * np.sign(margin)
    
    def calculate_win_probability(self, home_team, away_team):
        """Calculate probability of home team winning based on ELO difference"""
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Apply home ground advantage
        rating_diff = (home_rating + self.home_advantage) - away_rating
        
        # Convert rating difference to win probability using logistic function
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        
        return win_probability
    
    def update_ratings(self, home_team, away_team, hscore, ascore, year):
        """
        Update team ratings based on match result
        
        Parameters:
        -----------
        home_team: str
            Name of home team
        away_team: str
            Name of away team
        hscore: int
            Score of home team
        ascore: int
            Score of away team
        year: int
            Season year (used for tracking)
        
        Returns:
        --------
        dict with updated ratings and prediction information
        """
        # Ensure teams exist in ratings
        if home_team not in self.team_ratings:
            self.team_ratings[home_team] = self.base_rating
        if away_team not in self.team_ratings:
            self.team_ratings[away_team] = self.base_rating
        
        # Get current ratings
        home_rating = self.team_ratings[home_team]
        away_rating = self.team_ratings[away_team]
        
        # Calculate win probability
        home_win_prob = self.calculate_win_probability(home_team, away_team)
        
        # Determine actual result (1 for home win, 0 for away win)
        actual_result = 1.0 if hscore > ascore else 0.0
        
        # Handle draws (0.5 points each)
        if hscore == ascore:
            actual_result = 0.5
        
        # Calculate rating change based on result
        margin = hscore - ascore
        capped_margin = self._cap_margin(margin)
        
        # Adjust K-factor by margin
        margin_multiplier = 1.0
        if self.margin_factor > 0:
            margin_multiplier = np.log1p(abs(capped_margin) * self.margin_factor) / np.log1p(self.max_margin * self.margin_factor)
        
        # Calculate ELO update
        rating_change = self.k_factor * margin_multiplier * (actual_result - home_win_prob)
        
        # Update ratings
        self.team_ratings[home_team] += rating_change
        self.team_ratings[away_team] -= rating_change
        
        # Store the prediction and outcome
        prediction_info = {
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'hscore': hscore,
            'ascore': ascore,
            'pre_match_home_rating': home_rating,
            'pre_match_away_rating': away_rating,
            'predicted_home_win_prob': home_win_prob,
            'actual_result': actual_result,
            'margin': margin,
            'rating_change': rating_change
        }
        
        self.predictions.append(prediction_info)
        
        # Store rating history
        self.rating_history.append({
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'home_rating': self.team_ratings[home_team],
            'away_rating': self.team_ratings[away_team]
        })
        
        return prediction_info
    
    def apply_season_carryover(self, new_year):
        """Apply regression to mean between seasons"""
        for team in self.team_ratings:
            # Regress ratings toward base rating
            self.team_ratings[team] = self.base_rating + self.season_carryover * (self.team_ratings[team] - self.base_rating)
    
    def evaluate_model(self):
        """Calculate accuracy and other metrics for model evaluation"""
        if not self.predictions:
            return {
                'accuracy': 0,
                'brier_score': 1.0,  # Worst possible Brier score
                'log_loss': float('inf')
            }
        
        y_true = [p['actual_result'] for p in self.predictions]
        y_pred = [p['predicted_home_win_prob'] for p in self.predictions]
        
        # Calculate binary prediction accuracy (did we predict the winner correctly?)
        binary_predictions = [1 if prob >= 0.5 else 0 for prob in y_pred]
        accuracy = sum(1 for true, pred in zip(y_true, binary_predictions) if true == pred) / len(y_true)
        
        # Calculate Brier score (lower is better)
        brier = 0
        for true, pred in zip(y_true, y_pred):
            # Brier score is (forecast - outcome)^2
            brier += (pred/100 - true)**2
        brier /= len(y_true)

        # Calculate log loss (lower is better)
        logloss = 0
        for true, pred in zip(y_true, y_pred):
            # Convert percentage to probability (0-1)
            p = max(min(pred/100, 0.999), 0.001)  # Clip to avoid log(0) issues
            
            # Calculate loss based on actual outcome
            if true == 1.0:
                loss = -np.log(p)
            elif true == 0.0:
                loss = -np.log(1 - p)
            else:  # Draw (0.5)
                # For a draw, use proximity to 0.5 for the loss calculation
                loss = -np.log(1 - abs(0.5 - p))
            
            logloss += loss
        logloss /= len(y_true)
        
        return {
            'accuracy': accuracy,
            'brier_score': brier,
            'log_loss': logloss
        }
    
    def save_model(self, filename):
        """Save the model parameters and team ratings"""
        model_data = {
            'parameters': {
                'base_rating': self.base_rating,
                'k_factor': self.k_factor,
                'home_advantage': self.home_advantage,
                'margin_factor': self.margin_factor,
                'season_carryover': self.season_carryover,
                'max_margin': self.max_margin,
            },
            'team_ratings': self.team_ratings
        }
        
        with open(filename, 'w') as f:
            json.dump(model_data, f, indent=4)
    
    def load_model(self, filename):
        """Load model parameters and team ratings"""
        with open(filename, 'r') as f:
            model_data = json.load(f)
        
        # Set parameters
        params = model_data['parameters']
        self.base_rating = params['base_rating']
        self.k_factor = params['k_factor']
        self.home_advantage = params['home_advantage']
        self.margin_factor = params['margin_factor']
        self.season_carryover = params['season_carryover']
        self.max_margin = params['max_margin']
        
        # Set team ratings
        self.team_ratings = model_data['team_ratings']


def fetch_afl_data(db_path, start_year=1990, end_year=2024):
    """
    Fetch historical AFL match data from SQLite database
    
    Parameters:
    -----------
    db_path: str
        Path to SQLite database
    start_year: int
        Starting year for data
    end_year: int
        Ending year for data
        
    Returns:
    --------
    pandas DataFrame with match data
    """
    conn = sqlite3.connect(db_path)
    
    query = f"""
    SELECT 
        m.match_id, m.match_number, m.round_number, m.match_date, 
        m.year, m.hscore, m.ascore, m.hgoals, m.hbehinds, m.agoals, m.abehinds, m.complete,
        ht.name as home_team, at.name as away_team
    FROM 
        matches m
    JOIN 
        teams ht ON m.home_team_id = ht.team_id
    JOIN 
        teams at ON m.away_team_id = at.team_id
    WHERE 
        m.year >= {start_year} AND m.year <= {end_year}
        AND m.hscore IS NOT NULL AND m.ascore IS NOT NULL
    ORDER BY 
        m.year, m.match_date
    """
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    return df


def train_elo_model(data, params=None):
    """
    Train the ELO model on the provided data with optional parameters
    
    Parameters:
    -----------
    data: pandas DataFrame
        Historical match data
    params: dict
        Optional model parameters
        
    Returns:
    --------
    trained ELO model
    """
    if params is None:
        model = AFLEloModel()
    else:
        model = AFLEloModel(
            base_rating=params.get('base_rating', 1500),
            k_factor=params.get('k_factor', 30),
            home_advantage=params.get('home_advantage', 50),
            margin_factor=params.get('margin_factor', 0.5),
            season_carryover=params.get('season_carryover', 0.75),
            max_margin=params.get('max_margin', 100)
        )
    
    # Get unique teams
    all_teams = pd.concat([data['home_team'], data['away_team']]).unique()
    
    # Initialize ratings
    model.initialize_ratings(all_teams)
    
    # Process matches chronologically
    prev_year = None
    
    for _, match in data.iterrows():
        # Apply season carryover at the start of a new season
        if prev_year is not None and match['year'] != prev_year:
            model.apply_season_carryover(match['year'])
        
        # Update ratings based on match result
        model.update_ratings(
            home_team=match['home_team'],
            away_team=match['away_team'],
            hscore=match['hscore'],
            ascore=match['ascore'],
            year=match['year']
        )
        
        prev_year = match['year']
    
    return model


def parameter_tuning(data, param_grid, cv=5):
    """
    Find optimal ELO parameters using grid search
    
    Parameters:
    -----------
    data: pandas DataFrame
        Historical match data
    param_grid: dict
        Dictionary of parameter ranges to test
    cv: int
        Number of cross-validation splits
        
    Returns:
    --------
    dict with best parameters and results
    """
    # Create time-based splits to avoid training on future data
    tscv = TimeSeriesSplit(n_splits=cv)
    
    best_score = float('inf')  # Using log loss, lower is better
    best_params = None
    all_results = []
    
    # Sort data by date to ensure chronological order
    data = data.sort_values(['year', 'match_date'])
    
    # Create parameter combinations
    param_combinations = []
    
    # Simple grid search using loops (for illustration)
    for k_factor in param_grid['k_factor']:
        for home_advantage in param_grid['home_advantage']:
            for margin_factor in param_grid['margin_factor']:
                for season_carryover in param_grid['season_carryover']:
                    for max_margin in param_grid['max_margin']:
                        params = {
                            'base_rating': param_grid['base_rating'][0],  # Use first value
                            'k_factor': k_factor,
                            'home_advantage': home_advantage,
                            'margin_factor': margin_factor,
                            'season_carryover': season_carryover,
                            'max_margin': max_margin
                        }
                        param_combinations.append(params)
    
    print(f"Testing {len(param_combinations)} parameter combinations...")
    
    # Track progress
    total_combinations = len(param_combinations)
    
    for i, params in enumerate(param_combinations):
        if i % 10 == 0:  # Print progress every 10 combinations
            print(f"Testing combination {i+1}/{total_combinations}")
        
        # Cross-validation scores for this parameter set
        cv_scores = []
        
        for train_idx, test_idx in tscv.split(data):
            train_data = data.iloc[train_idx]
            test_data = data.iloc[test_idx]
            
            # Train model on training data
            model = train_elo_model(train_data, params)
            
            # Predict on test data
            test_probs = []
            test_results = []
            
            # Get the year of the earliest test game
            test_year = test_data['year'].min()
            
            # Apply season carryover if needed
            if test_year > train_data['year'].max():
                model.apply_season_carryover(test_year)
            
            for _, match in test_data.iterrows():
                prob = model.calculate_win_probability(match['home_team'], match['away_team'])
                test_probs.append(prob)
                # Actual result (1 for home win, 0 for away win, 0.5 for draw)
                if match['hscore'] > match['ascore']:
                    result = 1.0
                elif match['hscore'] < match['ascore']:
                    result = 0.0
                else:
                    result = 0.5
                test_results.append(result)
            
            # Clip probabilities to avoid log(0) issues
            test_probs = [max(min(p, 0.999), 0.001) for p in test_probs]
            
            # Calculate log loss for this fold
            log_losses = []
            for true_val, pred_val in zip(test_results, test_probs):
                # Clip predicted probability to avoid log(0)
                pred_val = max(min(pred_val, 0.999), 0.001)
                
                # Calculate loss based on actual outcome
                if true_val == 1.0:
                    loss = -np.log(pred_val)
                elif true_val == 0.0:
                    loss = -np.log(1 - pred_val)
                else:  # Draw (0.5)
                    # For a draw, use proximity to 0.5 for the loss calculation
                    loss = -np.log(1 - abs(0.5 - pred_val))
                
                log_losses.append(loss)

            fold_loss = np.mean(log_losses)
            cv_scores.append(fold_loss)
        
        # Average score across CV folds
        avg_score = np.mean(cv_scores)
        
        result = {
            'params': params,
            'log_loss': avg_score,
            'cv_scores': cv_scores
        }
        all_results.append(result)
        
        # Update best parameters if this is better
        if avg_score < best_score:
            best_score = avg_score
            best_params = params
    
    return {
        'best_params': best_params,
        'best_score': best_score,
        'all_results': all_results
    }


def plot_rating_history(model, top_n=8):
    """Plot rating history for top N teams"""
    # Convert rating history to DataFrame
    ratings_df = pd.DataFrame()
    
    for entry in model.rating_history:
        # Add home team rating
        new_row_home = {
            'year': entry['year'],
            'team': entry['home_team'],
            'rating': entry['home_rating']
        }
        ratings_df = pd.concat([ratings_df, pd.DataFrame([new_row_home])], ignore_index=True)
        
        # Add away team rating
        new_row_away = {
            'year': entry['year'],
            'team': entry['away_team'],
            'rating': entry['away_rating']
        }
        ratings_df = pd.concat([ratings_df, pd.DataFrame([new_row_away])], ignore_index=True)
    
    # Get final ratings for each team
    final_ratings = ratings_df.drop_duplicates(subset=['team'], keep='last').sort_values('rating', ascending=False)
    
    # Select top N teams
    top_teams = final_ratings.head(top_n)['team'].tolist()
    
    # Filter data for these teams
    plot_data = ratings_df[ratings_df['team'].isin(top_teams)]
    
    plt.figure(figsize=(12, 8))
    
    for team in top_teams:
        team_data = plot_data[plot_data['team'] == team]
        plt.plot(team_data['year'], team_data['rating'], label=team)
    
    plt.axhline(y=1500, color='gray', linestyle='--', alpha=0.5, label='Base Rating')
    plt.title('ELO Rating History for Top Teams')
    plt.xlabel('Year')
    plt.ylabel('ELO Rating')
    plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    
    plt.savefig('elo_rating_history.png')
    plt.close()


def plot_model_evaluation(model):
    """Plot model evaluation metrics"""
    # Convert predictions to DataFrame
    pred_df = pd.DataFrame(model.predictions)
    
    # Group by year
    yearly_metrics = pred_df.groupby('year').apply(lambda x: pd.Series({
        'accuracy': sum(1 for i, row in x.iterrows() 
                       if (row['predicted_home_win_prob'] >= 0.5 and row['actual_result'] == 1) or 
                          (row['predicted_home_win_prob'] < 0.5 and row['actual_result'] == 0)) / len(x),
        'brier_score': sum((row['predicted_home_win_prob'] - row['actual_result'])**2 for i, row in x.iterrows()) / len(x),
        'log_loss': -1 * sum((row['actual_result'] * np.log(max(0.001, row['predicted_home_win_prob'])) + 
                             (1-row['actual_result']) * np.log(max(0.001, 1-row['predicted_home_win_prob']))) 
                            for i, row in x.iterrows()) / len(x),
        'num_matches': len(x)
    }))
    
    # Create metrics plot
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 10), sharex=True)
    
    # Accuracy plot
    ax1.plot(yearly_metrics.index, yearly_metrics['accuracy'], marker='o', label='Accuracy')
    ax1.set_ylabel('Accuracy')
    ax1.set_title('Yearly Prediction Accuracy')
    ax1.grid(True, alpha=0.3)
    ax1.axhline(y=0.5, color='red', linestyle='--', alpha=0.5, label='Random Guess')
    ax1.legend()
    
    # Brier and Log Loss plot
    ax2.plot(yearly_metrics.index, yearly_metrics['brier_score'], marker='s', label='Brier Score')
    ax2.plot(yearly_metrics.index, yearly_metrics['log_loss'], marker='^', label='Log Loss')
    ax2.set_ylabel('Error Score (lower is better)')
    ax2.set_title('Yearly Error Metrics')
    ax2.grid(True, alpha=0.3)
    ax2.legend()
    
    plt.xlabel('Year')
    plt.tight_layout()
    
    plt.savefig('elo_model_evaluation.png')
    plt.close()
    
    # Return the yearly metrics
    return yearly_metrics


def main():
    """Main function to train and evaluate the ELO model"""
    print("AFL ELO Model Training")
    print("=====================")
    
    # Set database path - UPDATED TO MATCH YOUR DATABASE NAME
    db_path = '../data/afl_predictions.db'
    
    # Check if database exists
    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}")
        print("Please update the db_path variable to your database location")
        return
    
    # Fetch data from database
    print("Fetching AFL match data from database...")
    data = fetch_afl_data(db_path, start_year=1990)
    print(f"Fetched {len(data)} matches from {data['year'].min()} to {data['year'].max()}")
    
    # Define whether to perform parameter tuning or use default parameters
    do_tuning = True
    
    if do_tuning:
        print("Performing parameter tuning...")
        
        # Define parameter grid
        param_grid = {
            'base_rating': [1500],  # Keep base rating fixed
            'k_factor': [20, 30, 40],
            'home_advantage': [30, 50, 70],
            'margin_factor': [0.3, 0.5, 0.7],
            'season_carryover': [0.6, 0.75, 0.85],
            'max_margin': [80, 100, 120]
        }
        
        # Perform parameter tuning
        tuning_results = parameter_tuning(data, param_grid, cv=3)
        
        # Display best parameters
        best_params = tuning_results['best_params']
        print(f"Best parameters found:")
        for key, value in best_params.items():
            print(f"  {key}: {value}")
        print(f"Best log loss: {tuning_results['best_score']:.4f}")
        
        # Train model with best parameters
        print("Training model with best parameters...")
        model = train_elo_model(data, best_params)
    else:
        # Train model with default parameters
        print("Training model with default parameters...")
        model = train_elo_model(data)
    
    # Evaluate model
    metrics = model.evaluate_model()
    print("\nModel Evaluation:")
    print(f"  Accuracy: {metrics['accuracy']:.4f}")
    print(f"  Brier Score: {metrics['brier_score']:.4f}")
    print(f"  Log Loss: {metrics['log_loss']:.4f}")
    
    # Save model
    model.save_model('afl_elo_model.json')
    print("\nModel saved to afl_elo_model.json")
    
    # Plot rating history
    print("Creating rating history plot...")
    plot_rating_history(model)
    print("Rating history plot saved to elo_rating_history.png")
    
    # Plot model evaluation
    print("Creating model evaluation plot...")
    yearly_metrics = plot_model_evaluation(model)
    print("Model evaluation plot saved to elo_model_evaluation.png")
    
    # Display final team ratings
    print("\nFinal Team Ratings:")
    sorted_ratings = sorted(model.team_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in sorted_ratings:
        print(f"  {team}: {rating:.1f}")


if __name__ == "__main__":
    main()
