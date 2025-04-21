const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { getOne, runQuery } = require('../models/db');

// Add rate limiting
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 5 attempts per window
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Login page (GET)
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/predictions');
  }
  res.render('index', { error: null });
});

// Login submission (POST)
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.render('index', { 
        error: 'Username and password are required' 
      });
    }

    // Check if user exists
    const user = await getOne(
      'SELECT * FROM predictors WHERE name = ?',
      [username]
    );

    if (!user) {
      return res.render('index', { 
        error: 'Invalid username or password' 
      });
    }

    // Validate password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.render('index', { 
        error: 'Invalid username or password' 
      });
    }

    // Set session data
    req.session.user = {
      id: user.predictor_id,
      name: user.name
    };
    req.session.isAdmin = user.is_admin === 1;

    // Redirect based on role
    if (user.is_admin === 1) {
      res.redirect('/admin');
    } else {
      res.redirect('/predictions');
    }
  } catch (error) {
    console.error('Login error:', error);
    res.render('index', { 
      error: 'An error occurred during login'
    });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/login');
  });
});

// Middleware to require authentication
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Middleware to require admin privileges
function isAdmin(req, res, next) {
  if (req.session.user && req.session.isAdmin) {
    next();
  } else {
    res.status(403).render('error', { 
      error: 'Admin access required' 
    });
  }
}

module.exports = router;
module.exports.isAuthenticated = isAuthenticated;
module.exports.isAdmin = isAdmin;
