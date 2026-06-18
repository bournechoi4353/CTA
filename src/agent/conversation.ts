export type Role = 'user' | 'assistant' | 'system' | 'diff'

export interface Turn {
  role: Role
  text: string
}

/** The running chat transcript. The agent appends to it; the UI renders it. */
export class Conversation {
  private turns: Turn[] = []
  private rev = 0

  get all(): readonly Turn[] {
    return this.turns
  }

  /** Bumped on every mutation — lets the UI cache rendered lines cheaply. */
  get revision(): number {
    return this.rev
  }

  add(role: Role, text: string): void {
    this.turns.push({ role, text })
    this.rev += 1
  }

  /** Append text to the last turn if it's the same role, else start a new one. */
  appendToLast(role: Role, text: string): void {
    const last = this.turns[this.turns.length - 1]
    if (last && last.role === role) last.text += text
    else this.turns.push({ role, text })
    this.rev += 1
  }

  clear(): void {
    this.turns = []
    this.rev += 1
  }
}
