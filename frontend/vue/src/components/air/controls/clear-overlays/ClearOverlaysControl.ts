import { SentinelControlBase } from '../sentinel-control-base/SentinelControlBase'
import type { AdsbLiveControl } from '../adsb/AdsbLiveControl'
import type { AdsbLabelsToggleControl } from '../adsb-labels/AdsbLabelsToggleControl'
import type { RoadsToggleControl } from '@/components/shared/controls/roads/RoadsToggleControl'
import type { NamesToggleControl } from '@/components/shared/controls/names/NamesToggleControl'
import type { RangeRingsControl } from '../range-rings/RangeRingsControl'

interface OverlaySibling {
  visible?: boolean
  toggle?(): void
}

interface AllControls {
  adsb: AdsbLiveControl | null
  adsbLabels: AdsbLabelsToggleControl | null
  roads: RoadsToggleControl | null
  names: NamesToggleControl | null
  rangeRings: RangeRingsControl | null
  airports: OverlaySibling | null
  militaryBases: OverlaySibling | null
  aara: OverlaySibling | null
  awacs: OverlaySibling | null
}

export class ClearOverlaysControl extends SentinelControlBase {
  _cleared = false
  savedStates: Record<string, boolean> | null = null
  private _controls: AllControls

  constructor(controls: AllControls) {
    super()
    this._controls = controls
  }

  get buttonLabel(): string {
    return '✕'
  }
  get buttonTitle(): string {
    return 'Toggle all overlays'
  }

  protected onInit(): void {
    this.button.style.opacity = '0.3'
    this.button.style.color = '#ffffff'
    this.button.style.fontSize = '14px'
  }

  protected handleClick(): void {
    this.toggle()
  }

  toggle(): void {
    if (!this._cleared) this._hideAllOverlays()
    else this._restoreAllOverlays()
  }

  _hideAllOverlays(): void {
    const c = this._controls
    this.savedStates = {
      roads: c.roads?.roadsVisible ?? false,
      names: c.names?.namesVisible ?? false,
      rangeRings: c.rangeRings?.ringsVisible ?? false,
      aara: c.aara?.visible ?? false,
      awacs: c.awacs?.visible ?? false,
      airports: c.airports?.visible ?? false,
      militaryBases: c.militaryBases?.visible ?? false,
      adsb: c.adsb?.visible ?? false,
      adsbLabels: c.adsbLabels?.labelsVisible ?? false,
    }

    if (c.roads?.roadsVisible) c.roads.handleClickPublic()
    if (c.names?.namesVisible) c.names.handleClickPublic()
    if (c.rangeRings?.ringsVisible) c.rangeRings.handleClickPublic()
    if (c.aara?.visible) c.aara.toggle?.()
    if (c.awacs?.visible) c.awacs.toggle?.()
    if (c.airports?.visible) c.airports.toggle?.()
    if (c.militaryBases?.visible) c.militaryBases.toggle?.()

    if (c.adsb?.visible) {
      c.adsb.setAllHidden(true)
      c.adsb.setLabelsVisible(false)
      const keepTrails = c.adsb._followEnabled && c.adsb._selectedHex
      if (!keepTrails) {
        try {
          c.adsb.map.setLayoutProperty('adsb-trails', 'visibility', 'none')
        } catch {}
      }
    }

    this._cleared = true
    this.button.style.opacity = '1'
    this.button.style.color = '#c8ff00'
  }

  _restoreAllOverlays(): void {
    if (!this.savedStates) {
      this._cleared = false
      return
    }
    const s = this.savedStates
    const c = this._controls

    if (c.roads?.roadsVisible === false && s.roads) c.roads.handleClickPublic()
    if (c.names?.namesVisible === false && s.names) c.names.handleClickPublic()
    if (c.rangeRings?.ringsVisible === false && s.rangeRings) c.rangeRings.handleClickPublic()
    if (c.aara && !c.aara.visible && s.aara) c.aara.toggle?.()
    if (c.awacs && !c.awacs.visible && s.awacs) c.awacs.toggle?.()
    if (c.airports && !c.airports.visible && s.airports) c.airports.toggle?.()
    if (c.militaryBases && !c.militaryBases.visible && s.militaryBases) c.militaryBases.toggle?.()

    if (c.adsb && s.adsb) {
      c.adsb.setAllHidden(false)
      try {
        c.adsb.map.setLayoutProperty('adsb-trails', 'visibility', 'visible')
      } catch {}
      if (c.adsbLabels) {
        c.adsbLabels.labelsVisible = s.adsbLabels
        c.adsbLabels.button.style.opacity = s.adsbLabels ? '1' : '0.3'
        c.adsbLabels.button.style.color = s.adsbLabels ? '#c8ff00' : '#ffffff'
        c.adsb.setLabelsVisible(s.adsbLabels)
      }
    }

    this._cleared = false
    this.button.style.opacity = '0.3'
    this.button.style.color = '#ffffff'
  }
}
