package com.bytelab.fguipreview;

import com.intellij.codeInsight.daemon.SyntheticPsiFileSupport;
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
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.util.Key;
import com.intellij.openapi.util.Pair;
import com.intellij.openapi.vcs.FilePath;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.VirtualFileManager;
import com.intellij.testFramework.LightVirtualFile;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBLabel;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.JComponent;
import javax.swing.SwingConstants;
import java.util.List;

/** "FairyGUI preview" viewer in the diff window: both revisions of a component rendered side by side. */
public final class FguiDiffTool implements FrameDiffTool {
    private static final Logger LOG = Logger.getInstance(FguiDiffTool.class);

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
            if (p != null && path == null) path = p;
            if (FguiProject.looksLikeComponent(ReadAction.compute(() -> dc.getDocument().getImmutableCharSequence()))) component = true;
        }
        if (path == null || !path.toLowerCase().endsWith(".xml") || path.endsWith("/package.xml")) {
            if (component) debugReject(contents, "no usable file path: " + path);
            return null;
        }
        if (!component) return null;
        VirtualFile assets = FguiProject.findAssetsForPath(path);
        if (assets == null) {
            debugReject(contents, "not inside a FairyGUI project: " + path);
            return null;
        }
        String rel = FguiProject.relativePath(assets, path);
        return rel == null ? null : new Target(assets, rel);
    }

    private static volatile Key<?> revisionInfo;

    /** Looked up lazily: the VCS key exists only once the VCS diff code has been loaded. */
    private static @Nullable Key<?> revisionInfoKey() {
        Key<?> k = revisionInfo;
        if (k == null) revisionInfo = k = Key.findKeyByName("Merge.RevisionInfo");
        return k;
    }

    /**
     * Revision contents of files missing from the working copy (a file added in a pull request) have no local file;
     * their document belongs to a light file that remembers the original path.
     */
    private static @Nullable String pathOf(DiffContent c) {
        if (c instanceof FileContent fc && fc.getFile() != null && fc.getFile().isInLocalFileSystem()) return fc.getFile().getPath();
        Key<?> key = revisionInfoKey();
        if (key != null && c.getUserData(key) instanceof Pair<?, ?> pair && pair.first instanceof FilePath fp) return fp.getPath();
        if (c instanceof DocumentContent dc) {
            String p = localOrOriginalPath(dc.getHighlightFile());
            if (p != null) return p;
            return localOrOriginalPath(ReadAction.compute(() -> FileDocumentManager.getInstance().getFile(dc.getDocument())));
        }
        return null;
    }

    private static @Nullable String localOrOriginalPath(@Nullable VirtualFile f) {
        if (f == null) return null;
        if (f.isInLocalFileSystem()) return f.getPath();
        String p = SyntheticPsiFileSupport.getOriginalFilePath(f);
        if (p != null) return p;
        String url = SyntheticPsiFileSupport.getOriginalFileUrl(f);
        if (url != null) return VirtualFileManager.extractPath(url);
        if (f instanceof LightVirtualFile lf && lf.getOriginalFile() != null && lf.getOriginalFile().isInLocalFileSystem()) {
            return lf.getOriginalFile().getPath();
        }
        return null;
    }

    private static void debugReject(List<DiffContent> contents, String reason) {
        if (!LOG.isDebugEnabled()) return;
        StringBuilder sb = new StringBuilder("FairyGUI preview not offered (").append(reason).append(')');
        for (DiffContent c : contents) {
            sb.append("\n  ").append(c.getClass().getName());
            if (c instanceof DocumentContent dc) {
                VirtualFile h = dc.getHighlightFile();
                VirtualFile d = ReadAction.compute(() -> FileDocumentManager.getInstance().getFile(dc.getDocument()));
                sb.append(" highlight=").append(h == null ? "null" : h.getClass().getSimpleName() + ":" + h.getPath())
                        .append(" document=").append(d == null ? "null" : d.getClass().getSimpleName() + ":" + d.getPath());
            }
        }
        LOG.debug(sb.toString());
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
