import { vi, describe, it, expect } from 'vitest'
import { shallowMount } from '@vue/test-utils'

// Prevent the real ExportAllControl from being compiled in this worker's V8 context.
// Without this, v8 creates a separate function-coverage record for ExportAllControl.vue
// in both this worker and ExportAllControl.spec.ts's worker; the records have different
// byte-range offsets, so the merge creates phantom uncovered function entries.
// shallowMount already stubs child components so the mock doesn't affect test behaviour.
vi.mock('./ExportAllControl.vue', () => ({ default: { name: 'ExportAllControl' } }))
import type { Component } from 'vue'
import { axe } from 'jest-axe'
import SettingRow from './SettingRow.vue'
import type { SettingItem } from '@/types/settings'
import ConnectivityToggle from './ConnectivityToggle.vue'
import OverheadAlertsToggleControl from './OverheadAlertsToggleControl.vue'
import OverheadAlertRadiusControl from './OverheadAlertRadiusControl.vue'
import LandAprsRetentionControl from './LandAprsRetentionControl.vue'
import ProbeUrlControl from './ProbeUrlControl.vue'
import LocationControl from './LocationControl.vue'
import NotificationSoundControl from './NotificationSoundControl.vue'
import SourceOverrideControl from './SourceOverrideControl.vue'
import OnlineSourceControl from './OnlineSourceControl.vue'
import OfflineSourceControl from './OfflineSourceControl.vue'
import SpaceTleOnlineControl from './SpaceTleOnlineControl.vue'
import SpaceTleManualControl from './SpaceTleManualControl.vue'
import SpaceTleDatabaseControl from './SpaceTleDatabaseControl.vue'
import SpaceTleUncatControl from './SpaceTleUncatControl.vue'
import SpaceTleSatListControl from './SpaceTleSatListControl.vue'
import SpaceHoverPreviewControl from './SpaceHoverPreviewControl.vue'
import AdsbLabelFieldsControl from './AdsbLabelFieldsControl.vue'
import AdsbTagFieldsControl from './AdsbTagFieldsControl.vue'
import AirReplayToggleControl from './AirReplayToggleControl.vue'
import SdrDevicesControl from './SdrDevicesControl.vue'
import SdrAutoCenterControl from './SdrAutoCenterControl.vue'
import SdrFullWaterfallUpdateControl from './SdrFullWaterfallUpdateControl.vue'
import SdrSnapToKnownControl from './SdrSnapToKnownControl.vue'
import SdrShowBandPlanControl from './SdrShowBandPlanControl.vue'
import SdrShowKnownFreqsControl from './SdrShowKnownFreqsControl.vue'
import SdrResumeDelayControl from './SdrResumeDelayControl.vue'
import SdrDecodeMuteToggleControl from './SdrDecodeMuteToggleControl.vue'
import SdrTrunkTrackingToggleControl from './SdrTrunkTrackingToggleControl.vue'
import ConfigCurrentControl from './ConfigCurrentControl.vue'
import ExportAllControl from './ExportAllControl.vue'
import JsonDataControl from './JsonDataControl.vue'

function mountRow(item: Partial<SettingItem> & { type: string }) {
  const fullItem: SettingItem = {
    section: 'test',
    sectionLabel: 'Test',
    id: 'test-id',
    label: 'Test',
    desc: '',
    ...item,
  }
  return shallowMount(SettingRow, {
    props: { item: fullItem, pending: new Map() },
  })
}

// Each setting type renders exactly one matching child control.
const TYPE_TO_COMPONENT: Array<[string, Component, Partial<SettingItem>?]> = [
  ['connectivity-toggle', ConnectivityToggle],
  ['overhead-alerts-toggle', OverheadAlertsToggleControl],
  ['overhead-alert-radius', OverheadAlertRadiusControl],
  ['land-aprs-retention', LandAprsRetentionControl],
  ['probe-url', ProbeUrlControl],
  ['location', LocationControl],
  ['notification-sound', NotificationSoundControl],
  ['source-override', SourceOverrideControl, { ns: 'air' }],
  ['online-source', OnlineSourceControl, { ns: 'air', defaultUrl: '' }],
  ['offline-source', OfflineSourceControl, { ns: 'air', defaultUrl: '' }],
  ['space-tle-online', SpaceTleOnlineControl],
  ['space-tle-manual', SpaceTleManualControl],
  ['space-tle-db', SpaceTleDatabaseControl],
  ['space-tle-uncat', SpaceTleUncatControl],
  ['space-tle-satlist', SpaceTleSatListControl],
  ['space-sat-radio-file', JsonDataControl],
  ['space-hover-preview', SpaceHoverPreviewControl],
  ['air-label-fields', AdsbLabelFieldsControl],
  ['air-tag-fields', AdsbTagFieldsControl],
  ['air-replay-toggle', AirReplayToggleControl],
  ['sdr-devices', SdrDevicesControl],
  ['sdr-autocenter', SdrAutoCenterControl],
  ['sdr-full-waterfall-update', SdrFullWaterfallUpdateControl],
  ['sdr-snap-to-known', SdrSnapToKnownControl],
  ['sdr-show-bandplan', SdrShowBandPlanControl],
  ['sdr-show-known-freqs', SdrShowKnownFreqsControl],
  ['sdr-resume-delay', SdrResumeDelayControl],
  ['sdr-decode-mute-toggle', SdrDecodeMuteToggleControl],
  ['sdr-trunk-tracking-toggle', SdrTrunkTrackingToggleControl],
  ['sdr-frequencies-file', JsonDataControl],
  ['sdr-bandplan-file', JsonDataControl],
  ['sdr-channelmaps-file', JsonDataControl],
  ['config-current', ConfigCurrentControl],
  ['export-all', ExportAllControl],
]

describe('SettingRow', () => {
  it.each(TYPE_TO_COMPONENT)('renders the %s control', (type, component, extra) => {
    const wrapper = mountRow({ id: type, type, label: type.toUpperCase(), ...extra })
    const child = wrapper.findComponent(component)
    expect(child.exists()).toBe(true)
    // Fire both events so this branch's inline stage/commit forwarders run
    // (a no-op for the controls that do not declare them).
    child.vm.$emit('stage', () => {})
    child.vm.$emit('commit')
  })

  it('defaults the source URLs to empty when no defaultUrl is given', () => {
    const online = mountRow({ id: 'o', type: 'online-source', label: 'Online', ns: 'air' })
    expect(online.findComponent(OnlineSourceControl).props('defaultUrl')).toBe('')
    const offline = mountRow({ id: 'f', type: 'offline-source', label: 'Offline', ns: 'air' })
    expect(offline.findComponent(OfflineSourceControl).props('defaultUrl')).toBe('')
  })

  it('renders only the label for an unrecognised type', () => {
    const wrapper = mountRow({ id: 'z', type: 'mystery-type', label: 'Mystery' })
    expect(wrapper.find('.settings-item-label').text()).toBe('Mystery')
    expect(wrapper.findComponent(ConfigCurrentControl).exists()).toBe(false)
    expect(wrapper.findComponent(ConnectivityToggle).exists()).toBe(false)
  })

  it('renders the label and an optional description', () => {
    const withDesc = mountRow({ id: 'x', type: 'probe-url', label: 'Probe', desc: 'A URL' })
    expect(withDesc.find('.settings-item-label').text()).toBe('Probe')
    expect(withDesc.find('.settings-item-desc').text()).toBe('A URL')

    const withoutDesc = mountRow({ id: 'x', type: 'probe-url', label: 'Probe' })
    expect(withoutDesc.find('.settings-item-desc').exists()).toBe(false)
  })

  it('applies the wide modifier only to wide types', () => {
    expect(mountRow({ id: 'a', type: 'sdr-channelmaps-file', label: 'Maps' }).classes()).toContain(
      'settings-item--wide',
    )
    expect(mountRow({ id: 'b', type: 'probe-url', label: 'Probe' }).classes()).not.toContain(
      'settings-item--wide',
    )
  })

  it('forwards a child stage event with the item id', () => {
    const wrapper = mountRow({ id: 'radius-1', type: 'overhead-alert-radius', label: 'Radius' })
    const staged = () => {}
    wrapper.findComponent(OverheadAlertRadiusControl).vm.$emit('stage', staged)
    expect(wrapper.emitted('stage')).toEqual([['radius-1', staged]])
  })

  it('forwards a child commit event', () => {
    const wrapper = mountRow({ id: 'radius-1', type: 'overhead-alert-radius', label: 'Radius' })
    wrapper.findComponent(OverheadAlertRadiusControl).vm.$emit('commit')
    expect(wrapper.emitted('commit')).toHaveLength(1)
  })

  it('has no accessibility violations', async () => {
    const wrapper = mountRow({ id: 'x', type: 'probe-url', label: 'Probe', desc: 'A URL' })
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
