import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VALID_DEPTS,
  csvSafe,
  exportToCSV,
  parseRoster,
  calculateCapacity,
  validateInputs,
  filterPlan,
  assertPlanInvariants,
} from '../src/utils.js';

test('csvSafe escapes formula injection characters', () => {
  assert.equal(csvSafe('=cmd|'), "'=cmd|");
  assert.equal(csvSafe('+123'), "'+123");
  assert.equal(csvSafe('-50'), "'-50");
  assert.equal(csvSafe('@SUM'), "'@SUM");
  assert.equal(csvSafe('\t24001'), "'\t24001");
  assert.equal(csvSafe('24001'), '24001');
  assert.equal(csvSafe('Hello, world'), '"Hello, world"');
  assert.equal(csvSafe('Line\nNext'), '"Line\nNext"');
  assert.equal(csvSafe('Say "Hi"'), '"Say ""Hi"""');
});

test('parseRoster parses various formats', () => {
  const input = `
    24001, CSE
    24002  CE
    24003; ECS
    24004\tMECH
  `;
  const parsed = parseRoster(input);
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed[0], { roll: '24001', dept: 'CSE' });
  assert.deepEqual(parsed[1], { roll: '24002', dept: 'CE' });
  assert.deepEqual(parsed[2], { roll: '24003', dept: 'ECS' });
  assert.deepEqual(parsed[3], { roll: '24004', dept: 'MECH' });
});

test('calculateCapacity calculates correctly', () => {
  const rooms = [
    { rows: 2, benches: 3, perBench: 2 }, // 12
    { rows: 3, benches: 2, perBench: 1 }, // 6
  ];
  assert.equal(calculateCapacity(rooms), 18);
});

test('validateInputs blocks invalid inputs', () => {
  // Empty workspace
  assert.match(
    validateInputs({ rooms: [], students: [], capacity: 0 })[0],
    /at least one classroom/i
  );

  // Missing room number
  const r1 = [{ number: '', rows: 2, benches: 2, perBench: 2 }];
  const s1 = [{ roll: '24001', dept: 'CSE' }];
  assert.match(
    validateInputs({ rooms: r1, students: s1, capacity: 8 })[0],
    /missing a room identifier/i
  );

  // Duplicate room numbers
  const r2 = [
    { number: 'R101', rows: 2, benches: 2, perBench: 1 },
    { number: 'R101', rows: 2, benches: 2, perBench: 1 },
  ];
  assert.match(
    validateInputs({ rooms: r2, students: s1, capacity: 8 })[0],
    /unique identifier/i
  );

  // Invalid department
  const r3 = [{ number: 'R101', rows: 2, benches: 2, perBench: 1 }];
  const s3 = [{ roll: '24001', dept: 'PHYSICS' }];
  assert.match(
    validateInputs({ rooms: r3, students: s3, capacity: 4 })[0],
    /invalid entries/i
  );

  // Duplicate roll numbers
  const s4 = [
    { roll: '24001', dept: 'CSE' },
    { roll: '24001', dept: 'CE' },
  ];
  assert.match(
    validateInputs({ rooms: r3, students: s4, capacity: 4 })[0],
    /duplicate roll numbers/i
  );

  // Capacity overflow
  const s5 = [
    { roll: '24001', dept: 'CSE' },
    { roll: '24002', dept: 'CE' },
    { roll: '24003', dept: 'ECS' },
  ];
  const rShort = [{ number: 'R101', rows: 1, benches: 1, perBench: 1 }];
  assert.match(
    validateInputs({ rooms: rShort, students: s5, capacity: 1 })[0],
    /insufficient capacity/i
  );

  // Formula injection attempts
  const sFormula = [{ roll: '=cmd', dept: 'CSE' }];
  assert.match(
    validateInputs({ rooms: r3, students: sFormula, capacity: 4 })[0],
    /cannot start with/i
  );
});

test('validateInputs passes for clean inputs', () => {
  const rooms = [{ number: 'R101', rows: 2, benches: 2, perBench: 2 }];
  const students = [
    { roll: '24001', dept: 'CSE' },
    { roll: '24002', dept: 'CE' },
  ];
  const errors = validateInputs({ rooms, students, capacity: 8 });
  assert.equal(errors.length, 0);
});

test('filterPlan filters by classroom and query', () => {
  const plan = [
    { roll: '24001', dept: 'CSE', room: 'R101', row: '1', bench: '1', seat: '1' },
    { roll: '24002', dept: 'CE', room: 'R102', row: '1', bench: '1', seat: '1' },
    { roll: '24003', dept: 'ECS', room: 'R101', row: '1', bench: '2', seat: '1' },
  ];

  // All rooms, no query
  assert.equal(filterPlan(plan, '', '').length, 3);

  // Filter by room
  assert.equal(filterPlan(plan, 'R101', '').length, 2);
  assert.equal(filterPlan(plan, 'R102', '').length, 1);

  // Search query (case insensitive)
  assert.equal(filterPlan(plan, '', 'cse').length, 1);
  assert.equal(filterPlan(plan, '', '24002').length, 1);
  assert.equal(filterPlan(plan, 'R101', 'ce').length, 0); // 24002 CE is in R102
});

test('exportToCSV generates safe RFC-4180 output', () => {
  const plan = [
    { roll: '24001', dept: 'CSE', room: 'R101', row: '1', bench: '1', seat: '1' },
    { roll: '24002', dept: 'CE', room: 'R101', row: '1', bench: '1', seat: '2' },
  ];
  const csv = exportToCSV(plan);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'roll,department,classroom,row,bench,seat');
  assert.equal(lines[1], '24001,CSE,R101,1,1,1');
  assert.equal(lines[2], '24002,CE,R101,1,1,2');
});

test('assertPlanInvariants verifies all conditions', () => {
  const students = [
    { roll: '24001', dept: 'CSE' },
    { roll: '24002', dept: 'CE' },
  ];
  const rooms = [{ number: 'R101', rows: 2, benches: 2, perBench: 2 }];
  const validPlan = [
    { roll: '24001', dept: 'CSE', room: 'R101', row: '1', bench: '1', seat: '1' },
    { roll: '24002', dept: 'CE', room: 'R101', row: '1', bench: '1', seat: '2' },
  ];

  assert.equal(assertPlanInvariants(validPlan, students, rooms), true);

  // Invariant failure: missing student
  assert.throws(
    () => assertPlanInvariants([validPlan[0]], students, rooms),
    /does not match roster count/
  );

  // Invariant failure: altered department
  const badDeptPlan = [
    { roll: '24001', dept: 'MECH', room: 'R101', row: '1', bench: '1', seat: '1' },
    { roll: '24002', dept: 'CE', room: 'R101', row: '1', bench: '1', seat: '2' },
  ];
  assert.throws(
    () => assertPlanInvariants(badDeptPlan, students, rooms),
    /department was altered/
  );

  // Invariant failure: duplicate seat booking
  const dupeSeatPlan = [
    { roll: '24001', dept: 'CSE', room: 'R101', row: '1', bench: '1', seat: '1' },
    { roll: '24002', dept: 'CE', room: 'R101', row: '1', bench: '1', seat: '1' },
  ];
  assert.throws(
    () => assertPlanInvariants(dupeSeatPlan, students, rooms),
    /allocated more than once/
  );

  // Invariant failure: out-of-bounds seat
  const oobPlan = [
    { roll: '24001', dept: 'CSE', room: 'R101', row: '5', bench: '1', seat: '1' },
    { roll: '24002', dept: 'CE', room: 'R101', row: '1', bench: '1', seat: '2' },
  ];
  assert.throws(
    () => assertPlanInvariants(oobPlan, students, rooms),
    /out of bounds/
  );
});
