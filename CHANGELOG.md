# Changelog

## 1.2.1 — 2026-11-06

- The diff viewer follows the working copy: when one side of a component diff is the file itself (Local Changes, Compare with Branch), editing it or changing it on disk re-renders that side and updates the added / removed / changed marks.

## 1.2.0 — 2026-11-06

- Diffs of component files that do not exist in the working copy (for example a file added in a pull request) now offer the "FairyGUI preview" viewer. The file path is taken from the revision content's original path when there is no local file.
- A preview that has been hidden for a minute (another tab, or the Editor-only layout) releases its embedded browser, which is a separate Chromium process. Showing it again recreates the page with the same zoom, screen, controller pages and options.
- Canvases of a replaced render are freed right away, image blobs are released once decoded, and the plugin no longer keeps the last binary file it read.
- With debug logging on for `#com.bytelab.fguipreview`, `idea.log` records why a component diff did not get the viewer.

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
