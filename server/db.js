const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'workin.db');
const db = new sqlite3.Database(dbPath);

// Helper function to run query returning a promise
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

// Helper function to get single row
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Helper function to get all rows
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// System configuration table for global settings like default commission rate
async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Default commission rate: 0.08 (8%)
  const rateRow = await get(`SELECT value FROM config WHERE key = 'default_commission_rate'`);
  if (!rateRow) {
    await run(`INSERT INTO config (key, value) VALUES ('default_commission_rate', '0.08')`);
  }

  // Employers table
  await run(`
    CREATE TABLE IF NOT EXISTS employers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      phone TEXT,
      location TEXT NOT NULL,
      commission_rate REAL DEFAULT 0.08,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Workers table
  await run(`
    CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trade TEXT NOT NULL,
      phone TEXT,
      location TEXT NOT NULL,
      rating REAL DEFAULT 4.9,
      verified INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Jobs table
  await run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      employer_id INTEGER NOT NULL,
      worker_id INTEGER,
      wage_amount REAL NOT NULL,
      commission_rate REAL DEFAULT 0.08,
      location TEXT NOT NULL,
      job_date TEXT,
      description TEXT,
      status TEXT DEFAULT 'open',
      employer_confirmed INTEGER DEFAULT 0,
      worker_confirmed INTEGER DEFAULT 0,
      payment_status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employer_id) REFERENCES employers(id),
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    )
  `);

  // Transactions table
  await run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      employer_id INTEGER NOT NULL,
      worker_id INTEGER NOT NULL,
      wage_amount REAL NOT NULL,
      commission_rate REAL NOT NULL,
      commission_amount REAL NOT NULL,
      total_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (employer_id) REFERENCES employers(id),
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    )
  `);

  // Seed sample data if empty
  const empCount = await get(`SELECT COUNT(*) as count FROM employers`);
  if (empCount.count === 0) {
    console.log('Seeding initial data...');
    await run(`INSERT INTO employers (name, type, phone, location, commission_rate) VALUES
      ('Annamalai Wedding Hall', 'Mandapam Owner', '9840012345', 'Madurai', 0.08),
      ('Sri Balaji Catering Services', 'Caterer', '9840023456', 'Chennai', 0.08),
      ('Vetri Builders', 'Contractor', '9840034567', 'Coimbatore', 0.10)
    `);

    await run(`INSERT INTO workers (name, trade, phone, location, rating, verified) VALUES
      ('Muthu Kumar', 'Catering Assistant', '9710011111', 'Madurai', 4.9, 1),
      ('Kavitha S.', 'Mandapam Decor Helper', '9710022222', 'Madurai', 4.8, 1),
      ('Ramesh R.', 'Construction Helper', '9710033333', 'Chennai', 4.7, 1),
      ('Selvam P.', 'Kitchen Helper', '9710044444', 'Chennai', 4.9, 1)
    `);

    await run(`INSERT INTO jobs (title, category, employer_id, worker_id, wage_amount, commission_rate, location, job_date, description, status, payment_status, employer_confirmed, worker_confirmed) VALUES
      ('Marriage Hall Setup Helper', 'Mandapam Event', 1, 1, 800, 0.08, 'Madurai', '2026-09-28', 'Need 1 helper for hall arrangement and chair setup.', 'assigned', 'pending', 0, 0),
      ('Buffet Catering Assistant', 'Catering', 2, 4, 1200, 0.08, 'Chennai', '2026-09-25', 'Evening reception catering service helper.', 'completed', 'job_completed', 1, 1),
      ('Site Loading & Unloading', 'Construction', 3, 3, 1000, 0.10, 'Coimbatore', '2026-09-24', 'Material handling at site.', 'completed', 'commission_paid', 1, 1)
    `);

    // Insert corresponding transaction for completed jobs
    // Job 2 (wage 1200 * 0.08 = 96, total = 1296)
    await run(`INSERT INTO transactions (job_id, employer_id, worker_id, wage_amount, commission_rate, commission_amount, total_amount, status, created_at) VALUES
      (2, 2, 4, 1200, 0.08, 96, 1296, 'pending', '2026-09-25 18:30:00'),
      (3, 3, 3, 1000, 0.10, 100, 1100, 'commission_paid', '2026-09-24 17:00:00')
    `);
    console.log('Seeding complete!');
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  initDb
};
