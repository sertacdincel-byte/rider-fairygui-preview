package com.bytelab.fguipreview;

import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorPolicy;
import com.intellij.openapi.fileEditor.FileEditorProvider;
import com.intellij.openapi.fileEditor.TextEditor;
import com.intellij.openapi.fileEditor.TextEditorWithPreview;
import com.intellij.openapi.fileEditor.TextEditorWithPreviewProvider;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;

/** Opens FairyGUI component XML files as a text editor with a live visual preview next to it. */
public final class FguiEditorProvider extends TextEditorWithPreviewProvider implements DumbAware {
    public FguiEditorProvider() {
        super(new PreviewProvider());
    }

    @Override
    public boolean accept(@NotNull Project project, @NotNull VirtualFile file) {
        return FguiProject.isComponent(file);
    }

    @Override
    public boolean acceptRequiresReadAction() {
        return false;
    }

    @Override
    public @NotNull String getEditorTypeId() {
        return "bytelab-fairygui-xml-preview";
    }

    @Override
    protected @NotNull FileEditor createSplitEditor(@NotNull TextEditor editor, @NotNull FileEditor preview) {
        if (preview instanceof FguiPreviewEditor p) p.attach(editor);
        return new TextEditorWithPreview(editor, preview, "FairyGUI", TextEditorWithPreview.Layout.SHOW_EDITOR);
    }

    private static final class PreviewProvider implements FileEditorProvider, DumbAware {
        @Override
        public boolean accept(@NotNull Project project, @NotNull VirtualFile file) {
            return FguiProject.isComponent(file);
        }

        @Override
        public boolean acceptRequiresReadAction() {
            return false;
        }

        @Override
        public @NotNull FileEditor createEditor(@NotNull Project project, @NotNull VirtualFile file) {
            return new FguiPreviewEditor(project, file);
        }

        @Override
        public @NotNull String getEditorTypeId() {
            return "bytelab-fairygui-preview";
        }

        @Override
        public @NotNull FileEditorPolicy getPolicy() {
            return FileEditorPolicy.PLACE_AFTER_DEFAULT_EDITOR;
        }
    }
}
