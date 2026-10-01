import { describe, expect, it } from 'vitest'
import { RecognitionService, assessComplexity } from '../../src/main/providers/recognition'
import { TesseractProvider, type LocalOcrLine, type LocalOcrResult } from '../../src/main/providers/impl/tesseract'
import { isVisionRequest } from '../../src/main/providers/types'
import { FakeProvider, createHarness, failWith, settle } from './fakes'
import type { AiSettings } from '../../src/shared/providers'

const IMAGE = Buffer.from('fake-png')

const PROMPTS = {
  vision: 'VISION PROMPT',
  textFormat: (text: string) => `FORMAT:${text}`,
  jsonRepair: (broken: string) => `REPAIR:${broken}`
}

function line(text: string, y: number, x0 = 10, confidence = 95): LocalOcrLine {
  return { text, confidence, bbox: { x0, y0: y, x1: x0 + text.length * 8, y1: y + 14 }, wordConfidences: text.split(/\s+/).map(() => confidence) }
}

const SIMPLE: LocalOcrResult = {
  text: 'Обычный абзац текста, распознанный уверенно.\nВторая строка того же абзаца.',
  confidence: 93,
  lines: [line('Обычный абзац текста, распознанный уверенно.', 10), line('Вторая строка того же абзаца.', 30)]
}

const TABLE: LocalOcrResult = {
  text: 'Компания Цена\nApple 100\nSamsung 120',
  confidence: 90,
  lines: [line('Компания', 10, 10), line('Цена', 10, 300), line('Apple', 30, 10), line('100', 30, 300), line('Samsung', 50, 10), line('120', 50, 300)]
}

function setup(mode: AiSettings['mode'], local: LocalOcrResult | Error, cloud: FakeProvider[]) {
  const engine = {
    recognize: async () => {
      if (local instanceof Error) throw local
      return local
    },
    ready: async () => {}
  }
  const tesseract = new TesseractProvider(engine)
  const h = createHarness([...cloud, tesseract as unknown as FakeProvider], { mode })
  const service = new RecognitionService(h.manager, tesseract, () => h.settings)
  return { service, h }
}

describe('assessComplexity (balanced mode)', () => {
  it('treats confident single-column prose as simple', () => {
    expect(assessComplexity(SIMPLE)).toMatchObject({ complex: false })
  })
  it('detects side-by-side columns as a table', () => {
    const result = assessComplexity(TABLE)
    expect(result.reasons).toContain('columns')
    expect(result.operation).toBe('TABLE_RECOGNITION')
  })
  it('detects code', () => {
    const code: LocalOcrResult = {
      text: 'def main():\n    return 0',
      confidence: 92,
      lines: [line('def main():', 10), line('    return {0};', 30)]
    }
    expect(assessComplexity(code).operation).toBe('CODE_RECOGNITION')
  })
  it('low confidence is complex', () => {
    expect(assessComplexity({ ...SIMPLE, confidence: 50 }).reasons).toContain('low_confidence')
  })
})

describe('RecognitionService modes', () => {
  it('offline only: Tesseract, and not a single byte reaches a cloud provider', async () => {
    const gemini = new FakeProvider('gemini')
    const { service } = setup('offline', SIMPLE, [gemini])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(out.provider).toBe('tesseract')
    expect(out.structured).toBe(false)
    expect(out.raw).toBe(SIMPLE.text)
    expect(gemini.calls).toHaveLength(0)
  })

  it('economy: Tesseract text → text model; no image leaves the computer', async () => {
    const gemini = new FakeProvider('gemini')
    const { service } = setup('economy', SIMPLE, [gemini])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(out.provider).toBe('gemini')
    expect(gemini.calls).toHaveLength(1)
    expect(isVisionRequest(gemini.calls[0])).toBe(false)
    expect(gemini.calls[0].prompt).toBe(`FORMAT:${SIMPLE.text}`)
    expect(out.structured).toBe(true)
  })

  it('balanced: simple text takes the text path, complex layout the vision path', async () => {
    const gemini = new FakeProvider('gemini')
    const simple = setup('balanced', SIMPLE, [gemini])
    await settle()
    await simple.service.recognize(IMAGE, PROMPTS)
    expect(isVisionRequest(gemini.calls[0])).toBe(false)

    const gemini2 = new FakeProvider('gemini')
    const complex = setup('balanced', TABLE, [gemini2])
    await settle()
    await complex.service.recognize(IMAGE, PROMPTS)
    expect(isVisionRequest(gemini2.calls[0])).toBe(true)
    expect(gemini2.calls[0].operation).toBe('TABLE_RECOGNITION')
  })

  it('best quality: the vision model gets the screenshot', async () => {
    const chatgpt = new FakeProvider('chatgpt')
    const { service } = setup('best', SIMPLE, [chatgpt])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(out.provider).toBe('chatgpt')
    expect(isVisionRequest(chatgpt.calls[0])).toBe(true)
    expect(chatgpt.calls[0].prompt).toBe('VISION PROMPT')
  })

  it('Tesseract fallback when every cloud provider fails (best)', async () => {
    const { service } = setup('best', SIMPLE, [
      new FakeProvider('chatgpt', false, failWith('chatgpt', 'PLAN_LIMIT')),
      new FakeProvider('gemini', false, failWith('gemini', 'NETWORK'))
    ])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(out.provider).toBe('tesseract')
    expect(out.offlineFallback).toBe(true)
    expect(out.notice?.offlineFallback).toBe(true)
    expect(out.raw).toBe(SIMPLE.text)
  })

  it('balanced complex: cloud failure reuses the local result instead of re-running OCR', async () => {
    let localRuns = 0
    const engine = {
      recognize: async () => {
        localRuns++
        return TABLE
      },
      ready: async () => {}
    }
    const tesseract = new TesseractProvider(engine)
    const h = createHarness([new FakeProvider('gemini', false, failWith('gemini', 'PROVIDER_DOWN')), tesseract as unknown as FakeProvider], {
      mode: 'balanced'
    })
    const service = new RecognitionService(h.manager, tesseract, () => h.settings)
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(out.offlineFallback).toBe(true)
    expect(localRuns).toBe(1)
  })

  it('structured JSON failure: one repair request, then valid JSON', async () => {
    let n = 0
    const gemini = new FakeProvider('gemini', false, async () => {
      n++
      return n === 1
        ? // Malformed in the middle (missing comma), not merely truncated: needs the repair request.
          { text: '{"blocks":[{"type":"paragraph","text":"Цена 15 000 ₽"} {"type":"paragraph","text":"x"}]}', model: 'g' }
        : { text: '{"blocks":[{"type":"paragraph","text":"Цена 15 000 ₽"}]}', model: 'g' }
    })
    const { service } = setup('best', SIMPLE, [gemini])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(gemini.calls).toHaveLength(2)
    expect(isVisionRequest(gemini.calls[1])).toBe(false)
    expect(gemini.calls[1].prompt.startsWith('REPAIR:')).toBe(true)
    expect(out.structured).toBe(true)
  })

  it('structured JSON failure twice: falls back to plain text, never throws', async () => {
    const gemini = new FakeProvider('gemini', false, async () => ({ text: '{"blocks": [ {"type": "paragraph", "text": ', model: 'g' }))
    const { service } = setup('best', SIMPLE, [gemini])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(gemini.calls).toHaveLength(2)
    expect(out.structured).toBe(false)
  })

  it('locally repairable JSON needs no extra request', async () => {
    const gemini = new FakeProvider('gemini', false, async () => ({
      text: '```json\n{"blocks":[{"type":"heading","text":"Тариф Pro"},]}\n```',
      model: 'g'
    }))
    const { service } = setup('best', SIMPLE, [gemini])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(gemini.calls).toHaveLength(1)
    expect(out.structured).toBe(true)
  })

  it('economy without any text provider still returns the local text', async () => {
    const { service } = setup('economy', SIMPLE, [])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(out.provider).toBe('tesseract')
    expect(out.raw).toBe(SIMPLE.text)
  })

})
