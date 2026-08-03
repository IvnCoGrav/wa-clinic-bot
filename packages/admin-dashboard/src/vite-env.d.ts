/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLINIC_NAME?: string;
  readonly VITE_ADMIN_API_KEY?: string;
  readonly VITE_LANDING_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
