// Ambient declarations for static assets imported by the bundler (electron-vite).
// Must live in a non-module .d.ts (no top-level import/export): under
// `moduleResolution: "bundler"`, wildcard `declare module` only applies globally
// from an ambient script. Keeping these out of env.d.ts (which is a module) is
// deliberate — see git history if tempted to merge them back.
declare module '*.png' {
  const src: string
  export default src
}
