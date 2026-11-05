#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_SEATS 4000
#define MAX_ROOMS 100
#define MAX_STUDENTS 4000
#define TEXT_LEN 64

struct Room {
    char number[TEXT_LEN];
    int rows;
    int benches;
    int per_bench;
    int start;
    int capacity;
};

struct Seat {
    int room;
    int row;
    int bench;
    int position;
    int degree;
    int neighbors[6];
};

struct Student {
    char roll[TEXT_LEN];
    char dept[TEXT_LEN];
};

struct HeapItem {
    int room;
    int capacity;
};

/* Max-heap push: inserts an item into the capacity heap */
static void push(struct HeapItem heap[], int *size, struct HeapItem item) {
    int i = (*size)++;
    while (i > 0 && heap[(i - 1) / 2].capacity < item.capacity) {
        heap[i] = heap[(i - 1) / 2];
        i = (i - 1) / 2;
    }
    heap[i] = item;
}

/* Max-heap pop: extracts the item with highest capacity */
static struct HeapItem pop(struct HeapItem heap[], int *size) {
    struct HeapItem top = heap[0];
    struct HeapItem last = heap[--(*size)];
    int i = 0;
    while (2 * i + 1 < *size) {
        int c = 2 * i + 1;
        if (c + 1 < *size && heap[c + 1].capacity > heap[c].capacity) {
            c++;
        }
        if (heap[c].capacity <= last.capacity) {
            break;
        }
        heap[i] = heap[c];
        i = c;
    }
    if (*size > 0) {
        heap[i] = last;
    }
    return top;
}

/* Safe multiplication: returns 0 on success, 1 on integer overflow. */
static int safe_mul(int a, int b, int *out) {
    if (a > 0 && b > 0 && a > 2147483647 / b) {
        return 1;
    }
    *out = a * b;
    return 0;
}

/* Validate a text field (room number, roll number, department code):
   - Non-empty
   - No formula injection prefixes (=, +, -, @)
   - No control characters (\t, \r, \n) or commas
   Returns 0 if valid, 1 if rejected. */
static int validate_text(const char *s) {
    if (!s || s[0] == '\0') {
        return 1;
    }
    /* Reject leading formula injection characters */
    if (s[0] == '=' || s[0] == '+' || s[0] == '-' || s[0] == '@') {
        return 1;
    }
    /* Reject control characters and CSV delimiters */
    for (const char *p = s; *p; p++) {
        if (*p == '\t' || *p == '\r' || *p == '\n' || *p == ',') {
            return 1;
        }
    }
    return 0;
}

/* Check if department is one of the four allowed codes */
static int is_valid_dept(const char *dept) {
    if (!dept) return 0;
    return (strcmp(dept, "CE") == 0 ||
            strcmp(dept, "CSE") == 0 ||
            strcmp(dept, "ECS") == 0 ||
            strcmp(dept, "MECH") == 0);
}

/* Department index mapper */
static int get_dept_index(const char *d) {
    if (strcmp(d, "CE") == 0) return 0;
    if (strcmp(d, "CSE") == 0) return 1;
    if (strcmp(d, "ECS") == 0) return 2;
    return 3;
}

/* Count how many benches have not yet been assigned */
static int count_unused_benches(const int bench_used[], int bench_count) {
    int count = 0;
    for (int bi = 0; bi < bench_count; bi++) {
        if (!bench_used[bi]) count++;
    }
    return count;
}

/* Helper to find best partner for student `first_student` on a 2-seat bench */
static int find_partner(const struct Student students[], const int student_assigned[],
                        int student_count, int first_student, int current_policy) {
    int first_dept = get_dept_index(students[first_student].dept);

    if (current_policy == 1 || current_policy == 3) {
        /* Same department preference */
        for (int s = 0; s < student_count; s++) {
            if (!student_assigned[s] && s != first_student) {
                if (strcmp(students[s].dept, students[first_student].dept) == 0) {
                    return s;
                }
            }
        }
        return -1; /* No same-dept partner found */
    }

    if (current_policy == 2 || current_policy == 4) {
        /* Different department preference:
           Greedily pick from the department that has the HIGHEST unassigned count
           among departments different from `first_dept`. This prevents stranding
           the largest remaining department. */
        int dept_counts[4] = {0};
        for (int s = 0; s < student_count; s++) {
            if (!student_assigned[s] && s != first_student) {
                dept_counts[get_dept_index(students[s].dept)]++;
            }
        }
        int best_dept = -1;
        int max_c = 0;
        for (int d = 0; d < 4; d++) {
            if (d != first_dept && dept_counts[d] > max_c) {
                max_c = dept_counts[d];
                best_dept = d;
            }
        }
        if (best_dept >= 0) {
            for (int s = 0; s < student_count; s++) {
                if (!student_assigned[s] && s != first_student &&
                    get_dept_index(students[s].dept) == best_dept) {
                    return s;
                }
            }
        }
        return -1; /* No diff-dept partner found */
    }

    /* Policy 0: no department rule, pick next unassigned */
    for (int s = 0; s < student_count; s++) {
        if (!student_assigned[s] && s != first_student) {
            return s;
        }
    }
    return -1;
}

int main(void) {
    struct Room rooms[MAX_ROOMS];
    struct Student students[MAX_STUDENTS];
    struct Seat seats[MAX_SEATS];
    struct HeapItem heap[MAX_ROOMS], ordered[MAX_ROOMS];
    int room_count = 0, student_count = 0, policy = 0;
    int seat_count = 0, heap_size = 0;

    /* 1. Parse and validate room count */
    if (scanf("%d", &room_count) != 1 || room_count < 1 || room_count > MAX_ROOMS) {
        fprintf(stderr, "error: invalid room count (must be 1-%d)\n", MAX_ROOMS);
        return 1;
    }

    /* 2. Parse and validate each room */
    for (int r = 0; r < room_count; r++) {
        if (scanf("%63s %d %d %d", rooms[r].number, &rooms[r].rows, &rooms[r].benches, &rooms[r].per_bench) != 4) {
            fprintf(stderr, "error: failed to read room %d specification\n", r + 1);
            return 1;
        }
        if (rooms[r].rows < 1 || rooms[r].rows > 100) {
            fprintf(stderr, "error: room '%s' rows must be 1-100\n", rooms[r].number);
            return 1;
        }
        if (rooms[r].benches < 1 || rooms[r].benches > 100) {
            fprintf(stderr, "error: room '%s' benches per row must be 1-100\n", rooms[r].number);
            return 1;
        }
        if (rooms[r].per_bench != 1 && rooms[r].per_bench != 2) {
            fprintf(stderr, "error: room '%s' seats per bench must be 1 or 2\n", rooms[r].number);
            return 1;
        }
        if (validate_text(rooms[r].number)) {
            fprintf(stderr, "error: room '%s' contains invalid characters or formula prefix\n", rooms[r].number);
            return 1;
        }

        /* Safe capacity calculation */
        int rb, cap;
        if (safe_mul(rooms[r].rows, rooms[r].benches, &rb) || safe_mul(rb, rooms[r].per_bench, &cap)) {
            fprintf(stderr, "error: room '%s' capacity overflow\n", rooms[r].number);
            return 1;
        }
        rooms[r].start = seat_count;
        rooms[r].capacity = cap;

        if (seat_count + cap > MAX_SEATS) {
            fprintf(stderr, "error: total seats exceed maximum limit of %d\n", MAX_SEATS);
            return 1;
        }

        /* Push to max-heap prioritized by room capacity */
        push(heap, &heap_size, (struct HeapItem){r, rooms[r].capacity});

        /* Build physical seat graph representation for this room */
        for (int row = 0; row < rooms[r].rows; row++) {
            for (int bench = 0; bench < rooms[r].benches; bench++) {
                for (int pos = 0; pos < rooms[r].per_bench; pos++) {
                    int id = seat_count++;
                    seats[id] = (struct Seat){
                        .room = r,
                        .row = row,
                        .bench = bench,
                        .position = pos,
                        .degree = 0,
                    };
                    /* Edges to adjacent seats in adjacent rows */
                    if (row > 0) {
                        seats[id].neighbors[seats[id].degree++] = id - rooms[r].benches * rooms[r].per_bench;
                    }
                    if (row + 1 < rooms[r].rows) {
                        seats[id].neighbors[seats[id].degree++] = id + rooms[r].benches * rooms[r].per_bench;
                    }
                    /* Edges to adjacent benches in same row */
                    if (bench > 0) {
                        seats[id].neighbors[seats[id].degree++] = id - rooms[r].per_bench;
                    }
                    if (bench + 1 < rooms[r].benches) {
                        seats[id].neighbors[seats[id].degree++] = id + rooms[r].per_bench;
                    }
                    /* Edges to neighbor on same bench */
                    if (pos > 0) {
                        seats[id].neighbors[seats[id].degree++] = id - 1;
                    }
                    if (pos + 1 < rooms[r].per_bench) {
                        seats[id].neighbors[seats[id].degree++] = id + 1;
                    }
                }
            }
        }
    }

    /* Check for duplicate room numbers */
    for (int i = 0; i < room_count; i++) {
        for (int j = i + 1; j < room_count; j++) {
            if (strcmp(rooms[i].number, rooms[j].number) == 0) {
                fprintf(stderr, "error: duplicate room number '%s'\n", rooms[i].number);
                return 1;
            }
        }
    }

    /* 3. Parse student count and department policy
       Policies:
       0 = No preference
       1 = Strict same department (fail if violation unavoidable)
       2 = Strict different departments (fail if violation unavoidable)
       3 = Best-effort same department (fallback if match unavailable)
       4 = Best-effort different departments (fallback if match unavailable) */
    if (scanf("%d %d", &student_count, &policy) != 2 ||
        student_count < 1 || student_count > MAX_STUDENTS ||
        student_count > seat_count || policy < 0 || policy > 4) {
        fprintf(stderr, "error: invalid student count (1-%d, <= %d seats) or policy (0-4)\n",
                MAX_STUDENTS, seat_count);
        return 1;
    }

    /* 4. Parse students */
    for (int i = 0; i < student_count; i++) {
        if (scanf("%63s %63s", students[i].roll, students[i].dept) != 2) {
            fprintf(stderr, "error: failed to read student %d\n", i + 1);
            return 1;
        }
        if (validate_text(students[i].roll)) {
            fprintf(stderr, "error: student roll '%s' contains invalid characters or formula prefix\n", students[i].roll);
            return 1;
        }
        if (!is_valid_dept(students[i].dept)) {
            fprintf(stderr, "error: student '%s' has invalid department '%s'; expected CE, CSE, ECS, or MECH\n",
                    students[i].roll, students[i].dept);
            return 1;
        }
    }

    /* Check for duplicate roll numbers */
    for (int i = 0; i < student_count; i++) {
        for (int j = i + 1; j < student_count; j++) {
            if (strcmp(students[i].roll, students[j].roll) == 0) {
                fprintf(stderr, "error: duplicate roll number '%s'\n", students[i].roll);
                return 1;
            }
        }
    }

    /* 5. Breadth-First Search (BFS) on the seat graph.
       Each bench is collected once in graph traversal order. */
    int visited[MAX_SEATS] = {0};
    int queue[MAX_SEATS];
    int bench_order[MAX_SEATS];
    int bench_room[MAX_SEATS];
    int bench_count = 0;

    for (int room = 0; room < room_count; room++) {
        int first = rooms[room].start;
        int head = 0, tail = 0;
        visited[first] = 1;
        queue[tail++] = first;

        while (head < tail) {
            int cur = queue[head++];
            int bench_base = cur - seats[cur].position;
            int already_recorded = 0;
            for (int i = 0; i < bench_count; i++) {
                if (bench_order[i] == bench_base) {
                    already_recorded = 1;
                    break;
                }
            }
            if (!already_recorded) {
                bench_order[bench_count] = bench_base;
                bench_room[bench_count++] = room;
            }
            for (int n = 0; n < seats[cur].degree; n++) {
                int next = seats[cur].neighbors[n];
                if (!visited[next] && seats[next].room == room) {
                    visited[next] = 1;
                    queue[tail++] = next;
                }
            }
        }
    }

    /* 6. Extract classrooms from max capacity heap in descending capacity order */
    int heap_n = heap_size;
    for (int i = 0; i < heap_n; i++) {
        ordered[i] = pop(heap, &heap_size);
    }

    /* 7. Allocation state */
    int assigned_count = 0;
    int student_assigned[MAX_STUDENTS] = {0};
    int seat_student[MAX_SEATS];
    for (int i = 0; i < MAX_SEATS; i++) seat_student[i] = -1;
    int bench_used[MAX_SEATS] = {0};

    /* Primary allocation pass:
       Iterate through rooms in capacity-heap order, assigning benches in BFS order. */
    int next_student = 0;
    while (assigned_count < student_count) {
        int progressed = 0;
        for (int oi = 0; oi < heap_n && assigned_count < student_count; oi++) {
            int room = ordered[oi].room;
            int bi = 0;
            while (bi < bench_count && (bench_room[bi] != room || bench_used[bi])) {
                bi++;
            }
            if (bi == bench_count) continue;

            bench_used[bi] = 1;
            progressed = 1;

            /* Find next unassigned student for seat 0 */
            while (next_student < student_count && student_assigned[next_student]) {
                next_student++;
            }
            if (next_student >= student_count) break;

            int first_student = next_student++;
            student_assigned[first_student] = 1;
            assigned_count++;
            int base = bench_order[bi];
            seat_student[base] = first_student;

            /* If bench has 2 seats and there are more students to assign */
            if (rooms[room].per_bench == 2 && assigned_count < student_count) {
                int partner = -1;
                if (policy == 0) {
                    partner = find_partner(students, student_assigned, student_count, first_student, 0);
                } else {
                    partner = find_partner(students, student_assigned, student_count, first_student, policy);
                }

                if (partner >= 0) {
                    student_assigned[partner] = 1;
                    assigned_count++;
                    seat_student[base + 1] = partner;
                } else {
                    /* Partner matching policy was not found. */
                    if (policy == 3 || policy == 4) {
                        /* Best-effort fallback:
                           Only pair an incompatible student if remaining empty benches
                           cannot accommodate the remaining students sitting alone. */
                        int remaining_students = student_count - assigned_count;
                        int unused_benches = count_unused_benches(bench_used, bench_count);
                        if (unused_benches < remaining_students) {
                            /* Must pair to avoid running out of benches */
                            for (int s = 0; s < student_count; s++) {
                                if (!student_assigned[s]) {
                                    partner = s;
                                    break;
                                }
                            }
                            if (partner >= 0) {
                                student_assigned[partner] = 1;
                                assigned_count++;
                                seat_student[base + 1] = partner;
                            }
                        }
                        /* Otherwise, leave seat 1 empty so students can have their own bench! */
                    }
                    /* For strict policy (1 or 2): do NOT place an incompatible partner.
                       Leave seat 1 empty so the student sits alone. */
                }
            }
        }
        if (!progressed) break;
    }

    /* Secondary pass:
       If any students remain unassigned, place them in any remaining empty seats. */
    if (assigned_count < student_count) {
        for (int bi = 0; bi < bench_count && assigned_count < student_count; bi++) {
            int base = bench_order[bi];
            int room = bench_room[bi];
            for (int pos = 0; pos < rooms[room].per_bench && assigned_count < student_count; pos++) {
                if (seat_student[base + pos] < 0) {
                    /* Find partner or next student */
                    int candidate = -1;
                    if (pos == 1 && seat_student[base] >= 0) {
                        /* Second seat on a bench where seat 0 is already occupied */
                        int s0 = seat_student[base];
                        if (policy == 1) {
                            /* Strict same department */
                            for (int s = 0; s < student_count; s++) {
                                if (!student_assigned[s] && strcmp(students[s].dept, students[s0].dept) == 0) {
                                    candidate = s;
                                    break;
                                }
                            }
                        } else if (policy == 2) {
                            /* Strict different departments */
                            for (int s = 0; s < student_count; s++) {
                                if (!student_assigned[s] && strcmp(students[s].dept, students[s0].dept) != 0) {
                                    candidate = s;
                                    break;
                                }
                            }
                        } else {
                            /* Policy 0, 3, or 4: any available */
                            for (int s = 0; s < student_count; s++) {
                                if (!student_assigned[s]) {
                                    candidate = s;
                                    break;
                                }
                            }
                        }
                    } else {
                        /* Empty bench or seat 0: any available */
                        for (int s = 0; s < student_count; s++) {
                            if (!student_assigned[s]) {
                                candidate = s;
                                break;
                            }
                        }
                    }

                    if (candidate >= 0) {
                        seat_student[base + pos] = candidate;
                        student_assigned[candidate] = 1;
                        assigned_count++;
                    }
                }
            }
        }
    }

    /* 8. Verify all allocation invariants */

    /* Invariant: Total assigned count must equal accepted student roster count */
    if (assigned_count != student_count) {
        if (policy == 1) {
            fprintf(stderr, "error: cannot satisfy same-department policy: roster counts require mixing departments on two-seat benches\n");
        } else if (policy == 2) {
            fprintf(stderr, "error: cannot satisfy different-departments policy: roster counts require pairing students of the same department\n");
        } else {
            fprintf(stderr, "error: only %d of %d students could be seated\n", assigned_count, student_count);
        }
        return 1;
    }

    /* Invariant: Each student must be assigned exactly once */
    for (int s = 0; s < student_count; s++) {
        if (!student_assigned[s]) {
            fprintf(stderr, "error: student '%s' was not assigned a seat\n", students[s].roll);
            return 1;
        }
    }

    /* Invariant: Policy satisfaction check on every 2-seat bench */
    for (int bi = 0; bi < bench_count; bi++) {
        int base = bench_order[bi];
        int room = bench_room[bi];
        if (rooms[room].per_bench == 2) {
            int s0 = seat_student[base];
            int s1 = seat_student[base + 1];
            if (s0 >= 0 && s1 >= 0) {
                int same = (strcmp(students[s0].dept, students[s1].dept) == 0);
                if (policy == 1 && !same) {
                    fprintf(stderr, "error: strict same-department policy violated on bench %d in room '%s'\n",
                            seats[base].bench + 1, rooms[room].number);
                    return 1;
                }
                if (policy == 2 && same) {
                    fprintf(stderr, "error: strict different-departments policy violated on bench %d in room '%s'\n",
                            seats[base].bench + 1, rooms[room].number);
                    return 1;
                }
            }
        }
    }

    /* 9. Output CSV format */
    puts("roll,department,classroom,row,bench,seat");
    int output_count = 0;
    for (int i = 0; i < seat_count; i++) {
        if (seat_student[i] >= 0) {
            struct Seat s = seats[i];
            struct Room r = rooms[s.room];
            struct Student st = students[seat_student[i]];
            printf("%s,%s,%s,%d,%d,%d\n", st.roll, st.dept, r.number, s.row + 1, s.bench + 1, s.position + 1);
            output_count++;
        }
    }

    /* Invariant: Output line count must equal student count */
    if (output_count != student_count) {
        fprintf(stderr, "error: output %d rows but expected %d\n", output_count, student_count);
        return 1;
    }

    return 0;
}
