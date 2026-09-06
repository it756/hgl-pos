use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};
use rand_core::OsRng;

const MEMORY_COST_KIB: u32 = 19_456;
const ITERATIONS: u32 = 3;
const PARALLELISM: u32 = 1;

fn pin_argon2() -> Result<Argon2<'static>, String> {
    let params = Params::new(MEMORY_COST_KIB, ITERATIONS, PARALLELISM, None)
        .map_err(|err| err.to_string())?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

#[tauri::command]
pub fn hash_pin(pin: String) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    pin_argon2()?
        .hash_password(pin.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn verify_pin(pin: String, hash: String) -> Result<bool, String> {
    let parsed = PasswordHash::new(&hash).map_err(|e| e.to_string())?;
    Ok(pin_argon2()?.verify_password(pin.as_bytes(), &parsed).is_ok())
}

#[cfg(test)]
mod tests {
    use super::{hash_pin, verify_pin};

    #[test]
    fn hashes_and_verifies_pin_with_argon2id() {
        let hash = hash_pin("123456".to_string()).expect("hash pin");

        assert!(hash.starts_with("$argon2id$v=19$"));
        assert!(verify_pin("123456".to_string(), hash.clone()).expect("verify matching pin"));
        assert!(!verify_pin("654321".to_string(), hash).expect("verify different pin"));
    }
}
