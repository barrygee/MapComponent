<template>
  <div class="lft-wrap" :style="{ '--lft-accent': accentColor }">
    <div class="lft-table">
      <div class="lft-header" :style="gridStyle">
        <div class="lft-header-field">{{ fieldHeader }}</div>
        <div v-for="column in columns" :key="column.key" class="lft-header-col">
          {{ column.label }}
        </div>
      </div>
      <div v-for="row in rows" :key="row.key" class="lft-row" :style="gridStyle">
        <div class="lft-row-label">
          <span v-if="row.abbr" class="lft-row-abbr">{{ row.abbr }}</span>
          <span class="lft-row-name">{{ row.label }}</span>
          <slot name="row-extra" :row="row" />
        </div>
        <div v-for="column in columns" :key="column.key" class="lft-cell">
          <BaseCheckbox
            class="lft-check"
            input-class="lft-input"
            box-class="lft-box"
            :accessible-name="accessibleName(row, column)"
            :checked="isChecked(column.key, row.key)"
            @change="emit('toggle', column.key, row.key)"
          >
            <template #checkmark>
              <svg
                v-if="isChecked(column.key, row.key)"
                width="8"
                height="5"
                viewBox="0 0 8 5"
                fill="none"
              >
                <path
                  d="M1 2.5L3 4.5L7 0.5"
                  :stroke="checkmarkColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </template>
          </BaseCheckbox>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Settings table of on/off data fields, one row per field and one checkbox
 * column per group.
 *
 * Shared by every "which fields appear on a map label" control: the Air domain
 * uses two columns (civil / military aircraft), the Land domain one (APRS
 * stations). The table owns the layout, typography and checkbox chrome; callers
 * own the field list, the checked state, and what a toggle means.
 */
import { computed } from 'vue'
import BaseCheckbox from '@/components/base/BaseCheckbox.vue'

/** One checkbox column — a group the field set can differ between. */
export interface LabelFieldColumn {
  key: string
  label: string
}

/** One field row. `abbr` is the short code shown on the label itself, if any. */
export interface LabelFieldRow {
  key: string
  label: string
  abbr?: string
}

const props = withDefaults(
  defineProps<{
    columns: LabelFieldColumn[]
    rows: LabelFieldRow[]
    /** Whether the field in this column/row pair is currently switched on. */
    isChecked: (columnKey: string, rowKey: string) => boolean
    /** Fill of a checked box — the owning domain's accent colour. */
    accentColor?: string
    /** Tick colour, dark by default so it reads on a bright accent fill. */
    checkmarkColor?: string
    fieldHeader?: string
  }>(),
  {
    accentColor: '#c8ff00',
    checkmarkColor: '#0a0c10',
    fieldHeader: 'Field',
  },
)

const emit = defineEmits<{ toggle: [columnKey: string, rowKey: string] }>()

const gridStyle = computed(() => ({
  gridTemplateColumns: `1fr repeat(${props.columns.length}, var(--lft-col-width))`,
}))

/**
 * Accessible name for a checkbox. With a single column the column name adds
 * nothing ("Callsign — show"), so the field name alone is the clearer label.
 */
function accessibleName(row: LabelFieldRow, column: LabelFieldColumn): string {
  return props.columns.length === 1 ? row.label : `${row.label} — ${column.label}`
}
</script>

<style scoped>
.lft-wrap {
  --lft-col-width: 80px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lft-table {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.lft-header {
  display: grid;
  padding: 0 4px 10px;
}
.lft-header-field,
.lft-header-col {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(16, 19, 29, 0.38);
}
.lft-header-field {
  padding-left: 10px;
}
.lft-header-col {
  text-align: center;
}
.lft-row {
  display: grid;
  align-items: center;
  background: rgba(16, 19, 29, 0.015);
  border-radius: 6px;
  margin-bottom: 4px;
  transition: background 0.1s;
}
.lft-row:hover {
  background: rgba(16, 19, 29, 0.04);
}
.lft-row-label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
}
.lft-row-abbr {
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(16, 19, 29, 0.4);
  min-width: 28px;
}
.lft-row-name {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(16, 19, 29, 0.82);
}
.lft-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 9px 0;
}
.lft-check {
  cursor: pointer;
  display: flex;
  align-items: center;
}
/* The input/box render inside BaseCheckbox (which owns hiding the input), so
   only the label root carries this component's scope id — their rules need
   :deep() anchored at the label class. */
.lft-check :deep(.lft-box) {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 0;
  background: rgba(16, 19, 29, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.lft-check :deep(.lft-input:checked + .lft-box) {
  background: var(--lft-accent);
}

@media (max-width: 480px) {
  .lft-wrap {
    --lft-col-width: 56px;
  }
  .lft-header-field,
  .lft-header-col {
    font-size: 8px;
    letter-spacing: 0.14em;
  }
}
</style>
