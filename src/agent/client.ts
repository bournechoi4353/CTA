import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { mapMessage, type AgentHandlers } from './events'
import type { PermissionGate } from './permissions'
import type { AskController } from './ask'
import { debugLog } from './debug'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// Reads + our own ask tool are auto-approved. Writes/Bash go through the gate.
const AUTO_ALLOW_TOOLS = ['Read', 'Glob', 'Grep', 'mcp__cta__ask_user']

/**
 * A multi-turn agent conversation over the Claude Agent SDK. Each `send()` runs
 * one turn (a `query()` stream) and can be cancelled mid-flight via `cancel()`.
 * Tool permissions go through the {@link PermissionGate}; preference questions
 * go through the {@link AskController} (our in-process `ask_user` tool).
 */
export class AgentSession {
  private sessionId: string | null = null
  private busy = false
  private aborter: AbortController | null = null
  private effort: Effort = 'high'
  private readonly mcpServer

  constructor(
    private readonly gate: PermissionGate,
    private readonly ask: AskController,
  ) {
    const askUser = tool(
      'ask_user',
      'Ask the user to choose between options when you need their preference or a decision you should not make for them. Give a short, clear question and 2-5 brief options. Returns the option the user picked.',
      { question: z.string(), options: z.array(z.string()) },
      async (args) => {
        const answer = await this.ask.ask(args.question, args.options)
        return { content: [{ type: 'text' as const, text: answer }] }
      },
    )
    this.mcpServer = createSdkMcpServer({ name: 'cta', version: '0.1.0', tools: [askUser] })
  }

  get isBusy(): boolean {
    return this.busy
  }

  get currentSessionId(): string | null {
    return this.sessionId
  }

  get currentEffort(): Effort {
    return this.effort
  }

  setEffort(effort: Effort): void {
    this.effort = effort
  }

  resume(sessionId: string): void {
    this.sessionId = sessionId
  }

  reset(): void {
    this.sessionId = null
  }

  /** Interrupt the in-flight turn (if any) and unblock any pending prompts. */
  cancel(): void {
    this.aborter?.abort()
    this.gate.cancelAll()
    this.ask.cancelAll()
  }

  async send(prompt: string, handlers: AgentHandlers): Promise<void> {
    if (this.busy) return
    this.busy = true
    const ac = new AbortController()
    this.aborter = ac
    try {
      const options: Options = {
        cwd: process.cwd(),
        abortController: ac,
        effort: this.effort,
        allowedTools: [...AUTO_ALLOW_TOOLS],
        disallowedTools: ['AskUserQuestion'], // use our renderable ask_user instead
        permissionMode: 'default',
        canUseTool: (toolName, input) => this.gate.request(toolName, input),
        mcpServers: { cta: this.mcpServer },
        stderr: (data: string) => debugLog('cli-stderr', data),
      }
      if (this.sessionId) options.resume = this.sessionId

      for await (const msg of query({ prompt, options })) {
        const sid = (msg as { session_id?: unknown }).session_id
        if (typeof sid === 'string' && sid.length > 0) this.sessionId = sid
        mapMessage(msg, handlers)
      }
      if (ac.signal.aborted) {
        handlers.onState('idle')
        handlers.onNotice?.('cancelled')
      }
    } catch (err) {
      if (ac.signal.aborted) {
        handlers.onState('idle')
        handlers.onNotice?.('cancelled')
      } else {
        debugLog('query-error', String(err))
        handlers.onState('error')
        handlers.onResult(describeError(err), true)
      }
    } finally {
      this.busy = false
      this.aborter = null
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
