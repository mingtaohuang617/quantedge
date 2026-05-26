/**
 * Z-index scale — single source of truth for stacking contexts.
 *
 * Standard Tailwind classes cover the common tiers:
 *   z-30  → Z_DROPDOWN  (context menus, floating dropdowns, sticky row labels)
 *   z-40  → Z_SIDEBAR   (sidebar rail, mobile bottom nav)
 *   z-50  → Z_MODAL     (standard overlay modals)
 *
 * For values outside Tailwind's named scale, import these constants and
 * apply via style={{ zIndex: Z_XXX }} so the intent is always clear.
 */

/** Dropdowns, context menus, floating tooltips */
export const Z_DROPDOWN = 30;

/** Sidebar rail, mobile bottom nav bar */
export const Z_SIDEBAR = 40;

/** Standard overlay modals (matches Tailwind z-50) */
export const Z_MODAL = 50;

/** Detail panels, fullscreen chart overlays */
export const Z_ELEVATED = 90;

/** Command palette, onboarding tour */
export const Z_TOUR = 100;

/** Toast notifications (reserved — not yet wired) */
export const Z_TOAST = 120;
