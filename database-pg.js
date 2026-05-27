// PostgreSQL version — compare this file against database.js to see what changes
//
// What's different from SQLite:
//  - Requires a running PostgreSQL server (not just a file)
//  - Connection is async — queries return Promises, not values directly
//  - Uses a connection pool (multiple connections shared across requests)
//  - $1, $2 placeholders instead of ?
//  - SERIAL instead of AUTOINCREMENT
//  - now() instead of datetime('now')
//
// To use: set DATABASE_URL in .env, then swap require('./database') for require('./database-pg')

const { Pool } = require('pg');

// The pool manages multiple connections automatically
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
  // e.g. DATABASE_URL=postgresql://user:password@localhost:5432/api_portal
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id          SERIAL PRIMARY KEY,
      event_name  TEXT NOT NULL,
      payload     TEXT NOT NULL,
      received_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

// Async wrappers — same interface as the SQLite stmts so server.js barely changes
const stmts = {
  findUser:     (username) => pool.query('SELECT * FROM users WHERE username = $1', [username]).then(r => r.rows[0]),
  insertUser:   (username, hash) => pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hash]),
  countUsers:   () => pool.query('SELECT COUNT(*) as count FROM users').then(r => r.rows[0]),

  insertEvent:  (name, payload) => pool.query('INSERT INTO webhook_events (event_name, payload) VALUES ($1, $2)', [name, payload]),
  recentEvents: () => pool.query('SELECT * FROM webhook_events ORDER BY id DESC LIMIT 20').then(r => r.rows),
  countEvents:  () => pool.query('SELECT COUNT(*) as count FROM webhook_events').then(r => r.rows[0]),
};

module.exports = { pool, stmts, init };
