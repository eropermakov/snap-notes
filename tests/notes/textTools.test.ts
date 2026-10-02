import { describe, expect, it } from 'vitest'
import { contactHref, findContactAt, findContacts, isOpenableLink, isPlausiblePhone, linesToItems, meaningfulTitle, removeLineBreaks } from '../../src/shared/textTools'

describe('remove unnecessary line breaks', () => {
  it('joins the lines of one paragraph and keeps real paragraph breaks', () => {
    const input = 'Первая строка абзаца\nпродолжается здесь\nи заканчивается.\n\nВторой абзац\nтоже перенесён.'
    expect(removeLineBreaks(input)).toBe('Первая строка абзаца продолжается здесь и заканчивается.\n\nВторой абзац тоже перенесён.')
  })

  it('merges words split by a hyphen at the line end', () => {
    expect(removeLineBreaks('распозна-\nвание текста')).toBe('распознавание текста')
  })

  it('does not break lists', () => {
    const input = '- первый пункт\n- второй пункт\nпродолжение второго\n1. раз\n2. два'
    expect(removeLineBreaks(input)).toBe('- первый пункт\n- второй пункт продолжение второго\n1. раз\n2. два')
  })

  it('does not join code or table-looking lines', () => {
    const code = 'function a() {\n  return 1;\n}'
    expect(removeLineBreaks(code)).toBe(code)
    const table = 'Имя | Город\nАнна | Москва'
    expect(removeLineBreaks(table)).toBe(table)
    expect(removeLineBreaks('a\tb\nc\td')).toBe('a\tb\nc\td')
  })
})

describe('convert to list', () => {
  it('turns each line into an item and strips existing markers', () => {
    expect(linesToItems('молоко\n- хлеб\n2. яйца\n\n☑ сыр').map((i) => i.text)).toEqual(['молоко', 'хлеб', 'яйца', 'сыр'])
    expect(linesToItems('[x] готово\n[ ] нет').map((i) => i.checked)).toEqual([true, false])
  })
})

describe('links, e-mails and phones', () => {
  it('finds URLs without the trailing punctuation', () => {
    const [url] = findContacts('Смотри (https://example.com/a?b=1#c), пожалуйста.')
    expect(url).toMatchObject({ kind: 'url', value: 'https://example.com/a?b=1#c' })
    expect(contactHref(findContacts('сайт www.example.org')[0])).toBe('https://www.example.org')
  })

  it('finds e-mails and builds mailto', () => {
    const [mail] = findContacts('пишите на anna.k+work@example.co.uk сегодня')
    expect(mail).toMatchObject({ kind: 'email', value: 'anna.k+work@example.co.uk' })
    expect(contactHref(mail)).toBe('mailto:anna.k+work@example.co.uk')
  })

  it('finds reasonable phone formats', () => {
    for (const phone of ['+31 6 12345678', '+7 (912) 345-67-89', '8 (912) 345-67-89', '+79123456789']) {
      const found = findContacts(`звоните ${phone} завтра`)
      expect(found, phone).toHaveLength(1)
      expect(found[0].kind).toBe('phone')
    }
    expect(contactHref(findContacts('+7 (912) 345-67-89')[0])).toBe('tel:+79123456789')
  })

  it('does not turn random numbers, dates, ids and versions into phones', () => {
    for (const text of ['счёт 1234567890123456', 'дата 2024-01-15', 'версия 1.2.3.4', 'код 111 111 1111', 'сумма 15 000', 'индекс 123456']) {
      expect(findContacts(text).filter((c) => c.kind === 'phone'), text).toEqual([])
    }
    expect(isPlausiblePhone('12345')).toBe(false)
  })

  it('does not treat the digits of an e-mail or URL as a phone', () => {
    const found = findContacts('mail 79123456789@example.com и https://x.com/79123456789')
    expect(found.map((c) => c.kind).sort()).toEqual(['email', 'url'])
  })

  it('finds the contact under a given text offset', () => {
    const text = 'открой https://example.com сейчас'
    expect(findContactAt(text, 10)?.kind).toBe('url')
    expect(findContactAt(text, 2)).toBeNull()
  })

  it('only allows http(s), mailto and tel to reach the system', () => {
    expect(isOpenableLink('https://a.b')).toBe(true)
    expect(isOpenableLink('mailto:a@b.co')).toBe(true)
    expect(isOpenableLink('tel:+31612345678')).toBe(true)
    for (const bad of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-msdt:/id', 'C:\\x.exe', '', 5, 'https://a b']) {
      expect(isOpenableLink(bad), String(bad)).toBe(false)
    }
  })
})

describe('automatic titles', () => {
  it('uses the first meaningful line', () => {
    expect(meaningfulTitle('•\n--\n# Отчёт за май\nтекст')).toBe('Отчёт за май')
    expect(meaningfulTitle('1. Купить молоко\n2. Хлеб')).toBe('Купить молоко')
  })

  it('shortens long lines at a word boundary', () => {
    const title = meaningfulTitle('очень длинная строка '.repeat(10))
    expect(title.length).toBeLessThanOrEqual(61)
    expect(title.endsWith('…')).toBe(true)
  })

  it('returns an empty title for empty text', () => {
    expect(meaningfulTitle('  \n ')).toBe('')
  })
})
