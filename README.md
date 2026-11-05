# Seatwise — Exam Hall Seating Arrangement

Seatwise is a data-structures project for generating, visualizing, and exporting examination seating plans. It pairs a modern React administrative dashboard with a high-performance Rust HTTP server and a C allocator utilizing a seat graph/BFS, queue, and classroom capacity max-heap.

---

## Architecture & Data Structures

```
[ React + Vite Dashboard ] ──(HTTP POST /api/allocate)──> [ Rust HTTP Daemon ] ──(Piped I/O)──> [ C Allocator (ds/seating) ]
   - Form state & live preview                                - Loopback bound (:8080)              - Max-Heap (Capacity)
   - Client-side invariant checks                              - Request bounds & timeouts           - Graph + BFS (Seat traversal)
   - Safe CSV export                                          - Server-side validation              - Student Queue
```

### Data Structure Roles

1. **Max Capacity Heap:**
   - Classrooms are pushed onto a max-heap keyed by total capacity (`rows × benches × seats_per_bench`).
   - The heap prioritizes larger examination halls first during multi-room allocation passes.

2. **Seat Graph & Breadth-First Search (BFS):**
   - Each physical seat is modeled as a vertex in an adjacency graph with edges connecting:
     - Adjacent benches in the same row
     - Adjacent rows in the same classroom
     - Sibling seats on the same bench
   - A BFS traversal from the first seat establishes a natural, structured bench-ordering within each hall.

3. **Student Roster Queue:**
   - Student roll numbers are processed in FIFO order from the validated input roster.
   - For two-seat benches, the allocator pairs the initial student with a compatible partner according to the active department policy.

4. **Greedy Most-Constrained-First Department Matching:**
   - Under the "Different departments" policy, candidate partners are selected from the department with the highest remaining unassigned student count. This prevents stranding students of the largest department together on final benches.

---

## Seating Invariants

Seatwise formally guarantees the following invariants on every allocation:

1. **Roster Completeness:** Every student in the input roster appears exactly once in the generated seating plan.
2. **No Double-Booking:** Each physical seat is allocated to at most one student.
3. **Capacity Adherence:** No bench exceeds its configured capacity of 1 or 2 seats.
4. **Boundary Integrity:** No student is placed in a nonexistent classroom, row, bench, or seat index.
5. **Department Preservation:** Students are never reassigned to an unintended department code.
6. **Explicit Policy Enforcement:**
   - **No preference (Policy 0):** Students fill benches sequentially in graph traversal order.
   - **Same department (Strict, Policy 1):** Every shared bench contains students belonging to the identical department. If impossible for the given roster, the allocator halts with an error.
   - **Different departments (Strict, Policy 2):** Every shared bench contains students from differing departments. If impossible, the allocator halts with an error.
   - **Same department (Fallback, Policy 3):** Prioritizes same-department pairing, leaving students alone on a bench when capacity permits, and only mixing departments when capacity forces it.
   - **Different departments (Fallback, Policy 4):** Prioritizes different-department pairing, only pairing same-department students if capacity forces it.

---

## Security Model & Hardening

- **Local Scope & Loopback Binding:** The Rust server binds strictly to `127.0.0.1:8080` (configurable via `SEAT_API_ADDR`). It is intended as a local demo tool and should not be exposed to untrusted external networks without authentication.
- **Strict CORS:** Restricted to local Vite development origins (`http://localhost:5173` and `http://127.0.0.1:5173`).
- **CSV Formula Injection Prevention:**
  - In the C allocator and Rust backend, room identifiers and roll numbers starting with `= , + , - , @` or containing control characters (`\t`, `\r`, `\n`) or commas are strictly rejected.
  - In the frontend CSV exporter, all exported cells are escaped (`'=...'`) per RFC 4180 to neutralize spreadsheet formula execution.
- **Resource Protection & DoS Defense:**
  - Request headers capped at 8 KiB (`431 Request Header Fields Too Large`).
  - Request body capped at 256 KiB (`413 Content Too Large`).
  - Strict 10-second socket read/write timeouts.
  - Bounded concurrency capped at 8 simultaneous connections (`503 Service Unavailable`).
- **Privacy & Information Leakage Prevention:**
  - Allocator process stderr is captured internally and logged only on the server; client responses never expose internal filesystem paths, compiler details, or sensitive student rosters.

---

## Input Specification

### Accepted Departments
Only four department codes are accepted:
`CE`, `CSE`, `ECS`, `MECH`

### Protocol Format (`POST /api/allocate`)
```
<room_count>
<room_number> <rows> <benches_per_row> <seats_per_bench>
...
<student_count> <policy_code>
<roll_number> <department_code>
...
```

*Example Request Body:*
```
2
R101 2 2 2
R102 2 1 1
6 1
24001 CSE
24002 CSE
24003 CE
24004 CE
24005 ECS
24006 ECS
```

---

## Running the Application

### Prerequisites
- Node.js (v20+) and npm
- Rust & Cargo
- GCC (C11 support)

### Step 1: Start the Rust API Server
```sh
cd backend
cargo run
```
*The API will listen at `http://127.0.0.1:8080`.*

### Step 2: Start the React Frontend
In a second terminal:
```sh
cd frontend
npm install
npm run dev
```
*Open `http://localhost:5173` in your browser.*

---

## Verification & Test Commands

Every component has automated verification suites. Run these to verify all parts:

### 1. C Allocator Tests
Compiles with strict C11 flags (`-Wall -Wextra -Wpedantic -O2`) and runs the 17-case allocation invariant test suite:
```sh
gcc -std=c11 -Wall -Wextra -Wpedantic -O2 ds/seating.c -o ds/seating.exe
powershell -ExecutionPolicy Bypass -File ds/test_allocator.ps1
```

### 2. Rust Backend Tests & Linting
Runs the 13 backend integration tests, Clippy linter, and formatting checks:
```sh
cd backend
cargo check
cargo test
cargo clippy -- -D warnings
cargo fmt --check
```

### 3. Frontend Tests & Production Build
Runs the frontend unit test suite and Vite production bundle build:
```sh
cd frontend
npm test
npm run build
```
