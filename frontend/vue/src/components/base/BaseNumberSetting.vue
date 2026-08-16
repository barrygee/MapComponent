<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useStagedSetting } from '@/composables/useStagedSetting'

/**
 * `BaseNumberSetting` — a Settings-panel digit-filtered number input with an
 * optional unit suffix, wired to the "mirror-now, stage-write-later"
 * lifecycle via `useStagedSetting`. Every migrated numeric control
 * (`SdrResumeDelayControl`, `OverheadAlertRadiusControl`) is a thin wrapper
 * that supplies its store bindings and validation bounds as props here
 * instead of re-implementing the input markup, digit filtering, DB
 * hydration, and staged-write plumbing.
 *
 * Validation is `minValue`/`minExclusive` + `allowDecimal` rather than an
 * arbitrary predicate, because every current and anticipated numeric
 * setting reduces to "a non-negative (or strictly positive) integer or
 * decimal" — this keeps the component's behaviour easy to reason about and
 * fully covered, instead of accepting an opaque validator function.
 */
interface BaseNumberSettingProps {
  /**
   * Accessible name for the input — the control has no visible `<label>` of
   * its own (any caption is a separate sibling, matching each control's
   * existing on-screen text exactly).
   */
  accessibleName: string
  /**
   * Short unit suffix rendered after the input (e.g. `'NM'`). Omit when the
   * unit is already stated in the setting's own label.
   */
  unit?: string
  /** Native `maxlength` on the input, when the value has a known digit cap. */
  maxLength?: number
  /** Allows a single decimal point plus fractional digits. Defaults to `false` (integers only). */
  allowDecimal?: boolean
  /** Minimum allowed numeric value. Defaults to `0`. */
  minValue?: number
  /** When true, the value must be strictly greater than `minValue` rather than greater-or-equal. Defaults to `false`. */
  minExclusive?: boolean
  /** Settings-API namespace this value is persisted under (e.g. `'sdr'`). */
  namespace: string
  /** Settings-API key within `namespace` (e.g. `'resumeDelaySec'`). */
  settingKey: string
  /** Re-hydrates the backing store from the DB; see `useStagedSetting`. */
  hydrateFromDb: () => Promise<void>
  /** Reads the current numeric value out of the backing store. */
  readFromStore: () => number
  /** Mirrors a new value into the backing store. */
  mirrorToStore: (value: number) => void
  /**
   * Overrides how the persisted write is built. See `useStagedSetting`'s
   * `buildStagedWriter` — supply this when the control's write is a combined
   * payload rather than the bare new value.
   */
  buildStagedWriter?: (value: number) => () => Promise<unknown> | void
  /**
   * When false, skips the `sentinel:config-uploaded` re-sync listener.
   * Defaults to `true`. See `useStagedSetting`.
   */
  syncOnConfigUpload?: boolean
  /** When true, defers the store mirror until the staged writer runs on APPLY. Defaults to `false`. */
  deferMirror?: boolean
  /** Disables the input. Defaults to `false`. */
  disabled?: boolean
}

const props = withDefaults(defineProps<BaseNumberSettingProps>(), {
  unit: '',
  maxLength: undefined,
  allowDecimal: false,
  minValue: 0,
  minExclusive: false,
  buildStagedWriter: undefined,
  syncOnConfigUpload: true,
  deferMirror: false,
  disabled: false,
})

const emit = defineEmits<{
  /** Re-emitted from `useStagedSetting` for the Settings panel to collect. */
  stage: [fn: () => Promise<unknown> | void]
  /** Fired on Enter — the Settings panel treats this as "commit and close". */
  commit: []
}>()

const { value, applyChange } = useStagedSetting<number>({
  namespace: props.namespace,
  key: props.settingKey,
  hydrateFromDb: props.hydrateFromDb,
  readFromStore: props.readFromStore,
  mirrorToStore: props.mirrorToStore,
  deferMirror: props.deferMirror,
  buildStagedWriter: props.buildStagedWriter,
  syncOnConfigUpload: props.syncOnConfigUpload,
  stageWrite: (stagedWriter) => emit('stage', stagedWriter),
})

/** The raw text the user is editing — distinct from `value`, the committed numeric setting. */
const inputText = ref<string>(String(value.value))

const isValid = computed(() => {
  const trimmedText = inputText.value.trim()
  if (trimmedText === '') return false
  const formatPattern = props.allowDecimal ? /^\d+(\.\d+)?$/ : /^\d+$/
  if (!formatPattern.test(trimmedText)) return false
  const numericValue = Number(trimmedText)
  /* v8 ignore start -- defensive: the format regex above guarantees a finite numeric string */
  if (!Number.isFinite(numericValue)) return false
  /* v8 ignore stop */
  return props.minExclusive ? numericValue > props.minValue : numericValue >= props.minValue
})

// Re-syncs the visible text after a DB hydrate/config-upload re-sync changes
// `value` out from under the user. Skipped only when the input already holds
// a validly-formatted, non-empty representation of that same number (e.g.
// right after the user's own edit staged this value, possibly with different
// formatting like a leading zero) — so typing is never rewritten mid-edit,
// but an empty/invalid field still snaps to the hydrated value, including
// `"0"`, exactly like the original controls did.
watch(value, (newValue) => {
  const currentTextAlreadyMatchesValue =
    inputText.value !== '' && isValid.value && Number(inputText.value) === newValue
  if (!currentTextAlreadyMatchesValue) {
    inputText.value = String(newValue)
  }
})

function onInput(event: Event): void {
  const inputElement = event.target as HTMLInputElement
  const disallowedCharsPattern = props.allowDecimal ? /[^0-9.]/g : /[^0-9]/g
  const filteredText = inputElement.value.replace(disallowedCharsPattern, '')
  if (filteredText !== inputElement.value) {
    inputElement.value = filteredText
    inputText.value = filteredText
  }
  if (!isValid.value) return
  applyChange(Number(inputText.value))
}
</script>

<template>
  <div class="number-setting-wrap">
    <input
      v-model="inputText"
      type="text"
      inputmode="numeric"
      class="number-setting-input"
      :class="{ 'number-setting-input--invalid': !isValid }"
      :maxlength="maxLength"
      :aria-label="accessibleName"
      :disabled="disabled"
      spellcheck="false"
      autocomplete="off"
      @input="onInput"
      @keydown.enter="emit('commit')"
    />
    <span v-if="unit" class="number-setting-unit">{{ unit }}</span>
  </div>
</template>

<style scoped>
.number-setting-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.number-setting-unit {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(16, 19, 29, 0.5);
}
.number-setting-input {
  width: 60px;
  height: 28px;
  padding: 0;
  /* The settings panel's field treatment: no fill, a hairline rule under the
     value that thickens to the accent on focus — see the field block in
     SettingsPanel.css, which every other settings input follows. */
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: inset 0 -1px 0 var(--settings-field-line, rgba(16, 19, 29, 0.18));
  color: rgba(16, 19, 29, 0.92);
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-align: center;
  outline: none;
  transition: box-shadow 0.15s;
}
.number-setting-input:focus {
  box-shadow: inset 0 -2px 0 var(--color-accent);
}
.number-setting-input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.number-setting-input--invalid {
  box-shadow: inset 0 -2px 0 #d94436;
}
</style>
