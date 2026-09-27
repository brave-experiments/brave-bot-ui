// Windows treats a program with no manifest as an installer if its name contains "instal",
// "uninst", "setup", "update" or "patch", and will not run it without administrator rights.
// An `asInvoker` manifest stops that for every binary built here, test binaries included.
// See "installer detection" in docs/testing.md.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // https://learn.microsoft.com/en-us/cpp/build/reference/manifestuac-embeds-uac-information-in-manifest
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTUAC:level='asInvoker' uiAccess='false'");
    }
}
