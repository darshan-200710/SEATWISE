#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_SEATS 4000
#define MAX_ROOMS 100
#define MAX_STUDENTS 4000
#define TEXT_LEN 64

struct Room { char number[TEXT_LEN]; int rows, benches, per_bench, start, capacity; };
struct Seat { int room, row, bench, position, degree, neighbors[6]; };
struct Student { char roll[TEXT_LEN], dept[TEXT_LEN]; };
struct HeapItem { int room, capacity; };

static void push(struct HeapItem heap[], int *size, struct HeapItem item) {
    int i = (*size)++;
    while (i && heap[(i - 1) / 2].capacity < item.capacity) { heap[i] = heap[(i - 1) / 2]; i = (i - 1) / 2; }
    heap[i] = item;
}
static struct HeapItem pop(struct HeapItem heap[], int *size) {
    struct HeapItem top = heap[0], last = heap[--(*size)]; int i = 0;
    while (2 * i + 1 < *size) { int c = 2 * i + 1; if (c + 1 < *size && heap[c + 1].capacity > heap[c].capacity) c++; if (heap[c].capacity <= last.capacity) break; heap[i] = heap[c]; i = c; }
    if (*size) heap[i] = last;
    return top;
}

int main(void) {
    struct Room rooms[MAX_ROOMS]; struct Student students[MAX_STUDENTS];
    struct Seat seats[MAX_SEATS]; struct HeapItem heap[MAX_ROOMS], ordered[MAX_ROOMS];
    int room_count, student_count, policy, seat_count = 0, heap_size = 0;
    if (scanf("%d", &room_count) != 1 || room_count < 1 || room_count > MAX_ROOMS) return 1;
    for (int r = 0; r < room_count; r++) {
        if (scanf("%63s %d %d %d", rooms[r].number, &rooms[r].rows, &rooms[r].benches, &rooms[r].per_bench) != 4 || rooms[r].rows < 1 || rooms[r].benches < 1 || (rooms[r].per_bench != 1 && rooms[r].per_bench != 2)) return 1;
        rooms[r].start = seat_count; rooms[r].capacity = rooms[r].rows * rooms[r].benches * rooms[r].per_bench;
        if (seat_count + rooms[r].capacity > MAX_SEATS) return 1;
        push(heap, &heap_size, (struct HeapItem){r, rooms[r].capacity});
        for (int row = 0; row < rooms[r].rows; row++) for (int bench = 0; bench < rooms[r].benches; bench++) for (int pos = 0; pos < rooms[r].per_bench; pos++) {
            int id = seat_count++;
            seats[id] = (struct Seat){.room=r, .row=row, .bench=bench, .position=pos, .degree=0};
            if (row > 0) seats[id].neighbors[seats[id].degree++] = id - rooms[r].benches * rooms[r].per_bench;
            if (row + 1 < rooms[r].rows) seats[id].neighbors[seats[id].degree++] = id + rooms[r].benches * rooms[r].per_bench;
            if (bench > 0) seats[id].neighbors[seats[id].degree++] = id - rooms[r].per_bench;
            if (bench + 1 < rooms[r].benches) seats[id].neighbors[seats[id].degree++] = id + rooms[r].per_bench;
            if (pos > 0) seats[id].neighbors[seats[id].degree++] = id - 1;
            if (pos + 1 < rooms[r].per_bench) seats[id].neighbors[seats[id].degree++] = id + 1;
        }
    }
    if (scanf("%d %d", &student_count, &policy) != 2 || student_count < 1 || student_count > MAX_STUDENTS || student_count > seat_count || policy < 0 || policy > 2) return 1;
    for (int i = 0; i < student_count; i++) if (scanf("%63s %63s", students[i].roll, students[i].dept) != 2) return 1;

    /* BFS the classroom seat graph. Each bench is emitted once in graph traversal order. */
    int visited[MAX_SEATS] = {0}, queue[MAX_SEATS], bench_order[MAX_SEATS], bench_room[MAX_SEATS], bench_count = 0;
    for (int room = 0; room < room_count; room++) {
        int first = rooms[room].start, head = 0, tail = 0;
        visited[first] = 1; queue[tail++] = first;
        while (head < tail) {
            int cur = queue[head++];
            int exists = 0;
            for (int i = 0; i < bench_count; i++) if (bench_order[i] == cur - seats[cur].position) { exists = 1; break; }
            if (!exists) { bench_order[bench_count] = cur - seats[cur].position; bench_room[bench_count++] = room; }
            for (int n = 0; n < seats[cur].degree; n++) { int next = seats[cur].neighbors[n]; if (!visited[next] && seats[next].room == room) { visited[next] = 1; queue[tail++] = next; } }
        }
    }
    int heap_n = heap_size; for (int i = 0; i < heap_n; i++) ordered[i] = pop(heap, &heap_size);
    int next_student = 0, assigned_count = 0, student_assigned[MAX_STUDENTS] = {0};
    int seat_student[MAX_SEATS]; for (int i = 0; i < MAX_SEATS; i++) seat_student[i] = -1;
    int bench_used[MAX_SEATS] = {0};
    /* Give each room one bench per pass, with larger rooms considered first by the capacity heap. */
    while (assigned_count < student_count) {
        int progressed = 0;
        for (int oi = 0; oi < heap_n && assigned_count < student_count; oi++) {
            int room = ordered[oi].room, bi = 0;
            while (bi < bench_count && (bench_room[bi] != room || bench_used[bi])) bi++;
            if (bi == bench_count) continue;
            bench_used[bi] = 1; progressed = 1;
            while (next_student < student_count && student_assigned[next_student]) next_student++;
            if (next_student >= student_count) break;
            int first_student = next_student++;
            student_assigned[first_student] = 1; assigned_count++;
            int base = bench_order[bi]; seat_student[base] = first_student;
            if (rooms[room].per_bench == 2 && assigned_count < student_count) {
                while (next_student < student_count && student_assigned[next_student]) next_student++;
                int chosen = next_student;
                if (policy != 0) {
                    int found = -1;
                    for (int s = next_student; s < student_count; s++) if (!student_assigned[s]) {
                        int same = strcmp(students[first_student].dept, students[s].dept) == 0;
                        if ((policy == 1 && same) || (policy == 2 && !same)) { found = s; break; }
                    }
                    if (found >= 0) chosen = found;
                }
                if (chosen < student_count) {
                    student_assigned[chosen] = 1; assigned_count++; seat_student[base + 1] = chosen;
                    while (next_student < student_count && student_assigned[next_student]) next_student++;
                }
            }
        }
        if (!progressed) break;
    }
    /* Fill any remaining students in available graph-ordered seats, without assigning a student twice. */
    for (int bi = 0; bi < bench_count && next_student < student_count; bi++) {
        int base = bench_order[bi], room = bench_room[bi];
        for (int pos = 0; pos < rooms[room].per_bench && next_student < student_count; pos++) {
            if (seat_student[base + pos] < 0) { while (next_student < student_count && student_assigned[next_student]) next_student++; if (next_student < student_count) { seat_student[base + pos] = next_student; student_assigned[next_student++] = 1; } }
        }
    }
    puts("roll,department,classroom,row,bench,seat");
    for (int i = 0; i < seat_count; i++) if (seat_student[i] >= 0) {
        struct Seat s = seats[i]; struct Room r = rooms[s.room]; struct Student st = students[seat_student[i]];
        printf("%s,%s,%s,%d,%d,%d\n", st.roll, st.dept, r.number, s.row + 1, s.bench + 1, s.position + 1);
    }
    return 0;
}
