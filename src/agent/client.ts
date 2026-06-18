import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { mapMessage, type AgentHandlers } from './events'
import { debugLog } from './debug'

// Phase 3 is read-only: the assistant can read code and answer, but writes and
// shell commands are denied until Phase 4 builds the approval gate.
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep']

/**
 * A multi-turn agent conversation over the Claude Agent SDK. Each `send()` runs
 * one turn (a `query()` stream), resuming the prior session so context carries
 * across turns. Messages are mapped to state/text via {@link mapMessage}.
 */
export class AgentSession {
  private sessionId: string | null = null
  private busy = false

  get isBusy(): boolean {
    return this.busy
  }

  async send(prompt: string, handlers: AgentHandlers): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const options: Options = {
        cwd: process.cwd(),
        allowedTools: [...READ_ONLY_TOOLS],
        permissionMode: 'default',
        canUseTool: async (toolName: string): Promise<PermissionResult> => {
          if (READ_ONLY_TOOLS.includes(toolName)) return { behavior: 'allow' }
          return {
            behavior: 'deny',
            message: `"${toolName}" isn't enabled yet — writes and commands arrive in Phase 4, behind an approval gate.`,
          }
        },
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
