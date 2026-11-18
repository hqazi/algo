// Vite's `?raw` imports: migrations are bundled into the main process as text.
declare module '*.sql?raw' {
  const text: string;
  export default text;
}
