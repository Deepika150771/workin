const path = require('path');
const fs = require('fs');

let sqlite3;
let db = null;
let useJsFallback = false;

// Determine writable DB location for Vercel serverless / read-only filesystem
let dbPath;
if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
  dbPath = '/tmp/workin.db';
} else {
  dbPath = path.join(__dirname, 'workin.db');
}

try {
  sqlite3 = require('sqlite3').verbose();
  // Test opening DB path or fall back to :memory:
  try {
    db = new sqlite3.Database(dbPath);
  } catch (e1) {
    db = new sqlite3.Database(':memory:');
  }
} catch (err) {
  console.warn('sqlite3 native module unavailable, falling back to in-memory store:', err.message);
  useJsFallback = true;
}

// In-Memory JS Store Fallback
const memoryStore = {
  config: [{ key: 'default_commission_rate', value: '0.08' }],
  employers: [],
  workers: [],
  jobs: [],
  transactions: [],
  autoIds: { employers: 1, workers: 1, jobs: 1, transactions: 1 }
};

function run(sql, params = []) {
  if (!useJsFallback && db) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  // JS Fallback handling
  return new Promise((resolve) => {
    const cleanSql = sql.trim().replace(/\s+/g, ' ');

    if (cleanSql.startsWith('CREATE TABLE')) {
      return resolve({ id: 0, changes: 0 });
    }

    if (cleanSql.includes('INSERT OR REPLACE INTO config')) {
      const existing = memoryStore.config.find(c => c.key === params[0]);
      if (existing) {
        existing.value = params[1];
      } else {
        memoryStore.config.push({ key: params[0], value: params[1] });
      }
      return resolve({ id: 1, changes: 1 });
    }

    if (cleanSql.startsWith('INSERT INTO employers')) {
      const id = memoryStore.autoIds.employers++;
      const item = {
        id,
        name: params[0],
        type: params[1],
        phone: params[2],
        location: params[3],
        commission_rate: params[4] || 0.08,
        created_at: new Date().toISOString()
      };
      memoryStore.employers.push(item);
      return resolve({ id, changes: 1 });
    }

    if (cleanSql.startsWith('INSERT INTO workers')) {
      const id = memoryStore.autoIds.workers++;
      const item = {
        id,
        name: params[0],
        trade: params[1],
        phone: params[2],
        location: params[3],
        rating: params[4] || 4.9,
        verified: params[5] !== undefined ? params[5] : 1,
        created_at: new Date().toISOString()
      };
      memoryStore.workers.push(item);
      return resolve({ id, changes: 1 });
    }

    if (cleanSql.startsWith('INSERT INTO jobs')) {
      const id = memoryStore.autoIds.jobs++;
      const item = {
        id,
        title: params[0],
        category: params[1],
        employer_id: params[2],
        wage_amount: parseFloat(params[3]),
        commission_rate: parseFloat(params[4]),
        location: params[5],
        job_date: params[6],
        description: params[7],
        status: 'open',
        employer_confirmed: 0,
        worker_confirmed: 0,
        payment_status: 'pending',
        worker_id: null,
        created_at: new Date().toISOString()
      };
      memoryStore.jobs.push(item);
      return resolve({ id, changes: 1 });
    }

    if (cleanSql.startsWith('INSERT INTO transactions')) {
      const id = memoryStore.autoIds.transactions++;
      const item = {
        id,
        job_id: params[0],
        employer_id: params[1],
        worker_id: params[2],
        wage_amount: parseFloat(params[3]),
        commission_rate: parseFloat(params[4]),
        commission_amount: parseFloat(params[5]),
        total_amount: parseFloat(params[6]),
        status: params[7] || 'pending',
        created_at: new Date().toISOString()
      };
      memoryStore.transactions.push(item);
      return resolve({ id, changes: 1 });
    }

    if (cleanSql.includes('UPDATE jobs SET employer_confirmed')) {
      const [empConfirmed, wrkConfirmed, status, paymentStatus, jobId] = params;
      const job = memoryStore.jobs.find(j => j.id == jobId);
      if (job) {
        job.employer_confirmed = empConfirmed;
        job.worker_confirmed = wrkConfirmed;
        job.status = status;
        job.payment_status = paymentStatus;
      }
      return resolve({ id: jobId, changes: job ? 1 : 0 });
    }

    if (cleanSql.includes('UPDATE transactions SET status')) {
      const [status, txId] = params;
      const tx = memoryStore.transactions.find(t => t.id == txId);
      if (tx) tx.status = status;
      return resolve({ id: txId, changes: tx ? 1 : 0 });
    }

    if (cleanSql.includes('UPDATE jobs SET payment_status')) {
      const [paymentStatus, jobId] = params;
      const job = memoryStore.jobs.find(j => j.id == jobId);
      if (job) job.payment_status = paymentStatus;
      return resolve({ id: jobId, changes: job ? 1 : 0 });
    }

    resolve({ id: 0, changes: 0 });
  });
}

function get(sql, params = []) {
  if (!useJsFallback && db) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  return new Promise((resolve) => {
    const cleanSql = sql.trim().replace(/\s+/g, ' ');

    if (cleanSql.includes('FROM config WHERE key')) {
      const row = memoryStore.config.find(c => c.key === params[0]);
      return resolve(row || null);
    }

    if (cleanSql.includes('FROM employers WHERE id')) {
      const row = memoryStore.employers.find(e => e.id == params[0]);
      return resolve(row || null);
    }

    if (cleanSql.includes('FROM jobs WHERE id')) {
      const row = memoryStore.jobs.find(j => j.id == params[0]);
      return resolve(row || null);
    }

    if (cleanSql.includes('FROM transactions WHERE job_id')) {
      const row = memoryStore.transactions.find(t => t.job_id == params[0]);
      return resolve(row || null);
    }

    if (cleanSql.includes('FROM transactions WHERE id')) {
      const row = memoryStore.transactions.find(t => t.id == params[0]);
      return resolve(row || null);
    }

    if (cleanSql.includes('COUNT(*) as count FROM employers')) {
      return resolve({ count: memoryStore.employers.length });
    }

    if (cleanSql.includes('COUNT(id) as total_transactions')) {
      const total_transactions = memoryStore.transactions.length;
      const total_job_wages = memoryStore.transactions.reduce((s, t) => s + t.wage_amount, 0);
      const total_commission_earned = memoryStore.transactions.reduce((s, t) => s + t.commission_amount, 0);
      const collected_commission = memoryStore.transactions
        .filter(t => t.status === 'commission_paid')
        .reduce((s, t) => s + t.commission_amount, 0);
      const pending_commission = memoryStore.transactions
        .filter(t => t.status === 'pending')
        .reduce((s, t) => s + t.commission_amount, 0);

      return resolve({
        total_transactions,
        total_job_wages,
        total_commission_earned,
        collected_commission,
        pending_commission
      });
    }

    resolve(null);
  });
}

function all(sql, params = []) {
  if (!useJsFallback && db) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  return new Promise((resolve) => {
    const cleanSql = sql.trim().replace(/\s+/g, ' ');

    if (cleanSql.includes('FROM employers')) {
      const list = [...memoryStore.employers].reverse();
      return resolve(list);
    }

    if (cleanSql.includes('FROM workers')) {
      const list = [...memoryStore.workers].reverse();
      return resolve(list);
    }

    if (cleanSql.includes('FROM jobs j')) {
      const list = memoryStore.jobs.map(j => {
        const emp = memoryStore.employers.find(e => e.id == j.employer_id) || {};
        const wrk = memoryStore.workers.find(w => w.id == j.worker_id) || {};
        return {
          ...j,
          employer_name: emp.name,
          employer_type: emp.type,
          worker_name: wrk.name,
          worker_phone: wrk.phone
        };
      }).reverse();
      return resolve(list);
    }

    if (cleanSql.includes('FROM transactions t') && cleanSql.includes('t.employer_id = ?')) {
      const list = memoryStore.transactions
        .filter(t => t.employer_id == params[0])
        .map(t => {
          const job = memoryStore.jobs.find(j => j.id == t.job_id) || {};
          const wrk = memoryStore.workers.find(w => w.id == t.worker_id) || {};
          return {
            ...t,
            job_title: job.title,
            job_category: job.category,
            job_date: job.job_date,
            job_payment_status: job.payment_status,
            worker_name: wrk.name,
            worker_phone: wrk.phone,
            worker_trade: wrk.trade
          };
        });
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return resolve(list);
    }

    if (cleanSql.includes('FROM transactions t') && cleanSql.includes('LIMIT 10')) {
      const list = memoryStore.transactions.map(t => {
        const job = memoryStore.jobs.find(j => j.id == t.job_id) || {};
        const emp = memoryStore.employers.find(e => e.id == t.employer_id) || {};
        const wrk = memoryStore.workers.find(w => w.id == t.worker_id) || {};
        return {
          ...t,
          job_title: job.title,
          employer_name: emp.name,
          worker_name: wrk.name
        };
      });
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return resolve(list.slice(0, 10));
    }

    resolve([]);
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

  const rateRow = await get(`SELECT value FROM config WHERE key = 'default_commission_rate'`);
  if (!rateRow) {
    await run(`INSERT OR REPLACE INTO config (key, value) VALUES ('default_commission_rate', '0.08')`);
  }

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed sample data if empty
  const empCount = await get(`SELECT COUNT(*) as count FROM employers`);
  if (!empCount || empCount.count === 0) {
    console.log('Seeding initial data...');
    if (useJsFallback) {
      memoryStore.employers = [
        { id: 1, name: 'Annamalai Wedding Hall', type: 'Mandapam Owner', phone: '9840012345', location: 'Madurai', commission_rate: 0.08 },
        { id: 2, name: 'Sri Balaji Catering Services', type: 'Caterer', phone: '9840023456', location: 'Chennai', commission_rate: 0.08 },
        { id: 3, name: 'Vetri Builders', type: 'Contractor', phone: '9840034567', location: 'Coimbatore', commission_rate: 0.10 }
      ];
      memoryStore.workers = [
        { id: 1, name: 'Muthu Kumar', trade: 'Catering Assistant', phone: '9710011111', location: 'Madurai', rating: 4.9, verified: 1 },
        { id: 2, name: 'Kavitha S.', trade: 'Mandapam Decor Helper', phone: '9710022222', location: 'Madurai', rating: 4.8, verified: 1 },
        { id: 3, name: 'Ramesh R.', trade: 'Construction Helper', phone: '9710033333', location: 'Chennai', rating: 4.7, verified: 1 },
        { id: 4, name: 'Selvam P.', trade: 'Kitchen Helper', phone: '9710044444', location: 'Chennai', rating: 4.9, verified: 1 }
      ];
      memoryStore.jobs = [
        { id: 1, title: 'Marriage Hall Setup Helper', category: 'Mandapam Event', employer_id: 1, worker_id: 1, wage_amount: 800, commission_rate: 0.08, location: 'Madurai', job_date: '2026-09-28', description: 'Need 1 helper for hall arrangement and chair setup.', status: 'assigned', payment_status: 'pending', employer_confirmed: 0, worker_confirmed: 0 },
        { id: 2, title: 'Buffet Catering Assistant', category: 'Catering', employer_id: 2, worker_id: 4, wage_amount: 1200, commission_rate: 0.08, location: 'Chennai', job_date: '2026-09-25', description: 'Evening reception catering service helper.', status: 'completed', payment_status: 'job_completed', employer_confirmed: 1, worker_confirmed: 1 },
        { id: 3, title: 'Site Loading & Unloading', category: 'Construction', employer_id: 3, worker_id: 3, wage_amount: 1000, commission_rate: 0.10, location: 'Coimbatore', job_date: '2026-09-24', description: 'Material handling at site.', status: 'completed', payment_status: 'commission_paid', employer_confirmed: 1, worker_confirmed: 1 }
      ];
      memoryStore.transactions = [
        { id: 1, job_id: 2, employer_id: 2, worker_id: 4, wage_amount: 1200, commission_rate: 0.08, commission_amount: 96, total_amount: 1296, status: 'pending', created_at: '2026-09-25 18:30:00' },
        { id: 2, job_id: 3, employer_id: 3, worker_id: 3, wage_amount: 1000, commission_rate: 0.10, commission_amount: 100, total_amount: 1100, status: 'commission_paid', created_at: '2026-09-24 17:00:00' }
      ];
      memoryStore.autoIds = { employers: 4, workers: 5, jobs: 4, transactions: 3 };
    } else {
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

      await run(`INSERT INTO transactions (job_id, employer_id, worker_id, wage_amount, commission_rate, commission_amount, total_amount, status, created_at) VALUES
        (2, 2, 4, 1200, 0.08, 96, 1296, 'pending', '2026-09-25 18:30:00'),
        (3, 3, 3, 1000, 0.10, 100, 1100, 'commission_paid', '2026-09-24 17:00:00')
      `);
    }
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

