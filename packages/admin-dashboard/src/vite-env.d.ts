/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLINIC_NAME?: string;
  readonly VITE_ADMIN_API_KEY?: string;
  readonly VITE_LANDING_BASE_URL?: string;
  readonly VITE_CARTO_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
