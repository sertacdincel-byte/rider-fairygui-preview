package com.bytelab.fguipreview;

import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Locates the FairyGUI project (a folder with a *.fairy file and an assets/ folder) a file belongs to. */
final class FguiProject {
    private FguiProject() {
    }

    static @Nullable VirtualFile findAssets(@NotNull VirtualFile file) {
        return findAssetsFrom(file.getParent());
    }

    /** For a path that may no longer exist (a deleted file in a diff): starts from the nearest existing folder. */
    static @Nullable VirtualFile findAssetsForPath(@NotNull String path) {
        String p = path.replace('\\', '/');
        for (int slash = p.lastIndexOf('/'); slash > 0; slash = p.lastIndexOf('/', slash - 1)) {
            VirtualFile dir = LocalFileSystem.getInstance().findFileByPath(p.substring(0, slash));
            if (dir != null) return findAssetsFrom(dir);
        }
        return null;
    }

    private static @Nullable VirtualFile findAssetsFrom(@Nullable VirtualFile start) {
        for (VirtualFile d = start; d != null; d = d.getParent()) {
            if ("assets".equals(d.getName())) {
                VirtualFile root = d.getParent();
                if (root != null && hasProjectFile(root)) return d;
            }
        }
        return null;
    }

    private static boolean hasProjectFile(VirtualFile dir) {
        for (VirtualFile c : dir.getChildren()) {
            if (!c.isDirectory() && "fairy".equalsIgnoreCase(c.getExtension())) return true;
        }
        return false;
    }

    static boolean isComponent(@NotNull VirtualFile file) {
        if (file.isDirectory() || !"xml".equalsIgnoreCase(file.getExtension()) || "package.xml".equals(file.getName())) return false;
        if (!file.isInLocalFileSystem() || findAssets(file) == null) return false;
        try (InputStream in = file.getInputStream()) {
            String head = new String(in.readNBytes(512), StandardCharsets.UTF_8);
            return head.contains("<component");
        } catch (IOException e) {
            return false;
        }
    }

    static @Nullable String relativePath(@NotNull VirtualFile assets, @NotNull VirtualFile file) {
        return VfsUtilCore.getRelativePath(file, assets, '/');
    }

    static @Nullable String relativePath(@NotNull VirtualFile assets, @NotNull String path) {
        String base = assets.getPath() + "/";
        String p = path.replace('\\', '/');
        return p.startsWith(base) ? p.substring(base.length()) : null;
    }

    static boolean looksLikeComponent(@Nullable CharSequence text) {
        if (text == null) return false;
        String head = text.subSequence(0, Math.min(text.length(), 512)).toString();
        return head.contains("<component");
    }
}
