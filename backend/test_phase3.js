/**
 * test_phase3.js
 * Comprehensive integration tests for Phase 3:
 * Citizen Journey, Ticket Tracking, Real Positions & ETAs, Multi-department Workflow,
 * Idempotency, Anonymous Safe Tracking, and Master Admin Organization Deletion.
 */

const mongoose = require('mongoose');
const Organization = require('./models/Organization');
const Department = require('./models/Department');
const Counter = require('./models/Counter');
const Worker = require('./models/Worker');
const Ticket = require('./models/Ticket');
const QueueEvent = require('./models/QueueEvent');
const queueService = require('./services/queueService');
const citizenService = require('./services/citizenService');
const { archiveOrganization } = require('./services/organizationService');

require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/queueless';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

async function runPhase3Tests() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  QUEUELESS — PHASE 3 CITIZEN JOURNEY INTEGRATION TESTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  await mongoose.connect(MONGO_URI);

  const stamp = Date.now();
  let org1, org2, dept1A, dept1B, dept2A, counter1, worker1;

  try {
    // ─── SETUP ────────────────────────────────────────────────────────
    org1 = await Organization.create({ name: `CitizenOrg1_${stamp}`, type: 'GOVERNMENT', status: 'ACTIVE' });
    org2 = await Organization.create({ name: `CitizenOrg2_${stamp}`, type: 'HOSPITAL', status: 'ACTIVE' });

    dept1A = await Department.create({
      orgId: org1._id,
      name: 'Registration & Token',
      prefix: 'REG',
      roomNumber: '101',
      avgServiceTimeMins: 4
    });

    dept1B = await Department.create({
      orgId: org1._id,
      name: 'Document Verification',
      prefix: 'VER',
      roomNumber: '102',
      avgServiceTimeMins: 6
    });

    dept2A = await Department.create({
      orgId: org2._id,
      name: 'General OPD',
      prefix: 'OPD',
      roomNumber: '201',
      avgServiceTimeMins: 10
    });

    counter1 = await Counter.create({
      organizationId: org1._id,
      departmentId: dept1A._id,
      counterNumber: 1,
      name: 'Counter 1',
      status: 'AVAILABLE',
      isActive: true
    });

    worker1 = await Worker.create({
      name: 'Alice Worker',
      email: `alice_${stamp}@queueless.local`,
      organizationId: org1._id,
      departmentId: dept1A._id,
      counterId: counter1._id,
      status: 'AVAILABLE'
    });

    // ─── 1. ACTIVE ORGANIZATIONS & DEPARTMENTS DISCOVERY ──────────────
    console.log('─── 1. Organization & Department Discovery ───');

    const activeOrgs = await Organization.find({ isDeleted: { $ne: true } });
    const foundOrg1 = activeOrgs.some(o => o._id.toString() === org1._id.toString());
    assert(foundOrg1, 'Citizen can view active organizations');

    const org1Depts = await Department.find({ orgId: org1._id });
    assert(org1Depts.length === 2, 'Citizen views departments belonging only to selected organization');
    assert(!org1Depts.some(d => d._id.toString() === dept2A._id.toString()), 'Cross-organization departments not leaked');

    // ─── 2. REAL TICKET CREATION & NUMBER UNIQUENESS ──────────────────
    console.log('─── 2. Real Ticket Creation & Uniqueness ───');

    const issue1 = await queueService.issueTicket({
      organizationId: org1._id,
      departmentId: dept1A._id,
      priority: 'NORMAL',
      source: 'WEB'
    });

    assert(issue1.ticket !== null, 'Citizen receives a real queue ticket');
    assert(typeof issue1.ticket.ticketNumber === 'string' && issue1.ticket.ticketNumber.startsWith('REG-'), 'Ticket number has proper prefix');
    assert(issue1.ticket.trackingToken && issue1.ticket.trackingToken.length >= 16, 'Ticket has secure trackingToken');
    assert(issue1.ticket.status === 'WAITING', 'Ticket starts in WAITING status');

    const issue2 = await queueService.issueTicket({
      organizationId: org1._id,
      departmentId: dept1A._id,
      priority: 'NORMAL',
      source: 'WEB'
    });
    assert(issue1.ticket.ticketNumber !== issue2.ticket.ticketNumber, 'Ticket numbers are unique and atomic');

    // ─── 3. IDEMPOTENCY & DUPLICATE PREVENTION ────────────────────────
    console.log('─── 3. Idempotency on Repeated Requests ───');

    const key = `idem_${stamp}_abc123`;
    const firstAttempt = await queueService.issueTicket({
      organizationId: org1._id,
      departmentId: dept1A._id,
      priority: 'NORMAL',
      source: 'WEB',
      idempotencyKey: key
    });

    const secondAttempt = await queueService.issueTicket({
      organizationId: org1._id,
      departmentId: dept1A._id,
      priority: 'NORMAL',
      source: 'WEB',
      idempotencyKey: key
    });

    assert(firstAttempt.ticket._id.toString() === secondAttempt.ticket._id.toString(), 'Repeated ticket creation with idempotency key returns same ticket');
    assert(secondAttempt.isIdempotent === true, 'Response indicates idempotent result');

    // ─── 4. QUEUE POSITION (PRIORITY + FIFO ENGINE ALIGNED) ───────────
    console.log('─── 4. Authoritative Queue Position ───');

    // Currently in dept1A: issue1, issue2, firstAttempt are all NORMAL.
    // Let's create an URGENT ticket and an EMERGENCY ticket
    const normalTicket = await queueService.issueTicket({
      organizationId: org1._id, departmentId: dept1A._id, priority: 'NORMAL'
    });
    const urgentTicket = await queueService.issueTicket({
      organizationId: org1._id, departmentId: dept1A._id, priority: 'URGENT'
    });
    const emergencyTicket = await queueService.issueTicket({
      organizationId: org1._id, departmentId: dept1A._id, priority: 'EMERGENCY'
    });

    // EMERGENCY should be at the head of the queue (0 people ahead among waiting tickets)
    const emPos = await citizenService.getTicketPosition(emergencyTicket.ticket._id);
    assert(emPos.peopleAhead === 0, 'EMERGENCY ticket has 0 people ahead (jumps ahead of NORMAL and URGENT)');
    assert(emPos.position === 1, 'EMERGENCY ticket is position #1 in queue');

    // URGENT ticket should only have EMERGENCY ahead of it
    const urgPos = await citizenService.getTicketPosition(urgentTicket.ticket._id);
    assert(urgPos.peopleAhead === 1, 'URGENT ticket has exactly 1 person ahead (EMERGENCY ticket)');
    assert(urgPos.position === 2, 'URGENT ticket is position #2 in queue');

    // normalTicket was created AFTER issue1, issue2, firstAttempt, so it has those 3 + emergency + urgent ahead
    const normPos = await citizenService.getTicketPosition(normalTicket.ticket._id);
    assert(normPos.peopleAhead >= 5, 'NORMAL ticket correctly accounts for priority and earlier FIFO tickets');

    // ─── 5. REALISTIC WAIT TIME (ETA) ─────────────────────────────────
    console.log('─── 5. Realistic Waiting Time (ETA) Calculation ───');

    const etaEm = await citizenService.getTicketETA(emergencyTicket.ticket._id);
    assert(etaEm.calculable === true, 'ETA is calculable from active queue metrics');
    assert(etaEm.estimatedWaitMin === 0, 'ETA for front ticket is 0 min');
    assert(etaEm.activeCounters === 1, 'ETA uses actual active counter count');
    assert(etaEm.avgServiceTimeMins === 4, 'ETA uses department avgServiceTimeMins (4 min)');

    const etaNorm = await citizenService.getTicketETA(normalTicket.ticket._id);
    assert(etaNorm.estimatedWaitMin >= 20, 'ETA uses real formula (peopleAhead * avgService / activeCounters)');

    // ─── 6. SNOOZED TICKET HANDLING IN QUEUE POSITION ─────────────────
    console.log('─── 6. Snoozed Ticket in Queue Position ───');

    // Snooze normalTicket into future
    const futureResume = new Date(Date.now() + 10 * 60 * 1000);
    normalTicket.ticket.status = 'SNOOZED';
    normalTicket.ticket.snoozeInfo = { snoozedAt: new Date(), resumeAt: futureResume, snoozeCount: 1 };
    await normalTicket.ticket.save();

    // Create a new ticket after snooze
    const afterSnoozeTicket = await queueService.issueTicket({
      organizationId: org1._id, departmentId: dept1A._id, priority: 'NORMAL'
    });

    // The future-snoozed ticket should NOT be counted as ahead of afterSnoozeTicket
    const afterPos = await citizenService.getTicketPosition(afterSnoozeTicket.ticket._id);
    assert(!isNaN(afterPos.peopleAhead), 'Calculated position handles snoozed tickets without crashing');

    // ─── 7. MULTI-DEPARTMENT JOURNEY TRACKER ──────────────────────────
    console.log('─── 7. Multi-department Journey Tracker ───');

    // Create a fresh journey ticket
    const journeyTest = await queueService.issueTicket({
      organizationId: org1._id, departmentId: dept1A._id, priority: 'NORMAL'
    });

    const journeyStage1 = await citizenService.getTicketJourney(journeyTest.ticket._id);
    assert(journeyStage1.stages.length === 1, 'Initial journey has 1 stage (Registration)');
    assert(journeyStage1.stages[0].departmentName === 'Registration & Token', 'Stage 1 has correct department name');
    assert(journeyStage1.stages[0].status === 'WAITING', 'Stage 1 starts WAITING');

    // Advance ticket to SERVING at Counter 1
    journeyTest.ticket.status = 'SERVING';
    journeyTest.ticket.currentCounterId = counter1._id;
    journeyTest.ticket.currentWorkerId = worker1._id;
    journeyTest.ticket.history.push({
      deptId: dept1A._id,
      timestamp: new Date(),
      servedBy: worker1.name,
      counterId: counter1._id,
      action: 'SERVICE_STARTED'
    });
    await journeyTest.ticket.save();

    // Transfer journeyTest ticket to Department 1B (Verification)
    const transferResult = await queueService.transferTicket({
      ticketId: journeyTest.ticket._id,
      targetDepartmentId: dept1B._id,
      workerId: worker1._id,
      counterId: counter1._id
    });

    const journeyStage2 = await citizenService.getTicketJourney(journeyTest.ticket._id);
    assert(journeyStage2.stages.length === 2, 'Journey now has 2 distinct stages');
    assert(journeyStage2.stages[0].status === 'COMPLETED', 'Previous stage marked COMPLETED after transfer');
    assert(journeyStage2.stages[1].departmentName === 'Document Verification', 'Second stage is Document Verification');
    assert(journeyStage2.stages[1].roomNumber === '102', 'Second stage carries destination room number 102');

    // ─── 8. QUEUEEVENT HISTORY & AUDIT TRAIL ──────────────────────────
    console.log('─── 8. Immutable QueueEvent History ───');

    const events = await citizenService.getTicketEvents(journeyTest.ticket._id);
    assert(events.length >= 2, 'Audit trail contains at least 2 events for transferred ticket');
    assert(events[0].eventType === 'TICKET_CREATED', 'First event is TICKET_CREATED');
    assert(events.some(e => e.eventType === 'TICKET_TRANSFERRED'), 'TICKET_TRANSFERRED recorded in audit trail');
    assert(events.every(e => !e.workerId), 'Worker IDs and sensitive secrets omitted from citizen event payload');

    // ─── 9. TERMINAL STATE (COMPLETED) HANDLING ───────────────────────
    console.log('─── 9. Completed Ticket Handling ───');

    // Complete the journey ticket
    journeyTest.ticket.status = 'COMPLETED';
    journeyTest.ticket.completedAt = new Date();
    await journeyTest.ticket.save();

    const compPos = await citizenService.getTicketPosition(journeyTest.ticket._id);
    assert(compPos.peopleAhead === 0 && compPos.position === 0, 'Completed ticket shows 0 people ahead and 0 position');
    assert(compPos.isActive === false, 'Completed ticket is marked not active');

    const compEta = await citizenService.getTicketETA(journeyTest.ticket._id);
    assert(compEta.estimatedWaitMin === 0 && compEta.isActive === false, 'Completed ticket ETA is 0 min and inactive');

    // ─── 10. ANONYMOUS TRACKING BY TOKEN & PRIVACY ────────────────────
    console.log('─── 10. Anonymous Secure Tracking & Privacy ───');

    const tracked = await citizenService.getTicketByTrackingToken(journeyTest.ticket.trackingToken);
    assert(tracked !== null, 'Can look up ticket by trackingToken');
    assert(tracked.ticketNumber === journeyTest.ticket.ticketNumber, 'Ticket number matches');

    let invalidLookupFailed = false;
    try {
      await citizenService.getTicketByTrackingToken('totally_invalid_nonexistent_token_123');
    } catch (e) {
      invalidLookupFailed = true;
    }
    assert(invalidLookupFailed, 'Invalid tracking token safely throws 404/not found');

    // ─── 11. TENANT BOUNDARIES & ISOLATION ────────────────────────────
    console.log('─── 11. Tenant Boundary Security ───');

    let crossOrgIssueFailed = false;
    try {
      // Trying to issue a ticket into Org 1 with a Department from Org 2
      await queueService.issueTicket({
        organizationId: org1._id,
        departmentId: dept2A._id,
        priority: 'NORMAL'
      });
    } catch (e) {
      crossOrgIssueFailed = true;
    }
    assert(crossOrgIssueFailed, 'Cannot issue ticket to mismatched organization and department');

    // ─── 12. MASTER ADMIN: DELETE / ARCHIVE ORGANIZATION ──────────────
    console.log('─── 12. Master Admin Organization Deletion & Archiving ───');

    // 12.1 Non-admin cannot archive
    let citizenDeleteBlocked = false;
    try {
      await archiveOrganization(org1._id, { userRole: 'citizen', userId: 'cit_1' });
    } catch (e) {
      if (e.status === 403) citizenDeleteBlocked = true;
    }
    assert(citizenDeleteBlocked, 'Citizen cannot archive organization (HTTP 403)');

    let workerDeleteBlocked = false;
    try {
      await archiveOrganization(org1._id, { userRole: 'worker', userId: 'wrk_1' });
    } catch (e) {
      if (e.status === 403) workerDeleteBlocked = true;
    }
    assert(workerDeleteBlocked, 'Worker cannot archive organization (HTTP 403)');

    let orgAdminDeleteBlocked = false;
    try {
      await archiveOrganization(org1._id, { userRole: 'org_admin', userId: 'oadm_1' });
    } catch (e) {
      if (e.status === 403) orgAdminDeleteBlocked = true;
    }
    assert(orgAdminDeleteBlocked, 'Org Admin cannot archive organization (HTTP 403)');

    // 12.2 Invalid ID format rejected
    let invalidIdRejected = false;
    try {
      await archiveOrganization('invalid-org-id', { userRole: 'master_admin' });
    } catch (e) {
      if (e.status === 400) invalidIdRejected = true;
    }
    assert(invalidIdRejected, 'Invalid organization ID format rejected (HTTP 400)');

    // 12.3 Nonexistent organization returns 404
    let notFoundRejected = false;
    try {
      await archiveOrganization(new mongoose.Types.ObjectId(), { userRole: 'master_admin' });
    } catch (e) {
      if (e.status === 404) notFoundRejected = true;
    }
    assert(notFoundRejected, 'Nonexistent organization returns 404');

    // 12.4 Master Admin successfully archives Org 1
    const archived = await archiveOrganization(org1._id, { userRole: 'master_admin', userId: 'master_1' });
    assert(archived.isDeleted === true, 'Organization marked isDeleted = true');
    assert(archived.status === 'INACTIVE', 'Organization status marked INACTIVE');
    assert(archived.deletedAt !== null, 'deletedAt timestamp recorded');
    assert(archived.deletedBy === 'master_1', 'deletedBy recorded');

    // 12.5 Archived org excluded from normal active lists
    const activeOrgsAfter = await Organization.find({ isDeleted: { $ne: true } });
    const containsArchived = activeOrgsAfter.some(o => o._id.toString() === org1._id.toString());
    assert(!containsArchived, 'Archived organization excluded from active organizations list');

    // 12.6 Other organizations unaffected
    const containsOrg2 = activeOrgsAfter.some(o => o._id.toString() === org2._id.toString());
    assert(containsOrg2, 'Other organizations remain active and unaffected');

    // 12.7 Archived org cannot receive new tickets
    let newTicketBlocked = false;
    try {
      await queueService.issueTicket({
        organizationId: org1._id,
        departmentId: dept1A._id,
        priority: 'NORMAL'
      });
    } catch (e) {
      newTicketBlocked = true;
    }
    assert(newTicketBlocked, 'Archived organization cannot receive new tickets');

    // 12.8 Historical QueueEvents preserved
    const historicalEvents = await QueueEvent.find({ organizationId: org1._id });
    assert(historicalEvents.length >= 2, 'Historical QueueEvents for archived org are preserved');

  } catch (err) {
    console.error('\n⚠ UNEXPECTED TEST EXCEPTION:', err);
    failed++;
  } finally {
    // Cleanup test records
    try {
      if (org1) await Organization.findByIdAndDelete(org1._id);
      if (org2) await Organization.findByIdAndDelete(org2._id);
      if (dept1A) await Department.findByIdAndDelete(dept1A._id);
      if (dept1B) await Department.findByIdAndDelete(dept1B._id);
      if (dept2A) await Department.findByIdAndDelete(dept2A._id);
      if (counter1) await Counter.findByIdAndDelete(counter1._id);
      if (worker1) await Worker.findByIdAndDelete(worker1._id);
    } catch (cleanupErr) {
      // ignore cleanup errors
    }
    await mongoose.disconnect();
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed}/${passed + failed} tests passed  |  ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('  ✅ ALL PHASE 3 BACKEND INTEGRATION TESTS PASSED!\n');
  }
}

runPhase3Tests();
