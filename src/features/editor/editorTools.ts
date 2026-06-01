export const EDITOR_TOOLS = [
  { id: 'character', label: 'Character', index: '01', requiresActor: false },
  { id: 'motion', label: 'Motion', index: '02', requiresActor: true },
  { id: 'transform', label: 'Transform', index: '03', requiresActor: true },
  { id: 'canvas', label: 'Canvas', index: '04', requiresActor: false },
  { id: 'export', label: 'Export', index: '05', requiresActor: true },
] as const;

export type EditorToolId = (typeof EDITOR_TOOLS)[number]['id'];
export type ActorEditorToolId = Exclude<EditorToolId, 'character' | 'canvas'>;

export const readEditorToolLabel = (toolId: EditorToolId): string =>
  EDITOR_TOOLS.find((tool) => tool.id === toolId)?.label ?? 'Controls';
