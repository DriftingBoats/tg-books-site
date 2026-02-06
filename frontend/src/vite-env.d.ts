/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_NAME?: string;
  readonly VITE_HEADER_NAME?: string;
  readonly VITE_APP_LOGO?: string;
  readonly VITE_APP_ICON?: string;
  readonly VITE_APP_APPLE_ICON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
