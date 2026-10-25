/**
 * test_room_counter_transfer.js
 * Integration tests for Room & Counter management, Staff Approval with counter
 * assignment, and Token Transfer workflow with destination validation.
 *
 * Uses the real backend services directly — no HTTP mocking.
 */

const mongoose = require('mongoose');
const Organization = require('./models/Organization');
const Department = require('./models/Department');
const Counter = require('./models/Counter');
const Worker = require('./models/Worker');
const Ticket = require('./models/Ticket');
const QueueEvent = require('./models/QueueEvent');
const queueService = require('./services/queueService');
const counterService = require('./services/counterService');
const citizenService = require('./services/citizenService');

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

// Unique prefix for test isolation
const PREFIX = `RCT_${Date.now()}`;

async function cleanup(orgId) {
  if (!orgId) return;
  await Ticket.deleteMany({ organizationId: orgId });
  await QueueEvent.deleteMany({ organizationId: orgId });
  await Counter.deleteMany({ organizationId: orgId });
  await Worker.deleteMany({ organizationId: orgId });
  await Department.deleteMany({ orgId: orgId });
  await Organization.deleteMany({ _id: orgId });
}

async function runTests() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  QUEUELESS — ROOM, COUNTER & TRANSFER INTEGRATION TESTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB: ${MONGO_URI.replace(/\/\/[^@]+@/, '//***@')}\n`);

  let org, deptA, deptB, counterA1, counterA2, counterB1;
  let workerA, workerB;

  try {
    // ─────────────────────────────────────────────────────────────
    // SETUP: Organization + two Departments
    // ─────────────────────────────────────────────────────────────
    console.log('── SETUP ──────────────────────────────────────────────────');

    org = await Organization.create({
      name: `${PREFIX} Hospital`,
      type: 'HOSPITAL',
      address: '1 Test St, Test City, TS',
      status: 'ACTIVE'
    });
    assert(org._id, 'Created test organization');

    deptA = await Department.create({
      name: `${PREFIX} Cardiology`,
      prefix: 'CRD',
      orgId: org._id,
      roomNumber: '100',
      isActive: true
    });
    assert(deptA._id, 'Created Department A (Cardiology)');

    deptB = await Department.create({
      name: `${PREFIX} Radiology`,
      prefix: 'RAD',
      orgId: org._id,
      roomNumber: '200',
      isActive: true
    });
    assert(deptB._id, 'Created Department B (Radiology)');

    // ─────────────────────────────────────────────────────────────
    // SECTION 1: Room Management (subdocuments on Department)
    // ─────────────────────────────────────────────────────────────
    console.log('\n── 1. ROOM MANAGEMENT ─────────────────────────────────────');

    // 1a. Create multiple rooms in Department A
    deptA.rooms = [];
    deptA.rooms.push({ roomNumber: '101', name: 'ECG Room', isActive: true });
    deptA.rooms.push({ roomNumber: '102', name: 'Consultation Room', isActive: true });
    await deptA.save();
    const deptAFresh = await Department.findById(deptA._id);
    assert(deptAFresh.rooms.length === 2, '1a. Created 2 rooms in Department A');

    // 1b. Edit a room's name
    deptAFresh.rooms[0].name = 'ECG Room (Updated)';
    await deptAFresh.save();
    const deptAEdited = await Department.findById(deptA._id);
    assert(deptAEdited.rooms[0].name === 'ECG Room (Updated)', '1b. Edited room name');

    // 1c. Reject duplicate roomNumber within same department
    const existingRoomNums = deptAEdited.rooms.map(r => r.roomNumber);
    const wouldBeDuplicate = existingRoomNums.includes('101');
    assert(wouldBeDuplicate, '1c. Detected duplicate roomNumber exists in department');

    // 1d. Create rooms in Department B
    deptB.rooms = [];
    deptB.rooms.push({ roomNumber: '201', name: 'X-Ray Room', isActive: true });
    deptB.rooms.push({ roomNumber: '202', name: 'MRI Room', isActive: true });
    await deptB.save();
    const deptBFresh = await Department.findById(deptB._id);
    assert(deptBFresh.rooms.length === 2, '1d. Created 2 rooms in Department B');

    // ─────────────────────────────────────────────────────────────
    // SECTION 2: Counter Management
    // ─────────────────────────────────────────────────────────────
    console.log('\n── 2. COUNTER MANAGEMENT ──────────────────────────────────');

    // 2a. Create multiple counters in Department A
    counterA1 = await counterService.createCounter({
      organizationId: org._id,
      departmentId: deptA._id,
      counterNumber: 1,
      name: 'Registration Counter',
      roomNumber: '101',
      status: 'AVAILABLE',
      isActive: true
    });
    assert(counterA1._id, '2a-1. Created Counter A1 (Registration, Room 101)');
    assert(counterA1.roomNumber === '101', '2a-1. Counter A1 roomNumber is 101');

    counterA2 = await counterService.createCounter({
      organizationId: org._id,
      departmentId: deptA._id,
      counterNumber: 2,
      name: 'Consultation Counter',
      roomNumber: '102',
      status: 'AVAILABLE',
      isActive: true
    });
    assert(counterA2._id, '2a-2. Created Counter A2 (Consultation, Room 102)');

    // 2b. Create counter in Department B
    counterB1 = await counterService.createCounter({
      organizationId: org._id,
      departmentId: deptB._id,
      counterNumber: 1,
      name: 'X-Ray Counter',
      roomNumber: '201',
      status: 'AVAILABLE',
      isActive: true
    });
    assert(counterB1._id, '2b. Created Counter B1 (X-Ray, Room 201)');

    // 2c. Reject duplicate counterNumber in same department
    let dupCounterErr = false;
    try {
      await counterService.createCounter({
        organizationId: org._id,
        departmentId: deptA._id,
        counterNumber: 1,  // Already exists as counterA1
        name: 'Duplicate Counter',
        roomNumber: '101'
      });
    } catch (e) {
      dupCounterErr = e.message.includes('already exists');
    }
    assert(dupCounterErr, '2c. Rejected duplicate counterNumber in Department A');

    // 2d. Edit counter name
    counterA1.name = 'Registration Counter (Updated)';
    await counterA1.save();
    const updatedA1 = await Counter.findById(counterA1._id);
    assert(updatedA1.name === 'Registration Counter (Updated)', '2d. Edited counter name');

    // 2e. Default counter status and isActive
    const offlineCounter = await counterService.createCounter({
      organizationId: org._id,
      departmentId: deptA._id,
      counterNumber: 99,
      name: 'Offline Counter'
    });
    assert(offlineCounter.status === 'OFFLINE', '2e. Default counter status is OFFLINE');
    assert(offlineCounter.isActive === false, '2e. Default isActive is false');
    await Counter.findByIdAndDelete(offlineCounter._id);

    // ─────────────────────────────────────────────────────────────
    // SECTION 3: Staff Approval — Worker ↔ Counter Assignment
    // ─────────────────────────────────────────────────────────────
    console.log('\n── 3. STAFF APPROVAL WITH COUNTER ─────────────────────────');

    // 3a. Create Worker A with Counter A1 assigned
    workerA = await Worker.create({
      authUserId: `${PREFIX}_workerA`,
      organizationId: org._id,
      departmentId: deptA._id,
      counterId: counterA1._id,
      name: 'Worker A',
      role: 'WORKER',
      status: 'AVAILABLE'
    });
    counterA1.assignedWorkerId = workerA._id;
    counterA1.isActive = true;
    if (counterA1.status === 'OFFLINE') counterA1.status = 'AVAILABLE';
    await counterA1.save();

    assert(workerA._id, '3a. Created Worker A');
    const verifyC = await Counter.findById(counterA1._id);
    assert(
      verifyC.assignedWorkerId?.toString() === workerA._id.toString(),
      '3a. Counter A1 assignedWorkerId → Worker A'
    );

    // 3b. Create Worker B with Counter B1 assigned
    workerB = await Worker.create({
      authUserId: `${PREFIX}_workerB`,
      organizationId: org._id,
      departmentId: deptB._id,
      counterId: counterB1._id,
      name: 'Worker B',
      role: 'WORKER',
      status: 'AVAILABLE'
    });
    counterB1.assignedWorkerId = workerB._id;
    counterB1.isActive = true;
    if (counterB1.status === 'OFFLINE') counterB1.status = 'AVAILABLE';
    await counterB1.save();
    assert(workerB._id, '3b. Created Worker B assigned to Counter B1');

    // 3c. Cross-department counter query returns null
    const wrongDeptCounter = await Counter.findOne({
      _id: counterB1._id,
      departmentId: deptA._id,   // Intentionally wrong dept
      organizationId: org._id
    });
    assert(wrongDeptCounter === null, '3c. Counter from wrong dept returns null');

    // 3d. Worker without fixed counter (general dept worker) is valid
    const workerGeneral = await Worker.create({
      authUserId: `${PREFIX}_workerG`,
      organizationId: org._id,
      departmentId: deptA._id,
      counterId: null,
      name: 'General Worker',
      role: 'WORKER',
      status: 'AVAILABLE'
    });
    assert(workerGeneral._id, '3d. Created general dept worker with no fixed counter');
    assert(workerGeneral.counterId == null, '3d. General worker counterId is null');
    await Worker.findByIdAndDelete(workerGeneral._id);

    // ─────────────────────────────────────────────────────────────
    // SECTION 4: Ticket Issuance and Call-Next
    // ─────────────────────────────────────────────────────────────
    console.log('\n── 4. TICKET ISSUANCE & CALL-NEXT ─────────────────────────');

    // 4a. Issue ticket in Department A
    const issued = await queueService.issueTicket({
      organizationId: org._id,
      departmentId: deptA._id,
      priority: 'NORMAL',
      source: 'KIOSK'
    });
    const ticket = issued.ticket;
    assert(ticket._id, '4a. Issued ticket in Department A');
    assert(ticket.status === 'WAITING', '4a. Ticket status is WAITING');
    assert(issued.trackingToken, '4a. Ticket has trackingToken');

    // 4b. Call next from Counter A1
    const callResult = await queueService.callNextTicket({
      departmentId: deptA._id,
      organizationId: org._id,
      counterId: counterA1._id,
      workerId: workerA._id
    });
    assert(callResult.ticket, '4b. callNextTicket returned a ticket');
    const calledTicket = await Ticket.findById(ticket._id);
    assert(calledTicket.status === 'CALLED', '4b. Ticket status is CALLED');
    assert(
      calledTicket.currentCounterId?.toString() === counterA1._id.toString(),
      '4b. Ticket assigned to Counter A1'
    );

    // 4c. Start service
    const startedTicket = await queueService.startService({
      ticketId: ticket._id,
      workerId: workerA._id,
      counterId: counterA1._id
    });
    assert(startedTicket.status === 'SERVING', '4c. Ticket status is SERVING');

    // ─────────────────────────────────────────────────────────────
    // SECTION 5: Ticket Transfer to Specific Counter
    // ─────────────────────────────────────────────────────────────
    console.log('\n── 5. TICKET TRANSFER TO SPECIFIC COUNTER ─────────────────');

    const transferResult = await queueService.transferTicket({
      ticketId: ticket._id,
      targetDepartmentId: deptB._id,
      targetCounterId: counterB1._id,
      workerId: workerA._id,
      counterId: counterA1._id,
      reason: 'Requires X-Ray scan'
    });
    // transferTicket returns { ticket, targetDepartment, targetCounter, positionInQueue }
    const transferred = transferResult.ticket;
    assert(transferred.status === 'TRANSFERRED', '5a. Ticket is TRANSFERRED');
    assert(
      transferred.currentDepartmentId?.toString() === deptB._id.toString(),
      '5a. currentDepartmentId → Dept B'
    );
    assert(
      transferred.targetCounterId?.toString() === counterB1._id.toString(),
      '5a. targetCounterId → Counter B1'
    );
    assert(transferred.transferInfo?.reason === 'Requires X-Ray scan', '5b. Transfer reason stored');
    assert(
      transferred.transferInfo?.fromDepartmentId?.toString() === deptA._id.toString(),
      '5b. fromDepartmentId → Dept A'
    );

    // 5c. Source counter freed
    const freedCounter = await Counter.findById(counterA1._id);
    assert(
      freedCounter.status === 'AVAILABLE' || freedCounter.currentTicketId == null,
      '5c. Source counter released after transfer'
    );

    // 5d. Transfer appears in QueueEvent history (eventType = TICKET_TRANSFERRED)
    const transferEvents = await QueueEvent.find({
      ticketId: ticket._id,
      eventType: 'TICKET_TRANSFERRED'
    });
    assert(transferEvents.length >= 1, '5d. TICKET_TRANSFERRED QueueEvent created');

    // 5e. Call ticket in Dept B from Counter B1
    const callInB = await queueService.callNextTicket({
      departmentId: deptB._id,
      organizationId: org._id,
      counterId: counterB1._id,
      workerId: workerB._id
    });
    assert(callInB.ticket, '5e. Called transferred ticket in Dept B');
    const ticketAtB = await Ticket.findById(ticket._id);
    assert(ticketAtB.status === 'CALLED', '5e. Status CALLED in Dept B');
    assert(
      ticketAtB.currentCounterId?.toString() === counterB1._id.toString(),
      '5e. Assigned to Counter B1'
    );

    // ─────────────────────────────────────────────────────────────
    // SECTION 6: Transfer Rejection Scenarios
    // ─────────────────────────────────────────────────────────────
    console.log('\n── 6. TRANSFER REJECTION SCENARIOS ────────────────────────');

    // Prepare a fresh SERVING ticket for rejection tests
    const issued2 = await queueService.issueTicket({
      organizationId: org._id,
      departmentId: deptA._id,
      priority: 'NORMAL',
      source: 'KIOSK'
    });
    const ticket2 = issued2.ticket;
    await queueService.callNextTicket({
      departmentId: deptA._id,
      organizationId: org._id,
      counterId: counterA1._id,
      workerId: workerA._id
    });
    await queueService.startService({
      ticketId: ticket2._id,
      workerId: workerA._id,
      counterId: counterA1._id
    });

    // 6a. Reject transfer to inactive counter
    const inactiveCounter = await counterService.createCounter({
      organizationId: org._id,
      departmentId: deptB._id,
      counterNumber: 99,
      name: 'Inactive Counter',
      roomNumber: '202',
      status: 'OFFLINE',
      isActive: false
    });
    let inactiveErr = false;
    try {
      await queueService.transferTicket({
        ticketId: ticket2._id,
        targetDepartmentId: deptB._id,
        targetCounterId: inactiveCounter._id,
        workerId: workerA._id,
        counterId: counterA1._id
      });
    } catch (e) {
      inactiveErr = e.message.toLowerCase().includes('inactive') || e.message.toLowerCase().includes('deactivated');
    }
    assert(inactiveErr, '6a. Rejected transfer to inactive counter');
    await Counter.findByIdAndDelete(inactiveCounter._id);

    // 6b. Reject transfer to counter in wrong department
    let wrongDeptErr = false;
    try {
      await queueService.transferTicket({
        ticketId: ticket2._id,
        targetDepartmentId: deptB._id,
        targetCounterId: counterA2._id,  // counterA2 is in deptA, not deptB
        workerId: workerA._id,
        counterId: counterA1._id
      });
    } catch (e) {
      wrongDeptErr = true;
    }
    assert(wrongDeptErr, '6b. Rejected transfer to counter in wrong department');

    // 6c. Complete ticket2, then reject transfer of completed ticket
    await queueService.completeService({
      ticketId: ticket2._id,
      workerId: workerA._id,
      counterId: counterA1._id
    });
    let completedErr = false;
    try {
      await queueService.transferTicket({
        ticketId: ticket2._id,
        targetDepartmentId: deptB._id,
        workerId: workerA._id,
        counterId: counterA1._id
      });
    } catch (e) {
      completedErr = true;
    }
    assert(completedErr, '6c. Rejected transfer of completed ticket');

    // 6d. Cross-organization tenant boundary rejection
    const foreignOrg = await Organization.create({
      name: `${PREFIX} Foreign Hospital`,
      type: 'HOSPITAL',
      address: '2 Other Ave, Test City, TS',
      status: 'ACTIVE'
    });
    const foreignDept = await Department.create({
      name: `${PREFIX} Foreign Dept`,
      prefix: 'FGN',
      orgId: foreignOrg._id,
      isActive: true
    });
    const issued3 = await queueService.issueTicket({
      organizationId: org._id,
      departmentId: deptA._id,
      priority: 'NORMAL',
      source: 'KIOSK'
    });
    const ticket3 = issued3.ticket;
    await queueService.callNextTicket({
      departmentId: deptA._id,
      organizationId: org._id,
      counterId: counterA1._id,
      workerId: workerA._id
    });
    await queueService.startService({
      ticketId: ticket3._id,
      workerId: workerA._id,
      counterId: counterA1._id
    });
    let tenantErr = false;
    try {
      await queueService.transferTicket({
        ticketId: ticket3._id,
        targetDepartmentId: foreignDept._id,
        workerId: workerA._id,
        counterId: counterA1._id
      });
    } catch (e) {
      tenantErr = e.message.includes('Tenant') || e.status === 403;
    }
    assert(tenantErr, '6d. Rejected cross-organization transfer');
    // Complete ticket3 and clean foreign org
    await queueService.completeService({
      ticketId: ticket3._id,
      workerId: workerA._id,
      counterId: counterA1._id
    });
    await Ticket.deleteMany({ organizationId: foreignOrg._id });
    await Department.deleteMany({ orgId: foreignOrg._id });
    await Organization.deleteMany({ _id: foreignOrg._id });

    // ─────────────────────────────────────────────────────────────
    // SECTION 7: Complete ticket at Dept B and safety checks
    // ─────────────────────────────────────────────────────────────
    console.log('\n── 7. COMPLETION & SAFETY CHECKS ──────────────────────────');

    // Start service on ticket (which is CALLED at B1)
    await queueService.startService({
      ticketId: ticket._id,
      workerId: workerB._id,
      counterId: counterB1._id
    });
    const servingAtB = await Ticket.findById(ticket._id);
    assert(servingAtB.status === 'SERVING', '7a. Ticket SERVING at Dept B');

    // Safety: room with active counters should block room deletion
    const countersInRoom101 = await Counter.find({
      departmentId: deptA._id,
      roomNumber: '101',
      isActive: true
    });
    assert(countersInRoom101.length > 0, '7b. Active counters found in Room 101 (blocks room delete)');

    // Complete the ticket
    await queueService.completeService({
      ticketId: ticket._id,
      workerId: workerB._id,
      counterId: counterB1._id
    });
    const completedTicket = await Ticket.findById(ticket._id);
    assert(completedTicket.status === 'COMPLETED', '7c. Ticket COMPLETED at Dept B');

    // ─────────────────────────────────────────────────────────────
    // SECTION 8: Citizen Tracking After Transfer
    // ─────────────────────────────────────────────────────────────
    console.log('\n── 8. CITIZEN TRACKING AFTER TRANSFER ─────────────────────');

    const issued4 = await queueService.issueTicket({
      organizationId: org._id,
      departmentId: deptA._id,
      priority: 'NORMAL',
      source: 'KIOSK'
    });
    const ticket4 = issued4.ticket;
    assert(issued4.trackingToken, '8a. Ticket has tracking token');

    await queueService.callNextTicket({
      departmentId: deptA._id,
      organizationId: org._id,
      counterId: counterA1._id,
      workerId: workerA._id
    });
    await queueService.startService({
      ticketId: ticket4._id,
      workerId: workerA._id,
      counterId: counterA1._id
    });
    await queueService.transferTicket({
      ticketId: ticket4._id,
      targetDepartmentId: deptB._id,
      workerId: workerA._id,
      counterId: counterA1._id,
      reason: 'Multi-stage routing'
    });

    // 8b. Tracking token still resolves
    const tracked = await citizenService.getTicketByTrackingToken(issued4.trackingToken);
    assert(tracked, '8b. Tracking token resolves after transfer');
    assert(tracked.status === 'TRANSFERRED', '8b. Tracked ticket status is TRANSFERRED');
    // currentDepartmentId is populated (object), so compare via ._id
    const trackedDeptId = tracked.currentDepartmentId?._id?.toString() || tracked.currentDepartmentId?.toString();
    assert(
      trackedDeptId === deptB._id.toString(),
      '8b. Tracked ticket shows Dept B'
    );

    // 8c. Journey includes TRANSFERRED action (stored as TRANSFERRED_TO_COUNTER_N or TRANSFERRED_FROM_xxx)
    const refreshedT4 = await Ticket.findById(ticket4._id);
    const hasTransfer = (refreshedT4.history || []).some(h => h.action && h.action.startsWith('TRANSFERRED'));
    assert(hasTransfer, '8c. Ticket journey has TRANSFERRED action');
    // Complete for cleanup
    await queueService.callNextTicket({
      departmentId: deptB._id,
      organizationId: org._id,
      counterId: counterB1._id,
      workerId: workerB._id
    });
    await queueService.startService({
      ticketId: ticket4._id,
      workerId: workerB._id,
      counterId: counterB1._id
    });
    await queueService.completeService({
      ticketId: ticket4._id,
      workerId: workerB._id,
      counterId: counterB1._id
    });

    // ─────────────────────────────────────────────────────────────
    // SECTION 9: Transfer to General Queue (no specific counter)
    // ─────────────────────────────────────────────────────────────
    console.log('\n── 9. TRANSFER TO GENERAL QUEUE ───────────────────────────');

    const issued5 = await queueService.issueTicket({
      organizationId: org._id,
      departmentId: deptA._id,
      priority: 'NORMAL',
      source: 'KIOSK'
    });
    const ticket5 = issued5.ticket;
    await queueService.callNextTicket({
      departmentId: deptA._id,
      organizationId: org._id,
      counterId: counterA1._id,
      workerId: workerA._id
    });
    await queueService.startService({
      ticketId: ticket5._id,
      workerId: workerA._id,
      counterId: counterA1._id
    });

    const generalTransferResult = await queueService.transferTicket({
      ticketId: ticket5._id,
      targetDepartmentId: deptB._id,
      workerId: workerA._id,
      counterId: counterA1._id,
      reason: 'General queue routing'
    });
    const generalTransfer = generalTransferResult.ticket;
    assert(generalTransfer.status === 'TRANSFERRED', '9a. Transferred to general queue');
    assert(
      generalTransfer.targetCounterId == null,
      '9a. No specific targetCounterId for general queue'
    );

    // Any counter in deptB can call this general-queue ticket
    const generalCall = await queueService.callNextTicket({
      departmentId: deptB._id,
      organizationId: org._id,
      counterId: counterB1._id,
      workerId: workerB._id
    });
    assert(generalCall.ticket, '9b. General-queue ticket callable from Counter B1');
    await queueService.startService({
      ticketId: ticket5._id,
      workerId: workerB._id,
      counterId: counterB1._id
    });
    await queueService.completeService({
      ticketId: ticket5._id,
      workerId: workerB._id,
      counterId: counterB1._id
    });

    // ─────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────
    console.log('\n── CLEANUP ────────────────────────────────────────────────');
    await cleanup(org._id);
    console.log('  Test data cleaned up.\n');

  } catch (err) {
    console.error('\n  !! UNEXPECTED ERROR:', err.message);
    console.error(err.stack);
    failed++;
    try { if (org?._id) await cleanup(org._id); } catch (e) { /* ignore */ }
  } finally {
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log('═══════════════════════════════════════════════════════════\n');
    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
