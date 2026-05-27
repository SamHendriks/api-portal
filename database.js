const Database = require('better-sqlite3');
const path = require('path');

// Use an in-memory database for tests — clean slate every run, never touches real data
const dbPath = process.env.NODE_ENV === 'test'
  ? ':memory:'
  : path.join(__dirname, 'data', 'portal.db');

const db = new Database(dbPath);

// WAL mode makes reads and writes faster and concurrent
db.pragma('journal_mode = WAL');

// Create tables if they don't exist yet
// This runs every startup — IF NOT EXISTS makes it safe to re-run
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT    UNIQUE NOT NULL,
    password_hash TEXT   NOT NULL,
    created_at   TEXT   DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    received_at TEXT DEFAULT (datetime('now'))
  );
`);

// Prepared statements — compiled once, executed many times (faster + safe from SQL injection)
const stmts = {
  // Users
  findUser:     db.prepare('SELECT * FROM users WHERE username = ?'),
  insertUser:   db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  countUsers:   db.prepare('SELECT COUNT(*) as count FROM users'),

  // Webhook events
  insertEvent:  db.prepare('INSERT INTO webhook_events (event_name, payload) VALUES (?, ?)'),
  recentEvents: db.prepare('SELECT * FROM webhook_events ORDER BY id DESC LIMIT 20'),
  countEvents:  db.prepare('SELECT COUNT(*) as count FROM webhook_events'),
};

module.exports = { db, stmts };
