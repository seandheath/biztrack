import adapter from '@sveltejs/adapter-static';
import { base } from './build.config.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    paths: { base, relative: false }
  }
};

export default config;
