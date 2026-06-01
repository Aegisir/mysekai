import { createMemo, createSignal, For } from 'solid-js';

import type { ModelId } from '@/domain/ids';
import type { CharacterDefinition, ModelDefinition } from '@/domain/manifest';

interface ModelPanelProps {
  readonly characters: readonly CharacterDefinition[];
  readonly selectedModelId: ModelId;
  readonly disabled: boolean;
  readonly active: boolean;
  readonly actors: readonly { id: string; label: string }[];
  readonly activeActorId: string | undefined;
  readonly onSelect: (model: ModelDefinition) => void;
  readonly onAdd: (model: ModelDefinition) => void;
  readonly onDeleteActive: () => void;
  readonly onActiveActorChange: (actorId: string) => void;
}

const findModel = (
  characters: readonly CharacterDefinition[],
  modelId: string,
): ModelDefinition | undefined => {
  for (const character of characters) {
    const model = character.models.find((candidate) => candidate.id === modelId);

    if (model) {
      return model;
    }
  }

  return undefined;
};

export const ModelPanel = (props: ModelPanelProps) => {
  const [query, setQuery] = createSignal('');

  const filteredCharacters = createMemo(() => {
    const keyword = query().trim().toLowerCase();

    if (!keyword) {
      return props.characters;
    }

    return props.characters
      .map((character) => {
        const matchesCharacter =
          character.name.toLowerCase().includes(keyword) ||
          (character.unit?.toLowerCase().includes(keyword) ?? false);

        const models = character.models.filter((model) => {
          if (matchesCharacter) {
            return true;
          }

          return model.name.toLowerCase().includes(keyword) || model.id.toLowerCase().includes(keyword);
        });

        return {
          ...character,
          models,
        };
      })
      .filter((character) => character.models.length > 0);
  });

  const handleSelect = (event: Event): void => {
    const target = event.currentTarget as HTMLSelectElement;
    const model = findModel(props.characters, target.value);

    if (model) {
      props.onSelect(model);
    }
  };

  const handleAdd = (): void => {
    const model = findModel(props.characters, props.selectedModelId);

    if (model) {
      props.onAdd(model);
    }
  };

  const handleActiveActorSelect = (event: Event): void => {
    const target = event.currentTarget as HTMLSelectElement;
    props.onActiveActorChange(target.value);
  };

  const handleQueryInput = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;
    setQuery(target.value);
  };

  return (
    <section
      class="control-section editor-panel"
      classList={{ 'is-active': props.active }}
      hidden={!props.active}
      aria-hidden={props.active ? 'false' : 'true'}
      aria-labelledby="model-panel-title"
    >
      <div class="section-heading">
        <h2 id="model-panel-title">Character</h2>
      </div>

      <label class="field">
        <span>Search Model</span>
        <input
          type="search"
          value={query()}
          onInput={handleQueryInput}
          placeholder="Name or id"
          disabled={props.disabled}
        />
      </label>

      <label class="field">
        <span>Model</span>
        <select value={props.selectedModelId} onChange={handleSelect} disabled={props.disabled}>
          <For each={filteredCharacters()}>
            {(character) => (
              <optgroup label={character.unit ? `${character.name} - ${character.unit}` : character.name}>
                <For each={character.models}>
                  {(model) => <option value={model.id}>{model.name}</option>}
                </For>
              </optgroup>
            )}
          </For>
        </select>
      </label>

      <div class="button-row">
        <button class="primary-button" type="button" onClick={handleAdd} disabled={props.disabled}>
          Add
        </button>
        <button
          class="ghost-button"
          type="button"
          onClick={props.onDeleteActive}
          disabled={props.disabled || !props.activeActorId}
        >
          Delete
        </button>
      </div>

      <label class="field">
        <span>Active</span>
        <select
          value={props.activeActorId ?? ''}
          onChange={handleActiveActorSelect}
          disabled={props.disabled || props.actors.length === 0}
        >
          <For each={props.actors}>{(actor) => <option value={actor.id}>{actor.label}</option>}</For>
        </select>
      </label>
    </section>
  );
};
