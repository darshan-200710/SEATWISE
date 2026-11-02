# Seatwise — Exam Hall Seating Arrangement

Seatwise is a data-structures mini project for preparing an exam seating plan. Start with an empty workspace, add classroom layouts, then paste department-tagged student roll numbers. The generated plan can be filtered by classroom or search and exported as CSV.

## Stack

- React + Vite admin panel (`frontend/`)
- Rust HTTP API (`backend/`)
- C seating allocator (`ds/seating.c`), compiled by the Rust build script

## Data structures

- **Graph + BFS:** Each physical seat is a vertex, with edges to neighboring seats/benches in the same classroom. BFS provides the bench traversal order.
- **Queue:** Student roll numbers are consumed once each; an optional department pairing rule can select a compatible second student for a two-seat bench.
- **Max heap:** Classrooms are prioritized by capacity when allocating students.

Each room has a number, rows, benches per row, and either one or two seats per bench. A one-seat bench receives exactly one student; a two-seat bench receives up to two. Department pairing choices are no preference, same department, or different departments. Pairing is best-effort if the requested department match is unavailable.

## Run locally

Requirements: Rust/Cargo, GCC, Node.js, and npm.

Terminal 1 — API:

```sh
cd backend
cargo run
```

Keep this terminal running while using the admin panel.

Terminal 2 — admin panel:

```sh
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite. Vite forwards `/api` requests to the Rust API at `http://127.0.0.1:8080` by default; set `SEAT_API_ADDR` to change the API bind address.

## Use

1. Add, remove, or edit classrooms. Enter a unique classroom number, row count, benches per row, and seats per bench.
2. Paste one student per line as `ROLL, DEPARTMENT`, for example `24001, CSE`.
3. Use one of the department codes `CE`, `CSE`, `ECS`, or `MECH`, then choose the two-seat bench pairing rule.
4. Choose **Generate seating plan**. The roster must contain unique roll numbers and fit the combined capacity.
5. Filter by room or search by roll, department, or classroom; export the complete allocation as CSV.

The API accepts `POST /api/allocate` with plain text in this format: room count; one `room-number rows benches-per-row seats-per-bench` line per room; `student-count department-policy` (`0` no preference, `1` same department, `2` different departments); then one `roll department` line per student. It returns CSV with each student's department, classroom, row, bench, and seat position.

## Reference

The GitHub project supplied by the author was consulted for high-level scope only. Its source files are not part of this implementation. A local clone was attempted, but this environment could not resolve `github.com`.
