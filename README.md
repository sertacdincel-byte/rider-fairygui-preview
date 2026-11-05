# FairyGUI Preview

**English** · [Türkçe](README.tr.md)

A Rider plugin that shows a live visual preview of FairyGUI component XML files next to the XML editor.

Every screen made in the FairyGUI editor is saved as a component `.xml` under `<project>/assets/<Package>/`. Opening one in Rider shows the XML as usual; the **Preview** and **Split** buttons in the editor's top-right corner (the same ones as the Markdown preview) show what it looks like.

| Feature | Details |
|---|---|
| Live | The preview follows unsaved edits as you type. Saving another component, image or `package.xml` in the project refreshes it. |
| Rendering | Nested components (any depth, across packages), images (9-slice, tile, tint, flip, fill), text and rich text (UBB, stroke, shadow, shrink / ellipsis), graphs, loaders (images or components, all fill modes), lists (column, row, flow, pagination), groups, movie clip and Spine placeholders |
| Component logic | Label / Button / ProgressBar / Slider instance overrides (title, icon, color, font size, checked, value), `<property>` overrides, controller pages set on instances, controller `change_page` actions, specific home pages, gears (display, display2, XY, size, look, color, icon, text, font size), masks |
| Layout | Relations replay FairyGUI's own event order (the `RelationItem` logic): parent and sibling targets, percent and ext types, pivot shifts on resize, edges kept when an element resizes itself, group moves, and relations directly under `<component>`. Auto-sized text is measured with the project font. |
| Controllers | Pick any page of the component's controllers from the toolbar; gears follow |
| Screens | Full-screen components can be previewed at every device resolution in the project's Adaptation settings; relations re-run for the new size |
| Navigation | Click an element to put the caret on its tag in the XML. Moving the caret highlights the element in the preview. Double-click a nested component to open its file. The status bar shows the hovered element's path, type, position, size and source file. |
| Diff | In any diff of a component (Git log → Show Diff, Commit / Local Changes, Compare with Branch…), pick **FairyGUI preview** in the diff window's viewer selector. Both revisions render side by side; added (green), removed (red) and changed (orange) elements are outlined and listed above the panes; zoom, scroll and hover stay in sync. |
| Options | Zoom (fit, 25–200%), show `visible="false"` elements, outline every element, mark loaders without a URL, paint graphs that have no fill color |

Everything runs locally in the IDE's embedded browser and reads only the FairyGUI project's own files.

---

## Install

**From disk**: Rider → **Settings → Plugins → ⚙ → Install Plugin from Disk…** → pick `FguiPreview-<version>.zip` (do not unzip) → restart.

**Use**: open any component `.xml` inside a FairyGUI project, then click **Preview** or **Split** in the editor's top-right corner. The choice is remembered per file. The browser behind the preview is created only when the preview is first shown, so files you keep in the XML view cost nothing extra.

**Uninstall**: **Settings → Plugins → Installed → FairyGUI Preview → Uninstall**, then restart.

### Which files get a preview

An `.xml` file gets the preview when all of these hold:

- it is inside an `assets` folder whose parent folder contains a `*.fairy` project file,
- it is not `package.xml`,
- its root element is `<component>`.

### Compatibility

| | |
|---|---|
| IDE | Rider 2026.2 (build 262) and later. Built and used on Rider 2026.2.3.1. |
| FairyGUI | Editor project format 5.x (`projectDescription version="5.0"`). |
| OS | Developed on Windows 11. No OS-specific code; macOS and Linux are untested. |

---

## What the preview does not show

Read these before trusting the preview for layout decisions.

- **Safe area and notches are not modeled.** The *Screen* dropdown only applies the design-resolution scaling (`ScaleWithScreenSize`, match width or height) and re-runs relations. Anything driven by the project's safe-area code at runtime is not reflected.
- **Transitions are not played** and advanced group layouts (`layout="row"` etc. on a group) are not re-run; elements stay where the XML puts them. Group bounds are not recomputed from their members.
- **Text metrics are the browser's.** Auto-sized text is measured with the project's default font in the browser, which can differ by a few pixels from TextMeshPro; things related to a label can shift by that much.
- **In a diff, only the compared file comes from the revision.** Nested components, images and `package.xml` are read from the working copy, so a change inside a nested component shows up on both sides.
- **Saved controller pages are shown as saved.** The preview starts on the page each controller has selected in the file, so an overlay page selected by the designer (for example a "payment successful" state) appears on top. Switch pages in the toolbar.
- **Graphs without a fill color are drawn as dashed outlines by default.** They are usually hit areas or holders for VFX added at runtime. FairyGUI itself paints them white; the **Plain graphs** button does the same.
- **Colors are approximate.** The game renders in linear color space; the preview, like the FairyGUI editor, shows gamma colors. Text uses the project's default font; TextMeshPro outline and face dilation are approximated with CSS.
- Elements that exist only at runtime (list items added by code, dynamic loader URLs, text set by code) appear as they are in the XML: lists show their `<item>` entries, empty loaders a dashed box.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No Preview / Split buttons on an XML file | The file does not meet the rules in *Which files get a preview*. Check that the FairyGUI project folder has its `.fairy` file. |
| "…needs the embedded browser (JCEF)…" | The IDE runs on a runtime without JCEF. Switch back to the bundled one: **Help → Find Action → Choose Boot Java Runtime for the IDE**. |
| Red bar "XML error in …" | The XML does not parse (often mid-edit). The preview keeps the last valid version until it parses again. |
| Red bar "Missing resources (…)" | An image or component referenced by the XML is not in the project's `package.xml` or not on disk. Missing items are drawn as pink dashed boxes. |
| The preview did not pick up a change to another file | Save that file, or press **Reload** in the preview toolbar. |
| No **FairyGUI preview** in the diff window | The viewer is offered only when the compared file is a component inside a FairyGUI project. Pick it once in the diff toolbar's viewer selector; the diff window remembers the choice. |

**Logs**: **Help → Show Log in Explorer** → `idea.log`, search for `com.bytelab.fguipreview`. **Page errors**: right-click the preview → **Open DevTools**.

---

## Development

### Build

Requirements: a local Rider (its bundled JBR provides `javac`) and Node.js 18+. No Gradle.

```powershell
./build.ps1                                   # page bundle + Java + zip
./build.ps1 -SkipWeb                          # reuse the committed preview.html
./build.ps1 -RiderHome "D:\Apps\Rider"        # non-default Rider location
./build.ps1 -RepositoryUrl https://host/path  # also write updatePlugins.xml
```

Output: `build/distributions/FguiPreview-<version>.zip`, plus `updatePlugins.xml` with `-RepositoryUrl`. The Java code compiles against the Rider installation's `lib/*` and `plugins/jcef-plugin/lib/modules/*` jars.

### Release

1. Bump `<version>` in `src/main/resources/META-INF/plugin.xml` and add a `<change-notes>` entry.
2. Add a `## <version> — <date>` section to `CHANGELOG.md`.
3. If the page changed, run `./build.ps1` so `preview.html` is regenerated.
4. Install the zip from disk once and check a few real screens.
5. Commit, then run `./release.ps1` (add `-Draft` to review the GitHub release first). It stops on a dirty tree, an existing tag or a missing CHANGELOG section, pushes `HEAD`, and creates release `v<version>` with the zip and an `updatePlugins.xml` pointing at it.

### Layout

| Path | Contents |
|---|---|
| `src/main/java/com/bytelab/fguipreview/FguiEditorProvider.java` | Split editor (text editor + preview) for component XML files |
| `src/main/java/com/bytelab/fguipreview/FguiPreviewEditor.java` | Preview half of the split editor: live source, caret ↔ element sync |
| `src/main/java/com/bytelab/fguipreview/FguiDiffTool.java` | "FairyGUI preview" viewer in the diff window |
| `src/main/java/com/bytelab/fguipreview/FguiPage.java` | JCEF page shared by both: lazy browser, page bridge, file reads, change tracking |
| `src/main/java/com/bytelab/fguipreview/FguiProject.java` | Finds the FairyGUI project and decides which files are components |
| `src/main/resources/fguipreview/preview.html` | Generated single-file page. Do not edit; run the web build |
| `web/src/` | Page source: `preview.js` (renderer) and the `preview.html` template, bundled by `web/build.mjs` |
| `web/test/serve.mjs` | Serves the page against a FairyGUI project without the IDE |

### Page API

The plugin loads `preview.html` and talks to it through a `JBCefJSQuery` exposed to the page as `FguiHost.request(json)`:

| Request | Response |
|---|---|
| `{op:"index"}` | `{packages:[{folder, xml}], common, adaptation}` — every `package.xml` plus `settings/Common.json` and `settings/Adaptation.json` |
| `{op:"read", path, enc:"text"}` | File text, from the open editor's document if it has unsaved changes |
| `{op:"read", path, enc:"base64", offset, length}` | `"<total size>:<base64 slice>"`; the page reads binary files in 512 KB slices |
| `{op:"nav", id}` | Moves the caret to the element's tag |
| `{op:"open", file}` | Opens another component in the editor |

Paths are relative to the project's `assets` folder. The plugin calls `FguiPreview.init / initDiff / setSource / invalidate / highlight` on the page.

### Testing the page without the IDE

```powershell
node web/test/serve.mjs <path to the FairyGUI project folder>
```

Open `http://127.0.0.1:47912/?file=<Package>/<path>.xml` (`&dark=0` for the light theme, `&rev=<git revision>` for the diff view against that revision). The script serves the same host API from disk and logs `nav` / `open` requests.
