export interface EditorSize { width: number; height: number }
export interface EditorPosition { x: number; y: number }

export function floatingEditorSize(workspace: EditorSize, preferredWidth: number): EditorSize {
  return {
    width: Math.max(0, Math.min(preferredWidth, workspace.width - 16)),
    height: Math.max(0, Math.min(680, workspace.height - 16))
  }
}

export function clampEditorPosition(position: EditorPosition, workspace: EditorSize, panel: EditorSize): EditorPosition {
  return {
    x: Math.max(0, Math.min(position.x, workspace.width - panel.width)),
    y: Math.max(0, Math.min(position.y, workspace.height - panel.height))
  }
}

export function shouldFollowAppend({ grew, nearBottom, editingEarlier, searching }: {
  grew: boolean; nearBottom: boolean; editingEarlier: boolean; searching: boolean
}): boolean {
  return grew && nearBottom && !editingEarlier && !searching
}
