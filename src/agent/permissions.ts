import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'

export interface PendingPermission {
  toolName: string
  /** Short title for the modal (the tool name). */
  title: string
  /** Lines describing exactly what the tool will do. */
  detail: string[]
}

interface Entry {
  pending: PendingPermission
  resolve: (result: PermissionResult) => void
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypass' | 'plan'

const MODE_ORDER: PermissionMode[] = ['default', 'acceptEdits', 'bypass', 'plan']

const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit'])

/**
 * Mediates tool-permission requests between the Agent SDK and the TUI. The SDK
 * calls {@link request} (via `canUseTool`) and awaits the returned promise; the
 * UI shows {@link current} as a modal and calls {@link decide} on a keypress,
 * which resolves the promise. Requests queue, so parallel tool calls are handled
 * one at a time. "Always allow" remembers a tool for the session.
 */
export class PermissionGate {
  private readonly queue: Entry[] = []
  private readonly always = new Set<string>()
  private mode: PermissionMode = 'default'

  get current(): PendingPermission | null {
    return this.queue[0]?.pending ?? null
  }

  get queued(): number {
    return this.queue.length
  }

  get permissionMode(): PermissionMode {
    return this.mode
  }

  /** Cycle default → acceptEdits → bypass → plan (the shift+tab control). */
  cycleMode(): void {
    this.mode = MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length]!
  }

  request(toolName: string, input: Record<string, unknown>): Promise<PermissionResult> {
    if (this.always.has(toolName)) return Promise.resolve({ behavior: 'allow' })
    if (this.mode === 'bypass') return Promise.resolve({ behavior: 'allow' })
    if (this.mode === 'plan') {
      return Promise.resolve({ behavior: 'deny', message: 'Plan mode is read-only — switch off plan to make changes.' })
    }
    if (this.mode === 'acceptEdits' && EDIT_TOOLS.has(toolName.toLowerCase())) {
      return Promise.resolve({ behavior: 'allow' })
    }
    return new Promise<PermissionResult>((resolve) => {
      this.queue.push({
        pending: { toolName, title: toolName, detail: describe(toolName, input) },
        resolve,
      })
    })
  }

  decide(kind: 'allow' | 'always' | 'deny'): void {
    const head = this.queue.shift()
    if (!head) return
    if (kind === 'always') this.always.add(head.pending.toolName)
    head.resolve(
      kind === 'deny'
        ? { behavior: 'deny', message: 'Denied by the user.' }
        : { behavior: 'allow' },
    )
  }

  /** Resolve every pending request as denied (used when a turn is cancelled). */
  cancelAll(): void {
    while (this.queue.length > 0) {
      this.queue.shift()!.resolve({ behavior: 'deny', message: 'Cancelled.' })
    }
  }
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s
}

// Build human-readable detail lines for the approval modal, per tool.
function describe(toolName: string, input: Record<string, unknown>): string[] {
  switch (toolName.toLowerCase()) {
    case 'bash':
      return [`$ ${asString(input['command'])}`]
    case 'write': {
      const file = asString(input['file_path'])
      return [file, '', ...preview(asString(input['content']), 8)]
    }
    case 'edit':
    case 'multiedit': {
      const file = asString(input['file_path'])
      return [
        file,
        '',
        `- ${truncate(asString(input['old_string']), 160)}`,
        `+ ${truncate(asString(input['new_string']), 160)}`,
      ]
    }
    default:
      return [truncate(asString(input), 240)]
  }
}

function preview(content: string, maxLines: number): string[] {
  const lines = content.split('\n')
  const shown = lines.slice(0, maxLines)
  if (lines.length > maxLines) shown.push(`... (+${lines.length - maxLines} more lines)`)
  return shown
}
