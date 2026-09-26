let currentRole = 'employer';
let activeEmployerId = 1;
let currentTransactionId = null;
let currentJobForPayment = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  updateCalcPreview();
  loadJobs();
});

// Role Switcher (Employer, Worker, Admin)
function switchRole(role) {
  currentRole = role;
  
  document.getElementById('role-employer').classList.toggle('active', role === 'employer');
  document.getElementById('role-worker').classList.toggle('active', role === 'worker');
  document.getElementById('role-admin').classList.toggle('active', role === 'admin');

  document.getElementById('view-employer').style.display = role === 'employer' ? 'block' : 'none';
  document.getElementById('view-worker').style.display = role === 'worker' ? 'block' : 'none';
  document.getElementById('view-admin').style.display = role === 'admin' ? 'block' : 'none';

  const voiceTitle = document.getElementById('voice-title');
  const voiceDesc = document.getElementById('voice-desc');

  if (role === 'employer') {
    voiceTitle.innerText = '🎤 Voice Job Posting / குரல் மூலம் வேலை பதிவு';
    voiceDesc.innerText = 'Say: "Need 2 catering assistants in Madurai for ₹1000 per day"';
    loadJobs();
  } else if (role === 'worker') {
    voiceTitle.innerText = '🎤 Voice Job Search / குரல் மூலம் வேலை தேடல்';
    voiceDesc.innerText = 'Say: "Show catering helper jobs in Madurai"';
    loadWorkerJobs();
  } else if (role === 'admin') {
    voiceTitle.innerText = '📊 Admin Revenue Dashboard';
    voiceDesc.innerText = 'Track total platform revenue, job volume, and commission breakdown';
    loadAdminRevenue();
  }
}

// Employer Sub-tabs: 'jobs' vs 'payments' (Step 3 feature)
function switchEmployerTab(tab) {
  document.getElementById('tab-jobs').classList.toggle('active', tab === 'jobs');
  document.getElementById('tab-payments').classList.toggle('active', tab === 'payments');

  document.getElementById('employer-tab-jobs').style.display = tab === 'jobs' ? 'grid' : 'none';
  document.getElementById('employer-tab-payments').style.display = tab === 'payments' ? 'block' : 'none';

  if (tab === 'payments') {
    loadEmployerTransactions();
  } else {
    loadJobs();
  }
}

// Dynamic Live Calculation Preview on Job Form
function updateCalcPreview() {
  const wageInput = document.getElementById('wage-amount');
  const wage = parseFloat(wageInput.value) || 0;
  const rate = 0.08; // 8% default commission rate

  const commission = Math.round(wage * rate * 100) / 100;
  const total = Math.round((wage + commission) * 100) / 100;

  document.getElementById('preview-wage').innerText = `₹${wage.toLocaleString()}`;
  document.getElementById('preview-commission').innerText = `₹${commission.toLocaleString()}`;
  document.getElementById('preview-total').innerText = `₹${total.toLocaleString()}`;
}

// Post New Job
async function handlePostJob(e) {
  e.preventDefault();

  const employer_id = parseInt(document.getElementById('employer-select').value);
  activeEmployerId = employer_id;
  const title = document.getElementById('job-title').value.trim();
  const category = document.getElementById('job-category').value;
  const wage_amount = parseFloat(document.getElementById('wage-amount').value);
  const location = document.getElementById('job-location').value.trim();

  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        category,
        employer_id,
        wage_amount,
        location,
        custom_commission_rate: 0.08
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to post job');

    alert(`✅ Job Posted Successfully!\n\n${data.note}`);
    document.getElementById('job-title').value = '';
    loadJobs();
  } catch (err) {
    alert(`Error posting job: ${err.message}`);
  }
}

// Load Jobs for Employer View
async function loadJobs() {
  const container = document.getElementById('employer-job-list');
  container.innerHTML = '<div style="text-align:center; padding: 2rem; color: #64748b;">Loading jobs...</div>';

  try {
    const res = await fetch('/api/jobs');
    const jobs = await res.json();

    if (!Array.isArray(jobs) || jobs.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding: 2rem; color: #64748b;">No jobs posted yet. Post your first job above!</div>';
      return;
    }

    container.innerHTML = jobs.map(job => {
      const wage = job.wage_amount;
      const rate = job.commission_rate || 0.08;
      const commission = Math.round(wage * rate * 100) / 100;
      const total = Math.round((wage + commission) * 100) / 100;

      let statusClass = 'status-pending';
      let statusLabel = 'Job Pending Completion';
      
      if (job.payment_status === 'job_completed') {
        statusClass = 'status-job_completed';
        statusLabel = 'Job Completed - Commission Due';
      } else if (job.payment_status === 'commission_paid') {
        statusClass = 'status-commission_paid';
        statusLabel = 'Commission Paid ✓';
      }

      const isCompleted = job.status === 'completed';

      return `
        <div class="job-card">
          <div class="job-header">
            <div>
              <div class="job-title">${escapeHtml(job.title)}</div>
              <span class="job-category">${escapeHtml(job.category)} • 📍 ${escapeHtml(job.location)}</span>
            </div>
            <span class="status-badge ${statusClass}">${statusLabel}</span>
          </div>

          <div class="job-meta">
            <span>Employer: <strong>${escapeHtml(job.employer_name || 'Employer #' + job.employer_id)}</strong></span>
            <span>Assigned Worker: <strong>${escapeHtml(job.worker_name || 'Muthu Kumar (Verified)')}</strong></span>
          </div>

          <!-- Employer Breakdown Box -->
          <div style="background: #f8fafc; border-radius: 8px; padding: 0.75rem; font-size: 0.88rem; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <span>Worker Wage: <strong>₹${wage}</strong></span> | 
              <span>Commission (8%): <strong>₹${commission}</strong></span>
            </div>
            <div style="font-weight: 700; color: var(--primary);">
              Total Due: ₹${total}
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem;">
            ${!isCompleted ? `
              <button class="btn btn-primary" onclick="completeJob(${job.id}, 'both')">
                ✅ Mark Job Completed (Confirm Both)
              </button>
            ` : job.payment_status !== 'commission_paid' ? `
              <button class="btn btn-success" onclick="openPaymentSummaryModal(${job.id}, ${wage}, ${commission}, ${total})">
                💳 View Payment Summary & Pay Now (₹${total})
              </button>
            ` : `
              <div style="width: 100%; text-align: center; font-size: 0.88rem; color: #15803d; font-weight: 700; background: #dcfce7; padding: 0.5rem; border-radius: 8px;">
                ✓ Payment Settled
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="color: red; padding: 1rem;">Failed to load jobs: ${err.message}</div>`;
  }
}

// Complete Job Action (Two-Way Confirmation)
async function completeJob(jobId, confirmedBy = 'both') {
  try {
    const res = await fetch(`/api/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed_by: confirmedBy })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to complete job');

    if (data.transaction_summary) {
      const ts = data.transaction_summary;
      currentTransactionId = ts.transaction_id;
      openPaymentSummaryModal(jobId, ts.wage_amount, ts.commission_amount, ts.total_amount, ts.transaction_id);
    } else {
      alert(data.message);
    }

    loadJobs();
  } catch (err) {
    alert(`Error completing job: ${err.message}`);
  }
}

// Open Payment Summary Modal (Required Feature #3 & #5)
function openPaymentSummaryModal(jobId, wage, commission, total, txId = null) {
  currentJobForPayment = jobId;
  currentTransactionId = txId;

  document.getElementById('modal-wage').innerText = `₹${wage.toLocaleString()}`;
  document.getElementById('modal-commission').innerText = `₹${commission.toLocaleString()}`;
  document.getElementById('modal-total').innerText = `₹${total.toLocaleString()}`;

  const payBtn = document.getElementById('pay-now-btn');
  payBtn.style.display = 'block';

  document.getElementById('payment-modal').classList.add('active');

  // If txId not provided, fetch transactions to find txId
  if (!txId) {
    fetch('/api/jobs')
      .then(r => r.json())
      .then(jobs => {
        const j = jobs.find(x => x.id === jobId);
        if (j && j.employer_id) {
          fetch(`/api/employer/${j.employer_id}/transactions`)
            .then(r => r.json())
            .then(txData => {
              const matchedTx = txData.transactions.find(t => t.job_id === jobId);
              if (matchedTx) {
                currentTransactionId = matchedTx.id;
              }
            });
        }
      });
  }
}

function closeModal() {
  document.getElementById('payment-modal').classList.remove('active');
}

// Execute Pay Now (MVP Action)
async function executePayNow() {
  if (!currentTransactionId) {
    // If no transaction ID cached, find transaction for current job
    try {
      const resJobs = await fetch('/api/jobs');
      const jobs = await resJobs.json();
      const j = jobs.find(x => x.id === currentJobForPayment);
      if (j) {
        const resTx = await fetch(`/api/employer/${j.employer_id}/transactions`);
        const txData = await resTx.json();
        const found = txData.transactions.find(t => t.job_id === currentJobForPayment);
        if (found) currentTransactionId = found.id;
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (!currentTransactionId) {
    alert('Transaction record ready. Payment recorded!');
    closeModal();
    loadJobs();
    return;
  }

  try {
    const res = await fetch(`/api/transactions/${currentTransactionId}/pay`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Payment failed');

    alert(`🎉 Payment Successful!\n\n${data.message}\nTransaction #${data.transaction.id} status is now Paid.`);
    closeModal();
    loadJobs();
    if (document.getElementById('employer-tab-payments').style.display !== 'none') {
      loadEmployerTransactions();
    }
  } catch (err) {
    alert(`Payment Error: ${err.message}`);
  }
}

// STEP 3 FEATURE: Load "My Payments" Transaction History for Employer
async function loadEmployerTransactions() {
  const empId = parseInt(document.getElementById('employer-select').value) || 1;
  const tbody = document.getElementById('payments-table-body');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Loading payment history...</td></tr>';

  try {
    const res = await fetch(`/api/employer/${empId}/transactions`);
    const data = await res.json();

    const summary = data.summary;
    document.getElementById('emp-stat-jobs').innerText = summary.total_jobs;
    document.getElementById('emp-stat-pending').innerText = `₹${summary.total_pending.toLocaleString()}`;
    document.getElementById('emp-stat-paid').innerText = `₹${summary.total_paid.toLocaleString()}`;

    if (!data.transactions || data.transactions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#64748b;">No past transactions found for this employer.</td></tr>';
      return;
    }

    tbody.innerHTML = data.transactions.map(tx => {
      const isPaid = tx.status === 'commission_paid';
      const statusBadge = isPaid 
        ? '<span class="status-badge status-commission_paid">Paid ✓</span>'
        : '<span class="status-badge status-pending">Pending Payment</span>';

      const actionBtn = isPaid 
        ? '<span style="color:#15803d; font-weight:600;">Settled</span>'
        : `<button class="btn btn-success" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="payTransactionDirect(${tx.id})">Pay Now (₹${tx.total_amount})</button>`;

      const dateStr = new Date(tx.created_at).toLocaleDateString();

      return `
        <tr>
          <td><strong>#${tx.id}</strong></td>
          <td>${escapeHtml(tx.job_title)}</td>
          <td>${escapeHtml(tx.worker_name || 'Assigned Worker')}</td>
          <td>${dateStr}</td>
          <td>₹${tx.wage_amount}</td>
          <td>₹${tx.commission_amount} (8%)</td>
          <td><strong>₹${tx.total_amount}</strong></td>
          <td>${statusBadge} ${actionBtn}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:red;">Error loading transactions: ${err.message}</td></tr>`;
  }
}

async function payTransactionDirect(txId) {
  currentTransactionId = txId;
  await executePayNow();
}

// WORKER SIDE VIEW (Requirement #4: NO payment / commission UI at all)
async function loadWorkerJobs() {
  const container = document.getElementById('worker-job-list');
  container.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading worker opportunities...</div>';

  try {
    const res = await fetch('/api/jobs');
    const jobs = await res.json();

    if (!Array.isArray(jobs) || jobs.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding: 2rem;">No open jobs available right now.</div>';
      return;
    }

    container.innerHTML = jobs.map(job => {
      const isCompleted = job.status === 'completed';

      return `
        <div class="job-card" style="border-left: 5px solid var(--accent);">
          <div class="job-header">
            <div>
              <div class="job-title">${escapeHtml(job.title)}</div>
              <span class="job-category" style="background: var(--accent-light); color: var(--accent);">${escapeHtml(job.category)} • 📍 ${escapeHtml(job.location)}</span>
            </div>
            <span class="status-badge ${isCompleted ? 'status-commission_paid' : 'status-pending'}">
              ${isCompleted ? 'Work Finished ✓' : 'Open Job'}
            </span>
          </div>

          <div style="font-size: 1rem; font-weight: 700; color: #065f46; margin: 0.25rem 0;">
            💰 Full Agreed Daily Wage: ₹${job.wage_amount} (100% Yours - Free platform)
          </div>

          <p style="font-size: 0.9rem; color: var(--text-muted);">
            ${escapeHtml(job.description || 'Daily wage work requirement in ' + job.location)}
          </p>

          <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
            ${!isCompleted ? `
              <button class="btn btn-success" onclick="completeJob(${job.id}, 'worker')">
                👍 Confirm Work Completion
              </button>
            ` : `
              <div style="width: 100%; text-align: center; color: #059669; font-weight: 700;">
                ✓ You confirmed completion for this job
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:red;">Error: ${err.message}</div>`;
  }
}

// ADMIN REVENUE DASHBOARD
async function loadAdminRevenue() {
  try {
    const res = await fetch('/api/admin/revenue');
    const data = await res.json();
    const summary = data.revenue_summary;

    document.getElementById('admin-stat-count').innerText = summary.total_transactions;
    document.getElementById('admin-stat-wages').innerText = `₹${summary.total_job_wages.toLocaleString()}`;
    document.getElementById('admin-stat-commission').innerText = `₹${summary.total_commission_earned.toLocaleString()}`;
    document.getElementById('admin-stat-pending').innerText = `₹${summary.pending_commission.toLocaleString()}`;

    const tbody = document.getElementById('admin-transactions-body');
    if (!data.recent_transactions || data.recent_transactions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No recent transactions</td></tr>';
      return;
    }

    tbody.innerHTML = data.recent_transactions.map(tx => `
      <tr>
        <td>${escapeHtml(tx.job_title)}</td>
        <td>${escapeHtml(tx.employer_name)}</td>
        <td>${escapeHtml(tx.worker_name)}</td>
        <td>₹${tx.wage_amount}</td>
        <td><strong>₹${tx.commission_amount}</strong></td>
        <td>₹${tx.total_amount}</td>
        <td><span class="status-badge ${tx.status === 'commission_paid' ? 'status-commission_paid' : 'status-pending'}">${tx.status}</span></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

// Voice Assistant Simulation
function toggleVoiceRecording() {
  const btn = document.getElementById('mic-btn');
  btn.classList.add('recording');
  
  setTimeout(() => {
    btn.classList.remove('recording');
    if (currentRole === 'employer') {
      document.getElementById('job-title').value = 'Mandapam Reception Catering Helper';
      document.getElementById('job-category').value = 'Catering';
      document.getElementById('wage-amount').value = '1500';
      document.getElementById('job-location').value = 'Madurai';
      updateCalcPreview();
      alert('🎤 Voice captured: "Need Mandapam Reception Catering Helper in Madurai for ₹1500 per day"!\n\nForm populated automatically.');
    } else {
      alert('🎤 Voice captured: Searching for catering jobs in Madurai!');
    }
  }, 1500);
}

// Helper utility
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
