// T041 skeleton: Argon2id hashing exposed as Tauri commands. Concrete parameters
// (memory cost, iterations, parallelism) are set during Phase 3 auth work.

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand_core::OsRng;

#[tauri::command]
pub fn hash_pin(pin: String) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon = Argon2::default();
    argon
        .hash_password(pin.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn verify_pin(pin: String, hash: String) -> Result<bool, String> {
    let parsed = PasswordHash::new(&hash).map_err(|e| e.to_string())?;
    Ok(Argon2::default().verify_password(pin.as_bytes(), &parsed).is_ok())
}
