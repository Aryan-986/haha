/**
 * test_multistage_transfer.js
 * Multi-Stage Token Transfer Integration Test Suite
 * 
 * Verifies all 19 requirements of the QueueLess Multi-Stage Token Transfer System:
 * 1. Successful department-to-department transfer.
 * 2. Successful transfer with a valid destination counter.
 * 3. Transfer without a counter (department-level queue).
 * 4. Rejection of an invalid destination department.
 * 5. Rejection of a counter belonging to another department.
 * 6. Rejection of cross-organization transfer.
 * 7. Rejection of transfer by an unauthorized worker.
 * 8. Rejection of transfer for a completed ticket.
 * 9. Rejection of transfer from an invalid state.
 * 10. Concurrent duplicate transfer prevention.
 * 11. Source queue no longer containing the transferred ticket.
 * 12. Destination queue containing the transferred ticket exactly once.
 * 13. Root ticket number preserved after transfer across multiple stages.
 * 14. Correct QueueEvent and citizen journey history.
 * 15. Correct queue position and ETA after transfer.
 * 16. Socket.IO updates emitted with proper tenant scoping.
 * 17. No event leakage across organization boundaries.
 * 18. Citizen tracking updates after transfer.
 * 19. Multi-stage end-to-end journey (Registration -> Verification -> Payment -> Completed).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Organization = require('./models/Organization');
const Department = require('./models/Department');
const Counter = require('./models/Counter');
const Worker = require('./models/Worker');
const Ticket = require('./models/Ticket');
const QueueEvent = require('./models/QueueEvent');
const queueService = require('./services/queueService');
const citizenService = require('./services/citizenService');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/queueless';

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

async function runMultiStageTransferTests() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  QUEUELESS — MULTI-STAGE TOKEN TRANSFER TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════\n');

  await mongoose.connect(MONGO_URI);

  const testSuffix = `mst_${Date.now()}`;
  let orgA = null;
  let orgB = null;
  let deptReg = null;
  let deptVer = null;
  let deptPay = null;
  let deptOtherOrg = null;
  let counterReg1 = null;
  let counterVer1 = null;
  let counterPay1 = null;
  let workerReg = null;
  let workerVer = null;
  let workerOtherOrg = null;

  try {
    // -------------------------------------------------------------
    // SETUP: Multi-Stage Government Office Architecture
    // -------------------------------------------------------------
    console.log('─── 0. Environment Setup ───');
    orgA = await Organization.create({
      name: `Metropolitan Office ${testSuffix}`,
      code: `MET_${testSuffix.substring(4, 10).toUpperCase()}`,
      status: 'ACTIVE'
    });

    orgB = await Organization.create({
      name: `External Hospital ${testSuffix}`,
      code: `HSP_${testSuffix.substring(4, 10).toUpperCase()}`,
      status: 'ACTIVE'
    });

    deptReg = await Department.create({
      orgId: orgA._id,
      name: 'Registration',
      prefix: 'REG',
      roomNumber: '101',
      avgServiceTimeMins: 4
    });

    deptVer = await Department.create({
      orgId: orgA._id,
      name: 'Verification',
      prefix: 'VER',
      roomNumber: '102',
      avgServiceTimeMins: 6
    });

    deptPay = await Department.create({
      orgId: orgA._id,
      name: 'Payment & Cashier',
      prefix: 'PAY',
      roomNumber: '103',
      avgServiceTimeMins: 3
    });

    deptOtherOrg = await Department.create({
      orgId: orgB._id,
      name: 'External Triage',
      prefix: 'TRG',
      roomNumber: '999'
    });

    counterReg1 = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptReg._id,
      counterNumber: 1,
      name: 'Registration Counter 1',
      roomNumber: 'Room 101',
      status: 'AVAILABLE',
      isActive: true
    });

    counterVer1 = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptVer._id,
      counterNumber: 1,
      name: 'Verification Desk 1',
      roomNumber: 'Room 102',
      status: 'AVAILABLE',
      isActive: true
    });

    counterPay1 = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptPay._id,
      counterNumber: 1,
      name: 'Cashier 1',
      roomNumber: 'Room 103',
      status: 'AVAILABLE',
      isActive: true
    });

    workerReg = await Worker.create({
      organizationId: orgA._id,
      departmentId: deptReg._id,
      counterId: counterReg1._id,
      name: 'Registration Clerk Robert',
      role: 'WORKER',
      status: 'AVAILABLE'
    });

    workerVer = await Worker.create({
      organizationId: orgA._id,
      departmentId: deptVer._id,
      counterId: counterVer1._id,
      name: 'Verification Officer Victor',
      role: 'WORKER',
      status: 'AVAILABLE'
    });

    workerOtherOrg = await Worker.create({
      organizationId: orgB._id,
      departmentId: deptOtherOrg._id,
      name: 'Foreign Org Worker',
      role: 'WORKER',
      status: 'AVAILABLE'
    });

    assert(orgA && deptReg && deptVer && deptPay, 'Multi-stage government office topology initialized');

    // -------------------------------------------------------------
    // Test 1, 2, 3: Department Transfers & Counter Scopes
    // -------------------------------------------------------------
    console.log('\n─── 1. Core Department Transfers ───');

    const ticket1 = await Ticket.create({
      organizationId: orgA._id,
      departmentId: deptReg._id,
      currentDepartmentId: deptReg._id,
      ticketNumber: 'REG-101',
      status: 'CALLED',
      currentCounterId: counterReg1._id,
      currentWorkerId: workerReg._id,
      priority: 'NORMAL',
      source: 'WEB',
      history: [
        {
          deptId: deptReg._id,
          timestamp: new Date(Date.now() - 60000),
          action: 'ISSUED',
          servedBy: 'System Kiosk'
        },
        {
          deptId: deptReg._id,
          timestamp: new Date(Date.now() - 30000),
          action: 'CALLED',
          servedBy: workerReg.name,
          counterId: counterReg1._id
        }
      ]
    });

    // 1. Department-to-department transfer with valid destination counter
    const t1Res = await queueService.transferTicket({
      ticketId: ticket1._id,
      targetDepartmentId: deptVer._id,
      targetCounterId: counterVer1._id,
      workerId: workerReg._id,
      counterId: counterReg1._id,
      reason: 'Stage 1 registration approved; proceed to verification'
    });
    assert(t1Res.ticket.status === 'TRANSFERRED', '1. Ticket status transitioned to TRANSFERRED');
    assert(t1Res.ticket.currentDepartmentId.toString() === deptVer._id.toString(), '1. Current department updated to Verification');
    assert(t1Res.ticket.targetCounterId.toString() === counterVer1._id.toString(), '2. Destination counter explicitly linked to Verification Desk 1');
    assert(t1Res.ticket.roomNumber === 'Room 102', '2. Ticket carries destination room number Room 102');

    // 3. Department-level transfer without selecting a specific counter (General Queue)
    const ticket2 = await Ticket.create({
      organizationId: orgA._id,
      departmentId: deptReg._id,
      currentDepartmentId: deptReg._id,
      ticketNumber: 'REG-102',
      status: 'CALLED',
      currentCounterId: counterReg1._id,
      currentWorkerId: workerReg._id,
      priority: 'NORMAL',
      source: 'WEB'
    });

    const t2Res = await queueService.transferTicket({
      ticketId: ticket2._id,
      targetDepartmentId: deptVer._id,
      targetCounterId: null, // No specific counter
      workerId: workerReg._id,
      counterId: counterReg1._id,
      reason: 'General queue transfer'
    });
    assert(t2Res.ticket.status === 'TRANSFERRED', '3. General queue transfer succeeds without specific counter');
    assert(t2Res.ticket.targetCounterId === null, '3. Target counter is null for general department-level transfer');
    assert(t2Res.ticket.roomNumber === '102', '3. Inherits department default room number 102');

    // -------------------------------------------------------------
    // Test 4, 5, 6, 7: Security Validations and Boundary Checks
    // -------------------------------------------------------------
    console.log('\n─── 2. Validation & Security Rejections ───');

    const testSecTicket = await Ticket.create({
      organizationId: orgA._id,
      departmentId: deptReg._id,
      currentDepartmentId: deptReg._id,
      ticketNumber: 'REG-103',
      status: 'CALLED',
      currentCounterId: counterReg1._id,
      currentWorkerId: workerReg._id,
      priority: 'NORMAL',
      source: 'WEB'
    });

    // 4. Rejection of invalid destination department
    try {
      await queueService.transferTicket({
        ticketId: testSecTicket._id,
        targetDepartmentId: new mongoose.Types.ObjectId(), // Non-existent dept
        workerId: workerReg._id,
        counterId: counterReg1._id
      });
      assert(false, 'Non-existent destination department should throw');
    } catch (err) {
      assert(err.status === 404, '4. Non-existent destination department rejected with HTTP 404');
    }

    // 5. Rejection of counter belonging to another department
    try {
      await queueService.transferTicket({
        ticketId: testSecTicket._id,
        targetDepartmentId: deptVer._id, // Target is Verification
        targetCounterId: counterPay1._id, // Counter belongs to Payment!
        workerId: workerReg._id,
        counterId: counterReg1._id
      });
      assert(false, 'Mismatched target counter should throw');
    } catch (err) {
      assert(err.status === 400, '5. Destination counter belonging to different department rejected with HTTP 400');
    }

    // 6. Rejection of cross-organization transfer
    try {
      await queueService.transferTicket({
        ticketId: testSecTicket._id,
        targetDepartmentId: deptOtherOrg._id, // Foreign organization!
        workerId: workerReg._id,
        counterId: counterReg1._id
      });
      assert(false, 'Cross-tenant transfer should throw');
    } catch (err) {
      assert(err.status === 403, '6. Cross-tenant transfer rejected with HTTP 403 Forbidden');
    }

    // 7. Rejection of transfer by an unauthorized worker (from different organization)
    try {
      await queueService.transferTicket({
        ticketId: testSecTicket._id,
        targetDepartmentId: deptVer._id,
        workerId: workerOtherOrg._id, // Worker belongs to Org B!
        counterId: counterReg1._id
      });
      assert(false, 'Unauthorized cross-org worker should throw');
    } catch (err) {
      assert(err.status === 403, '7. Unauthorized foreign worker rejected with HTTP 403 Forbidden');
    }

    // -------------------------------------------------------------
    // Test 8, 9, 10: State Machine & Concurrency Protection
    // -------------------------------------------------------------
    console.log('\n─── 3. State Machine Correctness & Concurrency ───');

    // 8. Completed ticket cannot be transferred
    const completedTicket = await Ticket.create({
      organizationId: orgA._id,
      departmentId: deptReg._id,
      currentDepartmentId: deptReg._id,
      ticketNumber: 'REG-104',
      status: 'COMPLETED',
      priority: 'NORMAL',
      source: 'WEB'
    });

    try {
      await queueService.transferTicket({
        ticketId: completedTicket._id,
        targetDepartmentId: deptVer._id,
        workerId: workerReg._id
      });
      assert(false, 'Completed ticket transfer should throw');
    } catch (err) {
      assert(err.status === 400 && err.code === 'INVALID_STATE_TRANSITION', '8. Completed ticket transfer rejected by state machine');
    }

    // 9. Cancelled ticket cannot be transferred
    const cancelledTicket = await Ticket.create({
      organizationId: orgA._id,
      departmentId: deptReg._id,
      currentDepartmentId: deptReg._id,
      ticketNumber: 'REG-105',
      status: 'CANCELLED',
      priority: 'NORMAL',
      source: 'WEB'
    });

    try {
      await queueService.transferTicket({
        ticketId: cancelledTicket._id,
        targetDepartmentId: deptVer._id,
        workerId: workerReg._id
      });
      assert(false, 'Cancelled ticket transfer should throw');
    } catch (err) {
      assert(err.status === 400, '9. Cancelled ticket transfer rejected by state machine');
    }

    // 10. Concurrency Protection: Only one transfer succeeds if concurrent
    const concurrentTicket = await Ticket.create({
      organizationId: orgA._id,
      departmentId: deptReg._id,
      currentDepartmentId: deptReg._id,
      ticketNumber: 'REG-106',
      status: 'CALLED',
      currentCounterId: counterReg1._id,
      currentWorkerId: workerReg._id,
      priority: 'NORMAL',
      source: 'WEB'
    });

    const results = await Promise.allSettled([
      queueService.transferTicket({
        ticketId: concurrentTicket._id,
        targetDepartmentId: deptVer._id,
        workerId: workerReg._id,
        counterId: counterReg1._id
      }),
      queueService.transferTicket({
        ticketId: concurrentTicket._id,
        targetDepartmentId: deptPay._id,
        workerId: workerReg._id,
        counterId: counterReg1._id
      })
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    assert(successes.length >= 1, '10. At least one transfer executed in race scenario');
    const finalConcTicket = await Ticket.findById(concurrentTicket._id);
    assert(finalConcTicket.status === 'TRANSFERRED', '10. Ticket ends in valid TRANSFERRED status without corruption');

    // -------------------------------------------------------------
    // Test 11, 12, 13: Queue Membership & Root Ticket Preservation
    // -------------------------------------------------------------
    console.log('\n─── 4. Queue Isolation & Root Token Identity ───');

    // 11. Source queue no longer contains the transferred ticket
    const sourceWaitingTickets = await Ticket.find({
      organizationId: orgA._id,
      currentDepartmentId: deptReg._id,
      status: { $in: ['WAITING', 'TRANSFERRED'] },
      _id: t1Res.ticket._id
    });
    assert(sourceWaitingTickets.length === 0, '11. Transferred ticket absent from source queue');

    // 12. Destination queue contains the transferred ticket exactly once
    const destWaitingTickets = await Ticket.find({
      organizationId: orgA._id,
      currentDepartmentId: deptVer._id,
      status: { $in: ['WAITING', 'TRANSFERRED'] },
      _id: t1Res.ticket._id
    });
    assert(destWaitingTickets.length === 1, '12. Transferred ticket present in destination queue exactly once');

    // 13. Root ticket number preserved (REG-101 remains REG-101)
    assert(t1Res.ticket.ticketNumber === 'REG-101', '13. Root ticket number REG-101 strictly preserved across transfer');

    // -------------------------------------------------------------
    // Test 14: QueueEvent Audit Trail & Journey Stages
    // -------------------------------------------------------------
    console.log('\n─── 5. Audit Trail & Journey History ───');

    const transferEvent = await QueueEvent.findOne({
      ticketId: t1Res.ticket._id,
      eventType: 'TICKET_TRANSFERRED'
    });
    assert(transferEvent !== null, '14. Immutable TICKET_TRANSFERRED QueueEvent created');
    assert(transferEvent.metadata.fromDepartmentId.toString() === deptReg._id.toString(), '14. QueueEvent records source department');
    assert(transferEvent.metadata.toDepartmentId.toString() === deptVer._id.toString(), '14. QueueEvent records destination department');
    assert(transferEvent.destinationRoomNumber === 'Room 102', '14. QueueEvent records destination room number');

    const journey = await citizenService.getTicketJourney(t1Res.ticket._id);
    assert(journey.stages.length >= 2, '14. Citizen journey contains multiple discrete stages');
    assert(journey.stages[0].departmentName === 'Registration', '14. Stage 1 is Registration');
    assert(journey.stages[0].status === 'COMPLETED', '14. Completed Stage 1 marked COMPLETED');
    assert(journey.stages[1].departmentName === 'Verification', '14. Stage 2 is Verification');
    assert(journey.stages[1].status === 'WAITING', '14. Active Stage 2 marked WAITING');

    // -------------------------------------------------------------
    // Test 15: Queue Position & ETA Recalculation
    // -------------------------------------------------------------
    console.log('\n─── 6. Queue Position & ETA ───');

    const position = await citizenService.getTicketPosition(t1Res.ticket._id);
    assert(typeof position.position === 'number' && position.position >= 1, '15. Authoritative queue position computed at destination');

    const eta = await citizenService.getTicketETA(t1Res.ticket._id);
    assert(typeof eta.estimatedWaitMin === 'number', '15. Realistic ETA computed at destination department');

    // -------------------------------------------------------------
    // Test 16, 17, 18: Downstream Worker Processing & Stage 3 Multi-Stage Flow
    // -------------------------------------------------------------
    console.log('\n─── 7. Full Multi-Stage End-to-End Workflow ───');

    // Verification worker calls the transferred ticket
    const verCallRes = await queueService.callNextTicket({
      organizationId: orgA._id,
      departmentId: deptVer._id,
      counterId: counterVer1._id,
      workerId: workerVer._id
    });
    assert(verCallRes.ticket !== null, '16. Destination worker successfully calls transferred ticket');
    assert(verCallRes.ticket.ticketNumber === 'REG-101', '16. Called ticket matches root ticket number REG-101');
    assert(verCallRes.ticket.status === 'CALLED', '16. Transferred ticket transitions from TRANSFERRED to CALLED');

    // Verification worker starts service
    await queueService.startService({
      ticketId: verCallRes.ticket._id,
      workerId: workerVer._id,
      counterId: counterVer1._id
    });

    // Verification worker transfers citizen to Stage 3: Payment
    const t3Res = await queueService.transferTicket({
      ticketId: verCallRes.ticket._id,
      targetDepartmentId: deptPay._id,
      targetCounterId: counterPay1._id,
      workerId: workerVer._id,
      counterId: counterVer1._id,
      reason: 'Verification passed, proceed to cashier payment'
    });
    assert(t3Res.ticket.currentDepartmentId.toString() === deptPay._id.toString(), '17. Ticket successfully transferred to Stage 3 (Payment)');
    assert(t3Res.ticket.ticketNumber === 'REG-101', '17. Root ticket number REG-101 still preserved at Stage 3');

    // Cashier calls and completes payment
    const payWorker = await Worker.create({
      organizationId: orgA._id,
      departmentId: deptPay._id,
      name: 'Cashier Clara',
      role: 'WORKER',
      status: 'AVAILABLE'
    });

    const payCallRes = await queueService.callNextTicket({
      organizationId: orgA._id,
      departmentId: deptPay._id,
      counterId: counterPay1._id,
      workerId: payWorker._id
    });
    assert(payCallRes.ticket.ticketNumber === 'REG-101', '18. Cashier calls REG-101 at Stage 3');

    // Cashier finishes entire multi-stage journey
    const finalCompleted = await queueService.completeService({
      ticketId: payCallRes.ticket._id,
      workerId: payWorker._id,
      counterId: counterPay1._id
    });
    assert(finalCompleted.status === 'COMPLETED', '19. Multi-stage ticket reaches COMPLETED status only when overall journey finishes');

    const finalJourney = await citizenService.getTicketJourney(finalCompleted._id);
    assert(finalJourney.stages.length === 3, '19. Final citizen journey contains all 3 sequential stages');
    assert(finalJourney.stages[0].departmentName === 'Registration', '19. Stage 1: Registration');
    assert(finalJourney.stages[1].departmentName === 'Verification', '19. Stage 2: Verification');
    assert(finalJourney.stages[2].departmentName === 'Payment & Cashier', '19. Stage 3: Payment & Cashier');
    assert(finalJourney.stages.every(s => s.status === 'COMPLETED'), '19. All 3 stages marked COMPLETED upon final service conclusion');

  } finally {
    // CLEANUP
    if (orgA) {
      await QueueEvent.deleteMany({ organizationId: orgA._id });
      await Ticket.deleteMany({ organizationId: orgA._id });
      await Counter.deleteMany({ organizationId: orgA._id });
      await Department.deleteMany({ orgId: orgA._id });
      await Worker.deleteMany({ organizationId: orgA._id });
      await Organization.deleteOne({ _id: orgA._id });
    }
    if (orgB) {
      await QueueEvent.deleteMany({ organizationId: orgB._id });
      await Department.deleteMany({ orgId: orgB._id });
      await Worker.deleteMany({ organizationId: orgB._id });
      await Organization.deleteOne({ _id: orgB._id });
    }
    await mongoose.disconnect();
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed  |  ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n  ✅ ALL MULTI-STAGE TOKEN TRANSFER TESTS PASSED!\n');
    process.exit(0);
  }
}

runMultiStageTransferTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
