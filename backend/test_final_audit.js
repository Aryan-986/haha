/**
 * test_final_audit.js
 * Verification of requirements audit fixes:
 * 1. Ticket privacy: GET /:id does not leak trackingToken to unauthenticated callers
 * 2. Citizen snooze: Valid trackingToken allows snooze; invalid/missing token is rejected with 403
 * 3. Protected call-next: Unauthenticated call-next is rejected with 401
 * 4. Tenant isolation: Cross-tenant transfer rejected with Tenant Boundary Error (403)
 * 5. Counter targeting: Transfer to counter updates ticket.targetCounterId & counterNumber
 */

require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');

const Organization = require('./models/Organization');
const Department = require('./models/Department');
const Counter = require('./models/Counter');
const Worker = require('./models/Worker');
const Ticket = require('./models/Ticket');
const QueueEvent = require('./models/QueueEvent');
const queueService = require('./services/queueService');
const ticketRoutes = require('./routes/ticketRoutes');
const queueRoutes = require('./routes/queueRoutes');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/queueless';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runAuditTests() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  QUEUELESS — AUDIT & PRODUCTION HARDENING VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  await mongoose.connect(MONGO_URI);

  // Setup express test server
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tickets', ticketRoutes);
  app.use('/api/v1', queueRoutes);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  let orgA, orgB, deptA, deptB, counterA, counterB, workerA, testTicket;

  try {
    // 0. Setup
    console.log('─── 0. Test Fixtures Setup ───');
    orgA = await Organization.create({ name: 'Audit_Org_A_' + Date.now(), status: 'ACTIVE' });
    orgB = await Organization.create({ name: 'Audit_Org_B_' + Date.now(), status: 'ACTIVE' });

    deptA = await Department.create({ orgId: orgA._id, name: 'Billing', prefix: 'BIL', roomNumber: '101' });
    deptB = await Department.create({ orgId: orgA._id, name: 'Support', prefix: 'SUP', roomNumber: '102' });

    counterA = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptA._id,
      counterNumber: 1,
      name: 'Billing Desk',
      roomNumber: '101',
      status: 'AVAILABLE',
      isActive: true
    });

    counterB = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptB._id,
      counterNumber: 2,
      name: 'Support Desk 2',
      roomNumber: '102',
      status: 'AVAILABLE',
      isActive: true
    });

    workerA = await Worker.create({
      organizationId: orgA._id,
      departmentId: deptA._id,
      counterId: counterA._id,
      name: 'Agent Audit',
      role: 'WORKER',
      status: 'AVAILABLE'
    });

    const issueRes = await queueService.issueTicket({
      organizationId: orgA._id,
      departmentId: deptA._id,
      priority: 'NORMAL'
    });
    testTicket = issueRes.ticket;

    assert(testTicket && testTicket.trackingToken, 'Base test ticket created with high-entropy trackingToken');

    // ─── 1. TICKET PRIVACY: GET /:id DOES NOT LEAK TRACKING TOKEN ───
    console.log('\n─── 1. Ticket Privacy & Anonymous Lookup ───');
    const fetchRes = await fetch(`${baseUrl}/api/v1/tickets/${testTicket._id}`);
    const fetchData = await fetchRes.json();

    assert(fetchRes.status === 200, 'GET /api/v1/tickets/:id returns 200');
    assert(fetchData.ticket.ticketNumber === testTicket.ticketNumber, 'Ticket number returned accurately');
    assert(fetchData.ticket.trackingToken === undefined, 'Public GET /api/v1/tickets/:id does NOT leak trackingToken');
    assert(fetchData.ticket.idempotencyKey === undefined, 'Public GET /api/v1/tickets/:id does NOT leak idempotencyKey');
    assert(fetchData.ticket.currentWorkerId === undefined, 'Public GET /api/v1/tickets/:id does NOT leak currentWorkerId');

    // Lookup by ticketNumber string
    const fetchNumRes = await fetch(`${baseUrl}/api/v1/tickets/${testTicket.ticketNumber}`);
    const fetchNumData = await fetchNumRes.json();
    assert(fetchNumRes.status === 200, 'Lookup by ticketNumber string succeeds');
    assert(fetchNumData.ticket.trackingToken === undefined, 'Lookup by ticketNumber does NOT leak trackingToken');

    // Secure tracking endpoint DOES return tracking info
    const trackRes = await fetch(`${baseUrl}/api/v1/tickets/track/${testTicket.trackingToken}`);
    const trackData = await trackRes.json();
    assert(trackRes.status === 200, 'GET /track/:trackingToken authorized with token');
    assert(trackData.ticket.ticketNumber === testTicket.ticketNumber, 'Tracking endpoint returns correct ticket');

    // ─── 2. CITIZEN SNOOZE / DELAY AUTHORIZATION ───
    console.log('\n─── 2. Citizen Snooze / Delay Authorization ───');
    // Snooze without token should be rejected (403)
    const rejectSnoozeRes = await fetch(`${baseUrl}/api/v1/tickets/${testTicket._id}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 5, source: 'CITIZEN' })
    });
    assert(rejectSnoozeRes.status === 403, 'Citizen snooze without trackingToken rejected with HTTP 403');

    // Snooze with wrong token should be rejected (403)
    const wrongTokenRes = await fetch(`${baseUrl}/api/v1/tickets/${testTicket._id}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 5, source: 'CITIZEN', trackingToken: 'invalid_token_123456789' })
    });
    assert(wrongTokenRes.status === 403, 'Citizen snooze with invalid trackingToken rejected with HTTP 403');

    // Snooze with legitimate trackingToken should succeed
    const validSnoozeRes = await fetch(`${baseUrl}/api/v1/tickets/${testTicket._id}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 5, source: 'CITIZEN', trackingToken: testTicket.trackingToken })
    });
    const validSnoozeData = await validSnoozeRes.json();
    assert(validSnoozeRes.status === 200, 'Citizen snooze with valid trackingToken succeeds with HTTP 200');
    assert(validSnoozeData.ticket.status === 'SNOOZED', 'Ticket status transitioned to SNOOZED');
    assert(validSnoozeData.ticket.snoozeInfo.source === 'CITIZEN', 'Snooze source recorded as CITIZEN');

    // ─── 3. PROTECTED CALL-NEXT ENDPOINTS ───
    console.log('\n─── 3. Call-Next Authentication Safeguard ───');
    const callNextRes = await fetch(`${baseUrl}/api/v1/call-next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ departmentId: deptA._id.toString() })
    });
    assert(callNextRes.status === 401, 'Unauthenticated POST /api/v1/call-next rejected with HTTP 401 Unauthorized');

    // ─── 4. COUNTER TARGETING & SYNC ON TRANSFER ───
    console.log('\n─── 4. Counter Targeting and Sync ───');
    // Resume ticket first back to WAITING
    await queueService.resumeTicket({ ticketId: testTicket._id });
    // Worker calls ticket so status becomes CALLED
    await queueService.callNextTicket({
      departmentId: deptA._id,
      organizationId: orgA._id,
      counterId: counterA._id,
      workerId: workerA._id
    });

    const transferRes = await queueService.transferTicket({
      ticketId: testTicket._id,
      targetDepartmentId: deptB._id,
      targetCounterId: counterB._id,
      workerId: workerA._id,
      counterId: counterA._id,
      reason: 'Audit transfer test'
    });

    assert(transferRes.ticket.status === 'TRANSFERRED', 'Ticket status updated to TRANSFERRED');
    assert(transferRes.ticket.targetCounterId.toString() === counterB._id.toString(), 'targetCounterId set to destination counter');
    assert(transferRes.ticket.counterNumber === counterB.counterNumber, 'Ticket counterNumber synced to target counter');
    assert(transferRes.ticket.roomNumber === counterB.roomNumber, 'Ticket roomNumber synced to target counter room');

    // ─── 5. TENANT ISOLATION BOUNDARY ───
    console.log('\n─── 5. Tenant Isolation Boundary ───');
    let crossTenantBlocked = false;
    try {
      const foreignDept = await Department.create({ orgId: orgB._id, name: 'Foreign Dept', prefix: 'FOR' });
      await queueService.transferTicket({
        ticketId: testTicket._id,
        targetDepartmentId: foreignDept._id,
        workerId: workerA._id
      });
    } catch (err) {
      if (err.status === 403 && err.message.includes('Tenant Boundary Error')) {
        crossTenantBlocked = true;
      }
    }
    assert(crossTenantBlocked, 'Cross-tenant transfer strictly blocked with HTTP 403 Tenant Boundary Error');

  } catch (err) {
    console.error('Audit test error:', err);
    failed++;
  } finally {
    // Cleanup
    try {
      if (orgA) {
        await Ticket.deleteMany({ organizationId: orgA._id });
        await QueueEvent.deleteMany({ organizationId: orgA._id });
        await Counter.deleteMany({ organizationId: orgA._id });
        await Department.deleteMany({ orgId: orgA._id });
        await Worker.deleteMany({ organizationId: orgA._id });
        await Organization.deleteOne({ _id: orgA._id });
      }
      if (orgB) {
        await Department.deleteMany({ orgId: orgB._id });
        await Organization.deleteOne({ _id: orgB._id });
      }
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }

    server.close();
    await mongoose.disconnect();

    const total = passed + failed;
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  AUDIT TEST RESULTS: ${passed}/${total} passed | ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════════\n');

    if (failed > 0) process.exit(1);
    else process.exit(0);
  }
}

runAuditTests();
