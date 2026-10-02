import { describe, expect, it } from 'vitest'
import type { Block } from '../../src/shared/blocks'
import { collapseRunaway, trimOverlap } from '../../src/shared/repeatGuard'

let n = 0
const para = (html: string, sourceId?: string): Block => ({ id: `b${++n}`, type: 'paragraph', html, ...(sourceId ? { sourceId } : {}) })
const texts = (blocks: Block[]): string[] => blocks.map((b) => (b.type === 'paragraph' ? b.html : b.type))

describe('collapseRunaway (a looping answer)', () => {
  it('keeps a few identical lines: they are real content', () => {
    const blocks = [para('Status: OK'), para('Status: OK'), para('Status: OK'), para('Status: OK'), para('Error: connection refused')]
    const result = collapseRunaway(blocks)
    expect(result.removed).toBe(0)
    expect(result.blocks).toHaveLength(5)
  })

  it('collapses one line repeated far beyond any real screen', () => {
    const blocks = [para('Service report'), ...Array.from({ length: 30 }, () => para('nginx running OK')), para('Done')]
    const result = collapseRunaway(blocks)
    expect(texts(result.blocks)).toEqual(['Service report', 'nginx running OK', 'Done'])
    expect(result.removed).toBe(29)
  })

  it('collapses a cycle of lines (A B A B …) to one cycle', () => {
    const cycle = Array.from({ length: 6 }, () => [para('GET /health 200'), para('GET /ready 200')]).flat()
    const result = collapseRunaway([para('access log'), ...cycle, para('end')])
    expect(texts(result.blocks)).toEqual(['access log', 'GET /health 200', 'GET /ready 200', 'end'])
  })

  it('leaves real data that only looks similar', () => {
    const rows = Array.from({ length: 12 }, (_, i) => para(`worker-${i} idle`))
    expect(collapseRunaway(rows).removed).toBe(0)
  })

  it('never collapses separators and symbols', () => {
    const rows = Array.from({ length: 12 }, () => para('------------'))
    expect(collapseRunaway(rows).removed).toBe(0)
  })

  it('cuts a table that repeats one row endlessly, keeps normal repeated rows', () => {
    const row = ['nginx', 'running', 'OK']
    const normal: Block = { id: 'b-t1', type: 'table', header: false, rows: [row, row, row, ['redis', 'running', 'OK']] }
    const loop: Block = { id: 'b-t2', type: 'table', header: false, rows: [['host', 'state'], ...Array.from({ length: 20 }, () => row), ['end', 'x']] }
    const result = collapseRunaway([normal, loop])
    expect((result.blocks[0] as { rows: string[][] }).rows).toHaveLength(4)
    expect((result.blocks[1] as { rows: string[][] }).rows).toEqual([['host', 'state'], row, ['end', 'x']])
  })

  it('collapses a code dump that repeats a line, keeps a short repeat', () => {
    const code = (lines: string[]): Block => ({ id: `c${++n}`, type: 'code', code: lines.join('\n') })
    const loop = code(['start', ...Array.from({ length: 40 }, () => 'retry connection to db'), 'stop'])
    const fine = code(['a = 1', 'retry connection to db', 'retry connection to db', 'retry connection to db', 'b = 2'])
    const result = collapseRunaway([loop, fine])
    expect((result.blocks[0] as { code: string }).code).toBe('start\nretry connection to db\nstop')
    expect((result.blocks[1] as { code: string }).code).toContain('retry connection to db\nretry connection to db\nretry connection to db')
  })

  it('cuts a phrase repeated inside one paragraph', () => {
    const loop = para(`Connection timed out. ${'Connection timed out. '.repeat(9)}Next step`)
    const result = collapseRunaway([loop])
    expect(texts(result.blocks)[0]).toBe('Connection timed out. Next step')
  })
})

describe('trimOverlap (long page captured in pieces)', () => {
  const A = (s: string): Block => para(s, 'src-a')
  const B = (s: string): Block => para(s, 'src-b')

  it('drops the lines the previous capture ended with', () => {
    const previous = [A('Header'), A('line 1 of the log'), A('line 2 of the log')]
    const next = [B('line 1 of the log'), B('line 2 of the log'), B('line 3 of the log')]
    const result = trimOverlap(previous, next)
    expect(texts(result.blocks)).toEqual(['line 3 of the log'])
    expect(result.removed).toBe(2)
  })

  it('works when the recognizer glued the lines into one paragraph', () => {
    const previous = [A('Server log part one Worker alpha started on port 8081 Worker beta started on port 8082')]
    const next = [B('Worker alpha started on port 8081 Worker beta started on port 8082 Worker gamma started on port 8083')]
    const result = trimOverlap(previous, next)
    expect(texts(result.blocks)).toEqual(['Worker gamma started on port 8083'])
  })

  it('ignores case and spacing', () => {
    const result = trimOverlap([A('Server  started'), A('Port 8080 open')], [B('server started'), B('PORT 8080  open'), B('ready')])
    expect(texts(result.blocks)).toEqual(['ready'])
  })

  it('a short coincidence is not an overlap', () => {
    expect(trimOverlap([A('line 1'), A('OK')], [B('OK'), B('next')]).removed).toBe(0)
    expect(trimOverlap([A('first part'), A('Status: OK')], [B('Status: OK'), B('Disk space is fine')]).removed).toBe(0)
  })

  it('does not cut inside a word', () => {
    const result = trimOverlap([A('the service restarted after the node reboot')], [B('node reboot completed successfully and nothing else happened')])
    expect(result.removed).toBe(0)
    const half = trimOverlap([A('the service restarted after the nodes reboot completed')], [B('s reboot completed and then something new appears here')])
    expect(half.removed).toBe(0)
  })

  it('keeps a second capture that is a full copy of the first (a deliberate repeat)', () => {
    const result = trimOverlap([A('one line of the report'), A('two line of the report')], [B('one line of the report'), B('two line of the report')])
    expect(result.removed).toBe(0)
  })

  it('does not compare with text the user typed after the last capture', () => {
    const result = trimOverlap([A('first line here ok'), A('second line here ok'), para('my own words')], [B('first line here ok'), B('second line here ok'), B('third')])
    expect(result.removed).toBe(0)
  })

  it('an empty note has nothing to overlap with', () => {
    expect(trimOverlap([], [B('anything long enough to count here, really'), B('more')]).removed).toBe(0)
  })
})
