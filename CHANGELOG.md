# Changelog

## 1.1.0 — 2026-11-05

- Diff viewer: the diff window offers "FairyGUI preview" for component XML files. Both revisions render side by side with synchronized zoom, scroll and hover; added (green), removed (red) and changed (orange) elements are outlined and listed above the panes.
- Relations now replay FairyGUI's own event order: pivot shifts on resize, centre/right/middle/bottom edges kept when an element resizes itself, percent and ext relation types, group moves, and relations placed directly under `<component>` (a label following its text).
- Auto-sized text (`autoSize` both, the default) is measured with the project font, so labels and whatever is related to them land where the editor puts them.
- Controller `change_page` actions are applied (for example a lock component following its button's `cLock` page), and controllers with a specific home page start on it.
- Gear font size and gear color on Label/Button instances now drive their title.

## 1.0.0 — 2026-11-05

- First release.
- Editor / Split / Preview view for FairyGUI component XML files, following unsaved edits.
- Renders nested components, images (9-slice, tile, tint, flip, fill), text and rich text, graphs, loaders, lists, groups and masks; Label / Button / ProgressBar / Slider overrides, `<property>` overrides, gears and relations.
- Controller page switching and device resolution preview from the project's Adaptation settings.
- Click an element to jump to its XML tag; the caret highlights the element in the preview; double-click opens a nested component.
- Options: zoom, hidden elements, outlines, empty loaders, plain graphs.
