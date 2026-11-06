# Seatwise Project Presentation

## 1. Project overview

Seatwise is an exam seating allocation project. It takes classroom layouts and a student roster, then produces a seating plan that records each student's classroom, row, bench, and seat. The plan can be searched in the browser dashboard and exported as a CSV file.

The project has two ways to allocate seats:

- A browser dashboard built with HTML, CSS, and JavaScript. Its allocation runs in the browser, so it does not need a server.
- A standalone C command-line allocator that reads a request from standard input and prints a CSV plan to standard output.

Both versions support one-seat and two-seat benches and department pairing policies. Supported departments are CE, CSE, ECS, and MECH. The policy can request no department rule, strict same-department pairing, strict different-department pairing, or a best-effort preference for either kind of pair.

## 2. Technology stack and languages

- **C11:** Implements the standalone allocator and its input validation, room ordering, seat graph traversal, student pairing, and CSV output.
- **HTML:** Defines the dashboard structure and controls.
- **CSS:** Styles the dashboard and adjusts its layout for smaller screens.
- **JavaScript:** Updates the dashboard, validates form input, allocates seats in the browser, filters results, and exports CSV.
- **GCC or Clang:** Compiles the C allocator.

The browser UI uses plain HTML, CSS, and JavaScript. It does not use React, Vite, Node.js, or a backend service.

## 3. Data structures used and why

### Max-heap

Each classroom is inserted into a max-heap using its total seat capacity as the priority. Removing items from the heap gives the allocator the largest classrooms first. This helps it place students into larger rooms before smaller rooms. Heap insertion and removal take **O(log n)** time, where *n* is the number of classrooms.

### Seat graph and breadth-first search queue

The C allocator represents physical seats as graph vertices. Edges connect nearby seats, such as seats on the same bench and adjacent benches or rows. A breadth-first search (BFS) visits this graph in an orderly traversal. The BFS uses an array as a FIFO queue: seats enter at the tail and leave from the head. This gives a predictable order for collecting benches and assigning students.

### Arrays and structs

Fixed-size arrays store rooms, students, seats, heap entries, and the BFS queue. C structs group related fields: a room stores its dimensions and capacity; a seat stores its room and coordinates plus graph neighbors; a student stores roll number and department. The project has configured limits of 100 classrooms and 4,000 seats or students, so bounded arrays keep memory use straightforward and predictable.

### Department counts and student lookup

The allocator tracks department counts and assignment state while selecting partners for a bench. That supports the same-department and different-department policies and helps detect when a strict policy cannot be satisfied.

## 4. Presentation script

“Hello everyone. Our project is called Seatwise. It helps exam staff create classroom seating plans from room layouts and a student roster.

The user enters each classroom's number of rows, benches per row, and seats per bench, then provides student roll numbers and department codes. Seatwise checks the input, verifies that the configured capacity is enough, and applies the selected department pairing policy. The result shows the classroom and seat coordinates for every student, and it can be exported as a CSV file.

Our project has a browser dashboard made with plain HTML, CSS, and JavaScript, as well as a separate command-line allocator written in C11. The browser dashboard runs its allocation logic in JavaScript. The C program reads a structured request from standard input and prints the seating plan to standard output.

The C allocator uses a max-heap to process higher-capacity classrooms first. It models the seats as a graph and uses breadth-first search to visit benches in a consistent order. BFS uses a queue, which follows first-in, first-out order. Arrays and structs hold classroom, seat, and student information.

These structures make the allocation order predictable and help us enforce room capacity and department pairing rules. The program also checks for invalid or duplicate entries and reports an error if a strict pairing policy cannot be met.

To demonstrate the project, we can load the sample data in the dashboard, generate a seating plan, filter by classroom or student, and export the result. That concludes our presentation. Thank you.”
