#!/usr/bin/env node
import { run } from './app'

const VERSION = '0.1.0'
const args = process.argv.slice(2)

if (args.includes('-v') || args.includes('--version')) {
  process.stdout.write(`cta v${VERSION}\n`)
  process.exit(0)
}

if (args.includes('-h') || args.includes('--help')) {
  process.stdout.write(
    [
      `cta v${VERSION} — a terminal coding assistant with a reactive visualizer`,
      '',
      'usage: cta [options] [prompt]',
      '',
      '  prompt          pre-fill the input with this text (press Enter to send)',
      '  -h, --help      show this help',
      '  -v, --version   show version',
      '',
      'auth: set ANTHROPIC_API_KEY, or run `claude` once to log in (subscription).',
      'in-app: /help for commands · shift+tab for permission modes · Ctrl-C to quit.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const initialPrompt = args.filter((a) => !a.startsWith('-')).join(' ').trim()
run(initialPrompt.length > 0 ? initialPrompt : undefined)
