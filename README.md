# Seatwise

Seatwise includes a browser-based seating dashboard built with plain HTML, CSS, and JavaScript, plus a standalone C11 command-line allocator. The dashboard runs locally in your browser without React, Vite, Node.js, or a backend server.

## Browser dashboard

Open `index.html` in a browser. Add classrooms, paste a roster, choose a pairing policy, and select **Generate seating plan**. Use the search field or classroom tabs to filter the plan, then choose **Export CSV** to download it. **Load demo data** fills the form with a sample setup.

The dashboard performs allocation in JavaScript in the browser. The standalone C allocator remains available for command-line use below.

## Build

Requires a C compiler with C11 support, such as GCC or Clang.

```sh
make
```

Or compile directly:

```sh
gcc -std=c11 -Wall -Wextra -Wpedantic -O2 ds/seating.c -o seatwise
```

On Windows with MinGW GCC, use `make` if GNU Make is installed, or compile to `seatwise.exe` directly.

## Run

The program reads the allocation request from standard input and writes a CSV seating plan to standard output. Save the request in a text file, then run:

```sh
./seatwise < request.txt > seating-plan.csv
```

On Windows:

```powershell
.\seatwise.exe < request.txt > seating-plan.csv
```

Input format:

```text
<room_count>
<room_number> <rows> <benches_per_row> <seats_per_bench>
...
<student_count> <policy_code>
<roll_number> <department_code>
...
```

Example `request.txt`:

```text
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

Departments: `CE`, `CSE`, `ECS`, `MECH`.

Policies:

| Code | Behavior |
| --- | --- |
| 0 | No department preference |
| 1 | Strictly pair students from the same department |
| 2 | Strictly pair students from different departments |
| 3 | Prefer same-department pairs, mixing only when needed |
| 4 | Prefer different-department pairs, matching same departments only when needed |

The CSV output columns are `roll,department,classroom,row,bench,seat`. Errors are written to standard error and return a nonzero exit code.

## Limits and validation

- At most 100 rooms and 4,000 seats/students.
- Each room supports 1–100 rows, 1–100 benches per row, and one or two seats per bench.
- Room IDs and roll numbers must be unique and cannot contain commas, control characters, or spreadsheet formula prefixes.
- Student rolls must be unique, and each department must be one of the supported codes.
