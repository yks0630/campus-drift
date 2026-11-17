declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    RACE_ADMIN_PASSWORD?: string;
    BUCKET?: R2Bucket;
  }
}
