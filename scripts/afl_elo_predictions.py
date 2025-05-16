import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime
import os


class AFLEloPredictor:
    def __init__(self, model_path='afl_elo_model.json'):
        """
        Initialize the ELO predictor with a trained model
        
        Parameters:
        -----------
        model_path: str
            Path to the saved ELO model JSON file
        """
        self.load_model(model_path)
    
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
            
            print(f"Loaded ELO model with {len(self.team_ratings)} team ratings")
            
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            return False
    
    def calculate_win_probability(self, home_team, away_team):
        """Calculate probability of home team winning based on ELO difference"""
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Apply home ground advantage
        rating_diff = (home_rating + self.home_advantage) - away_rating
        
        # Convert rating difference to win probability using logistic function
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        
        return win_probability
    
    def predict_match(self, home_team, away_team, include_ratings=False):
        """
        Predict the outcome of a match
        
        Parameters:
        -----------
        home_team: str
            Name of home team
        away_team: str
            Name of away team
        include_ratings: bool
            Whether to include team ratings in the output
            
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
        
        # Calculate win probability
        home_win_prob = self.calculate_win_probability(home_team, away_team)
        
        # Create prediction result
        prediction = {
            'home_team': home_team,
            'away_team': away_team,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob)
        }
        
        # Include ratings if requested
        if include_ratings:
            prediction['home_rating'] = self.team_ratings[home_team]
            prediction['away_rating'] = self.team_ratings[away_team]
            prediction['rating_difference'] = self.team_ratings[home_team] - self.team_ratings[away_team]
            prediction['adjusted_rating_difference'] = (self.team_ratings[home_team] + self.home_advantage) - self.team_ratings[away_team]
        
        return prediction


def fetch_upcoming_matches(db_path):
    """
    Fetch upcoming AFL matches from the database
    
    Parameters:
    -----------
    db_path: str
        Path to SQLite database
        
    Returns:
    --------
    pandas DataFrame with upcoming matches
    """
    conn = sqlite3.connect(db_path)
    
    query = """
    SELECT 
        m.match_id, m.match_number, m.round_number, m.match_date, 
        m.venue, m.year,
        ht.name as home_team, at.name as away_team
    FROM 
        matches m
    JOIN 
        teams ht ON m.home_team_id = ht.team_id
    JOIN 
        teams at ON m.away_team_id = at.team_id
    WHERE 
        (m.hscore IS NULL OR m.ascore IS NULL OR m.complete < 100) 
        AND m.match_date >= datetime('now')
    ORDER BY 
        m.match_date
    """
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    return df


def predict_upcoming_matches(db_path, model_path='afl_elo_model.json'):
    """
    Make predictions for upcoming matches
    
    Parameters:
    -----------
    db_path: str
        Path to SQLite database
    model_path: str
        Path to the saved ELO model
        
    Returns:
    --------
    pandas DataFrame with predictions
    """
    # Load the predictor
    predictor = AFLEloPredictor(model_path)
    
    # Get upcoming matches
    upcoming_matches = fetch_upcoming_matches(db_path)
    
    if len(upcoming_matches) == 0:
        print("No upcoming matches found")
        return pd.DataFrame()
    
    print(f"Found {len(upcoming_matches)} upcoming matches")
    
    # Make predictions
    all_predictions = []
    
    for _, match in upcoming_matches.iterrows():
        prediction = predictor.predict_match(
            home_team=match['home_team'],
            away_team=match['away_team'],
            include_ratings=True
        )
        
        # Add match details
        prediction['match_id'] = match['match_id']
        prediction['match_number'] = match['match_number']
        prediction['round_number'] = match['round_number']
        prediction['match_date'] = match['match_date']
        prediction['venue'] = match['venue']
        prediction['year'] = match['year']
        
        all_predictions.append(prediction)
    
    # Convert predictions to DataFrame
    predictions_df = pd.DataFrame(all_predictions)
    
    # Format the DataFrame for display
    if len(predictions_df) > 0:
        # Format probabilities as percentages
        predictions_df['home_win_probability'] = predictions_df['home_win_probability'].apply(lambda x: f"{x:.1%}")
        predictions_df['away_win_probability'] = predictions_df['away_win_probability'].apply(lambda x: f"{x:.1%}")
        predictions_df['confidence'] = predictions_df['confidence'].apply(lambda x: f"{x:.1%}")
        
        # Format ratings to 1 decimal place
        if 'home_rating' in predictions_df.columns:
            predictions_df['home_rating'] = predictions_df['home_rating'].apply(lambda x: f"{x:.1f}")
            predictions_df['away_rating'] = predictions_df['away_rating'].apply(lambda x: f"{x:.1f}")
            predictions_df['rating_difference'] = predictions_df['rating_difference'].apply(lambda x: f"{x:.1f}")
            predictions_df['adjusted_rating_difference'] = predictions_df['adjusted_rating_difference'].apply(lambda x: f"{x:.1f}")
    
    return predictions_df


def save_predictions_to_database(predictions_df, db_path):
    """
    Save predictions to the database
    
    Parameters:
    -----------
    predictions_df: pandas DataFrame
        DataFrame containing predictions
    db_path: str
        Path to SQLite database
    """
    if len(predictions_df) == 0:
        print("No predictions to save")
        return
    
    # Convert percentage strings back to floats for database storage
    predictions_df_copy = predictions_df.copy()
    
    # Convert percentage strings back to floats
    for col in ['home_win_probability', 'away_win_probability', 'confidence']:
        if col in predictions_df_copy.columns:
            predictions_df_copy[col] = predictions_df_copy[col].str.rstrip('%').astype('float') / 100
    
    # Convert rating strings back to floats
    for col in ['home_rating', 'away_rating', 'rating_difference', 'adjusted_rating_difference']:
        if col in predictions_df_copy.columns:
            predictions_df_copy[col] = predictions_df_copy[col].astype('float')
    
    # Connect to database
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if elo_predictions table exists, create if not
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS elo_predictions (
        prediction_id INTEGER PRIMARY KEY,
        match_id INTEGER,
        prediction_time TEXT,
        home_win_probability REAL,
        away_win_probability REAL,
        predicted_winner TEXT,
        confidence REAL,
        home_rating REAL,
        away_rating REAL,
        rating_difference REAL,
        adjusted_rating_difference REAL,
        FOREIGN KEY (match_id) REFERENCES matches (match_id)
    )
    """)
    
    # Get current timestamp
    prediction_time = datetime.now().isoformat()
    
    # Insert predictions
    for _, row in predictions_df_copy.iterrows():
        # Check if prediction already exists for this match
        cursor.execute(
            "SELECT prediction_id FROM elo_predictions WHERE match_id = ?", 
            (row['match_id'],)
        )
        existing = cursor.fetchone()
        
        if existing:
            # Update existing prediction
            cursor.execute("""
            UPDATE elo_predictions
            SET prediction_time = ?,
                home_win_probability = ?,
                away_win_probability = ?,
                predicted_winner = ?,
                confidence = ?,
                home_rating = ?,
                away_rating = ?,
                rating_difference = ?,
                adjusted_rating_difference = ?
            WHERE match_id = ?
            """, (
                prediction_time,
                row['home_win_probability'],
                row['away_win_probability'],
                row['predicted_winner'],
                row['confidence'],
                row.get('home_rating', None),
                row.get('away_rating', None),
                row.get('rating_difference', None),
                row.get('adjusted_rating_difference', None),
                row['match_id']
            ))
        else:
            # Insert new prediction
            cursor.execute("""
            INSERT INTO elo_predictions (
                match_id, prediction_time, home_win_probability, away_win_probability,
                predicted_winner, confidence, home_rating, away_rating,
                rating_difference, adjusted_rating_difference
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                row['match_id'],
                prediction_time,
                row['home_win_probability'],
                row['away_win_probability'],
                row['predicted_winner'],
                row['confidence'],
                row.get('home_rating', None),
                row.get('away_rating', None),
                row.get('rating_difference', None),
                row.get('adjusted_rating_difference', None)
            ))
    
    # Commit changes and close connection
    conn.commit()
    conn.close()
    
    print(f"Saved {len(predictions_df)} predictions to database")


def update_ratings_with_results(db_path, model_path='afl_elo_model.json', save_updated_model=True):
    """
    Update ELO ratings with recent match results
    
    Parameters:
    -----------
    db_path: str
        Path to SQLite database
    model_path: str
        Path to the saved ELO model
    save_updated_model: bool
        Whether to save the updated model
        
    Returns:
    --------
    Updated AFLEloPredictor object
    """
    # Load the predictor with current ratings
    predictor = AFLEloPredictor(model_path)
    
    # Connect to database
    conn = sqlite3.connect(db_path)
    
    # Get completed matches that might not be in the model
    # This gets recent matches with scores that are completed (based on complete = 100)
    query = """
    SELECT 
        m.match_id, m.match_number, m.round_number, m.match_date, 
        m.year, m.hscore, m.ascore, m.complete,
        ht.name as home_team, at.name as away_team
    FROM 
        matches m
    JOIN 
        teams ht ON m.home_team_id = ht.team_id
    JOIN 
        teams at ON m.away_team_id = at.team_id
    WHERE 
        m.hscore IS NOT NULL AND m.ascore IS NOT NULL
        AND m.complete = 100  -- Only include fully completed matches
    ORDER BY 
        m.match_date DESC
    LIMIT 20  -- Get recent matches, adjust as needed
    """
    
    recent_matches = pd.read_sql_query(query, conn)
    conn.close()
    
    # Create a simple ELO model to update ratings
    class SimpleEloUpdater:
        def __init__(self, team_ratings, params):
            self.team_ratings = team_ratings.copy()  # Copy the ratings
            self.base_rating = params['base_rating']
            self.k_factor = params['k_factor']
            self.home_advantage = params['home_advantage']
            self.margin_factor = params['margin_factor']
            self.max_margin = params['max_margin']
            self.updates = []
        
        def calculate_win_probability(self, home_team, away_team):
            """Calculate probability of home team winning"""
            home_rating = self.team_ratings.get(home_team, self.base_rating)
            away_rating = self.team_ratings.get(away_team, self.base_rating)
            
            # Apply home ground advantage
            rating_diff = (home_rating + self.home_advantage) - away_rating
            
            # Convert rating difference to win probability
            win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
            
            return win_probability
        
        def update_ratings(self, home_team, away_team, hscore, ascore):
            """Update ratings based on match result"""
            # Ensure teams exist in ratings
            if home_team not in self.team_ratings:
                self.team_ratings[home_team] = self.base_rating
            if away_team not in self.team_ratings:
                self.team_ratings[away_team] = self.base_rating
            
            # Get current ratings
            home_rating_before = self.team_ratings[home_team]
            away_rating_before = self.team_ratings[away_team]
            
            # Calculate win probability
            home_win_prob = self.calculate_win_probability(home_team, away_team)
            
            # Determine actual result (1 for home win, 0 for away win, 0.5 for draw)
            if hscore > ascore:
                actual_result = 1.0
            elif hscore < ascore:
                actual_result = 0.0
            else:
                actual_result = 0.5
            
            # Calculate rating change based on result and margin
            margin = hscore - ascore
            capped_margin = min(abs(margin), self.max_margin) * np.sign(margin)
            
            # Adjust K-factor by margin
            margin_multiplier = 1.0
            if self.margin_factor > 0:
                margin_multiplier = np.log1p(abs(capped_margin) * self.margin_factor) / np.log1p(self.max_margin * self.margin_factor)
            
            # Calculate ELO update
            rating_change = self.k_factor * margin_multiplier * (actual_result - home_win_prob)
            
            # Update ratings
            self.team_ratings[home_team] += rating_change
            self.team_ratings[away_team] -= rating_change
            
            # Store the update
            self.updates.append({
                'home_team': home_team,
                'away_team': away_team,
                'hscore': hscore,
                'ascore': ascore,
                'home_rating_before': home_rating_before,
                'away_rating_before': away_rating_before,
                'home_rating_after': self.team_ratings[home_team],
                'away_rating_after': self.team_ratings[away_team],
                'rating_change': rating_change
            })
            
            return rating_change
    
    # Create updater with current ratings
    updater = SimpleEloUpdater(predictor.team_ratings, predictor.params)
    
    # Apply any matches that need updates
    updates_applied = 0
    
    for _, match in recent_matches.iterrows():
        # Only update if scores are available
        if pd.notna(match['hscore']) and pd.notna(match['ascore']):
            # Update ratings
            rating_change = updater.update_ratings(
                home_team=match['home_team'],
                away_team=match['away_team'],
                hscore=match['hscore'],
                ascore=match['ascore']
            )
            
            if abs(rating_change) > 0:
                updates_applied += 1
    
    print(f"Applied {updates_applied} rating updates from recent matches")
    
    # If no updates were applied, return the original predictor
    if updates_applied == 0:
        print("No rating updates needed")
        return predictor
    
    # Update the predictor with new ratings
    predictor.team_ratings = updater.team_ratings
    
    # Save updated model if requested
    if save_updated_model:
        # Create model data
        model_data = {
            'parameters': predictor.params,
            'team_ratings': predictor.team_ratings
        }
        
        # Save to file
        with open(model_path, 'w') as f:
            json.dump(model_data, f, indent=4)
        
        print(f"Saved updated model to {model_path}")
    
    # Return the updated predictor
    return predictor

def analyze_prediction_accuracy(predictions_df, completed_matches, output_prefix="elo"):
    """
    Analyze the accuracy of ELO predictions
    
    Parameters:
    -----------
    predictions_df: pandas DataFrame
        DataFrame containing predictions
    completed_matches: pandas DataFrame
        DataFrame containing completed matches with results
    output_prefix: str
        Prefix for output files
        
    Returns:
    --------
    dict with accuracy metrics
    """
    print("\nAnalyzing prediction accuracy...")
    
    if len(predictions_df) == 0 or len(completed_matches) == 0:
        print("No predictions or completed matches to analyze")
        return {}
    
    # Merge predictions with actual results
    analysis_df = predictions_df.copy()
    
    # Add columns for result analysis
    analysis_df['actual_result'] = None
    analysis_df['correct_prediction'] = False
    analysis_df['brier_score'] = None
    analysis_df['bits_score'] = None
    
    # Process each prediction
    for idx, pred in analysis_df.iterrows():
        match_id = pred['match_id']
        match = completed_matches[completed_matches['match_id'] == match_id]
        
        if len(match) == 0 or pd.isna(match['hscore'].values[0]) or pd.isna(match['ascore'].values[0]):
            continue
        
        # Get scores
        hscore = match['hscore'].values[0]
        ascore = match['ascore'].values[0]
        
        # Determine actual result
        if hscore > ascore:
            actual_result = 'home_win'
            actual_probability = 1.0
        elif hscore < ascore:
            actual_result = 'away_win'
            actual_probability = 0.0
        else:
            actual_result = 'draw'
            actual_probability = 0.5
        
        analysis_df.at[idx, 'actual_result'] = actual_result
        
        # Extract probability from percentage string
        home_win_prob_str = pred['home_win_probability']
        try:
            if isinstance(home_win_prob_str, str) and '%' in home_win_prob_str:
                home_win_prob = float(home_win_prob_str.strip('%')) / 100
            else:
                home_win_prob = float(home_win_prob_str)
        except:
            print(f"Warning: Could not convert probability {home_win_prob_str} for match {match_id}")
            continue
        
        # Check if prediction was correct
        predicted_winner = pred['predicted_winner']
        analysis_df.at[idx, 'correct_prediction'] = (predicted_winner == actual_result)
        
        # Calculate Brier score
        brier = (home_win_prob - actual_probability) ** 2
        analysis_df.at[idx, 'brier_score'] = brier
        
        # Calculate Bits score
        p = max(min(home_win_prob, 0.999), 0.001)
        if actual_probability == 1.0:
            bits = np.log2(p)
        elif actual_probability == 0.0:
            bits = np.log2(1 - p)
        else:  # Draw
            bits = np.log2(1 - abs(0.5 - p))
        analysis_df.at[idx, 'bits_score'] = bits
    
    # Filter to only completed matches
    completed_analysis = analysis_df[analysis_df['actual_result'].notna()].copy()
    
    if len(completed_analysis) == 0:
        print("No completed matches with predictions to analyze")
        return {}
    
    # Group by round and calculate metrics
    if 'round_number' in completed_analysis.columns:
        round_stats = completed_analysis.groupby('round_number').agg(
            matches=('match_id', 'count'),
            accuracy=('correct_prediction', 'mean'),
            avg_brier=('brier_score', 'mean'),
            avg_bits=('bits_score', 'mean')
        ).reset_index()
        
        # Print results by round
        print("\nPrediction Accuracy by Round:")
        for _, row in round_stats.iterrows():
            print(f"Round {row['round_number']}: "
                f"Accuracy = {row['accuracy']:.1%}, "
                f"Brier = {row['avg_brier']:.4f}, "
                f"Bits = {row['avg_bits']:.4f} "
                f"({row['matches']} matches)")
    
    # Calculate overall metrics
    overall_accuracy = completed_analysis['correct_prediction'].mean()
    overall_brier = completed_analysis['brier_score'].mean()
    overall_bits = completed_analysis['bits_score'].mean()
    total_matches = len(completed_analysis)
    
    print(f"\nOverall Metrics ({total_matches} matches):")
    print(f"Accuracy: {overall_accuracy:.1%}")
    print(f"Brier Score: {overall_brier:.4f} (lower is better)")
    print(f"Bits Score: {overall_bits:.4f} (higher is better)")
    
    # Save detailed results to CSV
    output_file = f'{output_prefix}_prediction_analysis.csv'
    completed_analysis.to_csv(output_file, index=False)
    print(f"\nDetailed prediction analysis saved to {output_file}")
    
    return {
        'accuracy': overall_accuracy,
        'brier_score': overall_brier,
        'bits_score': overall_bits,
        'total_matches': total_matches,
        'round_stats': round_stats if 'round_number' in completed_analysis.columns else None
    }

def main():
    """Main function to run predictions"""
    print("AFL ELO Model Predictions")
    print("========================")
    
    # Set database path - UPDATED TO MATCH YOUR DATABASE NAME
    db_path = '../data/afl_predictions.db'
    model_path = 'afl_elo_model.json'
    
    # Check if files exist
    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}")
        return
    
    if not os.path.exists(model_path):
        print(f"Error: Model file not found at {model_path}")
        print("Please run the training script first to generate the model")
        return
    
    # Update ratings with recent results
    print("Updating ratings with recent match results...")
    updater = update_ratings_with_results(db_path, model_path, save_updated_model=True)
    
    # Make predictions for upcoming matches
    print("\nMaking predictions for upcoming matches...")
    predictions = predict_upcoming_matches(db_path, model_path)
    
    if len(predictions) == 0:
        print("No upcoming matches to predict")
    else:
        # Display predictions
        print("\nPredictions for upcoming matches:")
        pd.set_option('display.max_columns', None)
        pd.set_option('display.width', 120)
        print(predictions[['round_number', 'match_date', 'home_team', 'away_team', 
                          'home_win_probability', 'away_win_probability', 
                          'predicted_winner', 'confidence']].to_string(index=False))
        
        # Save predictions to database
        print("\nSaving predictions to database...")
        save_predictions_to_database(predictions, db_path)
        
        # Create prediction output as CSV
        output_file = 'elo_predictions.csv'
        predictions.to_csv(output_file, index=False)
        print(f"Predictions saved to {output_file}")
    
    # Now predict completed 2025 matches using the current model
    print("\nPredicting and analyzing completed 2025 matches...")
    conn = sqlite3.connect(db_path)
    
    # Get completed matches for 2025
    completed_matches_query = """
    SELECT 
        m.match_id, m.round_number, m.match_date, 
        ht.name as home_team, at.name as away_team,
        m.hscore, m.ascore, m.year, m.venue
    FROM 
        matches m
    JOIN 
        teams ht ON m.home_team_id = ht.team_id
    JOIN 
        teams at ON m.away_team_id = at.team_id
    WHERE 
        m.year = 2025
        AND m.hscore IS NOT NULL 
        AND m.ascore IS NOT NULL
    ORDER BY 
        m.match_date
    """
    
    completed_matches = pd.read_sql_query(completed_matches_query, conn)
    conn.close()
    
    if len(completed_matches) == 0:
        print("No completed 2025 matches found")
        return
    
    print(f"Found {len(completed_matches)} completed matches for 2025")
    
    # Load the predictor
    predictor = AFLEloPredictor(model_path)
    
    # Make predictions for each completed match
    completed_predictions = []
    
    for _, match in completed_matches.iterrows():
        prediction = predictor.predict_match(
            home_team=match['home_team'],
            away_team=match['away_team'],
            include_ratings=True
        )
        
        # Add match details
        prediction['match_id'] = match['match_id']
        prediction['round_number'] = match['round_number']
        prediction['match_date'] = match['match_date']
        prediction['venue'] = match['venue']
        prediction['year'] = match['year']
        prediction['hscore'] = match['hscore']
        prediction['ascore'] = match['ascore']
        
        # Determine actual result
        if match['hscore'] > match['ascore']:
            prediction['actual_result'] = 'home_win'
            prediction['actual_probability'] = 1.0
        elif match['hscore'] < match['ascore']:
            prediction['actual_result'] = 'away_win'
            prediction['actual_probability'] = 0.0
        else:
            prediction['actual_result'] = 'draw'
            prediction['actual_probability'] = 0.5
        
        # Check if prediction was correct
        prediction['correct'] = prediction['predicted_winner'] == prediction['actual_result']
        
        # Format the display
        prediction['result'] = f"{int(match['hscore'])}-{int(match['ascore'])}"
        
        completed_predictions.append(prediction)
    
    # Convert to DataFrame
    completed_df = pd.DataFrame(completed_predictions)
    
    # Calculate overall accuracy
    accuracy = completed_df['correct'].mean() if len(completed_df) > 0 else 0
    
    # Display results
    print("\nPredictions for Completed 2025 Matches:")
    pd.set_option('display.max_columns', None)
    pd.set_option('display.width', 120)
    display_cols = ['round_number', 'match_date', 'home_team', 'away_team', 
                    'result', 'home_win_probability', 'predicted_winner', 
                    'actual_result', 'correct']
    print(completed_df[display_cols].to_string(index=False))
    
    print(f"\nOverall accuracy: {accuracy:.1%}")
    
    # Save to CSV
    output_file = 'elo_completed_predictions_2025.csv'
    completed_df.to_csv(output_file, index=False)
    print(f"Completed match predictions saved to {output_file}")

if __name__ == "__main__":
    main()
