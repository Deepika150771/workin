const http = require('http');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== STARTING STEP 1 BACKEND VERIFICATION TESTS ===\n');

  try {
    // Test 1: Config
    console.log('1. Testing GET /api/config...');
    const configRes = await request('GET', '/api/config');
    console.log('   Response:', configRes.body);
    if (configRes.body.default_commission_rate !== 0.08) throw new Error('Config default rate mismatch');

    // Test 2: Post Job
    console.log('\n2. Testing POST /api/jobs...');
    const newJobRes = await request('POST', '/api/jobs', {
      title: 'Mandapam Decor Helper',
      category: 'Mandapam Event',
      employer_id: 1,
      wage_amount: 2000,
      location: 'Madurai',
      job_date: '2026-09-30',
      description: 'Decoration assist'
    });
    console.log('   Posted Job Response:', newJobRes.body);
    const jobId = newJobRes.body.job.id;

    // Test 3: Complete Job (Two-way confirmation)
    console.log('\n3. Testing POST /api/jobs/:id/complete (Employer confirmation)...');
    const empCompleteRes = await request('POST', `/api/jobs/${jobId}/complete`, { confirmed_by: 'employer' });
    console.log('   Employer Confirm Result:', empCompleteRes.body.message);

    console.log('\n4. Testing POST /api/jobs/:id/complete (Worker confirmation & Calculation check)...');
    const wrkCompleteRes = await request('POST', `/api/jobs/${jobId}/complete`, { confirmed_by: 'worker' });
    console.log('   Worker Confirm Result:', wrkCompleteRes.body);
    
    // Check calculations: wage 2000 * 0.08 = 160 commission, total = 2160
    const tx = wrkCompleteRes.body.transaction_summary;
    if (tx.wage_amount !== 2000 || tx.commission_amount !== 160 || tx.total_amount !== 2160) {
      throw new Error(`Calculation error! Expected 2000 / 160 / 2160, got ${tx.wage_amount} / ${tx.commission_amount} / ${tx.total_amount}`);
    }
    console.log('   ✅ Commission calculation verified! Wage: ₹2000 | Commission (8%): ₹160 | Total: ₹2160');

    // Test 4: Employer Transactions
    console.log('\n5. Testing GET /api/employer/1/transactions...');
    const empTxRes = await request('GET', '/api/employer/1/transactions');
    console.log('   Employer 1 Transactions Summary:', empTxRes.body.summary);
    console.log(`   Found ${empTxRes.body.transactions.length} transactions for Employer 1.`);

    // Test 5: Admin Revenue
    console.log('\n6. Testing GET /api/admin/revenue...');
    const adminRes = await request('GET', '/api/admin/revenue');
    console.log('   Admin Revenue Summary:', adminRes.body.revenue_summary);

    // Test 6: Pay Transaction
    console.log('\n7. Testing POST /api/transactions/:id/pay...');
    const payRes = await request('POST', `/api/transactions/${tx.transaction_id}/pay`);
    console.log('   Pay Result:', payRes.body);
    if (payRes.body.transaction.status !== 'commission_paid') {
      throw new Error('Payment status update failed');
    }
    console.log('   ✅ Transaction status updated to commission_paid!');

    console.log('\n=== ALL STEP 1 BACKEND TESTS PASSED SUCCESSFULLY! ===');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ STEP 1 TEST FAILED:', err.message);
    process.exit(1);
  }
}

// Give server time to spin up if running test standalone
setTimeout(runTests, 1000);
