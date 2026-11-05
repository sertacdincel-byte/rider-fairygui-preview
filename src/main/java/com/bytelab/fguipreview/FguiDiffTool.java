package com.bytelab.fguipreview;

import com.intellij.diff.DiffContext;
import com.intellij.diff.FrameDiffTool;
import com.intellij.diff.contents.DiffContent;
import com.intellij.diff.contents.DocumentContent;
import com.intellij.diff.contents.EmptyContent;
import com.intellij.diff.contents.FileContent;
import com.intellij.diff.requests.ContentDiffRequest;
import com.intellij.diff.requests.DiffRequest;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ReadAction;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.util.Key;
import com.intellij.openapi.util.Pair;
import com.intellij.openapi.vcs.FilePath;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBLabel;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.JComponent;
import javax.swing.SwingConstants;
import java.util.List;

/** "FairyGUI preview" viewer in the diff window: both revisions of a component rendered side by side. */
public final class FguiDiffTool implements FrameDiffTool {
    @Override
    public @NotNull String getName() {
        return "FairyGUI preview";
    }

    @Override
    public boolean canShow(@NotNull DiffContext context, @NotNull DiffRequest request) {
        return context.getProject() != null && resolve(request) != null;
    }

    @Override
    public @NotNull DiffViewer createComponent(@NotNull DiffContext context, @NotNull DiffRequest request) {
        return new Viewer(context.getProject(), (ContentDiffRequest) request, resolve(request));
    }

    private record Target(VirtualFile assets, String relPath) {
    }

    private static @Nullable Target resolve(DiffRequest request) {
        if (!(request instanceof ContentDiffRequest r)) return null;
        List<DiffContent> contents = r.getContents();
        if (contents.size() != 2) return null;
        String path = null;
        boolean component = false;
        for (DiffContent c : contents) {
            if (c instanceof EmptyContent) continue;
            if (!(c instanceof DocumentContent dc)) return null;
            String p = pathOf(c);
            if (p == null || !p.toLowerCase().endsWith(".xml") || p.endsWith("/package.xml")) return null;
            if (path == null) path = p;
            if (FguiProject.looksLikeComponent(ReadAction.compute(() -> dc.getDocument().getImmutableCharSequence()))) component = true;
        }
        if (path == null || !component) return null;
        VirtualFile assets = FguiProject.findAssetsForPath(path);
        if (assets == null) return null;
        String rel = FguiProject.relativePath(assets, path);
        return rel == null ? null : new Target(assets, rel);
    }

    private static final Key<?> REVISION_INFO = Key.findKeyByName("Merge.RevisionInfo");

    private static @Nullable String pathOf(DiffContent c) {
        if (c instanceof FileContent fc && fc.getFile() != null) return fc.getFile().getPath();
        if (c instanceof DocumentContent dc && dc.getHighlightFile() != null) return dc.getHighlightFile().getPath();
        if (REVISION_INFO != null) {
            Object info = c.getUserData(REVISION_INFO);
            if (info instanceof Pair<?, ?> pair && pair.first instanceof FilePath fp) return fp.getPath();
        }
        return null;
    }

    private static final class Viewer implements DiffViewer {
        private final Disposable disposable = Disposer.newDisposable("FairyGUI diff preview");
        private final JComponent component;

        Viewer(@Nullable Project project, ContentDiffRequest request, @Nullable Target target) {
            if (project == null || target == null) {
                component = new JBLabel("This diff is not a FairyGUI component.", SwingConstants.CENTER);
                return;
            }
            List<DiffContent> contents = request.getContents();
            List<String> titles = request.getContentTitles();
            StringBuilder js = new StringBuilder("FguiPreview.initDiff({file:").append(Json.str(target.relPath()))
                    .append(",dark:").append(!JBColor.isBright());
            for (int i = 0; i < 2; i++) {
                String title = i < titles.size() && titles.get(i) != null ? titles.get(i) : (i == 0 ? "Before" : "After");
                DiffContent c = contents.get(i);
                String source = c instanceof DocumentContent dc ? ReadAction.compute(() -> dc.getDocument().getText()) : null;
                js.append(i == 0 ? ",left:{" : ",right:{")
                        .append("title:").append(Json.str(title))
                        .append(",source:").append(Json.str(source))
                        .append(",emptyText:").append(Json.str("File does not exist in this revision"))
                        .append('}');
            }
            String init = js.append("});").toString();
            FguiPage page = new FguiPage(project, target.assets(), () -> init, null, null, disposable);
            component = page.getComponent();
        }

        @Override
        public @NotNull JComponent getComponent() {
            return component;
        }

        @Override
        public @Nullable JComponent getPreferredFocusedComponent() {
            return component;
        }

        @Override
        public @NotNull ToolbarComponents init() {
            return new ToolbarComponents();
        }

        @Override
        public void dispose() {
            Disposer.dispose(disposable);
        }
    }
}
