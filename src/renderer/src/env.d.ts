/// <reference types="vite/client" />

import type { LumineApi } from '../../shared/types'

declare global {
  interface Window {
    lumine: LumineApi
  }
}

export {}
