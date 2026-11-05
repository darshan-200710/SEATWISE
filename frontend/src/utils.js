/**
 * Seatwise Frontend Utility Functions
 * Contains pure functions for validation, roster parsing, CSV generation,
 * filtering, and invariant checks.
 */

export const VALID_DEPTS = ['CE', 'CSE', 'ECS', 'MECH'];
export const MAX_SEATS = 4000;
export const MAX_ROOMS = 100;
export const MAX_STUDENTS = 4000;

/**
 * Escape a CSV field to prevent formula injection in spreadsheet software.
 * Prepends a single quote if the field begins with =, +, -, @, \t, or \r.
 * Wraps in quotes and escapes internal quotes if comma, newline, or quote is present.
 */
export function csvSafe(value) {
  let v = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(v)) {
    v = "'" + v;
  }
  if (/[",\n\r]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

/**
 * Format a seating plan array into a RFC-4180-compliant, formula-injection-safe CSV string.
 */
export function exportToCSV(plan) {
  const header = 'roll,department,classroom,row,bench,seat';
  const rows = plan.map((p) =>
    [p.roll, p.dept, p.room, p.row, p.bench, p.seat].map(csvSafe).join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * Parse student roster text into structured array of { roll, dept }.
 * Trims whitespace and handles common separators (comma, semicolon, space, tab).
 */
export function parseRoster(text) {
  if (!text || !text.trim()) return [];
  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Split on comma, semicolon, tab, or space
      const parts = line.split(/[\s,;]+/).filter(Boolean);
      const roll = (parts[0] || '').trim();
      const dept = (parts[1] || '').trim().toUpperCase();
      return { roll, dept };
    });
}

/**
 * Calculate total capacity across all classroom configurations.
 */
export function calculateCapacity(rooms) {
  return rooms.reduce((sum, r) => {
    const rows = Number(r.rows) || 0;
    const benches = Number(r.benches) || 0;
    const perBench = Number(r.perBench) || 0;
    return sum + rows * benches * perBench;
  }, 0);
}

/**
 * Comprehensive client-side validation.
 * Returns array of error strings. Empty array means validation passed.
 */
export function validateInputs({ rooms, students, capacity }) {
  const errors = [];

  if (!rooms || rooms.length === 0) {
    errors.push('Add at least one classroom layout.');
  } else if (rooms.length > MAX_ROOMS) {
    errors.push(`At most ${MAX_ROOMS} classrooms are supported.`);
  }

  const roomNames = [];
  const unsafePattern = /^[=+\-@\t\r]|[\t\r\n,]/;

  for (let i = 0; i < (rooms || []).length; i++) {
    const r = rooms[i];
    const num = (r.number || '').trim();
    if (!num) {
      errors.push(`Classroom ${i + 1} is missing a room identifier.`);
    } else {
      if (unsafePattern.test(num)) {
        errors.push(`Classroom "${num}" contains formula characters or commas.`);
      }
      roomNames.push(num);
    }
    const rows = Number(r.rows);
    const benches = Number(r.benches);
    const perBench = Number(r.perBench);

    if (!Number.isInteger(rows) || rows < 1 || rows > 100) {
      errors.push(`Classroom "${num || i + 1}": rows must be an integer between 1 and 100.`);
    }
    if (!Number.isInteger(benches) || benches < 1 || benches > 100) {
      errors.push(`Classroom "${num || i + 1}": benches per row must be an integer between 1 and 100.`);
    }
    if (![1, 2].includes(perBench)) {
      errors.push(`Classroom "${num || i + 1}": seats per bench must be 1 or 2.`);
    }
  }

  // Duplicate room numbers
  const uniqueRooms = new Set(roomNames);
  if (uniqueRooms.size !== roomNames.length) {
    errors.push('Each classroom must have a unique identifier.');
  }

  // Capacity limit
  if (capacity > MAX_SEATS) {
    errors.push(`Total capacity (${capacity}) exceeds the ${MAX_SEATS}-seat system limit.`);
  }

  // Student checks
  if (!students || students.length === 0) {
    errors.push('Add at least one student to the roster.');
  } else if (students.length > MAX_STUDENTS) {
    errors.push(`Roster exceeds maximum allowed student count of ${MAX_STUDENTS}.`);
  } else {
    const invalidStudents = students.filter(
      (s) => !s.roll || !VALID_DEPTS.includes(s.dept) || unsafePattern.test(s.roll)
    );
    if (invalidStudents.length > 0) {
      errors.push(
        `${invalidStudents.length} student(s) have invalid entries. Roll numbers cannot start with =, +, -, @, and department must be one of: ${VALID_DEPTS.join(', ')}.`
      );
    }

    // Duplicate rolls
    const seenRolls = new Set();
    const dups = [];
    for (const s of students) {
      if (s.roll) {
        if (seenRolls.has(s.roll)) {
          dups.push(s.roll);
        }
        seenRolls.add(s.roll);
      }
    }
    if (dups.length > 0) {
      const sample = dups.slice(0, 3).join(', ');
      errors.push(`Duplicate roll numbers detected: ${sample}${dups.length > 3 ? '…' : ''}.`);
    }

    // Capacity overflow
    if (students.length > capacity && capacity > 0) {
      errors.push(
        `Insufficient capacity: roster has ${students.length} students but only ${capacity} seats are configured (need ${students.length - capacity} more).`
      );
    }
  }

  return errors;
}

/**
 * Filter the seating plan by selected classroom tab and query string.
 */
export function filterPlan(plan, activeRoom, query) {
  if (!plan) return [];
  const q = (query || '').trim().toLowerCase();
  return plan.filter((p) => {
    if (activeRoom && p.room !== activeRoom) {
      return false;
    }
    if (!q) return true;
    return (
      p.roll.toLowerCase().includes(q) ||
      p.dept.toLowerCase().includes(q) ||
      p.room.toLowerCase().includes(q)
    );
  });
}

/**
 * Verify client-side invariants on generated plan.
 */
export function assertPlanInvariants(plan, expectedStudents, rooms) {
  if (!Array.isArray(plan)) throw new Error('Plan is not an array');
  if (plan.length !== expectedStudents.length) {
    throw new Error(
      `Assigned count (${plan.length}) does not match roster count (${expectedStudents.length})`
    );
  }

  const studentMap = new Map(expectedStudents.map((s) => [s.roll, s.dept]));
  const seenRolls = new Set();
  const seenSeats = new Set();
  const roomMap = new Map(rooms.map((r) => [r.number, r]));

  for (const item of plan) {
    if (!item.roll || !item.dept || !item.room) {
      throw new Error('Malformed plan entry missing required fields');
    }

    // Invariant: Student exists in roster
    if (!studentMap.has(item.roll)) {
      throw new Error(`Plan contains unknown student roll '${item.roll}'`);
    }

    // Invariant: Department unchanged
    if (studentMap.get(item.roll) !== item.dept) {
      throw new Error(`Student '${item.roll}' department was altered`);
    }

    // Invariant: No duplicate student assignment
    if (seenRolls.has(item.roll)) {
      throw new Error(`Student '${item.roll}' was assigned to multiple seats`);
    }
    seenRolls.add(item.roll);

    // Invariant: Room exists
    const room = roomMap.get(item.room);
    if (!room) {
      throw new Error(`Student assigned to nonexistent room '${item.room}'`);
    }

    // Invariant: Seat coordinates within bounds
    const row = Number(item.row);
    const bench = Number(item.bench);
    const seat = Number(item.seat);

    if (row < 1 || row > Number(room.rows)) {
      throw new Error(`Row ${row} out of bounds for room '${item.room}'`);
    }
    if (bench < 1 || bench > Number(room.benches)) {
      throw new Error(`Bench ${bench} out of bounds for room '${item.room}'`);
    }
    if (seat < 1 || seat > Number(room.perBench)) {
      throw new Error(`Seat ${seat} out of bounds for room '${item.room}'`);
    }

    // Invariant: No seat double-booking
    const seatKey = `${item.room}:${row}:${bench}:${seat}`;
    if (seenSeats.has(seatKey)) {
      throw new Error(`Seat ${seatKey} was allocated more than once`);
    }
    seenSeats.add(seatKey);
  }

  return true;
}
