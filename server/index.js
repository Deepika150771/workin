const express = require('express');
const cors = require('cors');
const path = require('path');
const { db, run, get, all, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize Database schema and seed data
initDb().then(() => {
  console.log('Database initialized successfully.');
}).catch((err) => {
  console.error('Failed to initialize database:', err);
});

// GET /api/config — Get system config (e.g., default commission rate)
app.get('/api/config', async (req, res) => {
  try {
    const row = await get(`SELECT value FROM config WHERE key = 'default_commission_rate'`);
    const defaultRate = row ? parseFloat(row.value) : 0.08;
    res.json({ default_commission_rate: defaultRate, commission_percentage: defaultRate * 100 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/config/commission-rate — Update global default commission rate (Configurable)
app.put('/api/config/commission-rate', async (req, res) => {
  try {
    const { rate } = req.body;
    if (rate === undefined || isNaN(rate) || rate < 0 || rate > 1) {
      return res.status(400).json({ error: 'Invalid commission rate. Provide a decimal between 0 and 1 (e.g. 0.08 for 8%).' });
    }
    await run(`INSERT OR REPLACE INTO config (key, value) VALUES ('default_commission_rate', ?)`, [rate.toString()]);
    res.json({ message: 'Default commission rate updated', default_commission_rate: parseFloat(rate) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employers — List all employers
app.get('/api/employers', async (req, res) => {
  try {
    const employers = await all(`SELECT * FROM employers ORDER BY id DESC`);
    res.json(employers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employer/:id — Get employer profile
app.get('/api/employer/:id', async (req, res) => {
  try {
    const employer = await get(`SELECT * FROM employers WHERE id = ?`, [req.params.id]);
    if (!employer) return res.status(404).json({ error: 'Employer not found' });
    res.json(employer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workers — List all workers
app.get('/api/workers', async (req, res) => {
  try {
    const workers = await all(`SELECT * FROM workers ORDER BY id DESC`);
    res.json(workers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs — List all jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await all(`
      SELECT j.*, 
             e.name as employer_name, e.type as employer_type,
             w.name as worker_name, w.phone as worker_phone
      FROM jobs j
      LEFT JOIN employers e ON j.employer_id = e.id
      LEFT JOIN workers w ON j.worker_id = w.id
      ORDER BY j.id DESC
    `);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs — Post a new job
app.post('/api/jobs', async (req, res) => {
  try {
    const { title, category, employer_id, wage_amount, location, job_date, description, custom_commission_rate } = req.body;
    
    if (!title || !category || !employer_id || !wage_amount || !location) {
      return res.status(400).json({ error: 'Missing required job fields (title, category, employer_id, wage_amount, location)' });
    }

    // Determine commission rate: custom rate if provided, else employer's default rate, else system default
    let rate = custom_commission_rate;
    if (rate === undefined || rate === null) {
      const emp = await get(`SELECT commission_rate FROM employers WHERE id = ?`, [employer_id]);
      if (emp && emp.commission_rate !== null) {
        rate = emp.commission_rate;
      } else {
        const sysConf = await get(`SELECT value FROM config WHERE key = 'default_commission_rate'`);
        rate = sysConf ? parseFloat(sysConf.value) : 0.08;
      }
    }

    const result = await run(`
      INSERT INTO jobs (title, category, employer_id, wage_amount, commission_rate, location, job_date, description, status, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'pending')
    `, [title, category, employer_id, wage_amount, rate, location, job_date || new Date().toISOString().split('T')[0], description || '']);

    const newJob = await get(`SELECT * FROM jobs WHERE id = ?`, [result.id]);
    res.status(201).json({
      message: 'Job posted successfully',
      note: `You pay a small commission (${rate * 100}% of wage: ₹${wage_amount * rate}) only after the job is successfully completed. Workers never pay anything.`,
      job: newJob
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/:id/complete — Simple two-way confirmation & completion logic
app.post('/api/jobs/:id/complete', async (req, res) => {
  try {
    const jobId = req.params.id;
    const { confirmed_by } = req.body; // 'employer', 'worker', or 'both'

    const job = await get(`SELECT * FROM jobs WHERE id = ?`, [jobId]);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    let empConfirmed = job.employer_confirmed;
    let wrkConfirmed = job.worker_confirmed;

    if (confirmed_by === 'employer') {
      empConfirmed = 1;
    } else if (confirmed_by === 'worker') {
      wrkConfirmed = 1;
    } else if (confirmed_by === 'both' || !confirmed_by) {
      empConfirmed = 1;
      wrkConfirmed = 1;
    }

    const isFullyCompleted = empConfirmed === 1 && wrkConfirmed === 1;

    let updatedStatus = job.status;
    let updatedPaymentStatus = job.payment_status;
    let transaction = null;

    if (isFullyCompleted) {
      updatedStatus = 'completed';
      if (job.payment_status === 'pending') {
        updatedPaymentStatus = 'job_completed';
      }

      // Calculate commission & total amount
      const wage = parseFloat(job.wage_amount);
      const rate = parseFloat(job.commission_rate || 0.08);
      const commissionAmount = Math.round(wage * rate * 100) / 100;
      const totalAmount = Math.round((wage + commissionAmount) * 100) / 100;

      // Check if transaction already exists for this job
      const existingTx = await get(`SELECT * FROM transactions WHERE job_id = ?`, [jobId]);
      if (existingTx) {
        transaction = existingTx;
      } else {
        const txResult = await run(`
          INSERT INTO transactions (job_id, employer_id, worker_id, wage_amount, commission_rate, commission_amount, total_amount, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `, [jobId, job.employer_id, job.worker_id || 1, wage, rate, commissionAmount, totalAmount]);
        
        transaction = await get(`SELECT * FROM transactions WHERE id = ?`, [txResult.id]);
      }
    }

    // Update job record
    await run(`
      UPDATE jobs 
      SET employer_confirmed = ?, worker_confirmed = ?, status = ?, payment_status = ?
      WHERE id = ?
    `, [empConfirmed, wrkConfirmed, updatedStatus, updatedPaymentStatus, jobId]);

    const updatedJob = await get(`SELECT * FROM jobs WHERE id = ?`, [jobId]);

    res.json({
      message: isFullyCompleted ? 'Job successfully completed by both parties!' : `Confirmation received from ${confirmed_by}. Waiting for other party confirmation.`,
      is_completed: isFullyCompleted,
      job: updatedJob,
      confirmation_status: {
        employer_confirmed: empConfirmed === 1,
        worker_confirmed: wrkConfirmed === 1
      },
      transaction_summary: transaction ? {
        transaction_id: transaction.id,
        wage_amount: transaction.wage_amount,
        commission_rate: transaction.commission_rate,
        commission_amount: transaction.commission_amount,
        total_amount: transaction.total_amount,
        status: transaction.status
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employer/:id/transactions — Returns employer's payment history
app.get('/api/employer/:id/transactions', async (req, res) => {
  try {
    const employerId = req.params.id;
    const transactions = await all(`
      SELECT t.*, 
             j.title as job_title, j.category as job_category, j.job_date, j.payment_status as job_payment_status,
             w.name as worker_name, w.phone as worker_phone, w.trade as worker_trade
      FROM transactions t
      JOIN jobs j ON t.job_id = j.id
      LEFT JOIN workers w ON t.worker_id = w.id
      WHERE t.employer_id = ?
      ORDER BY t.created_at DESC
    `, [employerId]);

    // Calculate totals for employer
    const totals = transactions.reduce((acc, tx) => {
      acc.total_jobs += 1;
      acc.total_wages += tx.wage_amount;
      acc.total_commission += tx.commission_amount;
      acc.total_paid += (tx.status === 'commission_paid' ? tx.total_amount : 0);
      acc.total_pending += (tx.status === 'pending' ? tx.total_amount : 0);
      return acc;
    }, { total_jobs: 0, total_wages: 0, total_commission: 0, total_paid: 0, total_pending: 0 });

    res.json({
      employer_id: parseInt(employerId),
      summary: totals,
      transactions: transactions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/revenue — Internal tracking/dashboard for total commission earned
app.get('/api/admin/revenue', async (req, res) => {
  try {
    const overallStats = await get(`
      SELECT 
        COUNT(id) as total_transactions,
        SUM(wage_amount) as total_job_wages,
        SUM(commission_amount) as total_commission_earned,
        SUM(CASE WHEN status = 'commission_paid' THEN commission_amount ELSE 0 END) as collected_commission,
        SUM(CASE WHEN status = 'pending' THEN commission_amount ELSE 0 END) as pending_commission
      FROM transactions
    `);

    const recentTransactions = await all(`
      SELECT t.*, j.title as job_title, e.name as employer_name, w.name as worker_name
      FROM transactions t
      JOIN jobs j ON t.job_id = j.id
      JOIN employers e ON t.employer_id = e.id
      JOIN workers w ON t.worker_id = w.id
      ORDER BY t.created_at DESC
      LIMIT 10
    `);

    res.json({
      revenue_summary: {
        total_transactions: overallStats.total_transactions || 0,
        total_job_wages: overallStats.total_job_wages || 0,
        total_commission_earned: overallStats.total_commission_earned || 0,
        collected_commission: overallStats.collected_commission || 0,
        pending_commission: overallStats.pending_commission || 0,
        default_commission_rate: '8%'
      },
      recent_transactions: recentTransactions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transactions/:id/pay — Record payment completion (Pay Now action for MVP)
app.post('/api/transactions/:id/pay', async (req, res) => {
  try {
    const txId = req.params.id;
    const tx = await get(`SELECT * FROM transactions WHERE id = ?`, [txId]);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    await run(`UPDATE transactions SET status = 'commission_paid' WHERE id = ?`, [txId]);
    await run(`UPDATE jobs SET payment_status = 'commission_paid' WHERE id = ?`, [tx.job_id]);

    const updatedTx = await get(`SELECT * FROM transactions WHERE id = ?`, [txId]);
    res.json({
      message: 'Commission payment successfully recorded!',
      transaction: updatedTx
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Workin Server running on port ${PORT}`);
});
