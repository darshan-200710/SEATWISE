use std::{io::{Read, Write}, net::{TcpListener, TcpStream}, process::{Command, Stdio}};

fn respond(mut stream: TcpStream, status: &str, body: &str, content_type: &str) {
    let headers = format!("HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(headers.as_bytes()); let _ = stream.write_all(body.as_bytes());
}
fn handle(mut stream: TcpStream) {
    let mut req = Vec::new(); let mut buf = [0u8; 4096];
    loop {
        let n = match stream.read(&mut buf) { Ok(0) | Err(_) => return, Ok(n) => n };
        req.extend_from_slice(&buf[..n]);
        if req.windows(4).any(|w| w == b"\r\n\r\n") { break; }
    }
    let split = req.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
    let headers = String::from_utf8_lossy(&req[..split]).into_owned();
    let content_len = headers.lines().find_map(|l| l.strip_prefix("Content-Length:").or_else(|| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
    while req.len() - split < content_len {
        let n = match stream.read(&mut buf) { Ok(0) | Err(_) => return, Ok(n) => n };
        req.extend_from_slice(&buf[..n]);
    }
    let body = String::from_utf8_lossy(&req[split..split + content_len]);
    if headers.starts_with("OPTIONS ") { respond(stream, "204 No Content", "", "text/plain"); return; }
    if !headers.starts_with("POST /api/allocate ") { respond(stream, "404 Not Found", "Use POST /api/allocate", "text/plain"); return; }
    let mut child = match Command::new(env!("SEATING_BIN")).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn() {
        Ok(c) => c, Err(_) => { respond(stream, "500 Internal Server Error", "Could not start seating allocator", "text/plain"); return; }
    };
    if let Some(mut stdin) = child.stdin.take() { let _ = stdin.write_all(body.as_bytes()); }
    match child.wait_with_output() {
        Ok(out) if out.status.success() => respond(stream, "200 OK", &String::from_utf8_lossy(&out.stdout), "text/csv; charset=utf-8"),
        _ => respond(stream, "400 Bad Request", "Invalid plan or not enough seats. Check room dimensions and roll numbers.", "text/plain; charset=utf-8"),
    }
}
fn main() {
    let addr = std::env::var("SEAT_API_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = TcpListener::bind(&addr).expect("Could not bind API address");
    println!("Seat allocation API listening on http://{addr}");
    for stream in listener.incoming().flatten() { std::thread::spawn(|| handle(stream)); }
}
