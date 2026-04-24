<template>
  <div id="notif-list-wrap">
    <div id="notif-list" ref="listRef">
      <div v-if="store.visible.length === 0" id="msb-alerts-empty">No alerts</div>
      <TransitionGroup name="notif">
        <div
          v-for="item in store.visible"
          :key="item.id"
          class="notif-item"
          :data-type="item.type"
          :style="item.clickAction ? 'cursor:pointer' : ''"
          @click="item.clickAction?.() "
        >
          <div class="notif-header">
            <span class="notif-label">
              <template v-if="item.action">
                <span class="notif-label-default">{{ store.getLabelForType(item.type) }}</span>
                <span class="notif-label-disable">DISABLE NOTIFICATIONS</span>
              </template>
              <template v-else>{{ store.getLabelForType(item.type) }}</template>
            </span>
            <div style="display:flex;align-items:center;gap:8px">
              <button v-if="item.action" class="notif-action" aria-label="Disable notifications"
                @click.stop="item.action!.callback(); store.dismiss(item.id)">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/>
                  <path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/>
                  <line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>
                </svg>
              </button>
              <button v-else class="notif-dismiss" aria-label="Dismiss" @click.stop="store.dismiss(item.id)">✕</button>
            </div>
          </div>
          <div class="notif-body">
            <span class="notif-title">{{ item.title }}</span>
            <span v-if="item.detail" class="notif-detail">{{ item.detail }}</span>
            <span class="notif-time">{{ formatTime(item.ts) }}</span>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </div>
  <div id="notif-footer">
    <button id="notif-clear-all-btn" v-if="store.total > 0"
      aria-label="Clear notifications" @click="store.clearAll()">CLEAR</button>
    <div id="notif-scroll-hint" :class="{ 'notif-scroll-hint-visible': showScrollHint }">
      MORE
      <svg id="notif-scroll-arrow" width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="1,2.5 4,5.5 7,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useNotificationsStore } from '@/stores/notifications'

const store = useNotificationsStore()
const listRef = ref<HTMLElement | null>(null)
const showScrollHint = ref(false)

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} LOCAL`
}

function updateScrollHint() {
  const el = listRef.value
  if (!el) return
  showScrollHint.value = el.scrollHeight > el.clientHeight + 1
}

let resizeObs: ResizeObserver | null = null

onMounted(() => {
  store.syncFromBackend()
  resizeObs = new ResizeObserver(updateScrollHint)
  if (listRef.value) resizeObs.observe(listRef.value)
})

onUnmounted(() => {
  resizeObs?.disconnect()
})
</script>

<style>
#notif-list-wrap {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    pointer-events: all;
    touch-action: none;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

#notif-footer {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    flex-shrink: 0;
    border-top: none;
    pointer-events: all;
    height: 40px;
}

#notif-clear-all-btn {
    flex: 1;
    pointer-events: all;
    background: none;
    border: none;
    border-right: 1px solid var(--color-border);
    color: rgba(255, 255, 255, 0.4);
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    line-height: 1;
    transition: color 0.15s ease, background 0.15s ease;
}

#notif-clear-all-btn:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text-muted);
}

#notif-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    align-items: flex-start;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
    pointer-events: none;
}

#notif-list::-webkit-scrollbar {
    display: none;
}

#notif-scroll-hint {
    flex: 1;
    background: none;
    color: rgba(255, 255, 255, 0.35);
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    pointer-events: none;
    visibility: hidden;
    opacity: 0;
    transition: opacity 0.3s ease, visibility 0.3s ease;
}

#notif-scroll-hint.notif-scroll-hint-visible {
    visibility: visible;
    opacity: 1;
}

#notif-scroll-arrow {
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
    transition: transform 0.2s ease;
}

#notif-scroll-arrow.notif-arrow-up {
    transform: rotate(180deg);
}

.notif-item {
    width: 100%;
    background: transparent;
    color: #fff;
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 13px 26px 13px 28px;
    transition: background 0.12s;
    flex-shrink: 0;
}

.notif-enter-active {
    transition: opacity 0.2s ease, transform 0.2s ease;
}

.notif-enter-from {
    opacity: 0;
    transform: translateX(-10px);
}

.notif-item:hover {
    background: rgba(255, 255, 255, 0.06);
}

.notif-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: none;
    background: transparent;
    position: relative;
    z-index: 1;
    gap: 6px;
    margin-bottom: 2px;
}

.notif-label {
    flex: 1;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
}

.notif-item[data-type="flight"]     .notif-label { color: var(--color-accent); opacity: 0.75; }
.notif-item[data-type="departure"]  .notif-label { color: var(--color-accent); opacity: 0.75; }
.notif-item[data-type="track"]      .notif-label { color: var(--color-accent); opacity: 0.75; }
.notif-item[data-type="tracking"]   .notif-label { color: var(--color-accent); opacity: 0.75; }
.notif-item[data-type="notif-off"]  .notif-label { color: rgba(255, 255, 255, 0.45); }
.notif-item[data-type="system"]     .notif-label { color: rgba(255, 255, 255, 0.45); }
.notif-item[data-type="message"]    .notif-label { color: rgba(100, 160, 255, 0.8); }
.notif-item[data-type="emergency"]  .notif-label { color: #ff2222; }
.notif-item[data-type="squawk-clr"] .notif-label { color: rgba(255, 255, 255, 0.45); }

.notif-dismiss {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    color: rgba(255, 255, 255, 0.25);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    transition: color 0.2s;
    line-height: 1;
    flex-shrink: 0;
}

.notif-dismiss:hover {
    color: var(--color-text-muted);
}

.notif-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.notif-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.notif-item[data-type="emergency"] .notif-title {
    color: #ff2222;
}

.notif-detail {
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.4);
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.notif-time {
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.25);
    margin-top: 0;
}

.notif-action {
    position: relative;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-right: -2px;
    color: rgba(255, 255, 255, 0.3);
    line-height: 1;
    display: flex;
    align-items: center;
    transition: color 0.15s;
}

.notif-action:hover {
    color: var(--color-accent);
}

.notif-label-default {
    transition: opacity 0.15s;
}

.notif-label-disable {
    display: none;
    color: #fff;
}

.notif-header:has(.notif-action:hover) .notif-label-default {
    display: none;
}

.notif-header:has(.notif-action:hover) .notif-label-disable {
    display: inline;
}

.notif-action[data-tooltip]::before {
    content: attr(data-tooltip);
    position: absolute;
    right: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
    background: #000;
    color: var(--color-text-muted);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 0 10px;
    height: 28px;
    display: flex;
    align-items: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 10002;
}

.notif-action[data-tooltip]:hover::before {
    opacity: 1;
}

@keyframes notif-bell-pulse {
    0%   { opacity: 0.6; color: #fff; }
    50%  { opacity: 1;   color: var(--color-accent); }
    100% { opacity: 0.6; color: #fff; }
}

#notif-toggle-btn.notif-btn-unread {
    animation: notif-bell-pulse 0.6s ease-in-out 3;
}

#notif-toggle-btn {
    height: 36px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 10px;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: #fff;
    opacity: 0.6;
    transition: background 0.2s, opacity 0.2s, color 0.2s;
    flex-shrink: 0;
    margin: 4px 0;
}

#notif-toggle-btn:hover {
    background: var(--color-border);
    border-radius: 6px;
    opacity: 1;
}

#notif-toggle-btn.notif-btn-active {
    opacity: 1;
    color: #fff;
}

#notif-toggle-btn:not(.notif-btn-active) {
    position: relative;
}

#notif-toggle-btn:not(.notif-btn-active) #notif-icon {
    position: relative;
}

#notif-toggle-btn:not(.notif-btn-active) #notif-icon::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 2px;
    height: 22px;
    background: rgba(255, 255, 255, 0.55);
    transform: translate(-50%, -50%) rotate(45deg);
    pointer-events: none;
}

#notif-icon {
    display: block;
    flex-shrink: 0;
    width: auto;
    height: 15px;
}

#notif-count {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.4);
    line-height: 1;
    margin-bottom: 4px;
}

#notif-count.notif-count-unread {
    color: var(--color-accent);
}
</style>
