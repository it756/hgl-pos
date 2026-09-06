declare namespace Deno {
  export const env: {
    get(key: string): string | undefined;
  };

  export function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

declare module "npm:@supabase/supabase-js@2.45.4" {
  export function createClient(url: string, key: string, options?: unknown): any;
}

declare module "npm:hash-wasm@4.12.0" {
  export interface Argon2Options {
    password: string;
    salt: Uint8Array;
    parallelism: number;
    iterations: number;
    memorySize: number;
    hashLength: number;
    outputType?: "hex" | "binary" | "encoded";
  }

  export function argon2id(options: Argon2Options): Promise<string>;
}
