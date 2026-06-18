const MAX_LINES = 16

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function cap(lines: string[], prefix: string): string[] {
  const shown = lines.slice(0, MAX_LINES).map((l) => `${prefix} ${l}`)
  if (lines.length > MAX_LINES) shown.push(`${prefix} ... (+${lines.length - MAX_LINES} more)`)
  return shown
}

/**
 * Build a `- old / + new` diff string for an edit/write tool call (rendered as a
 * 'diff' transcript turn). Returns null for non-edit tools.
 */
export function formatEditDiff(toolName: string, input: Record<string, unknown>): string | null {
  const tool = toolName.toLowerCase()
  const file = str(input['file_path'])

  if (tool === 'write') {
    return [`${file}  (new file)`, ...cap(str(input['content']).split('\n'), '+')].join('\n')
  }
  if (tool === 'edit') {
    return [
      file,
      ...cap(str(input['old_string']).split('\n'), '-'),
      ...cap(str(input['new_string']).split('\n'), '+'),
    ].join('\n')
  }
  if (tool === 'multiedit') {
    const edits = Array.isArray(input['edits']) ? input['edits'].length : 0
    return `${file}  (${edits} edit${edits === 1 ? '' : 's'})`
  }
  return null
}
