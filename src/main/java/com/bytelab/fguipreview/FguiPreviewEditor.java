package com.bytelab.fguipreview;

import com.intellij.openapi.application.ReadAction;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.ScrollType;
import com.intellij.openapi.editor.event.CaretEvent;
import com.intellij.openapi.editor.event.CaretListener;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorState;
import com.intellij.openapi.fileEditor.TextEditor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.UserDataHolderBase;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBLabel;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.JComponent;
import javax.swing.SwingConstants;
import javax.swing.Timer;
import java.beans.PropertyChangeListener;
import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** The preview half of the FairyGUI split editor. */
final class FguiPreviewEditor extends UserDataHolderBase implements FileEditor {
    private static final Pattern ELEMENT_ID = Pattern.compile(
            "<(?:image|component|text|richtext|graph|loader|loader3D|list|group|movieclip|swf|jta)\\b[^>]*?\\sid=\"([^\"]+)\"");

    private final VirtualFile file;
    private final @Nullable Document document;
    private final @Nullable FguiPage page;
    private final JComponent component;
    private final Timer sourceTimer;
    private final Timer highlightTimer;
    private @Nullable TextEditor textEditor;
    private String lastHighlight = "";

    FguiPreviewEditor(@NotNull Project project, @NotNull VirtualFile file) {
        this.file = file;
        this.document = FileDocumentManager.getInstance().getDocument(file);
        sourceTimer = singleShot(250, this::pushSource);
        highlightTimer = singleShot(120, this::pushHighlight);

        VirtualFile assets = FguiProject.findAssets(file);
        String relPath = assets != null ? FguiProject.relativePath(assets, file) : null;
        if (assets == null || relPath == null) {
            page = null;
            component = new JBLabel("This file is not inside a FairyGUI project (a folder with a .fairy file and an assets folder).", SwingConstants.CENTER);
            return;
        }
        boolean dark = !JBColor.isBright();
        page = new FguiPage(project, assets,
                () -> "FguiPreview.init({file:" + Json.str(relPath) + ",dark:" + dark + ",source:" + Json.str(currentText()) + "});",
                this::navigate, file.getPath(), this);
        component = page.getComponent();

        if (document != null) {
            document.addDocumentListener(new DocumentListener() {
                @Override
                public void documentChanged(@NotNull DocumentEvent event) {
                    sourceTimer.restart();
                }
            }, this);
        }
    }

    /** Connects the text editor of the split view: caret moves highlight elements, preview clicks move the caret. */
    void attach(@NotNull TextEditor editor) {
        this.textEditor = editor;
        editor.getEditor().getCaretModel().addCaretListener(new CaretListener() {
            @Override
            public void caretPositionChanged(@NotNull CaretEvent event) {
                highlightTimer.restart();
            }
        }, this);
    }

    private static Timer singleShot(int delayMs, Runnable action) {
        Timer t = new Timer(delayMs, e -> action.run());
        t.setRepeats(false);
        return t;
    }

    private String currentText() {
        if (document != null) return ReadAction.compute(document::getText);
        try {
            return VfsUtilCore.loadText(file);
        } catch (IOException e) {
            return "";
        }
    }

    private void pushSource() {
        if (page != null && page.isLoaded()) page.execute("FguiPreview.setSource(" + Json.str(currentText()) + ")");
    }

    private void pushHighlight() {
        TextEditor te = textEditor;
        if (page == null || !page.isLoaded() || te == null) return;
        Editor editor = te.getEditor();
        String id = elementIdAt(editor.getDocument().getCharsSequence(), editor.getCaretModel().getOffset());
        if (id.equals(lastHighlight)) return;
        lastHighlight = id;
        page.execute("FguiPreview.highlight(" + Json.str(id) + ")");
    }

    static String elementIdAt(CharSequence text, int offset) {
        String s = text.toString();
        int listStart = s.indexOf("<displayList");
        int listEnd = s.indexOf("</displayList>");
        if (listStart < 0 || offset < listStart || (listEnd >= 0 && offset > listEnd)) return "";
        Matcher m = ELEMENT_ID.matcher(s);
        String id = "";
        while (m.find() && m.start() <= offset) id = m.group(1);
        return id;
    }

    private void navigate(String id) {
        TextEditor te = textEditor;
        if (te == null) return;
        Editor editor = te.getEditor();
        String text = editor.getDocument().getText();
        int i = text.indexOf("id=\"" + id + "\"");
        if (i < 0) return;
        int start = text.lastIndexOf('<', i);
        lastHighlight = id;
        editor.getCaretModel().moveToOffset(start >= 0 ? start : i);
        editor.getScrollingModel().scrollToCaret(ScrollType.CENTER);
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
    public @NotNull String getName() {
        return "FairyGUI Preview";
    }

    @Override
    public void setState(@NotNull FileEditorState state) {
    }

    @Override
    public boolean isModified() {
        return false;
    }

    @Override
    public boolean isValid() {
        return file.isValid();
    }

    @Override
    public void addPropertyChangeListener(@NotNull PropertyChangeListener listener) {
    }

    @Override
    public void removePropertyChangeListener(@NotNull PropertyChangeListener listener) {
    }

    @Override
    public @NotNull VirtualFile getFile() {
        return file;
    }

    @Override
    public void dispose() {
        sourceTimer.stop();
        highlightTimer.stop();
    }
}
