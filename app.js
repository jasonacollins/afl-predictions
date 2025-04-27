const express = require('express');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const path = require('path');
const methodOverride = require('method-override');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const predictionsRoutes = require('./routes/predictions');
const matchesRoutes = require('./routes/matches');
const adminRoutes = require('./routes/admin');

// Import utilities
const { errorMiddleware } = require('./utils/error-handler');
const { logger, requestLogger } = require('./utils/logger');

// Initialize express app
const app = express();
const port = 3001;

// Configure view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve the scoring service as a client-side script
app.get('/js/scoring-service.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'services', 'scoring-service.js'));
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// Session configuration
app.use(session({
  store: new SqliteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, 'data')  // Use absolute path
  }),
  secret: process.env.SESSION_SECRET || 'afl-predictions-secret-key',
  resave: true,                       // Changed to true
  saveUninitialized: true,            // Changed to true
  cookie: { 
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: false                     // Set to false for HTTP
  }
}));

// Make user data available to all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.isAdmin = req.session.isAdmin || false;
  next();
});

// Add request logging middleware (before routes)
app.use(requestLogger);

// Routes
app.use('/', authRoutes);
app.use('/predictions', predictionsRoutes);
app.use('/matches', matchesRoutes);
app.use('/admin', adminRoutes);

// Home route
app.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/predictions');
  } else {
    res.render('index');
  }
});

// Add global error handler (after routes)
app.use(errorMiddleware);

// Start server
app.listen(port, '0.0.0.0', () => {
  logger.info(`Server running on http://0.0.0.0:${port}`);
});