// Task loot-reference-pages-20261030 (lane SITE): Vite `?raw` imports (the site's own CSS / JS are inlined as strings at build time).
declare module '*?raw' {
  const text: string;
  export default text;
}
