use std::{
    collections::HashSet,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::{Command, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

/// Maximum request body size in bytes (256 KiB — plenty for 4,000 students).
const MAX_BODY: usize = 256 * 1024;

/// Maximum header section size in bytes.
const MAX_HEADERS: usize = 8 * 1024;

/// Maximum concurrent connections handled simultaneously.
const MAX_CONCURRENT: usize = 8;

/// Read/write timeout for each TCP connection.
const IO_TIMEOUT: Duration = Duration::from_secs(10);

/// Maximum total seats supported.
const MAX_SEATS: usize = 4000;

/// Maximum classrooms supported.
const MAX_ROOMS: usize = 100;

/// Maximum students supported.
const MAX_STUDENTS: usize = 4000;

/// Active connection counter for bounded concurrency.
static ACTIVE_CONNECTIONS: AtomicUsize = AtomicUsize::new(0);

/// Check if Origin header matches allowed local development origins.
fn get_allowed_origin(headers: &str) -> &'static str {
    for line in headers.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("origin:") {
            let val = line[7..].trim();
            if val == "http://localhost:5173" {
                return "http://localhost:5173";
            }
            if val == "http://127.0.0.1:5173" {
                return "http://127.0.0.1:5173";
            }
        }
    }
    // Default to Vite dev server default
    "http://localhost:5173"
}

/// Send an HTTP response with secure headers.
fn respond(mut stream: TcpStream, status: &str, body: &str, content_type: &str, origin: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: {origin}\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Access-Control-Allow-Methods: POST, OPTIONS\r\n\
         X-Content-Type-Options: nosniff\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

/// Validate text fields: reject leading formula chars and control characters.
fn is_valid_text_token(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let first = s.as_bytes()[0];
    if first == b'=' || first == b'+' || first == b'-' || first == b'@' {
        return false;
    }
    !s.bytes()
        .any(|b| b == b'\t' || b == b'\r' || b == b'\n' || b == b',')
}

/// Validate the entire allocation request on the server before invoking the allocator.
fn validate_request(body: &str) -> Result<(), String> {
    let mut lines = body.lines().map(str::trim).filter(|l| !l.is_empty());

    // 1. Room count
    let room_count_line = lines.next().ok_or("Missing room count")?;
    let room_count: usize = room_count_line
        .parse()
        .map_err(|_| "Invalid room count integer")?;
    if room_count == 0 || room_count > MAX_ROOMS {
        return Err(format!("Room count must be between 1 and {MAX_ROOMS}"));
    }

    // 2. Classrooms
    let mut total_capacity: usize = 0;
    let mut seen_rooms = HashSet::new();

    for r in 0..room_count {
        let room_line = lines
            .next()
            .ok_or_else(|| format!("Missing classroom data for room {}", r + 1))?;
        let tokens: Vec<&str> = room_line.split_whitespace().collect();
        if tokens.len() != 4 {
            return Err(format!(
                "Classroom {} line must have 4 values: number rows benches per_bench",
                r + 1
            ));
        }

        let num = tokens[0];
        if !is_valid_text_token(num) {
            return Err(format!(
                "Classroom '{num}' has invalid characters or formula prefix"
            ));
        }
        if !seen_rooms.insert(num) {
            return Err(format!("Duplicate classroom number '{num}'"));
        }

        let rows: usize = tokens[1]
            .parse()
            .map_err(|_| format!("Invalid row count for room '{num}'"))?;
        let benches: usize = tokens[2]
            .parse()
            .map_err(|_| format!("Invalid bench count for room '{num}'"))?;
        let per_bench: usize = tokens[3]
            .parse()
            .map_err(|_| format!("Invalid seats-per-bench for room '{num}'"))?;

        if rows == 0 || rows > 100 {
            return Err(format!("Classroom '{num}' rows must be between 1 and 100"));
        }
        if benches == 0 || benches > 100 {
            return Err(format!(
                "Classroom '{num}' benches per row must be between 1 and 100"
            ));
        }
        if per_bench != 1 && per_bench != 2 {
            return Err(format!("Classroom '{num}' seats per bench must be 1 or 2"));
        }

        let cap = rows
            .checked_mul(benches)
            .and_then(|rb| rb.checked_mul(per_bench))
            .ok_or_else(|| format!("Classroom '{num}' capacity calculation overflowed"))?;

        total_capacity = total_capacity
            .checked_add(cap)
            .ok_or("Total capacity overflowed")?;
        if total_capacity > MAX_SEATS {
            return Err(format!(
                "Total capacity exceeds maximum of {MAX_SEATS} seats"
            ));
        }
    }

    // 3. Student count and policy
    let student_header = lines
        .next()
        .ok_or("Missing student count and policy line")?;
    let header_tokens: Vec<&str> = student_header.split_whitespace().collect();
    if header_tokens.len() != 2 {
        return Err("Student header line must have: student_count policy".into());
    }

    let student_count: usize = header_tokens[0]
        .parse()
        .map_err(|_| "Invalid student count integer")?;
    let policy: usize = header_tokens[1]
        .parse()
        .map_err(|_| "Invalid policy code (must be 0 to 4)")?;

    if student_count == 0 || student_count > MAX_STUDENTS {
        return Err(format!(
            "Student count must be between 1 and {MAX_STUDENTS}"
        ));
    }
    if policy > 4 {
        return Err("Policy code must be 0, 1, 2, 3, or 4".into());
    }
    if student_count > total_capacity {
        return Err(format!(
            "Roster has {student_count} students but total capacity is only {total_capacity} seats"
        ));
    }

    // 4. Students
    let mut seen_rolls = HashSet::new();
    let valid_depts = ["CE", "CSE", "ECS", "MECH"];

    for s in 0..student_count {
        let student_line = lines
            .next()
            .ok_or_else(|| format!("Missing student data at index {}", s + 1))?;
        let tokens: Vec<&str> = student_line.split_whitespace().collect();
        if tokens.len() != 2 {
            return Err(format!(
                "Student {} line must have 2 values: roll department",
                s + 1
            ));
        }

        let roll = tokens[0];
        let dept = tokens[1];

        if !is_valid_text_token(roll) {
            return Err(format!(
                "Student roll '{roll}' contains invalid characters or formula prefix"
            ));
        }
        if !valid_depts.contains(&dept) {
            return Err(format!(
                "Student '{roll}' has invalid department '{dept}'. Expected CE, CSE, ECS, or MECH"
            ));
        }
        if !seen_rolls.insert(roll) {
            return Err(format!("Duplicate student roll number '{roll}'"));
        }
    }

    // Verify no trailing extra lines
    if lines.next().is_some() {
        return Err("Payload contains extra lines beyond stated student count".into());
    }

    Ok(())
}

fn handle(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    let mut req = Vec::with_capacity(4096);
    let mut buf = [0u8; 4096];

    // Read HTTP headers up to MAX_HEADERS
    loop {
        let n = match stream.read(&mut buf) {
            Ok(0) | Err(_) => return,
            Ok(n) => n,
        };
        req.extend_from_slice(&buf[..n]);
        if req.len() > MAX_HEADERS {
            respond(
                stream,
                "431 Request Header Fields Too Large",
                "Headers too large",
                "text/plain",
                "http://localhost:5173",
            );
            return;
        }
        if req.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }

    let split = match req.windows(4).position(|w| w == b"\r\n\r\n") {
        Some(pos) => pos + 4,
        None => return,
    };

    let headers = String::from_utf8_lossy(&req[..split]).into_owned();
    let origin = get_allowed_origin(&headers);

    // Handle OPTIONS CORS preflight
    if headers.starts_with("OPTIONS ") {
        respond(stream, "204 No Content", "", "text/plain", origin);
        return;
    }

    // Method and endpoint check
    if !headers.starts_with("POST /api/allocate ") {
        let is_other_method = headers.starts_with("GET ")
            || headers.starts_with("HEAD ")
            || headers.starts_with("PUT ")
            || headers.starts_with("DELETE ")
            || headers.starts_with("PATCH ");

        if headers.starts_with("GET /api/allocate")
            || headers.starts_with("PUT /api/allocate")
            || headers.starts_with("DELETE /api/allocate")
        {
            respond(
                stream,
                "405 Method Not Allowed",
                "Method not allowed. Use POST /api/allocate",
                "text/plain",
                origin,
            );
        } else if is_other_method {
            respond(
                stream,
                "404 Not Found",
                "Endpoint not found",
                "text/plain",
                origin,
            );
        } else {
            respond(
                stream,
                "400 Bad Request",
                "Malformed request line",
                "text/plain",
                origin,
            );
        }
        return;
    }

    // Content-Type validation
    let has_valid_ct = headers.lines().any(|l| {
        let lower = l.to_ascii_lowercase();
        lower.starts_with("content-type:") && lower.contains("text/plain")
    });
    if !has_valid_ct {
        respond(
            stream,
            "415 Unsupported Media Type",
            "Content-Type must be text/plain",
            "text/plain",
            origin,
        );
        return;
    }

    // Content-Length parsing & body limit check
    let content_len: usize = headers
        .lines()
        .find_map(|l| {
            l.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .and_then(|v| v.trim().parse().ok())
        })
        .unwrap_or(0);

    if content_len > MAX_BODY {
        respond(
            stream,
            "413 Content Too Large",
            "Request body exceeds maximum allowed size (256 KiB)",
            "text/plain",
            origin,
        );
        return;
    }

    // Read full body
    while req.len() - split < content_len {
        let n = match stream.read(&mut buf) {
            Ok(0) | Err(_) => {
                respond(
                    stream,
                    "400 Bad Request",
                    "Client connection closed before full body was sent",
                    "text/plain",
                    origin,
                );
                return;
            }
            Ok(n) => n,
        };
        req.extend_from_slice(&buf[..n]);
        if req.len() - split > MAX_BODY {
            respond(
                stream,
                "413 Content Too Large",
                "Request body exceeds maximum allowed size (256 KiB)",
                "text/plain",
                origin,
            );
            return;
        }
    }

    let body = String::from_utf8_lossy(&req[split..split + content_len]);

    // Server-side validation
    if let Err(err_msg) = validate_request(&body) {
        respond(
            stream,
            "400 Bad Request",
            &format!("Validation error: {err_msg}"),
            "text/plain; charset=utf-8",
            origin,
        );
        return;
    }

    // Spawn C allocator
    let seating_bin = env!("SEATING_BIN");
    let mut child = match Command::new(seating_bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[error] Failed to launch allocator: {e}");
            respond(
                stream,
                "500 Internal Server Error",
                "Seating allocator unavailable",
                "text/plain",
                origin,
            );
            return;
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(body.as_bytes());
    }

    match child.wait_with_output() {
        Ok(out) if out.status.success() => {
            let csv = String::from_utf8_lossy(&out.stdout);
            if csv.trim().is_empty() {
                respond(
                    stream,
                    "500 Internal Server Error",
                    "Allocator produced empty output",
                    "text/plain",
                    origin,
                );
            } else {
                respond(stream, "200 OK", &csv, "text/csv; charset=utf-8", origin);
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let stderr_trimmed = stderr.trim();
            // Log for server debugging (never contains sensitive student personal info)
            eprintln!("[allocator error] {stderr_trimmed}");

            // Provide clear, actionable message without leaking compiler or filesystem paths
            let user_msg = if stderr_trimmed.contains("same-department policy") {
                "Cannot satisfy strict same-department policy: roster counts require mixing departments on two-seat benches. Enable 'Allow fallback' to proceed."
            } else if stderr_trimmed.contains("different-departments policy") {
                "Cannot satisfy strict different-departments policy: roster counts require pairing students of the same department. Enable 'Allow fallback' to proceed."
            } else {
                "Allocation could not be completed with the given classroom dimensions and roster."
            };

            respond(
                stream,
                "400 Bad Request",
                user_msg,
                "text/plain; charset=utf-8",
                origin,
            );
        }
        Err(e) => {
            eprintln!("[error] Allocator process execution failed: {e}");
            respond(
                stream,
                "500 Internal Server Error",
                "Seating allocator execution failed",
                "text/plain",
                origin,
            );
        }
    }
}

fn main() {
    let addr = std::env::var("SEAT_API_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = TcpListener::bind(&addr).expect("Could not bind API address");
    println!("====================================================");
    println!("Seatwise Seating Plan API listening on http://{addr}");
    println!("Local classroom demo service — bound to loopback.");
    println!("====================================================");

    for stream in listener.incoming().flatten() {
        let current = ACTIVE_CONNECTIONS.load(Ordering::Relaxed);
        if current >= MAX_CONCURRENT {
            respond(
                stream,
                "503 Service Unavailable",
                "Server busy: maximum concurrent requests reached. Please try again shortly.",
                "text/plain",
                "http://localhost:5173",
            );
            continue;
        }

        ACTIVE_CONNECTIONS.fetch_add(1, Ordering::Relaxed);
        std::thread::spawn(move || {
            handle(stream);
            ACTIVE_CONNECTIONS.fetch_sub(1, Ordering::Relaxed);
        });
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::thread;
    use std::time::Duration;

    fn start_test_server() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        drop(listener);

        let addr_clone = addr.clone();
        thread::spawn(move || {
            let listener = std::net::TcpListener::bind(&addr_clone).unwrap();
            for stream in listener.incoming().flatten() {
                super::handle(stream);
            }
        });

        thread::sleep(Duration::from_millis(150));
        addr
    }

    fn send_request(
        addr: &str,
        method: &str,
        path: &str,
        content_type: &str,
        body: &str,
    ) -> (u16, String) {
        let mut stream = TcpStream::connect(addr).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();

        let request = format!(
            "{method} {path} HTTP/1.1\r\n\
             Host: {addr}\r\n\
             Content-Type: {content_type}\r\n\
             Content-Length: {}\r\n\
             Origin: http://localhost:5173\r\n\
             \r\n\
             {body}",
            body.len(),
        );
        stream.write_all(request.as_bytes()).unwrap();

        let mut response = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => response.extend_from_slice(&buf[..n]),
                Err(_) => break,
            }
        }

        let response_str = String::from_utf8_lossy(&response).into_owned();
        let status_code = response_str
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse::<u16>().ok())
            .unwrap_or(0);

        let body_start = response_str
            .find("\r\n\r\n")
            .map(|i| i + 4)
            .unwrap_or(response_str.len());
        let resp_body = response_str[body_start..].to_string();

        (status_code, resp_body)
    }

    #[test]
    fn test_not_found() {
        let addr = start_test_server();
        let (status, _) = send_request(&addr, "GET", "/unknown", "text/plain", "");
        assert_eq!(status, 404);
    }

    #[test]
    fn test_unsupported_method() {
        let addr = start_test_server();
        let (status, body) = send_request(&addr, "GET", "/api/allocate", "text/plain", "");
        assert_eq!(status, 405);
        assert!(body.contains("Method not allowed"));
    }

    #[test]
    fn test_unsupported_media_type() {
        let addr = start_test_server();
        let (status, body) = send_request(&addr, "POST", "/api/allocate", "application/json", "{}");
        assert_eq!(status, 415);
        assert!(body.contains("Content-Type must be text/plain"));
    }

    #[test]
    fn test_empty_body() {
        let addr = start_test_server();
        let (status, body) = send_request(&addr, "POST", "/api/allocate", "text/plain", "");
        assert_eq!(status, 400);
        assert!(body.contains("Validation error"));
    }

    #[test]
    fn test_malformed_syntax() {
        let addr = start_test_server();
        let (status, body) = send_request(
            &addr,
            "POST",
            "/api/allocate",
            "text/plain",
            "garbage input",
        );
        assert_eq!(status, 400);
        assert!(body.contains("Validation error"));
    }

    #[test]
    fn test_duplicate_rolls() {
        let addr = start_test_server();
        let input = "1\nR101 1 2 2\n2 0\n24001 CSE\n24001 CE";
        let (status, body) = send_request(&addr, "POST", "/api/allocate", "text/plain", input);
        assert_eq!(status, 400);
        assert!(body.contains("Duplicate student roll number"));
    }

    #[test]
    fn test_duplicate_rooms() {
        let addr = start_test_server();
        let input = "2\nR101 1 2 2\nR101 1 2 2\n2 0\n24001 CSE\n24002 CE";
        let (status, body) = send_request(&addr, "POST", "/api/allocate", "text/plain", input);
        assert_eq!(status, 400);
        assert!(body.contains("Duplicate classroom number"));
    }

    #[test]
    fn test_invalid_department() {
        let addr = start_test_server();
        let input = "1\nR101 1 2 2\n2 0\n24001 CSE\n24002 ART";
        let (status, body) = send_request(&addr, "POST", "/api/allocate", "text/plain", input);
        assert_eq!(status, 400);
        assert!(body.contains("invalid department"));
    }

    #[test]
    fn test_capacity_overflow() {
        let addr = start_test_server();
        let input = "1\nR101 1 1 1\n2 0\n24001 CSE\n24002 CE";
        let (status, body) = send_request(&addr, "POST", "/api/allocate", "text/plain", input);
        assert_eq!(status, 400);
        assert!(body.contains("total capacity is only 1 seats"));
    }

    #[test]
    fn test_oversized_body() {
        let addr = start_test_server();
        // Create an oversized body (> 256 KiB)
        let large_body = "A".repeat(300 * 1024);
        let (status, body) =
            send_request(&addr, "POST", "/api/allocate", "text/plain", &large_body);
        assert_eq!(status, 413);
        assert!(body.contains("Request body exceeds maximum allowed size"));
    }

    #[test]
    fn test_cors_options_preflight() {
        let addr = start_test_server();
        let (status, _) = send_request(&addr, "OPTIONS", "/api/allocate", "text/plain", "");
        assert_eq!(status, 204);
    }

    #[test]
    fn test_valid_allocation_plan() {
        let addr = start_test_server();
        let input = "1\nR101 2 2 2\n4 0\n24001 CSE\n24002 CE\n24003 ECS\n24004 MECH";
        let (status, body) = send_request(&addr, "POST", "/api/allocate", "text/plain", input);
        assert_eq!(status, 200);

        let lines: Vec<&str> = body.trim().lines().collect();
        assert_eq!(lines[0], "roll,department,classroom,row,bench,seat");
        assert_eq!(lines.len(), 5); // 1 header + 4 students
    }

    #[test]
    fn test_strict_policy_failure_feedback() {
        let addr = start_test_server();
        // 3 CSE, 1 CE with strict diff-dept policy (2) across 2 benches -> cannot satisfy
        let input = "1\nR101 1 2 2\n4 2\n24001 CSE\n24002 CSE\n24003 CSE\n24004 CE";
        let (status, body) = send_request(&addr, "POST", "/api/allocate", "text/plain", input);
        assert_eq!(status, 400);
        assert!(body.contains("Cannot satisfy strict different-departments policy"));
    }
}
