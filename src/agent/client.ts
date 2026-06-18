import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { mapMessage, type AgentHandlers } from './events'
import type { PermissionGate } from './permissions'
import { debugLog } from './debug'

// Reads are auto-approved (no prompt). Everything else — Write, Edit, Bash, … —
// is available to the model but routed through the gate (the approval modal).
const AUTO_ALLOW_TOOLS = ['Read', 'Glob', 'Grep']

/**
 * A multi-turn agent conversation over the Claude Agent SDK. Each `send()` runs
 * one turn (a `query()` stream), resuming the prior session so context carries
 * across turns. Messages map to state/text via {@link mapMessage}; tool
 * permissions go through the {@link PermissionGate}.
 */
export class AgentSession {
  private sessionId: string | null = null
  private busy = false

  constructor(private readonly gate: PermissionGate) {}

  get isBusy(): boolean {
    return this.busy
  }

  get currentSessionId(): string | null {
    return this.sessionId
  }

  /** Continue a prior session (e.g. restored from disk). */
  resume(sessionId: string): void {
    this.sessionId = sessionId
  }

  /** Start a fresh session on the next turn. */
  reset(): void {
    this.sessionId = null
  }

  async send(prompt: string, handlers: AgentHandlers): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const options: Options = {
        cwd: process.cwd(),
        allowedTools: [...AUTO_ALLOW_TOOLS],
        permissionMode: 'default',
        canUseTool: (toolName, input) => this.gate.request(toolName, input),
        stderr: (data: string) => debugLog('cli-stderr', data),
      }
      if (this.sessionId) options.resume = this.sessionId

      for await (const msg of query({ prompt, options })) {
        const sid = (msg as { session_id?: unknown }).session_id
        if (typeof sid === 'string' && sid.length > 0) this.sessionId = sid
        mapMessage(msg, handlers)
      }
    } catch (err) {
      debugLog('query-error', String(err))
      handlers.onState('error')
      handlers.onResult(describeError(err), true)
    } finally {
      this.busy = false
    }
  }
}

function describeError(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err)
  if (/auth|api[_ ]?key|login|credential|401|unauthor/i.test(s)) {
    return 'Not authenticated. Set ANTHROPIC_API_KEY, or run `claude` once to log in with your subscription.'
  }
  if (/ENOENT|spawn|not found|executable/i.test(s)) {
    return 'Could not start the Claude agent. Try reinstalling: npm install @anthropic-ai/claude-agent-sdk'
  }
  return `agent error: ${s.slice(0, 200)}`
}
