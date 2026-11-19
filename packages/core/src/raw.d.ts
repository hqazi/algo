// Vite's `?raw` imports (tests only): the file's text.
declare module '*?raw' {
  const text: string;
  export default text;
}

// Vite's `import.meta.glob` (tests only).
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, T>;
}
