import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime
import os
import argparse


class AFLEloPredictor:
    def __init__(self, model_path):
        """
        Initialize the ELO predictor with a trained model
        
        Parameters:
        -----------
        model_path: str
            Path to the saved ELO model JSON file
        """
        self.load_model(model_path)
        self.predictions = []  # Store all predictions
        self.rating_history = []  # Store rating history
    
    def load_model(self, model_path):
        """Load the trained ELO model"""
        try:
            with open(model_path, 'r') as f:
                model_data = json.load(f)
            
            # Set parameters
            self.params = model_data['parameters']
            self.base_rating = self.params['base_rating']
            self.k_factor = self.params['k_factor']
            self.home_advantage = self.params['home_advantage']
            self.margin_factor = self.params['margin_factor']
            self.season_carryover = self.params['season_carryover']
            self.max_margin = self.params['max_margin']
            
            # Set team ratings
            self.team_ratings = model_data['team_ratings']
            
            # Store yearly ratings if available
            self.yearly_ratings = model_data.get('yearly_ratings', {})
            
            print(f"Loaded ELO model with {len(self.team_ratings)} team ratings")
            print("Model parameters:")
            for param, value in self.params.items():
                print(f"  {param}: {value}")
                
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            return False
    
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
    
    def apply_season_carryover(self, new_year):
        """Apply regression to mean between seasons"""
        print(f"Applying season carryover for {new_year}...")
        
        # Store current ratings before carryover
        ratings_before = self.team_ratings.copy()
        
        for team in self.team_ratings:
            # Regress ratings toward base rating
            self.team_ratings[team] = self.base_rating + self.season_carryover * (self.team_ratings[team] - self.base_rating)
        
        # Store the ratings transition in history
        self.rating_history.append({
            'event': 'season_carryover',
            'year': new_year,
            'ratings_before': ratings_before,
            'ratings_after': self.team_ratings.copy()
        })
    
    def update_ratings(self, home_team, away_team, hscore, ascore, match_id=None, year=None, round_number=None, match_date=None, venue=None):
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
        match_id: int
            Optional match ID for tracking
        year: int
            Season year
        round_number: str
            Optional round number for tracking
        match_date: str
            Optional match date for tracking
        venue: str
            Optional venue for tracking
            
        Returns:
        --------
        dict with updated prediction information
        """
        # Ensure teams exist in ratings
        if home_team not in self.team_ratings:
            print(f"Warning: {home_team} not found in ratings, using base rating")
            self.team_ratings[home_team] = self.base_rating
            
        if away_team not in self.team_ratings:
            print(f"Warning: {away_team} not found in ratings, using base rating")
            self.team_ratings[away_team] = self.base_rating
        
        # Get current ratings
        home_rating = self.team_ratings[home_team]
        away_rating = self.team_ratings[away_team]
        
        # Calculate win probability
        home_win_prob = self.calculate_win_probability(home_team, away_team)
        
        # Store the pre-update prediction info
        prediction_info = {
            'match_id': match_id,
            'round_number': round_number,
            'match_date': match_date,
            'venue': venue,
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'pre_match_home_rating': home_rating,
            'pre_match_away_rating': away_rating,
            'rating_difference': home_rating - away_rating,
            'adjusted_rating_difference': (home_rating + self.home_advantage) - away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob)
        }
        
        # If scores are provided, update ratings and add result info
        if hscore is not None and ascore is not None:
            # Determine actual result (1 for home win, 0 for away win)
            actual_result = 1.0 if hscore > ascore else 0.0
            
            # Handle draws (0.5 points each)
            if hscore == ascore:
                actual_result = 0.5
            
            # Calculate rating change based on result and margin
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
            
            # Add result info to prediction
            prediction_info.update({
                'hscore': hscore,
                'ascore': ascore,
                'actual_result': 'home_win' if hscore > ascore else ('away_win' if hscore < ascore else 'draw'),
                'margin': margin,
                'rating_change': rating_change,
                'post_match_home_rating': self.team_ratings[home_team],
                'post_match_away_rating': self.team_ratings[away_team],
                'correct': (home_win_prob > 0.5 and hscore > ascore) or 
                           (home_win_prob < 0.5 and hscore < ascore) or 
                           (home_win_prob == 0.5 and hscore == ascore)
            })
            
            # Store the ratings change in history
            self.rating_history.append({
                'event': 'match',
                'match_id': match_id,
                'year': year,
                'round_number': round_number,
                'match_date': match_date,
                'home_team': home_team,
                'away_team': away_team,
                'home_score': hscore,
                'away_score': ascore,
                'home_rating_before': home_rating,
                'away_rating_before': away_rating,
                'home_rating_after': self.team_ratings[home_team],
                'away_rating_after': self.team_ratings[away_team],
                'rating_change': rating_change
            })
        
        # Store the prediction
        self.predictions.append(prediction_info)
        
        return prediction_info
    
    def predict_match(self, home_team, away_team, match_id=None, year=None, round_number=None, match_date=None, venue=None):
        """
        Predict the outcome of a match without updating ratings
        
        Parameters:
        -----------
        home_team: str
            Name of home team
        away_team: str
            Name of away team
        match_id: int
            Optional match ID for tracking
        year: int
            Season year
        round_number: str
            Optional round number for tracking
        match_date: str
            Optional match date for tracking
        venue: str
            Optional venue for tracking
            
        Returns:
        --------
        dict with prediction information
        """
        # Check if teams exist in ratings
        if home_team not in self.team_ratings:
            print(f"Warning: {home_team} not found in ratings, using base rating")
            self.team_ratings[home_team] = self.base_rating
            
        if away_team not in self.team_ratings:
            print(f"Warning: {away_team} not found in ratings, using base rating")
            self.team_ratings[away_team] = self.base_rating
        
        # Get current ratings
        home_rating = self.team_ratings[home_team]
        away_rating = self.team_ratings[away_team]
        
        # Calculate win probability
        home_win_prob = self.calculate_win_probability(home_team, away_team)
        
        # Create prediction result
        prediction = {
            'match_id': match_id,
            'round_number': round_number,
            'match_date': match_date,
            'venue': venue,
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'pre_match_home_rating': home_rating,
            'pre_match_away_rating': away_rating,
            'rating_difference': home_rating - away_rating,
            'adjusted_rating_difference': (home_rating + self.home_advantage) - away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob)
        }
        
        # Store the prediction
        self.predictions.append(prediction)
        
        return prediction
    
    def save_predictions_to_csv(self, filename):
        """Save predictions to CSV file"""
        if not self.predictions:
            print("No predictions to save")
            return
        
        # Convert predictions to DataFrame
        df = pd.DataFrame(self.predictions)
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
        
        # Save to CSV
        df.to_csv(filename, index=False)
        print(f"Saved {len(df)} predictions to {filename}")
    
    def save_rating_history_to_csv(self, filename):
        """Save rating history to CSV file"""
        if not self.rating_history:
            print("No rating history to save")
            return
        
        # Convert to DataFrame
        df = pd.DataFrame()
        
        # Process each event
        for event in self.rating_history:
            event_type = event['event']
            
            if event_type == 'match':
                # For match events, add a row for each team
                home_row = {
                    'event': 'match',
                    'match_id': event['match_id'],
                    'date': event['match_date'],
                    'year': event['year'],
                    'round': event['round_number'],
                    'team': event['home_team'],
                    'opponent': event['away_team'],
                    'score': event['home_score'],
                    'opponent_score': event['away_score'],
                    'result': 'win' if event['home_score'] > event['away_score'] else 
                             ('loss' if event['home_score'] < event['away_score'] else 'draw'),
                    'rating_before': event['home_rating_before'],
                    'rating_after': event['home_rating_after'],
                    'rating_change': event['rating_change']
                }
                
                away_row = {
                    'event': 'match',
                    'match_id': event['match_id'],
                    'date': event['match_date'],
                    'year': event['year'],
                    'round': event['round_number'],
                    'team': event['away_team'],
                    'opponent': event['home_team'],
                    'score': event['away_score'],
                    'opponent_score': event['home_score'],
                    'result': 'win' if event['away_score'] > event['home_score'] else 
                             ('loss' if event['away_score'] < event['home_score'] else 'draw'),
                    'rating_before': event['away_rating_before'],
                    'rating_after': event['away_rating_after'],
                    'rating_change': -event['rating_change']
                }
                
                df = pd.concat([df, pd.DataFrame([home_row, away_row])], ignore_index=True)
                
            elif event_type == 'season_carryover':
                # For season carryover, add a row for each team
                for team, rating_before in event['ratings_before'].items():
                    rating_after = event['ratings_after'][team]
                    
                    carryover_row = {
                        'event': 'season_carryover',
                        'date': None,
                        'year': event['year'],
                        'round': None,
                        'team': team,
                        'opponent': None,
                        'rating_before': rating_before,
                        'rating_after': rating_after,
                        'rating_change': rating_after - rating_before
                    }
                    
                    df = pd.concat([df, pd.DataFrame([carryover_row])], ignore_index=True)
        
        # Sort by date and match_id
        if 'date' in df.columns and not df['date'].isna().all():
            df = df.sort_values(['date', 'match_id'])
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
        
        # Save to CSV
        df.to_csv(filename, index=False)
        print(f"Saved rating history with {len(df)} records to {filename}")


def fetch_matches(db_path, start_year):
    """
    Fetch AFL matches from the database starting from a specific year
    
    Parameters:
    -----------
    db_path: str
        Path to SQLite database
    start_year: int
        Year to start predictions from
        
    Returns:
    --------
    pandas DataFrame with matches
    """
    conn = sqlite3.connect(db_path)
    
    query = f"""
    SELECT 
        m.match_id, m.match_number, m.round_number, m.match_date, 
        m.venue, m.year, m.hscore, m.ascore, 
        ht.name as home_team, at.name as away_team
    FROM 
        matches m
    JOIN 
        teams ht ON m.home_team_id = ht.team_id
    JOIN 
        teams at ON m.away_team_id = at.team_id
    WHERE 
        m.year >= ?
    ORDER BY 
        m.year, m.match_date
    """
    
    matches = pd.read_sql_query(query, conn, params=(start_year,))
    conn.close()
    
    # Convert match_date to datetime for sorting
    matches['match_date'] = pd.to_datetime(matches['match_date'], errors='coerce')
    
    # Sort by date to ensure chronological order
    matches = matches.sort_values(['year', 'match_date'])
    
    return matches


def predict_matches(model_path, db_path, start_year, output_dir='.'):
    """
    Make predictions for matches starting from specified year
    
    Parameters:
    -----------
    model_path: str
        Path to the saved ELO model
    db_path: str
        Path to SQLite database
    start_year: int
        Year to start predictions from
    output_dir: str
        Directory to save output files
        
    Returns:
    --------
    None
    """
    # Load the predictor
    predictor = AFLEloPredictor(model_path)
    
    # Get matches from database
    matches = fetch_matches(db_path, start_year)
    
    if len(matches) == 0:
        print(f"No matches found from year {start_year} onwards")
        return
    
    # Get the years in the dataset
    years = matches['year'].unique()
    years.sort()
    
    print(f"Found {len(matches)} matches from {years.min()} to {years.max()}")
    
    # Track the current year to detect year changes
    current_year = None
    
    # Process matches in chronological order
    for i, match in matches.iterrows():
        match_year = match['year']
        
        # Apply season carryover at the start of a new season
        if current_year is not None and match_year != current_year:
            predictor.apply_season_carryover(match_year)
        
        current_year = match_year
        
        # Determine if match has scores (completed)
        has_scores = not pd.isna(match['hscore']) and not pd.isna(match['ascore'])
        
        if has_scores:
            # For completed matches, update ratings
            predictor.update_ratings(
                home_team=match['home_team'],
                away_team=match['away_team'],
                hscore=match['hscore'],
                ascore=match['ascore'],
                match_id=match['match_id'],
                year=match['year'],
                round_number=match['round_number'],
                match_date=match['match_date'].isoformat() if pd.notna(match['match_date']) else None,
                venue=match['venue']
            )
        else:
            # For future matches, just predict without updating
            predictor.predict_match(
                home_team=match['home_team'],
                away_team=match['away_team'],
                match_id=match['match_id'],
                year=match['year'],
                round_number=match['round_number'],
                match_date=match['match_date'].isoformat() if pd.notna(match['match_date']) else None,
                venue=match['venue']
            )
    
    # Save predictions and rating history
    os.makedirs(output_dir, exist_ok=True)
    
    predictions_file = os.path.join(output_dir, f"afl_elo_predictions_from_{start_year}.csv")
    history_file = os.path.join(output_dir, f"afl_elo_rating_history_from_{start_year}.csv")
    
    predictor.save_predictions_to_csv(predictions_file)
    predictor.save_rating_history_to_csv(history_file)
    
    # Evaluate the model on completed matches
    completed_predictions = [p for p in predictor.predictions if 'actual_result' in p]
    
    if completed_predictions:
        correct_count = sum(1 for p in completed_predictions if p.get('correct', False))
        accuracy = correct_count / len(completed_predictions)
        
        print(f"\nPrediction Accuracy on {len(completed_predictions)} completed matches: {accuracy:.4f}")
    else:
        print("\nNo completed matches found to evaluate prediction accuracy")
    
    # Display final team ratings
    print("\nFinal Team Ratings:")
    sorted_ratings = sorted(predictor.team_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in sorted_ratings:
        print(f"  {team}: {rating:.1f}")


def main():
    """Main function to make ELO predictions"""
    parser = argparse.ArgumentParser(description='Make AFL ELO predictions')
    parser.add_argument('--start-year', type=int, required=True,
                        help='Start year for predictions (inclusive)')
    parser.add_argument('--model-path', type=str, required=True,
                        help='Path to the trained ELO model JSON file')
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--output-dir', type=str, default='.',
                        help='Directory to save output files')
    
    args = parser.parse_args()
    
    print("AFL ELO Model Predictions")
    print("========================")
    print(f"Making predictions for matches from year {args.start_year} onwards")
    print(f"Using model: {args.model_path}")
    
    # Check if files exist
    if not os.path.exists(args.db_path):
        print(f"Error: Database not found at {args.db_path}")
        return
    
    if not os.path.exists(args.model_path):
        print(f"Error: Model file not found at {args.model_path}")
        return
    
    # Make predictions
    predict_matches(args.model_path, args.db_path, args.start_year, args.output_dir)


if __name__ == "__main__":
    main()