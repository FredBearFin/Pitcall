// Minimal typing for the one Node call the simulation report makes (the app itself never imports it).
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
}
