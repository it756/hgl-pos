import { invoke } from "@tauri-apps/api/core";

export type PinHasher = {
  hash(pin: string): Promise<string>;
  verify(pin: string, hash: string): Promise<boolean>;
};

export class TauriPinHasher implements PinHasher {
  async hash(pin: string): Promise<string> {
    return invoke<string>("hash_pin", { pin });
  }

  async verify(pin: string, hash: string): Promise<boolean> {
    return invoke<boolean>("verify_pin", { pin, hash });
  }
}

export const pinHasher = new TauriPinHasher();

export async function hashPin(pin: string): Promise<string> {
  return pinHasher.hash(pin);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return pinHasher.verify(pin, hash);
}
