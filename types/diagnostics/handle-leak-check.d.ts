export interface HandleLeakCheckOptions {
  /**
   * How often (ms) to walk and log active handles while suspended, from the
   * moment 'suspend' fires until 'idle' finally emits (or 'resume', if idle
   * never comes). Defaults to 1000ms.
   */
  tickIntervalMs?: number;
}

/**
 * Registers a diagnostic check on Bare's suspend/idle/resume lifecycle that
 * repeatedly walks and logs active handles while suspended, to help identify
 * what's keeping the event loop from reaching idle promptly. No-ops if
 * bare-walk-handles isn't installed or Bare's lifecycle events aren't
 * available.
 */
export function registerHandleLeakCheck(options?: HandleLeakCheckOptions): void;
