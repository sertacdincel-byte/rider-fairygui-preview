package com.bytelab.fguipreview;

import java.util.HashMap;
import java.util.Map;

/** Minimal JSON helpers for the page bridge: string quoting and flat string-valued objects. */
final class Json {
    private Json() {
    }

    static String str(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder(s.length() + 16).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case ' ' -> sb.append("\\u2028");
                case ' ' -> sb.append("\\u2029");
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        return sb.append('"').toString();
    }

    /** Parses {"key":"value",...} where every value is a string, number, boolean or null. */
    static Map<String, String> parseFlat(String json) {
        Map<String, String> out = new HashMap<>();
        int[] pos = {skip(json, 0)};
        expect(json, pos, '{');
        while (true) {
            pos[0] = skip(json, pos[0]);
            if (peek(json, pos) == '}') break;
            String key = readString(json, pos);
            pos[0] = skip(json, pos[0]);
            expect(json, pos, ':');
            pos[0] = skip(json, pos[0]);
            String value;
            if (peek(json, pos) == '"') value = readString(json, pos);
            else {
                int start = pos[0];
                while (pos[0] < json.length() && ",} \t\r\n".indexOf(json.charAt(pos[0])) < 0) pos[0]++;
                value = json.substring(start, pos[0]);
                if ("null".equals(value)) value = null;
            }
            out.put(key, value);
            pos[0] = skip(json, pos[0]);
            if (peek(json, pos) == ',') pos[0]++;
            else break;
        }
        return out;
    }

    private static int skip(String s, int i) {
        while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        return i;
    }

    private static char peek(String s, int[] pos) {
        if (pos[0] >= s.length()) throw new IllegalArgumentException("unexpected end of JSON");
        return s.charAt(pos[0]);
    }

    private static void expect(String s, int[] pos, char c) {
        if (peek(s, pos) != c) throw new IllegalArgumentException("expected '" + c + "' at " + pos[0]);
        pos[0]++;
    }

    private static String readString(String s, int[] pos) {
        expect(s, pos, '"');
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = peek(s, pos);
            pos[0]++;
            if (c == '"') return sb.toString();
            if (c != '\\') {
                sb.append(c);
                continue;
            }
            char e = peek(s, pos);
            pos[0]++;
            switch (e) {
                case 'n' -> sb.append('\n');
                case 'r' -> sb.append('\r');
                case 't' -> sb.append('\t');
                case 'b' -> sb.append('\b');
                case 'f' -> sb.append('\f');
                case 'u' -> {
                    sb.append((char) Integer.parseInt(s.substring(pos[0], pos[0] + 4), 16));
                    pos[0] += 4;
                }
                default -> sb.append(e);
            }
        }
    }
}
