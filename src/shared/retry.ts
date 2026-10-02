import type { ProviderId } from './providers'

/** A recognition source offered by "Retry with another AI". */
export interface RetryProvider {
  id: ProviderId
  name: string
  local: boolean
  /** The source that produced the current text. */
  current: boolean
}

export interface RetryResult {
  ok: boolean
  message?: string
  /** Handle of the held result; passed to applyRetry. */
  token?: string
  providerName?: string
  model?: string
  oldText?: string
  newText?: string
}

export interface PickedImage {
  name?: string
  bytes?: Uint8Array
  error?: string
}
