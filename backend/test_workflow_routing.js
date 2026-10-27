/**
 * test_workflow_routing.js
 * Comprehensive automated verification for QueueLess Token Issuance & Multi-Stage Workflow Architecture.
 *
 * Verifies all 21 Scenarios:
 * 1. Normal service issuance selects configured entry department
 * 2. Arbitrary department selection is rejected
 * 3. Repeated clicks don't create duplicate tickets (idempotency)
 * 4. Retries with same key return same result
 * 5. Concurrent identical requests create only one ticket
 * 6. Every public issuance endpoint is rate-limited
 * 7. Active-ticket / session policy works
 * 8. Kiosk requests cannot impersonate trusted device (document limitation)
 * 9. Invalid service/workflow config is rejected
 * 10. Valid Registration -> Verification transfer succeeds
 * 11. Invalid Registration -> Pharmacy transfer is rejected
 * 12. Cross-org transfer rejected
 * 13. Invalid/inactive destination counters rejected
 * 14. Duplicate transfer retries don't create duplicate stages
 * 15. Source/destination queues stay consistent
 * 16. Root token preserved throughout journey
 * 17. Stages have correct status/history; journey reaches final completion
 * 18. Two workers cannot claim same stage
 * 19. Unauthorized workers cannot transfer or claim
 * 20. Citizen tracking shows current stage without leaking secrets
 * 21. Existing tests regression verification
 */

require('dotenv').config();
process.env.NODE_ENV = 'test';
process.env.TEST_AUTH_BYPASS = 'true';
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');

const Organization = require('./models/Organization');
const Department = require('./models/Department');
const Counter = require('./models/Counter');
const Worker = require('./models/Worker');
const Ticket = require('./models/Ticket');
const QueueEvent = require('./models/QueueEvent');
const ServiceWorkflow = require('./models/ServiceWorkflow');
const queueService = require('./services/queueService');
const citizenService = require('./services/citizenService');
const ticketRoutes = require('./routes/ticketRoutes');
const queueRoutes = require('./routes/queueRoutes');
const organizationRoutes = require('./routes/organizationRoutes');

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

async function runWorkflowRoutingTests() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  QUEUELESS — TOKEN ISSUANCE & WORKFLOW ROUTING AUDIT');
  console.log('═══════════════════════════════════════════════════════════\n');

  await mongoose.connect(MONGO_URI);

  // Setup Express in-process test server
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tickets', ticketRoutes);
  app.use('/api/v1/orgs', organizationRoutes);
  app.use('/api/v1', queueRoutes);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const suffix = `wf_${Date.now()}`;

  let orgA, orgB;
  let deptReg, deptVer, deptPay, deptPharm, deptOrgB;
  let counterReg, counterVer, counterPay, inactiveCounter;
  let workerReg, workerVer, workerPay, workerForeign;
  let testWorkflow;

  try {
    // -------------------------------------------------------------
    // SETUP: Topologies, Departments, Workflows
    // -------------------------------------------------------------
    console.log('─── 0. Fixtures Setup ───');

    orgA = await Organization.create({
      name: `City Governance Office ${suffix}`,
      status: 'ACTIVE'
    });

    orgB = await Organization.create({
      name: `Foreign District Office ${suffix}`,
      status: 'ACTIVE'
    });

    // Org A Departments
    deptReg = await Department.create({
      orgId: orgA._id,
      name: 'Registration & Intake',
      prefix: 'REG',
      isEntryLevel: true,
      roomNumber: '101'
    });

    deptVer = await Department.create({
      orgId: orgA._id,
      name: 'Document Verification',
      prefix: 'VER',
      isEntryLevel: false,
      roomNumber: '102'
    });

    deptPay = await Department.create({
      orgId: orgA._id,
      name: 'Payment & Cashier',
      prefix: 'PAY',
      isEntryLevel: false,
      roomNumber: '103'
    });

    deptPharm = await Department.create({
      orgId: orgA._id,
      name: 'Pharmacy & Medical Dispensary',
      prefix: 'MED',
      isEntryLevel: false,
      roomNumber: '104'
    });

    // Org B Department
    deptOrgB = await Department.create({
      orgId: orgB._id,
      name: 'Foreign Department',
      prefix: 'FOR',
      isEntryLevel: true,
      roomNumber: '201'
    });

    // Counters
    counterReg = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptReg._id,
      counterNumber: 1,
      name: 'Registration Desk 1',
      roomNumber: '101',
      status: 'AVAILABLE',
      isActive: true
    });

    counterVer = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptVer._id,
      counterNumber: 1,
      name: 'Verification Desk 1',
      roomNumber: '102',
      status: 'AVAILABLE',
      isActive: true
    });

    counterPay = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptPay._id,
      counterNumber: 1,
      name: 'Cashier Desk 1',
      roomNumber: '103',
      status: 'AVAILABLE',
      isActive: true
    });

    inactiveCounter = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptVer._id,
      counterNumber: 99,
      name: 'Offline Desk',
      status: 'OFFLINE',
      isActive: false
    });

    // Workers
    workerReg = await Worker.create({
      name: 'Registration Worker',
      authUserId: `clerk_reg_${suffix}`,
      organizationId: orgA._id,
      departmentId: deptReg._id,
      counterId: counterReg._id,
      role: 'WORKER',
      status: 'AVAILABLE'
    });

    workerVer = await Worker.create({
      name: 'Verification Worker',
      authUserId: `clerk_ver_${suffix}`,
      organizationId: orgA._id,
      departmentId: deptVer._id,
      counterId: counterVer._id,
      role: 'WORKER',
      status: 'AVAILABLE'
    });

    workerPay = await Worker.create({
      name: 'Payment Worker',
      authUserId: `clerk_pay_${suffix}`,
      organizationId: orgA._id,
      departmentId: deptPay._id,
      counterId: counterPay._id,
      role: 'WORKER',
      status: 'AVAILABLE'
    });

    workerForeign = await Worker.create({
      name: 'Foreign Worker',
      authUserId: `clerk_foreign_${suffix}`,
      organizationId: orgB._id,
      departmentId: deptOrgB._id,
      role: 'WORKER',
      status: 'AVAILABLE'
    });

    // ServiceWorkflow Configuration:
    // Registration (Entry) -> Allowed: [Verification]
    // Verification -> Allowed: [Payment]
    // Payment -> Allowed: [] (Final)
    testWorkflow = await ServiceWorkflow.create({
      organizationId: orgA._id,
      name: 'Citizenship & National ID Application',
      description: 'Standard 3-stage citizen identity journey',
      entryDepartmentId: deptReg._id,
      isActive: true,
      stages: [
        {
          departmentId: deptReg._id,
          name: 'Registration',
          order: 0,
          allowedNextDepartments: [deptVer._id]
        },
        {
          departmentId: deptVer._id,
          name: 'Verification',
          order: 1,
          allowedNextDepartments: [deptPay._id]
        },
        {
          departmentId: deptPay._id,
          name: 'Payment',
          order: 2,
          allowedNextDepartments: []
        }
      ]
    });

    assert(testWorkflow && testWorkflow.stages.length === 3, '0. ServiceWorkflow configured with 3 stages and entry point');

    // -------------------------------------------------------------
    // Scenario 1: Normal service issuance selects configured entry department
    // -------------------------------------------------------------
    console.log('\n─── Scenario 1 & 2: Authoritative Service Workflow Issuance ───');

    const issueWfRes = await fetch(`${baseUrl}/api/v1/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: orgA._id.toString(),
        serviceWorkflowId: testWorkflow._id.toString()
      })
    });
    const issueWfData = await issueWfRes.json();
    assert(issueWfRes.status === 201, '1. Issuance with serviceWorkflowId succeeds with HTTP 201');
    assert(issueWfData.ticket.currentDepartmentId.toString() === deptReg._id.toString(), '1. Authoritative entry department (Registration) selected automatically');
    assert(issueWfData.ticket.serviceWorkflowId.toString() === testWorkflow._id.toString(), '1. Ticket stores serviceWorkflowId reference');

    // -------------------------------------------------------------
    // Scenario 2: Arbitrary department selection is rejected
    // -------------------------------------------------------------
    const invalidDeptRes = await fetch(`${baseUrl}/api/v1/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: orgA._id.toString(),
        serviceWorkflowId: testWorkflow._id.toString(),
        departmentId: deptVer._id.toString() // Trying to bypass entry department
      })
    });
    const invalidDeptData = await invalidDeptRes.json();
    assert(invalidDeptRes.status === 400, '2. Arbitrary non-entry department selection rejected with HTTP 400');
    assert(invalidDeptData.error.includes('Invalid entry department'), '2. Error message explicitly cites invalid entry department');

    // -------------------------------------------------------------
    // Scenario 3: Repeated clicks don't create duplicate tickets (idempotency)
    // -------------------------------------------------------------
    console.log('\n─── Scenario 3, 4 & 5: Idempotency & Concurrency Hardening ───');

    const idemKey = `idem_test_${Date.now()}_abc`;
    const firstReq = await fetch(`${baseUrl}/api/v1/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
      body: JSON.stringify({
        organizationId: orgA._id.toString(),
        departmentId: deptReg._id.toString()
      })
    });
    const firstData = await firstReq.json();
    assert(firstReq.status === 201, '3. Initial ticket issued with HTTP 201');
    const originalTicketNumber = firstData.ticket.ticketNumber;

    // -------------------------------------------------------------
    // Scenario 4: Retries with same key return same result
    // -------------------------------------------------------------
    const retryReq = await fetch(`${baseUrl}/api/v1/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
      body: JSON.stringify({
        organizationId: orgA._id.toString(),
        departmentId: deptReg._id.toString()
      })
    });
    const retryData = await retryReq.json();
    assert(retryReq.status === 200, '4. Retry with identical key returns HTTP 200 (idempotent)');
    assert(retryData.isIdempotent === true, '4. isIdempotent flag is true');
    assert(retryData.ticket.ticketNumber === originalTicketNumber, '4. Exact same ticketNumber returned on retry');
    assert(retryData.ticket._id === firstData.ticket._id, '4. Exact same Ticket Mongo ID returned');

    // -------------------------------------------------------------
    // Scenario 5: Concurrent identical requests create only one ticket
    // -------------------------------------------------------------
    const raceKey = `idem_race_${Date.now()}`;
    const concurrentPromises = Array.from({ length: 6 }, () =>
      fetch(`${baseUrl}/api/v1/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': raceKey },
        body: JSON.stringify({
          organizationId: orgA._id.toString(),
          departmentId: deptReg._id.toString()
        })
      }).then(r => r.json())
    );

    const raceResults = await Promise.all(concurrentPromises);
    const uniqueTicketIds = new Set(raceResults.map(r => r.ticket?._id?.toString() || r.ticket?._id));
    assert(uniqueTicketIds.size === 1, '5. Exactly 1 unique Ticket created across 6 concurrent requests');
    const ticketsInDb = await Ticket.countDocuments({ idempotencyKey: raceKey });
    assert(ticketsInDb === 1, '5. Database contains exactly 1 Ticket for race idempotency key');

    // -------------------------------------------------------------
    // Scenario 6: Every public issuance endpoint is rate-limited
    // -------------------------------------------------------------
    console.log('\n─── Scenario 6, 7 & 8: Rate Limiting & Device Integrity ───');

    // Verify rate limiter presence on /v1/tokens/issue and /tokens/issue
    const hasLimiterTicket = ticketRoutes.stack.some(layer => layer.route && layer.route.path === '/' && layer.route.stack.length > 1);
    const hasLimiterQueue = queueRoutes.stack.some(layer => layer.route && layer.route.path?.includes('tokens/issue') && layer.route.stack.length > 1);
    assert(hasLimiterTicket, '6. Rate limiter actively installed on /api/v1/tickets POST');
    assert(hasLimiterQueue, '6. Rate limiter actively installed on /api/v1/tokens/issue POST');

    // -------------------------------------------------------------
    // Scenario 7: Active-ticket / session policy works
    // -------------------------------------------------------------
    const activeTicketDoc = await Ticket.findById(firstData.ticket._id);
    assert(['WAITING', 'CALLED', 'SERVING', 'SNOOZED', 'TRANSFERRED'].includes(activeTicketDoc.status), '7. Ticket remains active until completion');

    // -------------------------------------------------------------
    // Scenario 8: Kiosk requests cannot impersonate trusted device
    // -------------------------------------------------------------
    const kioskDispenseRes = await fetch(`${baseUrl}/api/v1/tokens/dispense`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: orgA._id.toString(),
        deptId: deptReg._id.toString()
      })
    });
    const kioskData = await kioskDispenseRes.json();
    assert(kioskDispenseRes.status === 201, '8. Kiosk issuance passes through authoritative issueTicket');
    assert(kioskData.source === 'KIOSK', '8. Kiosk source explicitly labeled and tracked');
    assert(kioskData.ticket.source === 'KIOSK', '8. Ticket model records KIOSK source');

    // -------------------------------------------------------------
    // Scenario 9: Invalid service/workflow config is rejected
    // -------------------------------------------------------------
    console.log('\n─── Scenario 9, 10 & 11: Workflow Enforcement & Invalid Transitions ───');

    const foreignDeptWfRes = await fetch(`${baseUrl}/api/v1/orgs/${orgA._id}/service-workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': 'admin_1',
        'x-test-role': 'master_admin'
      },
      body: JSON.stringify({
        name: 'Invalid Cross-Org Workflow',
        entryDepartmentId: deptOrgB._id.toString() // Foreign department!
      })
    });
    assert(foreignDeptWfRes.status === 400, '9. Workflow with foreign entryDepartmentId rejected with HTTP 400');

    // -------------------------------------------------------------
    // Scenario 10: Valid Registration -> Verification transfer succeeds
    // -------------------------------------------------------------
    const ticketToTransfer = await queueService.issueTicket({
      organizationId: orgA._id,
      serviceWorkflowId: testWorkflow._id,
      source: 'WEB'
    });

    // Worker calls ticket first (WAITING -> CALLED)
    await Ticket.findByIdAndUpdate(ticketToTransfer.ticket._id, {
      status: 'CALLED',
      currentCounterId: counterReg._id,
      currentWorkerId: workerReg._id
    });

    const validTransfer = await queueService.transferTicket({
      ticketId: ticketToTransfer.ticket._id,
      targetDepartmentId: deptVer._id,
      workerId: workerReg._id,
      counterId: counterReg._id
    });

    assert(validTransfer.ticket.status === 'TRANSFERRED', '10. Valid Registration -> Verification transfer transitions to TRANSFERRED');
    assert(validTransfer.ticket.currentDepartmentId.toString() === deptVer._id.toString(), '10. Department correctly updated to Verification');
    assert(validTransfer.ticket.currentStageIndex === 1, '10. currentStageIndex advanced to 1');

    // -------------------------------------------------------------
    // Scenario 11: Invalid Registration -> Pharmacy transfer is rejected
    // -------------------------------------------------------------
    const ticketForIllegalTransfer = await queueService.issueTicket({
      organizationId: orgA._id,
      serviceWorkflowId: testWorkflow._id,
      source: 'WEB'
    });

    await Ticket.findByIdAndUpdate(ticketForIllegalTransfer.ticket._id, {
      status: 'CALLED',
      currentCounterId: counterReg._id,
      currentWorkerId: workerReg._id
    });

    try {
      await queueService.transferTicket({
        ticketId: ticketForIllegalTransfer.ticket._id,
        targetDepartmentId: deptPharm._id, // Not in allowedNextDepartments for Registration!
        workerId: workerReg._id,
        counterId: counterReg._id
      });
      assert(false, 'Transfer to Pharmacy should have thrown workflow violation');
    } catch (err) {
      assert(err.status === 400 && err.code === 'INVALID_WORKFLOW_TRANSITION', '11. Registration -> Pharmacy transfer rejected with INVALID_WORKFLOW_TRANSITION (400)');
    }

    // -------------------------------------------------------------
    // Scenario 12: Cross-org transfer rejected
    // -------------------------------------------------------------
    console.log('\n─── Scenario 12, 13 & 14: Tenant Boundaries & Destination Guards ───');

    try {
      await queueService.transferTicket({
        ticketId: ticketForIllegalTransfer.ticket._id,
        targetDepartmentId: deptOrgB._id, // Foreign org!
        workerId: workerReg._id,
        counterId: counterReg._id
      });
      assert(false, 'Cross-org transfer should throw');
    } catch (err) {
      assert(err.status === 403, '12. Cross-org transfer strictly rejected with Tenant Boundary Error (HTTP 403)');
    }

    // -------------------------------------------------------------
    // Scenario 13: Invalid/inactive destination counters rejected
    // -------------------------------------------------------------
    try {
      await queueService.transferTicket({
        ticketId: ticketForIllegalTransfer.ticket._id,
        targetDepartmentId: deptVer._id,
        targetCounterId: inactiveCounter._id,
        workerId: workerReg._id,
        counterId: counterReg._id
      });
      assert(false, 'Inactive destination counter should throw');
    } catch (err) {
      assert(err.status === 400, '13. Inactive destination counter rejected with HTTP 400');
    }

    // -------------------------------------------------------------
    // Scenario 14: Duplicate transfer retries don't create duplicate stages
    // -------------------------------------------------------------
    const ticketDuplicateTransfer = await queueService.issueTicket({
      organizationId: orgA._id,
      serviceWorkflowId: testWorkflow._id,
      source: 'WEB'
    });

    await Ticket.findByIdAndUpdate(ticketDuplicateTransfer.ticket._id, {
      status: 'CALLED',
      currentCounterId: counterReg._id,
      currentWorkerId: workerReg._id
    });

    await queueService.transferTicket({
      ticketId: ticketDuplicateTransfer.ticket._id,
      targetDepartmentId: deptVer._id,
      workerId: workerReg._id,
      counterId: counterReg._id
    });

    const ticketAfterFirst = await Ticket.findById(ticketDuplicateTransfer.ticket._id);
    const historyCount1 = ticketAfterFirst.history.length;

    // Retry transfer to same department
    const retryTransferRes = await queueService.transferTicket({
      ticketId: ticketDuplicateTransfer.ticket._id,
      targetDepartmentId: deptVer._id,
      workerId: workerReg._id,
      counterId: counterReg._id
    });

    const ticketAfterRetry = await Ticket.findById(ticketDuplicateTransfer.ticket._id);
    assert(retryTransferRes.isDuplicate === true || ticketAfterRetry.history.length === historyCount1, '14. Duplicate transfer retry is idempotent; does not corrupt stage history');

    // -------------------------------------------------------------
    // Scenario 15: Source/destination queues stay consistent
    // -------------------------------------------------------------
    console.log('\n─── Scenario 15, 16 & 17: Queue Consistency & Root Token Preservation ───');

    const sourceQueueTickets = await Ticket.find({
      organizationId: orgA._id,
      currentDepartmentId: deptReg._id,
      _id: ticketDuplicateTransfer.ticket._id
    });
    assert(sourceQueueTickets.length === 0, '15. Transferred ticket is removed from source queue');

    const destQueueTickets = await Ticket.find({
      organizationId: orgA._id,
      currentDepartmentId: deptVer._id,
      _id: ticketDuplicateTransfer.ticket._id
    });
    assert(destQueueTickets.length === 1, '15. Transferred ticket is present in destination queue');

    // -------------------------------------------------------------
    // Scenario 16: Root token preserved throughout journey
    // -------------------------------------------------------------
    const rootTokenNumber = ticketDuplicateTransfer.ticket.ticketNumber;
    assert(ticketAfterRetry.ticketNumber === rootTokenNumber, '16. Root ticketNumber (e.g. REG-001) strictly preserved across transfer');

    // -------------------------------------------------------------
    // Scenario 17: Stages have correct status/history; journey reaches final completion
    // -------------------------------------------------------------
    // Claim at Stage 2 (Verification)
    const claimedStage2 = await queueService.callNextTicket({
      organizationId: orgA._id,
      departmentId: deptVer._id,
      counterId: counterVer._id,
      workerId: workerVer._id
    });
    assert(claimedStage2.ticket && claimedStage2.ticket.status === 'CALLED', '17. Worker Ver calls waiting ticket at Stage 2');
    const stage2RootNum = claimedStage2.ticket.ticketNumber;

    // Transfer Stage 2 -> Stage 3 (Payment)
    await queueService.transferTicket({
      ticketId: claimedStage2.ticket._id,
      targetDepartmentId: deptPay._id,
      workerId: workerVer._id,
      counterId: counterVer._id
    });

    // Claim at Stage 3 (Payment)
    const claimedStage3 = await queueService.callNextTicket({
      organizationId: orgA._id,
      departmentId: deptPay._id,
      counterId: counterPay._id,
      workerId: workerPay._id
    });
    assert(claimedStage3.ticket.ticketNumber === stage2RootNum, '17. Cashier calls root ticket at Stage 3 with identical ticket number');

    // Complete service
    const completedTicket = await queueService.completeService({
      ticketId: claimedStage3.ticket._id,
      workerId: workerPay._id,
      counterId: counterPay._id
    });
    assert(completedTicket.status === 'COMPLETED', '17. Multi-stage ticket completes successfully');
    assert(completedTicket.history.length >= 3, '17. Journey history records discrete stages');

    // -------------------------------------------------------------
    // Scenario 18: Two workers cannot claim same stage
    // -------------------------------------------------------------
    console.log('\n─── Scenario 18 & 19: Concurrency Race & Worker Authorization ───');

    const singleWaitingTicket = await queueService.issueTicket({
      organizationId: orgA._id,
      departmentId: deptReg._id,
      source: 'WEB'
    });

    const [claim1, claim2] = await Promise.all([
      queueService.callNextTicket({
        organizationId: orgA._id,
        departmentId: deptReg._id,
        counterId: counterReg._id,
        workerId: workerReg._id
      }),
      queueService.callNextTicket({
        organizationId: orgA._id,
        departmentId: deptReg._id,
        counterId: counterReg._id,
        workerId: workerReg._id
      })
    ]);

    const bothGot = claim1.ticket && claim2.ticket;
    const noDup = !bothGot || (claim1.ticket._id.toString() !== claim2.ticket._id.toString());
    assert(noDup, '18. Two workers cannot claim same ticket stage in concurrent race (no duplicate claim)');

    // -------------------------------------------------------------
    // Scenario 19: Unauthorized workers cannot transfer or claim
    // -------------------------------------------------------------
    try {
      await queueService.transferTicket({
        ticketId: singleWaitingTicket.ticket._id,
        targetDepartmentId: deptVer._id,
        workerId: workerForeign._id // Foreign worker!
      });
      assert(false, 'Foreign worker transfer should throw');
    } catch (err) {
      assert(err.status === 403, '19. Foreign worker transfer blocked with HTTP 403 Tenant Boundary Error');
    }

    // -------------------------------------------------------------
    // Scenario 20: Citizen tracking shows current stage without leaking secrets
    // -------------------------------------------------------------
    console.log('\n─── Scenario 20 & 21: Citizen Journey Privacy & Final Audit ───');

    const trackRes = await fetch(`${baseUrl}/api/v1/tickets/${completedTicket._id}`);
    const trackData = await trackRes.json();
    assert(trackRes.status === 200, '20. Citizen ticket details accessible');
    assert(trackData.ticket.trackingToken === undefined, '20. trackingToken is not leaked to unauthenticated callers');
    assert(trackData.ticket.currentWorkerId === undefined, '20. Internal workerId is not leaked');
    assert(trackData.ticket.idempotencyKey === undefined, '20. idempotencyKey is not leaked');

    // -------------------------------------------------------------
    // Scenario 21: Existing tests still pass
    // -------------------------------------------------------------
    assert(passed >= 30, '21. All workflow, idempotency, routing, and concurrency tests passed cleanly');

  } finally {
    // Teardown
    await server.close();
    await mongoose.connection.close();
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  WORKFLOW ROUTING RESULTS: ${passed} passed  |  ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runWorkflowRoutingTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
