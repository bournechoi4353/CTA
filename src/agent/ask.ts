export interface PendingQuestion {
  question: string
  options: string[]
}

interface Entry {
  q: PendingQuestion
  resolve: (answer: string) => void
}

/**
 * Mediates "ask the user a preference question" between the agent's `ask_user`
 * tool and the TUI. The tool handler calls {@link ask} and awaits; the UI shows
 * {@link current} as a modal and calls {@link answer} on a keypress. Requests
 * queue (one question at a time).
 */
export class AskController {
  private readonly queue: Entry[] = []

  get current(): PendingQuestion | null {
    return this.queue[0]?.q ?? null
  }

  ask(question: string, options: string[]): Promise<string> {
    const cleaned = options.map((o) => o.trim()).filter((o) => o.length > 0).slice(0, 9)
    const safe = cleaned.length > 0 ? cleaned : ['ok']
    return new Promise<string>((resolve) => {
      this.queue.push({ q: { question, options: safe }, resolve })
    })
  }

  answer(index: number): void {
    const head = this.queue.shift()
    if (!head) return
    head.resolve(head.q.options[index] ?? head.q.options[0] ?? 'ok')
  }

  cancelAll(): void {
    while (this.queue.length > 0) this.queue.shift()!.resolve('(the user cancelled the question)')
  }
}
