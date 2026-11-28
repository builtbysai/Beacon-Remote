# Bundled fonts (Android host)

The app uses the same typefaces as the web workspace (`apps/web/public/fonts/`), licensed under the SIL Open Font
License 1.1. Android font resources cannot read WOFF2, so the files in `app/src/main/res/font/` are lossless TrueType
conversions of the web's variable WOFF2 files (same outlines, variation data and names; only the container differs).

| File                    | Family                     | Use                                           |
| ----------------------- | -------------------------- | --------------------------------------------- |
| `atkinson_next_var.ttf` | Atkinson Hyperlegible Next | All text; named at 400, 700 and 800           |
| `atkinson_mono_var.ttf` | Atkinson Hyperlegible Mono | Real codes only (pairing code, server address) |

Atkinson Hyperlegible was designed by the Braille Institute for character recognition. Latin subset only.
