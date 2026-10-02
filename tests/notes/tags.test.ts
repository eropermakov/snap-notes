import { describe, expect, it } from 'vitest'
import { addTags, MAX_TAGS_PER_NOTE, normalizeTag, normalizeTags, parseTagInput, removeTags } from '../../src/shared/noteMeta'

describe('tags', () => {
  it('never creates two tags for "работа" and "#работа"', () => {
    expect(normalizeTag('#Работа')).toBe('работа')
    expect(normalizeTags(['работа', '#работа', '##РАБОТА '])).toEqual(['работа'])
  })

  it('parses free input into clean tags', () => {
    expect(parseTagInput('#работа, важно  идеи;')).toEqual(['работа', 'важно', 'идеи'])
    expect(parseTagInput('   ')).toEqual([])
  })

  it('turns inner spaces into dashes and limits length', () => {
    expect(normalizeTag('  мой  проект ')).toBe('мой-проект')
    expect(normalizeTag('x'.repeat(100))).toHaveLength(32)
  })

  it('adds without duplicates and removes by normalized name', () => {
    expect(addTags(['a'], ['#A', 'b'])).toEqual(['a', 'b'])
    expect(removeTags(['a', 'b', 'c'], ['#B'])).toEqual(['a', 'c'])
  })

  it('ignores non-strings and caps the number of tags', () => {
    expect(normalizeTags([1, null, {}, 'ok'])).toEqual(['ok'])
    expect(normalizeTags(Array.from({ length: 50 }, (_, i) => `t${i}`))).toHaveLength(MAX_TAGS_PER_NOTE)
    expect(normalizeTags('not an array')).toEqual([])
  })
})
