/// <reference types="vite/client" />
import type { TutorBridge } from '../../shared/ipc';

declare global {
  interface Window {
    /** The preload bridge (`src/preload/index.ts`). */
    readonly tutor: TutorBridge;
  }
}
