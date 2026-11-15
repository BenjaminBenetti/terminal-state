// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane WORKERS): the type of Vite's inline-worker imports
// (`import W from './x?worker&inline'`: a constructor of a Worker that runs module x, started from a Blob of its compiled script).
// The game's tsconfig takes no ambient types (`types: []`), so the one shape it uses is declared here.
declare module '*?worker&inline' {
  const InlineWorker: {new (options?: {name?: string}): Worker};
  export default InlineWorker;
}
