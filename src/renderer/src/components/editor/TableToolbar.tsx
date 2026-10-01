import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { tableToCsv, tableToMarkdown, tableToTsv } from '@shared/blockExport'
import { useAppStore } from '../../store/useAppStore'
import { DropdownMenu, IconButton, MenuItem, cn } from '../../ui'
import { CopyIcon } from '../icons'

interface Props {
  root: HTMLDivElement | null
  wrapper: HTMLDivElement | null
  onChange: () => void
}

interface Active {
  table: HTMLTableElement
  row: HTMLTableRowElement
  cellIndex: number
  top: number
}

function rowsOf(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table)
}

function cellsOf(row: HTMLTableRowElement): HTMLTableCellElement[] {
  return Array.from(row.cells)
}

function emptyCell(tag: 'td' | 'th'): HTMLTableCellElement {
  const cell = document.createElement(tag)
  cell.appendChild(document.createElement('br'))
  return cell
}

/** Table contents as inline HTML rows, for Markdown / TSV / CSV export. */
function tableRows(table: HTMLTableElement): string[][] {
  return rowsOf(table).map((tr) => cellsOf(tr).map((c) => c.innerHTML))
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="h-6 whitespace-nowrap rounded-md px-1.5 text-sm text-fg-secondary transition-colors duration-fast hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  )
}

/** Toolbar over the table that holds the caret (§9): rows, columns, header row, copy formats. */
export default function TableToolbar({ root, wrapper, onChange }: Props): ReactElement | null {
  const pushToast = useAppStore((s) => s.pushToast)
  const [active, setActive] = useState<Active | null>(null)

  useEffect(() => {
    if (!root || !wrapper) return undefined
    const update = (): void => {
      const selection = window.getSelection()
      const node = selection?.anchorNode ?? null
      const cell = node && root.contains(node) ? ((node instanceof HTMLElement ? node : node.parentElement)?.closest('td,th') as HTMLTableCellElement | null) : null
      const table = cell?.closest('table') as HTMLTableElement | null
      if (!cell || !table || !root.contains(table)) {
        setActive(null)
        return
      }
      const row = cell.parentElement as HTMLTableRowElement
      setActive({
        table,
        row,
        cellIndex: cellsOf(row).indexOf(cell),
        top: table.getBoundingClientRect().top - wrapper.getBoundingClientRect().top
      })
    }
    document.addEventListener('selectionchange', update)
    root.addEventListener('input', update)
    return () => {
      document.removeEventListener('selectionchange', update)
      root.removeEventListener('input', update)
    }
  }, [root, wrapper])

  if (!active || !root) return null
  const { table, row, cellIndex } = active
  const inHead = row.parentElement?.tagName === 'THEAD'

  const commit = (): void => {
    onChange()
    setActive(null)
  }

  const addRow = (): void => {
    const width = Math.max(...rowsOf(table).map((r) => r.cells.length))
    const tr = document.createElement('tr')
    for (let i = 0; i < width; i++) tr.appendChild(emptyCell('td'))
    if (inHead) {
      let body = table.tBodies[0]
      if (!body) body = table.createTBody()
      body.insertBefore(tr, body.firstChild)
    } else {
      row.after(tr)
    }
    commit()
  }

  const addColumn = (): void => {
    for (const tr of rowsOf(table)) {
      const tag = tr.parentElement?.tagName === 'THEAD' ? 'th' : 'td'
      const ref = tr.cells[cellIndex]
      const cell = emptyCell(tag)
      if (ref) ref.after(cell)
      else tr.appendChild(cell)
    }
    commit()
  }

  const deleteRow = (): void => {
    row.remove()
    if (rowsOf(table).length === 0) table.remove()
    commit()
  }

  const deleteColumn = (): void => {
    for (const tr of rowsOf(table)) tr.cells[cellIndex]?.remove()
    if (rowsOf(table).every((tr) => tr.cells.length === 0)) table.remove()
    commit()
  }

  const toggleHeader = (): void => {
    const convert = (tr: HTMLTableRowElement, tag: 'td' | 'th'): void => {
      for (const cell of cellsOf(tr)) {
        const next = document.createElement(tag)
        while (cell.firstChild) next.appendChild(cell.firstChild)
        cell.replaceWith(next)
      }
    }
    if (table.tHead) {
      const rows = Array.from(table.tHead.rows)
      let body = table.tBodies[0]
      if (!body) body = table.createTBody()
      for (const tr of rows.reverse()) {
        convert(tr, 'td')
        body.insertBefore(tr, body.firstChild)
      }
      table.tHead.remove()
    } else {
      const first = rowsOf(table)[0]
      if (!first) return
      const head = table.createTHead()
      convert(first, 'th')
      head.appendChild(first)
    }
    commit()
  }

  const copy = (format: 'md' | 'tsv' | 'csv'): void => {
    const rows = tableRows(table)
    const text = format === 'md' ? tableToMarkdown(rows) : format === 'tsv' ? tableToTsv(rows) : tableToCsv(rows)
    void navigator.clipboard.writeText(text)
    pushToast('success', `Таблица скопирована (${format === 'md' ? 'Markdown' : format.toUpperCase()})`)
  }

  return (
    <div
      role="toolbar"
      aria-label="Таблица"
      className={cn('absolute right-0 z-[5] flex max-w-full -translate-y-full flex-wrap items-center justify-end gap-0.5 rounded-lg border border-line bg-elevated p-0.5 shadow-popover')}
      style={{ top: Math.max(0, active.top - 4) }}
    >
      <Tool label="Добавить строку ниже" onClick={addRow}>
        + строка
      </Tool>
      <Tool label="Добавить столбец справа" onClick={addColumn}>
        + столбец
      </Tool>
      <Tool label="Удалить строку" onClick={deleteRow}>
        − строка
      </Tool>
      <Tool label="Удалить столбец" onClick={deleteColumn}>
        − столбец
      </Tool>
      <Tool label={table.tHead ? 'Убрать строку заголовка' : 'Сделать первую строку заголовком'} onClick={toggleHeader}>
        {table.tHead ? 'без заголовка' : 'заголовок'}
      </Tool>
      <DropdownMenu
        label="Копировать таблицу"
        trigger={(p) => <IconButton {...p} size="sm" label="Копировать таблицу" icon={<CopyIcon />} onMouseDown={(e) => e.preventDefault()} />}
      >
        <MenuItem onSelect={() => copy('md')}>Как Markdown</MenuItem>
        <MenuItem onSelect={() => copy('tsv')}>Как TSV (для Excel)</MenuItem>
        <MenuItem onSelect={() => copy('csv')}>Как CSV</MenuItem>
      </DropdownMenu>
    </div>
  )
}
