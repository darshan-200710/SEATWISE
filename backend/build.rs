use std::{env, path::PathBuf, process::Command};
fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).parent().unwrap().to_path_buf();
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("seating");
    let status = Command::new("gcc").args(["-std=c11", "-O2"]).arg(root.join("ds/seating.c")).arg("-o").arg(&out).status().expect("gcc is required to build the C seating module");
    assert!(status.success(), "C seating module did not compile");
    println!("cargo:rustc-env=SEATING_BIN={}", out.display());
    println!("cargo:rerun-if-changed={}", root.join("ds/seating.c").display());
}
