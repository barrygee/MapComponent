<template>
  <div class="adsb-lf-wrap">
    <div class="adsb-lf-table">
      <!-- Header -->
      <div class="adsb-lf-header">
        <div class="adsb-lf-header-field">Field</div>
        <div class="adsb-lf-header-col adsb-lf-header-col--civil">Civil</div>
        <div class="adsb-lf-header-col adsb-lf-header-col--mil">Military</div>
      </div>
      <!-- Rows -->
      <div v-for="opt in OPTIONS" :key="opt.value" class="adsb-lf-row">
        <div class="adsb-lf-row-label">
          <span class="adsb-lf-row-name">{{ opt.label }}</span>
          <span class="adsb-lf-preview adsb-lf-preview--civil" v-if="opt.value === 'type'">B738</span>
          <span class="adsb-lf-preview adsb-lf-preview--mil"   v-if="opt.value === 'type'">F-16</span>
          <span class="adsb-lf-preview adsb-lf-preview--alt"   v-if="opt.value === 'alt'">FL350</span>
        </div>
        <div class="adsb-lf-cell">
          <label class="adsb-lf-check">
            <input type="checkbox" class="adsb-lf-input" :checked="fields.civil.includes(opt.value)" @change="toggle('civil', opt.value)">
            <span class="adsb-lf-box">
              <svg v-if="fields.civil.includes(opt.value)" width="8" height="5" viewBox="0 0 8 5" fill="none">
                <path d="M1 2.5L3 4.5L7 0.5" stroke="#00aaff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </label>
        </div>
        <div class="adsb-lf-cell">
          <label class="adsb-lf-check">
            <input type="checkbox" class="adsb-lf-input" :checked="fields.mil.includes(opt.value)" @change="toggle('mil', opt.value)">
            <span class="adsb-lf-box adsb-lf-box--mil">
              <svg v-if="fields.mil.includes(opt.value)" width="8" height="5" viewBox="0 0 8 5" fill="none">
                <path d="M1 2.5L3 4.5L7 0.5" stroke="#c8ff00" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAirStore, type AdsbLabelField, type AdsbLabelFields } from '@/stores/air'

const airStore = useAirStore()
const emit = defineEmits<{ stage: [fn: () => void] }>()

const fields = ref<AdsbLabelFields>({
  civil: [...airStore.adsbLabelFields.civil],
  mil:   [...airStore.adsbLabelFields.mil],
})

const OPTIONS: Array<{ value: AdsbLabelField; label: string }> = [
  { value: 'type', label: 'Aircraft Type' },
  { value: 'alt',  label: 'Altitude' },
]

function toggle(group: 'civil' | 'mil', field: AdsbLabelField): void {
  const current = fields.value[group]
  const next = current.includes(field) ? current.filter(f => f !== field) : [...current, field]
  fields.value = { ...fields.value, [group]: next }
  airStore.setAdsbLabelFields({ ...fields.value })
  window.dispatchEvent(new CustomEvent('adsb:labelFieldsChanged', { detail: { ...fields.value } }))
  emit('stage', () => {})
}
</script>

<style scoped>
.adsb-lf-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.adsb-lf-table {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  overflow: hidden;
  width: fit-content;
  min-width: 360px;
}
.adsb-lf-header {
  display: grid;
  grid-template-columns: 1fr 80px 80px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.adsb-lf-header-field,
.adsb-lf-header-col {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  padding: 7px 16px;
  color: rgba(255, 255, 255, 0.25);
}
.adsb-lf-header-col {
  text-align: center;
  padding-left: 0;
  padding-right: 0;
}
.adsb-lf-header-col--civil { color: rgba(0, 170, 255, 0.5); }
.adsb-lf-header-col--mil   { color: rgba(200, 255, 0, 0.5); }
.adsb-lf-row {
  display: grid;
  grid-template-columns: 1fr 80px 80px;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  transition: background 0.1s;
}
.adsb-lf-row:last-child { border-bottom: none; }
.adsb-lf-row:hover { background: rgba(255, 255, 255, 0.05); }
.adsb-lf-row-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
}
.adsb-lf-row-name {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}
.adsb-lf-preview {
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 2px;
}
.adsb-lf-preview--civil { background: #002244; color: #00aaff; }
.adsb-lf-preview--mil   { background: #4d6600; color: #c8ff00; }
.adsb-lf-preview--alt   { background: rgba(0, 0, 0, 0.5); color: rgba(255, 255, 255, 0.45); }
.adsb-lf-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0;
}
.adsb-lf-check {
  cursor: pointer;
  display: flex;
  align-items: center;
}
.adsb-lf-input { display: none; }
.adsb-lf-box {
  width: 14px;
  height: 14px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, background 0.15s;
}
.adsb-lf-input:checked + .adsb-lf-box {
  background: rgba(0, 170, 255, 0.1);
  border-color: rgba(0, 170, 255, 0.5);
}
.adsb-lf-input:checked + .adsb-lf-box--mil {
  background: rgba(200, 255, 0, 0.1);
  border-color: rgba(200, 255, 0, 0.5);
}
</style>
