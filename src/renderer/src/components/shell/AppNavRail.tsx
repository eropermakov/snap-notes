import type { ReactElement } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { NavRail, NavRailItem } from '../../ui'
import { GearIcon, NotesIcon, PanelLeftIcon, QuestionIcon } from '../icons'
import AiIndicator from '../ai/AiIndicator'

/** Global modes only. Everything section-specific lives in the context sidebar or workspace. */
export default function AppNavRail(): ReactElement {
  const section = useAppStore((s) => s.section)
  const sidebarOpen = useAppStore((s) => (s.layoutNarrow ? s.drawerOpen : s.sidebarOpen))
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const backToNotes = useAppStore((s) => s.backToNotes)
  const openSettings = useAppStore((s) => s.openSettings)
  const openInstructions = useAppStore((s) => s.openInstructions)

  return (
    <NavRail
      top={
        <>
          <NavRailItem
            label={sidebarOpen ? 'Скрыть боковую панель' : 'Показать боковую панель'}
            shortcut="Ctrl+\"
            icon={<PanelLeftIcon className="h-[18px] w-[18px]" />}
            onClick={toggleSidebar}
          />
          <div className="my-1 h-px w-6 bg-line" />
          <NavRailItem label="Заметки" icon={<NotesIcon className="h-5 w-5" />} active={section === 'notes'} onClick={backToNotes} />
        </>
      }
      bottom={
        <>
          <AiIndicator />
          <NavRailItem label="Справка" icon={<QuestionIcon className="h-5 w-5" />} active={section === 'help'} onClick={openInstructions} />
          <NavRailItem
            label="Настройки"
            shortcut="Ctrl+,"
            icon={<GearIcon className="h-5 w-5" />}
            active={section === 'settings'}
            onClick={() => openSettings()}
          />
        </>
      }
    />
  )
}
