package com.bytelab.fguipreview;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ReadAction;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.VirtualFileManager;
import com.intellij.openapi.vfs.newvfs.BulkFileListener;
import com.intellij.openapi.vfs.newvfs.events.VFileEvent;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefBrowserBase;
import com.intellij.ui.jcef.JBCefJSQuery;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.handler.CefLoadHandlerAdapter;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.JComponent;
import javax.swing.JPanel;
import javax.swing.SwingConstants;
import javax.swing.Timer;
import java.awt.BorderLayout;
import java.awt.event.HierarchyEvent;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * The preview page in a JCEF browser and its bridge to the FairyGUI project on disk.
 * The browser is created the first time the component is shown.
 */
final class FguiPage implements Disposable {
    private static final Logger LOG = Logger.getInstance(FguiPage.class);
    private static volatile String pageHtml;

    private final Project project;
    private final VirtualFile assets;
    private final Supplier<String> initScript;
    private final @Nullable Consumer<String> navigate;
    private final @Nullable String ownPath;
    private final JPanel component = new JPanel(new BorderLayout());
    private final AtomicBoolean started = new AtomicBoolean();
    private final Set<String> pendingInvalid = ConcurrentHashMap.newKeySet();
    private final Timer invalidateTimer;
    private volatile @Nullable JBCefBrowser browser;
    private volatile boolean loaded;
    private volatile boolean disposed;
    private String cachedPath;
    private long cachedStamp;
    private byte[] cachedBytes;

    /**
     * @param initScript JS run once the page is up, after FguiHost exists (FguiPreview.init or initDiff)
     * @param navigate   receives element ids clicked in the preview; null when there is no editor to move
     * @param ownPath    absolute path of a file whose changes the caller pushes itself, or null
     */
    FguiPage(@NotNull Project project, @NotNull VirtualFile assets, @NotNull Supplier<String> initScript,
             @Nullable Consumer<String> navigate, @Nullable String ownPath, @NotNull Disposable parent) {
        this.project = project;
        this.assets = assets;
        this.initScript = initScript;
        this.navigate = navigate;
        this.ownPath = ownPath;
        Disposer.register(parent, this);
        invalidateTimer = new Timer(300, e -> pushInvalidate());
        invalidateTimer.setRepeats(false);

        if (!JBCefApp.isSupported()) {
            component.add(new JBLabel("The FairyGUI preview needs the embedded browser (JCEF), which is not available in this IDE.", SwingConstants.CENTER), BorderLayout.CENTER);
            return;
        }
        component.addHierarchyListener(e -> {
            if ((e.getChangeFlags() & HierarchyEvent.SHOWING_CHANGED) != 0 && component.isShowing()) ensureBrowser();
        });
        String assetsPath = assets.getPath() + "/";
        project.getMessageBus().connect(this).subscribe(VirtualFileManager.VFS_CHANGES, new BulkFileListener() {
            @Override
            public void after(@NotNull List<? extends VFileEvent> events) {
                boolean any = false;
                for (VFileEvent e : events) {
                    String p = e.getPath();
                    if (p.startsWith(assetsPath) && !p.equals(ownPath)) {
                        pendingInvalid.add(p.substring(assetsPath.length()));
                        any = true;
                    }
                }
                if (any) ApplicationManager.getApplication().invokeLater(invalidateTimer::restart);
            }
        });
    }

    @NotNull JComponent getComponent() {
        return component;
    }

    boolean isLoaded() {
        return loaded && !disposed;
    }

    void execute(String js) {
        JBCefBrowser b = browser;
        if (b == null || disposed) return;
        CefBrowser cef = b.getCefBrowser();
        cef.executeJavaScript(js, cef.getURL(), 0);
    }

    private void ensureBrowser() {
        if (browser != null || disposed) return;
        String html;
        try {
            html = loadPageHtml();
        } catch (IOException e) {
            LOG.warn(e);
            component.add(new JBLabel("The FairyGUI preview could not load its page: " + e.getMessage(), SwingConstants.CENTER), BorderLayout.CENTER);
            component.revalidate();
            return;
        }
        JBCefBrowser b = JBCefBrowser.createBuilder().setEnableOpenDevToolsMenuItem(true).build();
        Disposer.register(this, b);
        browser = b;
        JBCefJSQuery query = JBCefJSQuery.create((JBCefBrowserBase) b);
        Disposer.register(this, query);
        query.addHandler(this::handle);
        b.getJBCefClient().addLoadHandler(new CefLoadHandlerAdapter() {
            @Override
            public void onLoadEnd(CefBrowser cefBrowser, CefFrame frame, int httpStatusCode) {
                String url = frame.getURL();
                if (!frame.isMain() || url == null || url.isEmpty() || url.startsWith("about:")) return;
                if (!started.compareAndSet(false, true)) return;
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (disposed) return;
                    execute("window.FguiHost={request:function(req){return new Promise(function(resolve,reject){"
                            + query.inject("req", "resolve", "function(code,msg){reject(new Error(msg))}")
                            + "});}};" + initScript.get());
                    loaded = true;
                });
            }
        }, b.getCefBrowser());
        b.loadHTML(html);
        component.add(b.getComponent(), BorderLayout.CENTER);
        component.revalidate();
    }

    private void pushInvalidate() {
        if (!isLoaded() || pendingInvalid.isEmpty()) return;
        List<String> paths = new ArrayList<>(pendingInvalid);
        pendingInvalid.removeAll(paths);
        StringBuilder sb = new StringBuilder("FguiPreview.invalidate([");
        for (int i = 0; i < paths.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(Json.str(paths.get(i)));
        }
        execute(sb.append("])").toString());
    }

    // ---------------------------------------------------------------- page requests

    private JBCefJSQuery.Response handle(String request) {
        try {
            Map<String, String> req = Json.parseFlat(request);
            String op = req.getOrDefault("op", "");
            return switch (op) {
                case "index" -> new JBCefJSQuery.Response(index());
                case "read" -> new JBCefJSQuery.Response(read(req.get("path"), "base64".equals(req.get("enc")), req.get("offset"), req.get("length")));
                case "nav" -> {
                    String id = req.get("id");
                    if (navigate != null && id != null && !id.isEmpty()) ApplicationManager.getApplication().invokeLater(() -> navigate.accept(id));
                    yield new JBCefJSQuery.Response("ok");
                }
                case "open" -> {
                    open(req.get("file"));
                    yield new JBCefJSQuery.Response("ok");
                }
                default -> new JBCefJSQuery.Response(null, 400, "unknown op " + op);
            };
        } catch (Throwable t) {
            return new JBCefJSQuery.Response(null, 404, String.valueOf(t.getMessage()));
        }
    }

    private String index() throws IOException {
        StringBuilder sb = new StringBuilder("{\"packages\":[");
        boolean first = true;
        for (VirtualFile dir : assets.getChildren()) {
            if (!dir.isDirectory()) continue;
            VirtualFile pkg = dir.findChild("package.xml");
            if (pkg == null) continue;
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"folder\":").append(Json.str(dir.getName())).append(",\"xml\":").append(Json.str(loadText(pkg))).append('}');
        }
        sb.append(']');
        VirtualFile settings = assets.getParent() != null ? assets.getParent().findChild("settings") : null;
        for (String[] s : new String[][]{{"common", "Common.json"}, {"adaptation", "Adaptation.json"}}) {
            VirtualFile f = settings != null ? settings.findChild(s[1]) : null;
            sb.append(",\"").append(s[0]).append("\":").append(f != null ? Json.str(loadText(f)) : "null");
        }
        return sb.append('}').toString();
    }

    /** Text files come back whole; binary files as "{total size}:{base64 of the requested slice}". */
    private String read(@Nullable String path, boolean base64, @Nullable String offset, @Nullable String length) throws IOException {
        if (path == null || path.contains("..") || path.startsWith("/") || path.contains("\\")) throw new IOException("bad path " + path);
        VirtualFile f = assets.findFileByRelativePath(path);
        if (f == null || f.isDirectory()) throw new IOException("not found: " + path);
        if (!base64) return loadText(f);
        byte[] all = bytesOf(f);
        int off = Math.max(0, Math.min(all.length, parseInt(offset, 0)));
        int end = Math.min(all.length, off + Math.max(0, parseInt(length, all.length)));
        return all.length + ":" + Base64.getEncoder().encodeToString(Arrays.copyOfRange(all, off, end));
    }

    private synchronized byte[] bytesOf(VirtualFile f) throws IOException {
        if (f.getPath().equals(cachedPath) && f.getModificationStamp() == cachedStamp) return cachedBytes;
        byte[] bytes;
        try (InputStream in = f.getInputStream()) {
            bytes = in.readAllBytes();
        }
        cachedPath = f.getPath();
        cachedStamp = f.getModificationStamp();
        cachedBytes = bytes;
        return bytes;
    }

    private static int parseInt(@Nullable String s, int dflt) {
        if (s == null || s.isEmpty()) return dflt;
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return dflt;
        }
    }

    static String loadText(VirtualFile f) throws IOException {
        Document d = ReadAction.compute(() -> FileDocumentManager.getInstance().getCachedDocument(f));
        if (d != null) return ReadAction.compute(d::getText);
        return VfsUtilCore.loadText(f);
    }

    private void open(@Nullable String path) {
        if (path == null || path.contains("..")) return;
        ApplicationManager.getApplication().invokeLater(() -> {
            VirtualFile f = assets.findFileByRelativePath(path);
            if (f != null && !project.isDisposed()) FileEditorManager.getInstance(project).openFile(f, true);
        });
    }

    private static String loadPageHtml() throws IOException {
        String html = pageHtml;
        if (html != null) return html;
        try (InputStream in = FguiPage.class.getResourceAsStream("/fguipreview/preview.html")) {
            if (in == null) throw new IOException("preview.html is missing from the plugin jar");
            html = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        pageHtml = html;
        return html;
    }

    @Override
    public void dispose() {
        disposed = true;
        invalidateTimer.stop();
    }
}
