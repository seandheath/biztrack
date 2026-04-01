/// <reference types="@sveltejs/kit" />

// Google Identity Services (loaded dynamically via script tag)
declare namespace google.accounts.oauth2 {
  interface TokenClient {
    requestAccessToken(config: { prompt?: string; login_hint?: string }): void;
  }

  interface TokenResponse {
    access_token: string;
    expires_in: number;
    error?: string;
  }

  function initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback: (error: unknown) => void;
  }): TokenClient;

  function revoke(token: string, callback: () => void): void;
}

// Build-time constant injected by vite.config.js
declare const __APP_VERSION__: string;
