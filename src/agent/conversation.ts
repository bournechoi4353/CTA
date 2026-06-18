export type Role = 'user' | 'assistant' | 'system'

export interface Turn {
  role: Role
  text: string
}

/** The running chat transcript. The agent appends to it; the UI renders it. */
export class Conversation {
  private turns: Turn[] = []

  get all(): readonly Turn[] {
    return this.turns
  }

  add(role: Role, text: string): void {
    this.turns.push({ role, text })
  }

  /** Append text to the last turn if it's the same role, else start a new one. */
  appendToLast(role: Role, text: string): void {
    const last = this.turns[this.turns.length - 1]
    if (last && last.role === role) last.text += text
    else this.turns.push({ role, text })
  }

  clear(): void {
    this.turns = []
  }
}
