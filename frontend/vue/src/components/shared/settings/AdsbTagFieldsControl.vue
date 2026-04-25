<template>
  <div class="adsb-tf-wrap">
    <div class="adsb-tf-table">
      <div class="adsb-tf-header">
        <div class="adsb-tf-header-field">Field</div>
        <div class="adsb-tf-header-col adsb-tf-header-col--civil">Civil</div>
        <div class="adsb-tf-header-col adsb-tf-header-col--mil">Military</div>
      </div>
      <div v-for="opt in OPTIONS" :key="opt.value" class="adsb-tf-row">
        <div class="adsb-tf-row-label">
          <span class="adsb-tf-row-abbr">{{ opt.abbr }}</span>
          <span class="adsb-tf-row-name">{{ opt.label }}</span>
        </div>
        <div class="adsb-tf-cell">
          <label class="adsb-tf-check">
            <input type="checkbox" class="adsb-tf-input" :checked="fields.civil.includes(opt.value)" @change="toggle('civil', opt.value)">
            <span class="adsb-tf-box">
              <svg v-if="fields.civil.includes(opt.value)" width="8" height="5" viewBox="0 0 8 5" fill="none">
                <path d="M1 2.5L3 4.5L7 0.5" stroke="#00aaff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </label>
        </div>
        <div class="adsb-tf-cell">
          <label class="adsb-tf-check">
            <input type="checkbox" class="adsb-tf-input" :checked="fields.mil.includes(opt.value)" @change="toggle('mil', opt.value)">
            <span class="adsb-tf-box adsb-tf-box--mil">
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
import { useAirStore, type AdsbTagField, type AdsbTagFields } from '@/stores/air'

const airStore = useAirStore()
const emit = defineEmits<{ stage: [fn: () => void] }>()

const fields = ref<AdsbTagFields>({
  civil: [...airStore.adsbTagFields.civil],
  mil:   [...airStore.adsbTagFields.mil],
})

const OPTIONS: Array<{ value: AdsbTagField; abbr: string; label: string }> = [
  { value: 'alt', abbr: 'ALT', label: 'Altitude' },
  { value: 'spd', abbr: 'SPD', label: 'Speed' },
  { value: 'hdg', abbr: 'HDG', label: 'Heading' },
  { value: 'typ', abbr: 'TYP', label: 'Aircraft Type' },
  { value: 'reg', abbr: 'REG', label: 'Registration' },
  { value: 'sqk', abbr: 'SQK', label: 'Squawk' },
  { value: 'cat', abbr: 'CAT', label: 'Category' },
]

function toggle(group: 'civil' | 'mil', field: AdsbTagField): void {
  const current = fields.value[group]
  const next = current.includes(field) ? current.filter(f => f !== field) : [...current, field]
  fields.value = { ...fields.value, [group]: next }
  airStore.setAdsbTagFields({ ...fields.value })
  window.dispatchEvent(new CustomEvent('adsb:tagFieldsChanged', { detail: { ...fields.value } }))
  emit('stage', () => {})
}
</script>

<style scoped>
.adsb-tf-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.adsb-tf-table {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  overflow: hidden;
  width: fit-content;
  min-width: 360px;
}
.adsb-tf-header {
  display: grid;
  grid-template-columns: 1fr 80px 80px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.adsb-tf-header-field,
.adsb-tf-header-col {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  padding: 7px 16px;
  color: rgba(255, 255, 255, 0.25);
}
.adsb-tf-header-col {
  text-align: center;
  padding-left: 0;
  padding-right: 0;
}
.adsb-tf-header-col--civil { color: rgba(0, 170, 255, 0.5); }
.adsb-tf-header-col--mil   { color: rgba(200, 255, 0, 0.5); }
.adsb-tf-row {
  display: grid;
  grid-template-columns: 1fr 80px 80px;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  transition: background 0.1s;
}
.adsb-tf-row:last-child { border-bottom: none; }
.adsb-tf-row:hover { background: rgba(255, 255, 255, 0.05); }
.adsb-tf-row-label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
}
.adsb-tf-row-abbr {
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.35);
  min-width: 28px;
}
.adsb-tf-row-name {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}
.adsb-tf-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0;
}
.adsb-tf-check {
  cursor: pointer;
  display: flex;
  align-items: center;
}
.adsb-tf-input { display: none; }
.adsb-tf-box {
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
.adsb-tf-input:checked + .adsb-tf-box {
  background: rgba(0, 170, 255, 0.1);
  border-color: rgba(0, 170, 255, 0.5);
}
.adsb-tf-input:checked + .adsb-tf-box--mil {
  background: rgba(200, 255, 0, 0.1);
  border-color: rgba(200, 255, 0, 0.5);
}
</style>
