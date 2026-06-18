// Standalone agent probe — bypasses CTA's TUI to show the RAW SDK behavior.
// Run in a repo with auth:   node agent-test.mjs "create a file cta-probe.txt with hi"
// It auto-allows every tool, so if a Write still fails we see the real error.
import { query } from '@anthropic-ai/claude-agent-sdk'

const prompt =
  process.argv.slice(2).join(' ') ||
  'Create a file named cta-probe.txt containing the text "hello from cta".'

console.log('cwd   :', process.cwd())
console.log('prompt:', prompt)
console.log('node  :', process.version)
console.log('--- streaming + canUseTool(auto-allow) ---\n')

async function* input() {
  yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null }
  await new Promise(() => {}) // hold the stream open; we exit on `result`
}

const options = {
  cwd: process.cwd(),
  allowedTools: ['Read', 'Glob', 'Grep'],
  permissionMode: 'default',
  canUseTool: async (name, inp) => {
    console.log(`[canUseTool] ${name}  ${JSON.stringify(inp).slice(0, 160)}`)
    return { behavior: 'allow', updatedInput: inp } // allow REQUIRES updatedInput
  },
  stderr: (d) => process.stderr.write('[cli-stderr] ' + d),
}

try {
  for await (const msg of query({ prompt: input(), options })) {
    if (msg.type === 'assistant') {
      for (const b of msg.message?.content ?? []) {
        if (b.type === 'text') console.log('[assistant]', b.text)
        else if (b.type === 'tool_use') console.log('[tool_use ]', b.name, JSON.stringify(b.input).slice(0, 200))
        else console.log('[block]', b.type)
      }
    } else if (msg.type === 'user') {
      for (const b of msg.message?.content ?? []) {
        if (b.type === 'tool_result') {
          console.log('[tool_result]', b.is_error ? '*** ERROR ***' : 'ok', '-', JSON.stringify(b.content).slice(0, 400))
        }
      }
    } else if (msg.type === 'result') {
      console.log('\n[result]', msg.subtype, '-', String(msg.result ?? '').slice(0, 300))
      console.log('--- DONE ---')
      process.exit(0)
    } else if (msg.type === 'system') {
      console.log('[system]', msg.subtype, msg.subtype === 'init' ? `model=${msg.model} auth=${msg.apiKeySource}` : '')
    } else {
      console.log('[' + msg.type + ']', msg.subtype ?? '')
    }
  }
} catch (e) {
  console.error('\n[QUERY THREW]', e && e.stack ? e.stack : e)
  process.exit(1)
}
