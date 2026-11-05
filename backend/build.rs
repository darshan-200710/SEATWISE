use std::{env, path::PathBuf, process::Command};

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_path_buf();
    let src = root.join("ds/seating.c");
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    // On Windows the executable needs .exe; on Unix it does not.
    let exe_name = if cfg!(windows) {
        "seating.exe"
    } else {
        "seating"
    };
    let out = out_dir.join(exe_name);

    let status = Command::new("gcc")
        .args(["-std=c11", "-Wall", "-Wextra", "-Wpedantic", "-O2"])
        .arg(&src)
        .arg("-o")
        .arg(&out)
        .status()
        .expect("gcc is required to build the C seating module");
    assert!(status.success(), "C seating module did not compile");

    println!("cargo:rustc-env=SEATING_BIN={}", out.display());
    println!("cargo:rerun-if-changed={}", src.display());
}
