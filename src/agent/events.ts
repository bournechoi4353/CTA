import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AssistantState } from '../state/assistantState'
import { debugLog } from './debug'

/** What the app cares about from the agent's message stream. */
export interface AgentHandlers {
  onState(state: AssistantState): void
  /** A segment of assistant text. */
  onAssistantText(text: string): void
  /** The agent invoked a tool (e.g. Read). */
  onToolUse(name: string): void
  /** The init message — model, cwd, how auth resolved. */
  onSystemInit(info: { model: string; cwd: string; apiKeySource: string; tools: string[] }): void
  /** Turn finished (success or error) — `text` is the final/answer or error. */
  onResult(text: string, isError: boolean): void
}

// Content blocks are typed loosely on purpose: we only read a few fields and
// don't want to couple to the exact Anthropic beta block union, which can carry
// many variants. Unknown blocks are ignored.
type LooseBlock = { type: string; text?: string; name?: string }

/**
 * Map one SDK message to state transitions + text. The discrete states come from
 * the message shape: system/init → starting, assistant text → responding,
 * tool_use → tool-running, user/tool_result → thinking, result → idle/error.
 *
 * NOTE: verify these shapes against a live run via CTA_DEBUG — the TS SDK does
 * not publish a complete event enum, so this is the documented-best mapping.
 */
export function mapMessage(msg: SDKMessage, h: AgentHandlers): void {
  debugLog('msg', { type: msg.type, subtype: (msg as { subtype?: string }).subtype })

  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') {
        h.onSystemInit({
          model: msg.model,
          cwd: msg.cwd,
          apiKeySource: msg.apiKeySource,
          tools: msg.tools,
        })
        h.onState('thinking')
      }
      break

    case 'assistant': {
      if (msg.error) {
        h.onResult(authHint(msg.error), true)
        h.onState('error')
        break
      }
      const content = (msg.message?.content ?? []) as ReadonlyArray<LooseBlock>
      let text = ''
      let sawTool = false
      let sawThinking = false
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') text += block.text
        else if (block.type === 'tool_use') {
          sawTool = true
          if (block.name) h.onToolUse(block.name)
        } else if (block.type === 'thinking') {
          sawThinking = true
        }
      }
      if (text.length > 0) h.onAssistantText(text)
      // A pending tool takes visual priority (it's about to run); otherwise text.
      if (sawTool) h.onState('tool')
      else if (text.length > 0) h.onState('responding')
      else if (sawThinking) h.onState('thinking')
      break
    }

    case 'user':
      // A tool result came back; the agent will reason about it next.
      h.onState('thinking')
      break

    case 'result':
      if (msg.subtype === 'success') {
        h.onResult(msg.result, msg.is_error === true)
        h.onState(msg.is_error === true ? 'error' : 'idle')
      } else {
        h.onResult(`run ended: ${msg.subtype}`, true)
        h.onState('error')
      }
      break

    default:
      break
  }
}

function authHint(code: string): string {
  if (code === 'authentication_failed' || code === 'oauth_org_not_allowed') {
    return 'Not authenticated. Set ANTHROPIC_API_KEY, or run `claude` once to log in with your subscription.'
  }
  return `error: ${code}`
}
