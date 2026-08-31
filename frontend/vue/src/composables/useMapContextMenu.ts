import type { Map as MapLibreGlMap, MapMouseEvent } from 'maplibre-gl'
import { formatLatitude, formatLongitude } from '@/utils/locationUtils'

export function useMapContextMenu() {
  let _ctxMenu: HTMLElement | null = null

  function remove(): void {
    if (_ctxMenu) {
      _ctxMenu.remove()
      _ctxMenu = null
    }
  }

  function _onDocKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') remove()
  }

  function show(e: MapMouseEvent): void {
    remove()
    const { lng, lat } = e.lngLat
    const latStr = formatLatitude(lat)
    const lonStr = formatLongitude(lng)
    const cx = e.originalEvent.clientX
    const cy = e.originalEvent.clientY

    const MARKER_SIZE = 60
    const PAD_X = 8
    const PAD_Y = 6
    const markerCenterX = PAD_X + MARKER_SIZE / 2
    const markerCenterY = PAD_Y + MARKER_SIZE / 2

    const el = document.createElement('div')
    el.style.cssText =
      "position:fixed;background:transparent;font-family:'Barlow Condensed','Barlow',sans-serif;font-size:11px;font-weight:400;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,0.7);z-index:9999;user-select:none"
    el.style.left = cx - markerCenterX + 'px'
    el.style.top = cy - markerCenterY + 'px'

    const setLocBtn = document.createElement('div')
    setLocBtn.style.cssText = `padding:${PAD_Y}px ${PAD_X}px;cursor:pointer;white-space:nowrap;color:rgba(255,255,255,0.7);display:flex;align-items:center;gap:0`
    setLocBtn.innerHTML =
      `<svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" overflow="visible" style="flex-shrink:0">` +
      // The SENTINEL ⊙ logo mark (white ring, green dot) with a static
      // solid dot, matching the UserLocationMarker this preview drops.
      `<circle cx="30" cy="30" r="13.1" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-dasharray="82.31" stroke-dashoffset="82.31" style="animation: marker-circle-draw 0.6s ease forwards" />` +
      `<circle cx="30" cy="30" r="5.2" fill="#c8ff00" />` +
      `</svg><span style="position:relative;margin-left:-30px;display:inline-flex;flex-direction:column;justify-content:center;align-items:flex-start;min-height:42px;padding:4px 12px 4px 24px;color:rgba(255,255,255,0.7);-webkit-mask-image:radial-gradient(circle 16px at 0px 50%, transparent 16px, black 16.5px);mask-image:radial-gradient(circle 16px at 0px 50%, transparent 16px, black 16.5px);background:#000;border-radius:6px"><span style="line-height:1.2">SET LOCATION</span><span style="line-height:1.2;font-size:9px;font-weight:400;letter-spacing:.12em;color:rgba(255,255,255,0.45);margin-top:2px">${latStr}  ${lonStr}</span></span>`
    setLocBtn.addEventListener('mouseenter', () => {
      setLocBtn.style.opacity = '0.85'
    })
    setLocBtn.addEventListener('mouseleave', () => {
      setLocBtn.style.opacity = ''
    })
    setLocBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      window.dispatchEvent(
        new CustomEvent('sentinel:setUserLocation', { detail: { longitude: lng, latitude: lat } }),
      )
      remove()
    })
    el.appendChild(setLocBtn)

    document.body.appendChild(el)
    _ctxMenu = el

    requestAnimationFrame(() => {
      if (!_ctxMenu) return
      const rect = _ctxMenu.getBoundingClientRect()
      if (rect.right > window.innerWidth)
        _ctxMenu.style.left = cx - rect.width + markerCenterX + 'px'
      if (rect.bottom > window.innerHeight)
        _ctxMenu.style.top = cy - rect.height + markerCenterY + 'px'
    })
  }

  function attach(m: MapLibreGlMap): void {
    m.on('contextmenu', show)
    m.on('click', remove)
    m.on('movestart', remove)
    m.on('zoomstart', remove)
    document.addEventListener('keydown', _onDocKeydown, { capture: true })
  }

  function detach(m: MapLibreGlMap | null): void {
    remove()
    document.removeEventListener('keydown', _onDocKeydown, { capture: true })
    if (m) {
      m.off('contextmenu', show)
      m.off('click', remove)
      m.off('movestart', remove)
      m.off('zoomstart', remove)
    }
  }

  return { attach, detach, remove, show }
}
