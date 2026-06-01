import { For } from 'solid-js';

import { EDITOR_TOOLS, type EditorToolId } from '@/features/editor/editorTools';

interface EditorToolbarProps {
  readonly activeTool: EditorToolId;
  readonly hasActiveActor: boolean;
  readonly onSelect: (toolId: EditorToolId) => void;
}

export const EditorToolbar = (props: EditorToolbarProps) => (
  <nav class="editor-toolbar" aria-label="Editor tools">
    <For each={EDITOR_TOOLS}>
      {(tool) => (
        <button
          class="editor-tool"
          classList={{ 'is-active': props.activeTool === tool.id }}
          type="button"
          aria-pressed={props.activeTool === tool.id}
          disabled={tool.requiresActor && !props.hasActiveActor}
          onClick={() => props.onSelect(tool.id)}
        >
          <span class="editor-tool-index" aria-hidden="true">
            {tool.index}
          </span>
          <span>{tool.label}</span>
        </button>
      )}
    </For>
  </nav>
);
