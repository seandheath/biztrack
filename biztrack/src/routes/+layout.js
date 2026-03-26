// Disable SSR — BizTrack is a pure client-side SPA.
// All data fetching is done via Google APIs in the browser.
export const ssr = false;

// prerender=true is required for adapter-static to output HTML files.
// With ssr=false, this produces a static shell for every route.
export const prerender = true;
