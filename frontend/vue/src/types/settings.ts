/**
 * Shared types for the Settings panel's data-driven control registry.
 *
 * `SettingsPanel.vue` renders `ALL_SETTINGS` (a flat list of `SettingItem`s)
 * into `SettingRow.vue`, which dispatches on `type` to the matching control
 * component. Both files depend on this shape, so it lives here rather than
 * inside either component (a component should not be imported purely for its
 * types).
 */

/**
 * Describes one entry in the Settings panel's navigation/search registry —
 * which section it belongs to, its label/description, which control renders
 * it (`type`), and any type-specific configuration the control needs (e.g.
 * `ns` for the settings namespace, `defaultUrl` for source controls).
 */
export interface SettingItem {
  section: string
  sectionLabel: string
  id: string
  label: string
  desc: string
  /**
   * Extra words the search box matches on but that are never rendered. Used by
   * controls that deliberately show no descriptive text (e.g. the SDR options
   * checkbox box) so their individual options stay findable by name.
   */
  searchTerms?: string
  groupLabel?: string
  type: string
  // type-specific props
  ns?: string
  defaultUrl?: string
}
