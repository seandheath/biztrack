import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // adapter-static outputs a pure static SPA.
    // fallback: '404.html' enables the GitHub Pages 404 trick for SPA routing:
    // GitHub serves 404.html for unknown routes, SvelteKit router resolves client-side.
    adapter: adapter({ fallback: '404.html' }),
    paths: {
      // Empty base = served from root (custom domain).
      // Change to '/repo-name' if hosting on a GitHub Pages project site without a custom domain.
      base: ''
    }
  }
};

export default config;
