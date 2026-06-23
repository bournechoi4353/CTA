/**
 * The assistant's visual state — the contract between what sigil is doing and what
 * the visualizer shows. Phase 2 drives this from keypresses; Phase 3 will drive
 * it from the Claude Agent SDK's event stream.
 */

export type AssistantState = 'idle' | 'thinking' | 'tool' | 'responding' | 'error'

export const ASSISTANT_STATES: readonly AssistantState[] = [
  'idle',
  'thinking',
  'tool',
  'responding',
  'error',
]

export const STATE_LABEL: Record<AssistantState, string> = {
  idle: 'idle',
  thinking: 'thinking',
  tool: 'tool-running',
  responding: 'responding',
  error: 'error',
}

/** Holds the current state and how long we've been in it. */
export class StateMachine {
  private current: AssistantState
  private timeInState = 0

  constructor(initial: AssistantState = 'idle') {
    this.current = initial
  }

  get state(): AssistantState {
    return this.current
  }

  /** Seconds since the current state was entered. */
  get elapsed(): number {
    return this.timeInState
  }

  set(next: AssistantState): void {
    if (next === this.current) return
    this.current = next
    this.timeInState = 0
  }

  update(dt: number): void {
    this.timeInState += dt
  }
}
