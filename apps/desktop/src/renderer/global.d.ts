import type { NopsApi } from '@nopsidian/ipc-contract';

declare global {
  interface Window {
    nops: NopsApi;
  }
}
